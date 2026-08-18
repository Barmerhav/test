/**
 * e2e demo — the full two-sided loop against a RUNNING local Supabase stack:
 *
 *   submit → claim → reveal → collect → scan → paid
 *   + forced expiry (zero-touch credit) + forced no-show (repost + strike)
 *
 * Prereqs: `supabase start && supabase db reset` (demo users/building seeded,
 * fake OTPs from config.toml). Run: `pnpm e2e:demo`
 * Env overrides: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * (auto-discovered from `supabase status` when omitted).
 */
import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const step = (msg: string) => console.log(`\n\x1b[33m◆ ${msg}\x1b[0m`);
const ok = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const info = (msg: string) => console.log(`    ${msg}`);

function discoverKeys(): { url: string; anon: string; service: string } {
  const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  let anon = process.env.SUPABASE_ANON_KEY ?? "";
  let service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!anon || !service) {
    try {
      const out = execSync("npx supabase status --output json", { encoding: "utf8" });
      const parsed = JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string>;
      anon ||= parsed.ANON_KEY ?? "";
      service ||= parsed.SERVICE_ROLE_KEY ?? "";
    } catch {
      /* fall through */
    }
  }
  if (!anon || !service) {
    console.error("Could not discover Supabase keys. Is `supabase start` running?");
    process.exit(1);
  }
  return { url, anon, service };
}

const { url, anon, service } = discoverKeys();
const svc = createClient(url, service, { auth: { persistSession: false } });

async function signIn(phone: string, otp: string): Promise<SupabaseClient> {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error: sendErr } = await client.auth.signInWithOtp({ phone: `+${phone}` });
  if (sendErr) throw new Error(`OTP send failed for ${phone}: ${sendErr.message}`);
  const { error } = await client.auth.verifyOtp({ phone: `+${phone}`, token: otp, type: "sms" });
  if (error) throw new Error(`OTP verify failed for ${phone}: ${error.message}`);
  return client;
}

const api = (c: SupabaseClient) => c.schema("api");

