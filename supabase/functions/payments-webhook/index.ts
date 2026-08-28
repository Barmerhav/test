/**
 * payments-webhook — the single settlement entry point for EVERY provider
 * (mock today, PayPlus/Cardcom/Tranzila later). Verifies the signature, then
 * hands the outcome to internal.settle_charge (via the service-only wrapper),
 * which does all side effects atomically: subscription activation, bag-roll
 * grant, past_due recovery, referral rewards.
 */
import { createMockPaymentProvider, type PaymentEvent } from "../../../packages/providers/src/payment.ts";
import {
  HttpError,
  MOCK_WEBHOOK_SECRET,
  SUPABASE_URL,
  handle,
  json,
  readConfig,
  serviceClient,
} from "../_shared/env.ts";

Deno.serve(
  handle(async (req) => {
    const cfg = await readConfig(["payment_provider"]);
    const providerName = String(cfg.payment_provider ?? "mock");

    let event: PaymentEvent;
    if (providerName === "mock") {
      const mock = createMockPaymentProvider({
        webhookUrl: `${SUPABASE_URL}/functions/v1/payments-webhook`,
        webhookSecret: MOCK_WEBHOOK_SECRET,
        settleDelaySeconds: 0,
        outcome: "settle",
      });
      event = await mock.verifyWebhook(req);
    } else {
      throw new HttpError(501, `provider ${providerName} not wired yet`);
    }

    const outcome =
      event.type === "charge.settled" || event.type === "refund.settled" ? "settled" : "failed";

    const { data, error } = await serviceClient()
      .schema("api")
      .rpc("service_settle_charge", {
        p_provider_charge_id: event.providerChargeId,
        p_outcome: outcome,
        p_failure_reason: outcome === "failed" ? event.type : null,
      });
    if (error) throw new HttpError(400, error.message);
    return json({ ok: true, result: data });
  }),
);
