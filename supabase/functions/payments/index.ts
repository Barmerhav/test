/**
 * payments — the only place charges get initiated. Adapter chosen by the
 * `payment_provider` config key; the mock exercises the same async
 * webhook-settlement path a real Israeli PSP will use.
 *
 * Actions (POST JSON, Bearer = user JWT):
 *  { action: 'tokenize' }                              → { token, brand, last4 }
 *  { action: 'charge_subscription', subscription_id }  → { status: 'pending' }
 *  { action: 'charge_extra_roll', format }             → { status: 'pending' }
 */
import {
  HttpError,
  MOCK_WEBHOOK_SECRET,
  SUPABASE_URL,
  handle,
  json,
  readConfig,
  requireUser,
  serviceClient,
  userClient,
  waitUntil,
} from "../_shared/env.ts";

interface ChargeSetup {
  charge_id: string;
  amount_agorot: number;
  idempotency_key: string;
  provider: string;
  provider_token: string;
  status?: string;
}

async function emitMockWebhook(providerChargeId: string, outcome: "settle" | "fail", delaySeconds: number) {
  const fire = async () => {
    await fetch(`${SUPABASE_URL}/functions/v1/payments-webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mock-signature": MOCK_WEBHOOK_SECRET },
      body: JSON.stringify({
        type: outcome === "settle" ? "charge.settled" : "charge.failed",
        providerChargeId,
        raw: { mock: true },
      }),
    });
  };
  if (delaySeconds <= 0) await fire();
  else waitUntil(new Promise((r) => setTimeout(r, delaySeconds * 1000)).then(fire));
}

async function processCharge(setup: ChargeSetup) {
  const cfg = await readConfig(["payment_provider", "mock_payment"]);
  const providerName = String(cfg.payment_provider ?? "mock");

  if (setup.status && setup.status !== "pending") return; // idempotent re-call

  if (providerName === "mock") {
    const mock = (cfg.mock_payment ?? { settle_delay_seconds: 2, outcome: "settle" }) as {
      settle_delay_seconds: number;
      outcome: "settle" | "fail";
    };
    // deterministic mock charge id lets us mark it before the webhook lands
    const providerChargeId = `mock_ch_${setup.idempotency_key}`;
    const svc = serviceClient();
    const { error } = await svc.schema("api").rpc("service_mark_charge_provider", {
      p_charge_id: setup.charge_id,
      p_provider_charge_id: providerChargeId,
    });
    if (error) throw new HttpError(500, error.message);
    await emitMockWebhook(providerChargeId, mock.outcome, mock.settle_delay_seconds);
    return;
  }

  // Real PSP adapters (PayPlus/Cardcom/Tranzila) slot in here — same contract.
  throw new HttpError(501, `provider ${providerName} not wired yet`);
}

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const body = (await req.json()) as Record<string, string>;
    const svc = serviceClient();

    switch (body.action) {
      case "tokenize": {
        const cfg = await readConfig(["payment_provider"]);
        if (cfg.payment_provider !== "mock") throw new HttpError(501, "provider not wired yet");
        return json({ token: `mock_tok_${crypto.randomUUID()}`, brand: "Visa", last4: "4242" });
      }

      case "charge_subscription": {
        if (!body.subscription_id) throw new HttpError(400, "subscription_id required");
        // ownership check with the USER client (RLS) before service-side work
        const { data: own } = await userClient(req)
          .from("subscriptions")
          .select("id")
          .eq("id", body.subscription_id)
          .maybeSingle();
        if (!own) throw new HttpError(403, "not_authorized");

        const { data, error } = await svc.schema("api").rpc("service_charge_subscription", {
          p_subscription_id: body.subscription_id,
        });
        if (error) throw new HttpError(400, error.message);
        await processCharge(data as ChargeSetup);
        return json({ status: "pending" });
      }

      case "charge_extra_roll": {
        const { data, error } = await svc.schema("api").rpc("service_charge_extra_roll", {
          p_user_id: user.id,
          p_format: body.format ?? "large",
        });
        if (error) throw new HttpError(400, error.message);
        await processCharge(data as ChargeSetup);
        return json({ status: "pending" });
      }

      default:
        throw new HttpError(400, "unknown action");
    }
  }),
);
