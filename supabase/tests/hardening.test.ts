import { describe, expect, it } from "vitest";
import { callAs, createTestUser, expectRpcError, serviceQuery } from "./helpers";

async function subscribedResident() {
  const user = await createTestUser();
  const hn = String(Math.floor(Math.random() * 1000000));
  const [{ r: residencyId }] = await callAs<{ r: string }>(
    user.id,
    `select api.onboard_residency('פתח תקווה', 'רוטשילד', $1, 3, '6', '1470') as r`, [hn]);
  const [{ id: planId }] = await serviceQuery<{ id: string }>(
    "select id from public.plans where code = 'L' and active_for_signup");
  const [{ s }] = await callAs<{ s: { id: string } }>(
    user.id, "select to_jsonb(api.start_subscription($1, $2, 'large')) as s", [planId, residencyId]);
  await serviceQuery(
    `update public.subscriptions set status='active', billing_anchor_day=10,
        next_reset_at = now() + interval '12 days' where id = $1`, [s.id]);
  return { user, residencyId, subId: s.id, planId };
}

async function activePicker() {
  const user = await createTestUser("97252");
  await callAs(user.id,
    `select api.register_picker('1991-01-01'::date, 'h-${Math.random()}', 'patur', true)`);
  await serviceQuery("update public.pickers set status = 'active' where user_id = $1", [user.id]);
  return user;
}