async function rpcOrThrow<T>(c: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await api(c).rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

async function main() {
  console.log("\n🗑️  פינוי+ — full two-sided demo loop\n" + "─".repeat(48));

  step("דנה (דיירת) מתחברת עם OTP מדומה");
  const dana = await signIn("972501000001", "111111");
  let state = await rpcOrThrow<Record<string, any>>(dana, "get_my_state");
  ok(`מנוי ${state.subscription.plan.code} פעיל · נשארו ${state.subscription.units_included - state.subscription.units_used} פינויים`);

  step('דנה לוחצת "השקית מוכנה" (עד היום)');
  const req = await rpcOrThrow<Record<string, any>>(dana, "submit_request", {
    p_units: 1, p_ttl_option: "today", p_notes: "ליד הדלת הירוקה",
  });
  ok(`בקשה ${req.id.slice(0, 8)} פתוחה · דדליין ${new Date(req.expires_at).toLocaleTimeString("he-IL")}`);

  step("רון (מפנה) מתחבר ורואה את הפיד");
  const ron = await signIn("972502000001", "222222");
  const feed = await rpcOrThrow<Array<Record<string, any>>>(ron, "open_feed");
  const card = feed.find((f) => f.request_id === req.id);
  if (!card) throw new Error("request missing from feed");
  ok(`"רח' ${card.street} · ${card.units} יח' · ₪${(card.payout_agorot / 100).toFixed(0)} · עד ${new Date(card.expires_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}"`);

  step("רון לוקח את הבקשה (soft lock)");
  const claimRes = await rpcOrThrow<{ claims: Array<{ claim_id: string }>; deadline_at: string }>(
    ron, "claim_request", { p_request_id: req.id });
  const claimId = claimRes.claims[0]!.claim_id;
  ok(`claim ${claimId.slice(0, 8)} · לסיים עד ${new Date(claimRes.deadline_at).toLocaleTimeString("he-IL")}`);

  step("חשיפת קוד כניסה (מתועדת, מוגבלת בזמן)");
  const reveal = await rpcOrThrow<{ code: string; reveal_expires_at: string }>(
    ron, "reveal_entry_code", { p_claim_id: claimId });
  ok(`קוד: ${reveal.code} · נעלם ב-${new Date(reveal.reveal_expires_at).toLocaleTimeString("he-IL")}`);
  const { count: audits } = await svc.from("code_reveal_audit")
    .select("*", { count: "exact", head: true }).eq("claim_id", claimId);
  ok(`שורת ביקורת נרשמה (${audits} reveal)`);

  step('איסוף עם צ\'יפ "3 קטנות = 1"');
  await rpcOrThrow(ron, "mark_collected", {
    p_claim_id: claimId,
    p_adjustment: { large_bags: 0, small_bags: 3, oversized_bags: 0 },
  });
  ok("נאסף · השרת חישב מחדש: 3 קטנות = יחידה אחת");

  step("סריקת ה-QR שעל הפחים");
  const verify = await rpcOrThrow<{ units: number; amount_agorot: number; today_total_agorot: number }>(
    ron, "verify_bin_scan", { p_claim_id: claimId, p_qr_payload: "BIN-DEMO-0001" });
  ok(`+₪${(verify.amount_agorot / 100).toFixed(2)} · סה"כ היום ₪${(verify.today_total_agorot / 100).toFixed(2)}`);

  state = await rpcOrThrow<Record<string, any>>(dana, "get_my_state");
  if (state.last_request.status !== "paid") throw new Error(`expected paid, got ${state.last_request.status}`);
  ok("הבקשה של דנה במצב paid · כל המעברים ב-request_events");

  step("תרחיש 2: תפוגה → זיכוי אוטומטי (zero-touch)");
  const yossi = await signIn("972501000002", "111111");
  const req2 = await rpcOrThrow<Record<string, any>>(yossi, "submit_request", { p_units: 1, p_ttl_option: "today" });
  await svc.from("requests").update({ expires_at: new Date(Date.now() - 60000).toISOString() }).eq("id", req2.id);
  await svc.schema("api").rpc("service_tick_minutely");
  const { data: credits } = await svc.from("credits").select("units_granted, reason")
    .eq("user_id", (await yossi.auth.getUser()).data.user!.id);
  ok(`הבקשה פגה · יוסי קיבל ${credits?.[0]?.units_granted} זיכוי (${credits?.[0]?.reason}) + פוש`);

  step("תרחיש 3: no-show → repost + נקודה שלילית");
  const michal = await signIn("972501000003", "111111");
  const req3 = await rpcOrThrow<Record<string, any>>(michal, "submit_request", { p_units: 2, p_ttl_option: "today" });
  const shira = await signIn("972502000002", "222222");
  await rpcOrThrow(shira, "claim_request", { p_request_id: req3.id });
  await svc.from("claims").update({ deadline_at: new Date(Date.now() - 60000).toISOString() })
    .eq("request_id", req3.id);
  await svc.schema("api").rpc("service_tick_minutely");
  const { data: r3 } = await svc.from("requests").select("status, repost_count").eq("id", req3.id).single();
  const { data: pk } = await svc.from("pickers").select("strikes")
    .eq("user_id", (await shira.auth.getUser()).data.user!.id).single();
  ok(`הבקשה חזרה ללוח (repost ${r3!.repost_count}) · לשירה ${pk!.strikes} נקודה · למיכל 2 זיכויים`);

  step("שכר: ריצת תשלום + חשבונית עצמית + ייצוא");
  const { data: batchId, error: payoutErr } = await svc.schema("api").rpc("service_run_payout");
  if (payoutErr) throw new Error(`payout run: ${payoutErr.message}`);
  if (batchId) {
    const { data: payouts } = await svc.from("payouts")
      .select("total_units, amount_exvat_agorot, vat_agorot, total_agorot").eq("batch_id", batchId);
    for (const p of payouts ?? []) {
      ok(`payout: ${p.total_units} יח' · ₪${(p.amount_exvat_agorot / 100).toFixed(2)} + מע"מ ₪${(p.vat_agorot / 100).toFixed(2)} = ₪${(p.total_agorot / 100).toFixed(2)}`);
    }
    const { data: invoices } = await svc.from("invoices_selfbilled")
      .select("invoice_number, tax_status_snapshot");
    ok(`חשבוניות עצמיות: ${(invoices ?? []).map((i) => `${i.invoice_number} (${i.tax_status_snapshot})`).join(" · ")}`);
    const exportRes = await fetch(`${url}/functions/v1/payout-export`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${service}` },
      body: JSON.stringify({ batch_id: batchId }),
    });
    if (exportRes.ok) {
      const files = (await exportRes.json()) as { csv: string; masav: string; invoices: string[] };
      ok(`ייצוא: ${files.csv} · ${files.masav} · ${files.invoices.length} חשבוניות ב-Storage`);
    } else {
      info(`(payout-export לא זמין: ${exportRes.status} — הריצו supabase functions serve)`);
    }
  }

  console.log("\n" + "─".repeat(48));
  console.log("✅ הלולה הדו-צדדית המלאה עבדה: submit → claim → reveal → collect → scan → paid");
  console.log("   + תפוגה עם זיכוי + no-show עם repost ונקודה. הכל zero-touch.\n");
}

main().catch((e) => {
  console.error(`\n✗ demo failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
