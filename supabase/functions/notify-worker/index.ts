/**
 * notify-worker — drains notification_outbox → Expo push. Runs every minute
 * (scheduled) or on demand. Templates resolve against the strings table AT
 * SEND TIME (push copy is admin-editable); params never contain entry codes
 * or apartment-level addresses.
 */
import { createExpoPushProvider } from "@pinui/providers/push";
import { formatILS } from "../../../packages/shared/src/money/index.ts";
import { handle, json, serviceClient } from "../_shared/env.ts";

interface OutboxRow {
  id: number;
  user_id: string;
  template_key: string;
  params: Record<string, unknown>;
  attempts: number;
}

function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (k === "amount" && typeof params.amount_agorot === "number") {
      return formatILS(params.amount_agorot, { isolate: false });
    }
    const v = params[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** A crashed run may leave rows claimed as 'sending' — recover after this. */
const STALE_CLAIM_MS = 5 * 60 * 1000;

Deno.serve(
  handle(async (_req) => {
    const svc = serviceClient();
    const push = createExpoPushProvider();

    // recover rows a crashed run left claimed
    await svc
      .from("notification_outbox")
      .update({ status: "pending" })
      .eq("status", "sending")
      .lt("claimed_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString());

    const { data: rows, error } = await svc
      .from("notification_outbox")
      .select("id, user_id, template_key, params, attempts")
      .eq("status", "pending")
      .order("id")
      .limit(50);
    if (error) return json({ error: error.message }, 500);

    let sent = 0;
    let skipped = 0;
    for (const row of (rows ?? []) as OutboxRow[]) {
      // claim the row atomically — overlapping runs must never double-send
      const { data: claimed } = await svc
        .from("notification_outbox")
        .update({ status: "sending", claimed_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed || claimed.length === 0) continue; // another run owns it

      try {
        const [{ data: devices }, { data: userRow }] = await Promise.all([
          svc.from("devices").select("expo_push_token").eq("user_id", row.user_id),
          svc.from("users").select("locale").eq("id", row.user_id).maybeSingle(),
        ]);
        const tokens = (devices ?? []).map((d: { expo_push_token: string }) => d.expo_push_token);
        if (tokens.length === 0) {
          // no device YET is retryable — the user may register one; only the
          // attempts cap turns it into a terminal skip
          const noTokenDone = row.attempts + 1 >= 3;
          await svc.from("notification_outbox")
            .update({
              status: noTokenDone ? "skipped" : "pending",
              attempts: row.attempts + 1,
              last_error: "no device token",
              ...(noTokenDone ? { sent_at: new Date().toISOString() } : {}),
            })
            .eq("id", row.id)
            .eq("status", "sending");
          skipped++;
          continue;
        }

        const locale = (userRow as { locale?: string } | null)?.locale ?? "he";
        const { data: strs } = await svc
          .from("strings")
          .select("key, locale, value")
          .in("key", [`${row.template_key}.title`, `${row.template_key}.body`]);
        const pick = (suffix: string) => {
          const cands = (strs ?? []).filter(
            (s: { key: string }) => s.key === `${row.template_key}.${suffix}`,
          ) as { locale: string; value: string }[];
          return (
            cands.find((s) => s.locale === locale)?.value ??
            cands.find((s) => s.locale === "he")?.value ??
            cands.find((s) => s.locale === "en")?.value ??
            row.template_key
          );
        };

        await push.send({
          tokens,
          title: interpolate(pick("title"), row.params),
          body: interpolate(pick("body"), row.params),
          data: { template: row.template_key },
        });
        await svc.from("notification_outbox")
          .update({ status: "sent", sent_at: new Date().toISOString(), attempts: row.attempts + 1 })
          .eq("id", row.id)
          .eq("status", "sending");
        sent++;
      } catch (e) {
        const failedForGood = row.attempts + 1 >= 3;
        await svc.from("notification_outbox")
          .update({
            status: failedForGood ? "failed" : "pending",
            attempts: row.attempts + 1,
            last_error: String(e).slice(0, 500),
          })
          .eq("id", row.id)
          .eq("status", "sending");
      }
    }
    return json({ sent, skipped });
  }),
);