describe("fail-closed auth (anon NULL-guard bypass)", () => {
  it("anon cannot cancel someone else's request", async () => {
    const { user } = await subscribedResident();
    const [{ r: req }] = await callAs<{ r: { id: string } }>(
      user.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");
    await expectRpcError(
      callAs(null, "select api.cancel_request($1)", [req.id]),
      "not_authorized",
    );
    const [row] = await serviceQuery<{ status: string }>(
      "select status from public.requests where id = $1", [req.id]);
    expect(row!.status).toBe("open"); // untouched
  });

  it("another resident cannot cancel it either", async () => {
    const { user } = await subscribedResident();
    const stranger = await createTestUser();
    const [{ r: req }] = await callAs<{ r: { id: string } }>(
      user.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");
    await expectRpcError(
      callAs(stranger.id, "select api.cancel_request($1)", [req.id]),
      "not_authorized",
    );
  });

  it("anon cannot execute api functions at all (PUBLIC default stripped)", async () => {
    await expect(
      callAs(null, "select api.get_my_state()", [], { role: "anon" }),
    ).rejects.toThrow(/permission denied|not_authorized/);
  });
});

describe("payout run under concurrency (the double-payment race)", () => {
  it("two concurrent run_payout calls produce exactly one payout + one invoice", async () => {
    const { user: resident } = await subscribedResident();
    const picker = await activePicker();
    const [{ r: req }] = await callAs<{ r: { id: string; building_id: string } }>(
      resident.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);
    await callAs(picker.id, "select api.mark_collected($1, null)", [claim!.id]);
    const [{ qr }] = await serviceQuery<{ qr: string }>(
      "select bin_qr_id as qr from public.buildings where id = $1", [req.building_id]);
    await callAs(picker.id, "select api.verify_bin_scan($1, $2)", [claim!.id, qr]);

    await Promise.all([
      serviceQuery("select internal.run_payout()"),
      serviceQuery("select internal.run_payout()"),
    ]);

    const payouts = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.payouts where picker_id = $1", [picker.id]);
    expect(Number(payouts[0]!.n)).toBe(1);
    const invoices = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.invoices_selfbilled where picker_id = $1", [picker.id]);
    expect(Number(invoices[0]!.n)).toBe(1);
  });
});

describe("collected-but-never-scanned auto-completes after the grace window", () => {
  it("inside grace: claim stays active; after grace: paid + flagged + payout line", async () => {
    const { user: resident } = await subscribedResident();
    const picker = await activePicker();
    const [{ r: req }] = await callAs<{ r: { id: string } }>(
      resident.id, "select to_jsonb(api.submit_request(2, 'today', null)) as r");
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);
    await callAs(picker.id, "select api.mark_collected($1, null)", [claim!.id]);

    // deadline passed but still inside scan grace → untouched
    await serviceQuery(
      "update public.claims set deadline_at = now() - interval '5 minutes' where id = $1", [claim!.id]);
    await serviceQuery("select internal.lapse_claims()");
    let [c] = await serviceQuery<{ status: string }>(
      "select status from public.claims where id = $1", [claim!.id]);
    expect(c!.status).toBe("active");

    // beyond grace (60m seed) → auto-complete: paid, payout line, flag
    await serviceQuery(
      "update public.claims set deadline_at = now() - interval '2 hours' where id = $1", [claim!.id]);
    await serviceQuery("select internal.lapse_claims()");
    const [r] = await serviceQuery<{ status: string }>(
      "select status from public.requests where id = $1", [req.id]);
    expect(r!.status).toBe("paid");
    const [line] = await serviceQuery<{ amount_agorot: number }>(
      "select amount_agorot from public.payout_lines where claim_id = $1", [claim!.id]);
    expect(line!.amount_agorot).toBe(1400);
    const flagged = await serviceQuery<{ n: string }>(
      `select count(*)::text as n from public.request_events
        where request_id = $1 and (meta->>'auto_completed')::boolean`, [req.id]);
    expect(Number(flagged[0]!.n)).toBe(1);
    const [pk] = await serviceQuery<{ strikes: number }>(
      "select strikes from public.pickers where user_id = $1", [picker.id]);
    expect(pk!.strikes).toBe(0); // no strike — the work was done
  });
});

describe("failed charges are retryable", () => {
  it("a failed charge no longer blocks its idempotency key", async () => {
    const u = await createTestUser();
    const [first] = await serviceQuery<{ id: string }>(
      "select id from internal.create_charge($1, 'on_demand', 2200, 'mock', 'retry-test-key')", [u.id]);
    await serviceQuery("select internal.mark_charge_provider_id($1, 'rt_1')", [first!.id]);
    await serviceQuery("select internal.settle_charge('rt_1', 'failed', 'card_declined')");

    const [second] = await serviceQuery<{ id: string; idempotency_key: string; status: string }>(
      "select id, idempotency_key, status from internal.create_charge($1, 'on_demand', 2200, 'mock', 'retry-test-key')", [u.id]);
    expect(second!.id).not.toBe(first!.id);
    expect(second!.status).toBe("pending");
    expect(second!.idempotency_key).toBe("retry-test-key#r1");

    // but a PENDING/settled charge still replays idempotently
    const [third] = await serviceQuery<{ id: string }>(
      "select id from internal.create_charge($1, 'on_demand', 2200, 'mock', 'retry-test-key')", [u.id]);
    expect(third!.id).toBe(second!.id);
  });
});

describe("subscription lifecycle exploits closed", () => {
  it("abandoned pending_payment no longer blocks a fresh signup", async () => {
    const { user, residencyId, planId } = await subscribedResident();
    // make the existing sub an abandoned checkout
    await serviceQuery(
      "update public.subscriptions set status = 'pending_payment' where user_id = $1", [user.id]);
    const [{ s }] = await callAs<{ s: { id: string; status: string } }>(
      user.id, "select to_jsonb(api.start_subscription($1, $2, 'small')) as s", [planId, residencyId]);
    expect(s.status).toBe("pending_payment");
    const canceled = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.subscriptions where user_id = $1 and status = 'canceled'",
      [user.id]);
    expect(Number(canceled[0]!.n)).toBe(1);
  });

  it("resume across the anchor creates the renewal charge (no free month)", async () => {
    const { user, subId } = await subscribedResident();
    await callAs(user.id, "select api.pause_subscription()");
    await serviceQuery(
      "update public.subscriptions set next_reset_at = now() - interval '2 days', units_used = 3 where id = $1",
      [subId]);
    await callAs(user.id, "select api.resume_subscription()");

    const [sub] = await serviceQuery<{ status: string; units_used: number }>(
      "select status, units_used from public.subscriptions where id = $1", [subId]);
    expect(sub).toMatchObject({ status: "active", units_used: 0 });
    const charges = await serviceQuery<{ kind: string; status: string }>(
      `select kind, status from public.charges
        where subscription_id = $1 and (meta->>'resume')::boolean`, [subId]);
    expect(charges[0]).toMatchObject({ kind: "subscription", status: "pending" });
  });

  it("concurrent submits cannot create two active requests", async () => {
    const { user } = await subscribedResident();
    const results = await Promise.allSettled([
      callAs(user.id, "select api.submit_request(1, 'today', null)"),
      callAs(user.id, "select api.submit_request(1, 'today', null)"),
    ]);
    const wins = results.filter((r) => r.status === "fulfilled");
    expect(wins.length).toBe(1);
    const active = await serviceQuery<{ n: string }>(
      `select count(*)::text as n from public.requests
        where resident_id = $1 and status in ('submitted','open','claimed','resident_approval','put_out_prompt','collected','verified')`,
      [user.id]);
    expect(Number(active[0]!.n)).toBe(1);
  });
});

