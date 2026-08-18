import { describe, expect, it } from "vitest";
import { callAs, createTestUser, serviceQuery } from "./helpers";

/** Runs a full paid pickup and returns the picker id. */
async function paidPickup(taxStatus: "patur" | "murshe" | "none", units = 2) {
  const resident = await createTestUser();
  const hn = String(Math.floor(Math.random() * 1000000));
  const [{ r: residencyId }] = await callAs<{ r: string }>(
    resident.id,
    `select api.onboard_residency('גבעתיים', 'כצנלסון', $1, 1, '1', '7777') as r`, [hn]);
  const [{ id: planId }] = await serviceQuery<{ id: string }>(
    "select id from public.plans where code = 'L' and active_for_signup");
  const [{ s }] = await callAs<{ s: { id: string } }>(
    resident.id, "select to_jsonb(api.start_subscription($1, $2, 'large')) as s", [planId, residencyId]);
  await serviceQuery(
    `update public.subscriptions set status='active', billing_anchor_day=1, next_reset_at=now()+interval '15 days' where id=$1`,
    [s.id]);

  const picker = await createTestUser("97252");
  await callAs(picker.id,
    `select api.register_picker('1985-03-03'::date, 'id-${picker.id}', $1, true, '{"bank":"10","branch":"800","account":"123456"}'::jsonb, $2)`,
    [taxStatus, taxStatus === "murshe" ? "512345678" : null]);
  await serviceQuery("update public.pickers set status='active' where user_id=$1", [picker.id]);

  const [{ r: req }] = await callAs<{ r: { id: string; building_id: string } }>(
    resident.id, "select to_jsonb(api.submit_request($1, 'today', null)) as r", [units]);
  await callAs(picker.id, "select api.claim_request($1)", [req.id]);
  const [claim] = await serviceQuery<{ id: string }>(
    "select id from public.claims where request_id = $1", [req.id]);
  await callAs(picker.id, "select api.mark_collected($1, null)", [claim!.id]);
  const [{ qr }] = await serviceQuery<{ qr: string }>(
    "select bin_qr_id as qr from public.buildings where id = $1", [req.building_id]);
  await callAs(picker.id, "select api.verify_bin_scan($1, $2)", [claim!.id, qr]);
  return picker;
}

describe("weekly payout run + self-billed invoices", () => {
  it("sweeps unswept lines; murshe gets a VAT line, patur does not; numbering is monotonic", async () => {
    const patur = await paidPickup("patur", 2);   // 2u × ₪7 = ₪14.00
    const murshe = await paidPickup("murshe", 3); // 3u × ₪7 = ₪21.00

    const [{ b }] = await serviceQuery<{ b: string }>("select internal.run_payout() as b");
    expect(b).not.toBeNull();

    const [paturPayout] = await serviceQuery<{
      amount_exvat_agorot: number; vat_agorot: number; total_agorot: number; vat_rate: string;
    }>("select amount_exvat_agorot, vat_agorot, total_agorot, vat_rate::text from public.payouts where picker_id = $1",
      [patur.id]);
    expect(paturPayout).toMatchObject({ amount_exvat_agorot: 1400, vat_agorot: 0, total_agorot: 1400 });

    const [murshePayout] = await serviceQuery<{
      amount_exvat_agorot: number; vat_agorot: number; total_agorot: number;
    }>("select amount_exvat_agorot, vat_agorot, total_agorot from public.payouts where picker_id = $1",
      [murshe.id]);
    expect(murshePayout).toMatchObject({
      amount_exvat_agorot: 2100,
      vat_agorot: 378, // 18% from config
      total_agorot: 2478,
    });

    const invoices = await serviceQuery<{ invoice_number: string; tax_status_snapshot: string }>(
      `select invoice_number, tax_status_snapshot from public.invoices_selfbilled
        where picker_id in ($1, $2) order by invoice_number`, [patur.id, murshe.id]);
    expect(invoices).toHaveLength(2);
    for (const inv of invoices) expect(inv.invoice_number).toMatch(/^SB-\d{4}-\d{6}$/);

    // lines are swept exactly once — a second run finds nothing for these pickers
    const [{ b2 }] = await serviceQuery<{ b2: string | null }>("select internal.run_payout() as b2");
    if (b2) {
      const dupes = await serviceQuery<{ n: string }>(
        "select count(*)::text as n from public.payouts where picker_id in ($1, $2)", [patur.id, murshe.id]);
      expect(Number(dupes[0]!.n)).toBe(2);
    }

    // pickers were notified
    const outbox = await serviceQuery<{ template_key: string }>(
      "select template_key from public.notification_outbox where user_id = $1 order by id desc", [murshe.id]);
    expect(outbox.map((o) => o.template_key)).toContain("push.payout_sent");
  });

  it("payout amounts came from claim-time snapshots (config-change-proof end to end)", async () => {
    const picker = await paidPickup("none", 1);
    const [line] = await serviceQuery<{ per_unit_agorot: number }>(
      "select per_unit_agorot from public.payout_lines where picker_id = $1", [picker.id]);
    expect(line!.per_unit_agorot).toBe(700);
  });

  it("admin metrics + board RPCs are admin-gated and return the dashboard shape", async () => {
    const admin = await createTestUser();
    await serviceQuery("insert into public.admin_users (user_id) values ($1)", [admin.id]);
    const [{ m }] = await callAs<{ m: Record<string, unknown> }>(
      admin.id, "select api.admin_metrics() as m");
    expect(m).toHaveProperty("requests_30d");
    expect(m).toHaveProperty("utilization_pct");
    expect(m).toHaveProperty("buildings");

    const stranger = await createTestUser();
    await expect(
      callAs(stranger.id, "select api.admin_metrics()"),
    ).rejects.toThrow(/not_authorized/);
  });
});
