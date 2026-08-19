/**
 * Live demo of the REAL backend on the local Postgres (no Docker needed):
 * runs the full two-sided loop through the actual RPCs with RLS enforced,
 * exactly as the app would call them. Narrated output.
 * Run: pnpm exec tsx scripts/demo-cli.ts   (after scripts/ci-db-reset.sh)
 */
import { callAs, pool, serviceQuery } from "../supabase/tests/helpers";

const RESIDENT = "d0000000-0000-4000-8000-000000000001"; // דנה, מנוי M פעיל
const RESIDENT2 = "d0000000-0000-4000-8000-000000000002"; // יוסי
const PICKER = "d0000000-0000-4000-8000-000000000101";   // רון, שליח מאומת
const ILS = (agorot: number) => `₪${(agorot / 100).toFixed(2)}`;

const step = (m: string) => console.log(`\n◆ ${m}`);
const ok = (m: string) => console.log(`  ✓ ${m}`);

async function main() {
  console.log("למטה (Lemata) — הלולאה הדו-צדדית, על המנוע האמיתי");
  console.log("─".repeat(56));

  step("דנה (דיירת): מצב חשבון");
  const [{ s }] = await callAs<{ s: any }>(RESIDENT, "select api.get_my_state() as s");
  ok(`מנוי ${s.subscription.plan.code} פעיל · מכסה ${s.subscription.units_included - s.subscription.units_used}/${s.subscription.units_included} · בניין: ${s.residency.street} ${s.residency.house_number} (${s.residency.meter_doors} דלתות)`);

  step('דנה לוחצת "השקית מוכנה" — שקית אחת, עד היום');
  const [{ r }] = await callAs<{ r: any }>(
    RESIDENT, "select to_jsonb(api.submit_request(1, 'today', 'ליד הדלת הירוקה')) as r");
  ok(`בקשה פתוחה · מקורות מימון: ${JSON.stringify(r.units_source)} · דדליין ${new Date(r.expires_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`);

  step("רון (שליח): הפיד");
  const feed = await callAs<any>(PICKER, "select * from api.open_feed()");
  const card = feed.find((f: any) => f.request_id === r.id)!;
  ok(`"רח׳ ${card.street} · ${card.units} שקיות · ${ILS(card.payout_agorot)} · עד ${new Date(card.expires_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}"`);

  step("רון תופס (soft-lock, race-safe)");
  const [{ c }] = await callAs<{ c: any }>(PICKER, "select api.claim_request($1) as c", [r.id]);
  const claimId = c.claims[0].claim_id;
  ok(`claim ${claimId.slice(0, 8)}… · דדליין איסוף ${new Date(c.deadline_at).toLocaleTimeString("he-IL")}`);

  step("חשיפת קוד הכניסה (מוצפן → מפוענח רק עכשיו, מתועד)");
  const [{ rv }] = await callAs<{ rv: any }>(PICKER, "select api.reveal_entry_code($1) as rv", [claimId]);
  const [audit] = await serviceQuery<{ n: string }>(
    "select count(*)::text as n from public.code_reveal_audit where claim_id = $1", [claimId]);
  ok(`קוד: ${rv.code} · פג ב-${new Date(rv.reveal_expires_at).toLocaleTimeString("he-IL")} · שורות ביקורת: ${audit!.n}`);

  step('איסוף עם צ׳יפ "3 קטנות = 1" (השרת סופר מחדש)');
  await callAs(PICKER,
    `select api.mark_collected($1, '{"large_bags":0,"small_bags":3,"oversized_bags":0}'::jsonb)`, [claimId]);
  ok("נאסף · 3 קטנות = שקית אחת במכסה (אימות בצד השרת)");

  step("סריקת ה-QR שעל הפח → תשלום");
  const [{ v }] = await callAs<{ v: any }>(
    PICKER, "select api.verify_bin_scan($1, 'BIN-DEMO-0001') as v", [claimId]);
  ok(`+${ILS(v.amount_agorot)} · סה"כ היום ${ILS(v.today_total_agorot)}`);

  const events = await serviceQuery<{ to_status: string }>(
    "select to_status from public.request_events where request_id = $1 order by id", [r.id]);
  ok(`שרשרת מלאה ב-audit: ${events.map((e) => e.to_status).join(" → ")}`);

  step("תרחיש כשל: הבקשה של יוסי פגה — זיכוי אוטומטי");
  const [{ r2 }] = await callAs<{ r2: any }>(
    RESIDENT2, "select to_jsonb(api.submit_request(1, 'today', null)) as r2");
  await serviceQuery("update public.requests set expires_at = now() - interval '1 minute' where id = $1", [r2.id]);
  await serviceQuery("select internal.tick_minutely()");
  const credits = await serviceQuery<{ units_granted: number; reason: string }>(
    "select units_granted, reason from public.credits where user_id = $1", [RESIDENT2]);
  const outbox = await serviceQuery<{ template_key: string }>(
    "select template_key from public.notification_outbox where user_id = $1 order by id desc limit 1", [RESIDENT2]);
  ok(`זיכוי ${credits[0]!.units_granted} (${credits[0]!.reason}) + פוש "${outbox[0]!.template_key}" — בלי מגע יד אדם`);

  step("ריצת שכר שבועית + חשבונית עצמית");
  const [{ b }] = await serviceQuery<{ b: string }>("select internal.run_payout() as b");
  const payouts = await serviceQuery<{ total_units: number; amount_exvat_agorot: number; vat_agorot: number; total_agorot: number }>(
    "select total_units, amount_exvat_agorot, vat_agorot, total_agorot from public.payouts where batch_id = $1", [b]);
  const invoices = await serviceQuery<{ invoice_number: string; tax_status_snapshot: string }>(
    "select invoice_number, tax_status_snapshot from public.invoices_selfbilled order by issued_at desc limit 3");
  for (const p of payouts) {
    ok(`payout: ${p.total_units} שקיות · ${ILS(p.amount_exvat_agorot)} + מע"מ ${ILS(p.vat_agorot)} = ${ILS(p.total_agorot)}`);
  }
  ok(`חשבוניות: ${invoices.map((i) => `${i.invoice_number} (${i.tax_status_snapshot})`).join(" · ")}`);

  console.log("\n" + "─".repeat(56));
  console.log("✅ submit → claim → reveal → collect → scan → paid + זיכוי-תקלה + שכר — הכל על המנוע האמיתי, עם RLS.");
  await pool.end();
}

main().catch(async (e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  await pool.end();
  process.exit(1);
});