describe("boost/backstop settle no-ops refund instead of keeping money", () => {
  it("boost settling after the request left 'open' creates a refund", async () => {
    const admin = await createTestUser();
    await serviceQuery("insert into public.admin_users (user_id) values ($1)", [admin.id]);
    await callAs(admin.id,
      `select api.admin_set_config('boost', '{"enabled": true, "user_fee": 4, "payout_bump": 2}'::jsonb, 'on')`);

    const { user } = await subscribedResident();
    const [{ r: req }] = await callAs<{ r: { id: string } }>(
      user.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");
    const [setup] = await serviceQuery<{ s: { charge_id: string } }>(
      "select api.service_charge_boost($1) as s", [req.id]);
    // request gets canceled while the PSP is settling
    await callAs(user.id, "select api.cancel_request($1)", [req.id]);
    await serviceQuery("select internal.mark_charge_provider_id($1, $2)",
      [setup!.s.charge_id, `bh_${req.id}`]);
    await serviceQuery("select internal.settle_charge($1, 'settled', null)", [`bh_${req.id}`]);

    const refunds = await serviceQuery<{ reason: string }>(
      "select reason from public.refunds where charge_id = $1", [setup!.s.charge_id]);
    expect(refunds[0]!.reason).toBe("boost_noop");

    await callAs(admin.id,
      `select api.admin_set_config('boost', '{"enabled": false, "user_fee": 4, "payout_bump": 2}'::jsonb, 'restore')`);
  });
});

describe("refund_partial preserves charge-funded entries", () => {
  it("a downward adjustment on an on-demand request keeps the charge entry intact", async () => {
    const user = await createTestUser();
    await callAs(user.id,
      `select api.onboard_residency('רעננה', 'אחוזה', $1, 1, '1', '3690')`,
      [String(Math.floor(Math.random() * 100000))]);
    const [setup] = await serviceQuery<{ s: { charge_id: string } }>(
      "select api.service_charge_on_demand($1, 'today') as s", [user.id]);
    await serviceQuery("select internal.mark_charge_provider_id($1, $2)",
      [setup!.s.charge_id, `odh_${setup!.s.charge_id}`]);
    await serviceQuery("select internal.settle_charge($1, 'settled', null)", [`odh_${setup!.s.charge_id}`]);
    const [req] = await serviceQuery<{ id: string }>(
      "select id from public.requests where charge_id = $1", [setup!.s.charge_id]);

    await serviceQuery("select core.refund_partial($1, $2, 1)", [req!.id, user.id]);
    const [after] = await serviceQuery<{ units_source: Array<Record<string, unknown>> }>(
      "select units_source from public.requests where id = $1", [req!.id]);
    expect(after!.units_source).toEqual([
      { type: "charge", charge_id: setup!.s.charge_id },
    ]);
  });
});
