/**
 * billing-worker — takes PENDING money movements to the provider:
 *  - renewal subscription charges created by the monthly reset
 *  - refunds created by zero-touch resolutions (on-demand expiry, leaks)
 * Mock provider settles them via the same webhook path a real PSP will use.
 * Scheduled every ~10 minutes; safe to run any time (idempotency keys).
 */
import {
  MOCK_WEBHOOK_SECRET,
  SUPABASE_URL,
  handle,
  json,
  readConfig,
  serviceClient,
} from "../_shared/env.ts";

async function emitMockWebhook(body: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/functions/v1/payments-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mock-signature": MOCK_WEBHOOK_SECRET },
    body: JSON.stringify(body),
  });
}

Deno.serve(
  handle(async (_req) => {
    const svc = serviceClient();
    const cfg = await readConfig(["payment_provider", "mock_payment"]);
    const providerName = String(cfg.payment_provider ?? "mock");
    if (providerName !== "mock") return json({ error: "real PSP billing not wired yet" }, 501);
    const outcome = ((cfg.mock_payment ?? {}) as { outcome?: string }).outcome === "fail" ? "charge.failed" : "charge.settled";

    // 1) pending charges: fresh renewals (no provider id yet) AND stuck ones
    //    whose settlement webhook never landed (provider id set, >3 min old)
    const staleCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: charges } = await svc
      .from("charges")
      .select("id, idempotency_key, provider_charge_id, created_at")
      .eq("status", "pending")
      .limit(50);

    let chargesProcessed = 0;
    for (const ch of (charges ?? []) as {
      id: string; idempotency_key: string; provider_charge_id: string | null; created_at: string;
    }[]) {
      if (ch.provider_charge_id && ch.created_at > staleCutoff) continue; // webhook still in flight
      const pcid = ch.provider_charge_id ?? `mock_ch_${ch.idempotency_key}`;
      if (!ch.provider_charge_id) {
        await svc.schema("api").rpc("service_mark_charge_provider", {
          p_charge_id: ch.id,
          p_provider_charge_id: pcid,
        });
      }
      await emitMockWebhook({ type: outcome, providerChargeId: pcid, raw: { mock: true, source: "billing-worker" } });
      chargesProcessed++;
    }

    // 2) pending refunds → mark settled directly (mock money went nowhere)
    const { data: refunds } = await svc
      .from("refunds")
      .select("id, charge_id")
      .eq("status", "pending")
      .limit(50);

    let refundsProcessed = 0;
    for (const rf of (refunds ?? []) as { id: string; charge_id: string }[]) {
      await svc.from("refunds")
        .update({ status: "settled", provider_refund_id: `mock_re_${rf.id}`, settled_at: new Date().toISOString() })
        .eq("id", rf.id);
      await svc.from("charges").update({ status: "refunded" }).eq("id", rf.charge_id);
      refundsProcessed++;
    }

    return json({ charges: chargesProcessed, refunds: refundsProcessed });
  }),
);
