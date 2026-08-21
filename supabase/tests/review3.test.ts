/**
 * Regression tests for the round-3 adversarial review fixes (00160):
 * payout-inflation clamp, entry-code authz, bin-QR secrecy, billing period
 * fast-forward, renewal retry policy, plan-change money, forced transitions,
 * kill-switch gating, per-request boost, meter races, ledger sync.
 */
import { describe, expect, it } from "vitest";
import { callAs, createTestUser, expectRpcError, makeAdmin, serviceQuery } from "./helpers";

async function residentOnPlan(planCode?: string) {
  const user = await createTestUser();
  const hn = String(Math.floor(Math.random() * 1000000));
  const [{ r: residencyId }] = await callAs<{ r: string }>(
    user.id,
    `select api.onboard_residency('חולון', 'סוקולוב', $1, 2, '4', '2580') as r`, [hn]);
  const [{ id: planId }] = await serviceQuery<{ id: string }>(
    planCode
      ? "select id from public.plans where code = $1 and active_for_signup"
      : "select id from public.plans where active_for_signup order by units_per_month desc limit 1",
    planCode ? [planCode] : []);
  const [{ s }] = await callAs<{ s: { id: string } }>(
    user.id, "select to_jsonb(api.start_subscription($1, $2, 'large')) as s", [planId, residencyId]);
  await serviceQuery(
    `update public.subscriptions set status='active', billing_anchor_day=10,
        current_period_start = now() - interval '5 days',
        next_reset_at = now() + interval '12 days' where id = $1`, [s.id]);
  return { user, residencyId, subId: s.id, planId };
}

async function activePicker() {
  const user = await createTestUser("97253");
  await callAs(user.id,
    `select api.register_picker('1990-05-05'::date, 'h3-${Math.random()}', 'patur', true)`);
  await serviceQuery("update public.pickers set status = 'active' where user_id = $1", [user.id]);
  return user;
}

async function settle(chargeId: string, outcome: "settled" | "failed", tag: string) {
  await serviceQuery("select internal.mark_charge_provider_id($1, $2)", [chargeId, tag]);
  await serviceQuery("select internal.settle_charge($1, $2, $3)",
    [tag, outcome, outcome === "failed" ? "card_declined" : null]);
}

describe("mark_collected can no longer inflate the payout", () => {
  it("an adjustment beyond max_units_per_request is rejected", async () => {
    const { user } = await residentOnPlan();
    const picker = await activePicker();
    const [{ r: req }] = await callAs<{ r: { id: string } }>(
      user.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);
    await expectRpcError(
      callAs(picker.id,
        `select api.mark_collected($1, '{"large_bags":500}'::jsonb)`, [claim!.id]),
      "invalid_units");
  });

  it("units the resident cannot fund are neither stamped nor paid", async () => {
    const { user, subId } = await residentOnPlan();
    const picker = await activePicker();
    const [{ r: req }] = await callAs<{ r: { id: string; building_id: string } }>(
      user.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");
    // exhaust the remaining allowance so the delta is unfundable
    await serviceQuery(
      "update public.subscriptions set units_used = units_included where id = $1", [subId]);
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);
    await callAs(picker.id,
      `select api.mark_collected($1, '{"large_bags":4}'::jsonb)`, [claim!.id]);

    const [row] = await serviceQuery<{ units_final: number; units_collected: number }>(
      `select r.units_final, c.units_collected from public.requests r
        join public.claims c on c.request_id = r.id where r.id = $1`, [req.id]);
    expect(row).toMatchObject({ units_final: 1, units_collected: 1 });
    const events = await serviceQuery<{ n: string }>(
      `select count(*)::text as n from public.request_events
        where request_id = $1 and (meta->>'unfunded_units')::int = 3`, [req.id]);
    expect(Number(events[0]!.n)).toBe(1);

    const [{ qr }] = await serviceQuery<{ qr: string }>(
      "select bin_qr_id as qr from public.buildings where id = $1", [req.building_id]);
    await callAs(picker.id, "select api.verify_bin_scan($1, $2)", [claim!.id, qr]);
    const [line] = await serviceQuery<{ units: number; amount_agorot: number }>(
      "select units, amount_agorot from public.payout_lines where claim_id = $1", [claim!.id]);
    expect(line).toMatchObject({ units: 1, amount_agorot: 700 });
  });
});

describe("building entry code: first-set only for residents", () => {
  it("a self-asserted resident cannot overwrite or clear an existing code", async () => {
    const { user } = await residentOnPlan(); // fixture building already has a code
    const [{ b }] = await serviceQuery<{ b: string }>(
      `select r.building_id as b from public.residencies r
        join public.users u on u.id = r.user_id where r.user_id = $1 limit 1`, [user.id]);
    await expectRpcError(
      callAs(user.id, "select api.set_building_entry_code($1, '9999')", [b]),
      "not_authorized");
    await expectRpcError(
      callAs(user.id, "select api.set_building_entry_code($1, '')", [b]),
      "not_authorized");
    const [code] = await serviceQuery<{ has: boolean }>(
      "select entry_code_enc is not null as has from public.buildings where id = $1", [b]);
    expect(code!.has).toBe(true);
  });

  it("first set works for a resident; overwrite works for an admin", async () => {
    const user = await createTestUser();
    const hn = String(Math.floor(Math.random() * 1000000));
    await callAs(user.id,
      `select api.onboard_residency('בת ים', 'העצמאות', $1, 1, '2')`, [hn]);
    const [{ b }] = await serviceQuery<{ b: string }>(
      `select building_id as b from public.residencies where user_id = $1 limit 1`, [user.id]);
    await callAs(user.id, "select api.set_building_entry_code($1, '1234#')", [b]);
    const [set1] = await serviceQuery<{ has: boolean }>(
      "select entry_code_enc is not null as has from public.buildings where id = $1", [b]);
    expect(set1!.has).toBe(true);

    const admin = await createTestUser();
    await makeAdmin(admin.id);
    await callAs(admin.id, "select api.set_building_entry_code($1, '5678*')", [b]);
    const [dec] = await serviceQuery<{ code: string }>(
      "select core.decrypt_entry_code(entry_code_enc) as code from public.buildings where id = $1", [b]);
    expect(dec!.code).toBe("5678*");
  });
});

describe("bin_qr_id is no longer client-readable", () => {
  it("authenticated selects on the column are denied", async () => {
    const picker = await activePicker();
    await expect(
      callAs(picker.id, "select bin_qr_id from public.buildings limit 1"),
    ).rejects.toThrow(/permission denied/);
  });

  it("admins read it via the definer RPC", async () => {
    await residentOnPlan(); // ensures at least one building exists
    const admin = await createTestUser();
    await makeAdmin(admin.id);
    const rows = await callAs<{ bin_qr_id: string }>(
      admin.id, "select bin_qr_id from api.admin_list_buildings() limit 1");
    expect(rows[0]!.bin_qr_id).toMatch(/^BIN-/);
  });
});

describe("billing: settlement edge cases", () => {
  it("a charge settling for a canceled subscription is refunded", async () => {
    const { user, subId } = await residentOnPlan();
    const [setup] = await serviceQuery<{ s: { charge_id: string } }>(
      "select api.service_charge_subscription($1) as s", [subId]);
    await serviceQuery(
      "update public.subscriptions set status = 'canceled', canceled_at = now() where id = $1", [subId]);
    await settle(setup!.s.charge_id, "settled", `r3c_${subId}`);

    const refunds = await serviceQuery<{ reason: string }>(
      "select reason from public.refunds where charge_id = $1", [setup!.s.charge_id]);
    expect(refunds[0]!.reason).toBe("subscription_canceled_noop");
    const [sub] = await serviceQuery<{ status: string }>(
      "select status from public.subscriptions where id = $1", [subId]);
    expect(sub!.status).toBe("canceled");
    void user;
  });

  it("past_due recovery fast-forwards the period instead of back-billing", async () => {
    const { subId } = await residentOnPlan();
    await serviceQuery(
      `update public.subscriptions
          set status = 'past_due',
              units_used = 4,
              current_period_start = now() - interval '100 days',
              next_reset_at = now() - interval '70 days',
              current_period_end = now() - interval '70 days'
        where id = $1`, [subId]);
    const [setup] = await serviceQuery<{ s: { charge_id: string } }>(
      "select api.service_charge_subscription($1) as s", [subId]);
    await settle(setup!.s.charge_id, "settled", `r3ff_${subId}`);

    const [sub] = await serviceQuery<{ status: string; units_used: number; future: boolean }>(
      `select status, units_used, next_reset_at > now() as future
         from public.subscriptions where id = $1`, [subId]);
    expect(sub).toMatchObject({ status: "active", units_used: 0, future: true });

    // the stale reset can never fire now — no back-billed renewal charges
    await serviceQuery("select internal.reset_allowances()");
    const charges = await serviceQuery<{ n: string }>(
      `select count(*)::text as n from public.charges
        where subscription_id = $1 and kind = 'subscription'`, [subId]);
    expect(Number(charges[0]!.n)).toBe(1);
  });

  it("pay-now reuses the in-flight pending renewal instead of minting a twin", async () => {
    const { subId } = await residentOnPlan();
    const [a] = await serviceQuery<{ s: { charge_id: string } }>(
      "select api.service_charge_subscription($1) as s", [subId]);
    const [b] = await serviceQuery<{ s: { charge_id: string } }>(
      "select api.service_charge_subscription($1) as s", [subId]);
    expect(b!.s.charge_id).toBe(a!.s.charge_id);
  });

  it("retries key on the unpaid period, honor the min-gap, and give up into cancel", async () => {
    const { subId } = await residentOnPlan();
    await serviceQuery(
      `update public.subscriptions
          set status = 'past_due',
              current_period_start = date_trunc('month', now())
        where id = $1`, [subId]);
    const [{ key }] = await serviceQuery<{ key: string }>(
      `select 'renew:' || id || ':' || to_char(current_period_start, 'YYYY-MM') as key
         from public.subscriptions where id = $1`, [subId]);

    // one fresh failed attempt → throttled (min_hours_between)
    const [{ id: c1 }] = await serviceQuery<{ id: string }>(
      `select id from internal.create_charge(
         (select user_id from public.subscriptions where id = $1),
         'subscription', 4900, 'mock', $2, $1)`, [subId, key]);
    await settle(c1, "failed", `r3rt1_${subId}`);
    await serviceQuery("select internal.retry_failed_renewals()");
    let pend = await serviceQuery<{ n: string }>(
      `select count(*)::text as n from public.charges
        where subscription_id = $1 and status = 'pending'`, [subId]);
    expect(Number(pend[0]!.n)).toBe(0); // too soon to retry

    // age the failure → retry mints the #r1 attempt under the SAME base key
    await serviceQuery(
      "update public.charges set created_at = now() - interval '30 hours' where id = $1", [c1]);
    await serviceQuery("select internal.retry_failed_renewals()");
    const retry = await serviceQuery<{ idempotency_key: string }>(
      `select idempotency_key from public.charges
        where subscription_id = $1 and status = 'pending'`, [subId]);
    expect(retry[0]!.idempotency_key).toBe(`${key}#r1`);

    // 4 aged failed attempts (config max) → zero-touch cancel + notification
    const [r1] = await serviceQuery<{ id: string }>(
      "select id from public.charges where subscription_id = $1 and status = 'pending'", [subId]);
    await settle(r1!.id, "failed", `r3rt2_${subId}`);
    for (let i = 0; i < 2; i += 1) {
      await serviceQuery(
        "update public.charges set created_at = now() - interval '30 hours' where subscription_id = $1", [subId]);
      await serviceQuery("select internal.retry_failed_renewals()");
      const [p] = await serviceQuery<{ id: string }>(
        "select id from public.charges where subscription_id = $1 and status = 'pending'", [subId]);
      if (p) await settle(p.id, "failed", `r3rt${3 + i}_${subId}`);
    }
    await serviceQuery(
      "update public.charges set created_at = now() - interval '30 hours' where subscription_id = $1", [subId]);
    await serviceQuery("select internal.retry_failed_renewals()");

    const [sub] = await serviceQuery<{ status: string }>(
      "select status from public.subscriptions where id = $1", [subId]);
    expect(sub!.status).toBe("canceled");
    const notified = await serviceQuery<{ n: string }>(
      `select count(*)::text as n from public.notification_outbox
        where template_key = 'push.subscription_canceled'
          and user_id = (select user_id from public.subscriptions where id = $1)`, [subId]);
    expect(Number(notified[0]!.n)).toBe(1);
  });
});

describe("change_plan can no longer mint allowance", () => {
  it("upgrade is immediate and charges the price difference", async () => {
    const plans = await serviceQuery<{ id: string; code: string; units_per_month: number; price_agorot: number }>(
      "select id, code, units_per_month, price_agorot from public.plans where active_for_signup order by units_per_month");
    const small = plans[0]!;
    const big = plans[plans.length - 1]!;
    const { user, subId } = await residentOnPlan(small.code);

    await callAs(user.id, "select api.change_plan($1)", [big.id]);
    const [sub] = await serviceQuery<{ units_included: number; plan_id: string }>(
      "select units_included, plan_id from public.subscriptions where id = $1", [subId]);
    expect(sub).toMatchObject({ units_included: big.units_per_month, plan_id: big.id });
    const upcharge = await serviceQuery<{ amount_agorot: number }>(
      `select amount_agorot from public.charges
        where subscription_id = $1 and (meta->>'plan_upgrade')::boolean`, [subId]);
    expect(upcharge[0]!.amount_agorot).toBe(big.price_agorot - small.price_agorot);
  });

  it("downgrade waits for the renewal; cycling creates exactly one upgrade charge", async () => {
    const plans = await serviceQuery<{ id: string; code: string; units_per_month: number; price_agorot: number }>(
      "select id, code, units_per_month, price_agorot from public.plans where active_for_signup order by units_per_month");
    const small = plans[0]!;
    const big = plans[plans.length - 1]!;
    const { user, subId } = await residentOnPlan(small.code);

    await callAs(user.id, "select api.change_plan($1)", [big.id]);   // up (charged)
    await callAs(user.id, "select api.change_plan($1)", [small.id]); // down → pending
    let [sub] = await serviceQuery<{ units_included: number; pending_plan_id: string | null }>(
      "select units_included, pending_plan_id from public.subscriptions where id = $1", [subId]);
    expect(sub).toMatchObject({ units_included: big.units_per_month, pending_plan_id: small.id });

    await callAs(user.id, "select api.change_plan($1)", [big.id]);   // re-pick current → clears
    [sub] = await serviceQuery<{ units_included: number; pending_plan_id: string | null }>(
      "select units_included, pending_plan_id from public.subscriptions where id = $1", [subId]);
    expect(sub).toMatchObject({ units_included: big.units_per_month, pending_plan_id: null });
    const upcharges = await serviceQuery<{ n: string }>(
      `select count(*)::text as n from public.charges
        where subscription_id = $1 and (meta->>'plan_upgrade')::boolean`, [subId]);
    expect(Number(upcharges[0]!.n)).toBe(1);

    // schedule the downgrade again and let the renewal apply it
    await callAs(user.id, "select api.change_plan($1)", [small.id]);
    await serviceQuery(
      "update public.subscriptions set next_reset_at = now() - interval '1 hour' where id = $1", [subId]);
    await serviceQuery("select internal.reset_allowances()");
    const [after] = await serviceQuery<{ plan_id: string; units_included: number; pending_plan_id: string | null }>(
      "select plan_id, units_included, pending_plan_id from public.subscriptions where id = $1", [subId]);
    expect(after).toMatchObject({
      plan_id: small.id, units_included: small.units_per_month, pending_plan_id: null,
    });
  });
});

describe("admin force-transition accounts for money", () => {
  it("forcing a funded request into canceled refunds the units exactly once", async () => {
    const { user, subId } = await residentOnPlan();
    const admin = await createTestUser();
    await makeAdmin(admin.id);
    const [{ r: req }] = await callAs<{ r: { id: string } }>(
      user.id, "select to_jsonb(api.submit_request(2, 'today', null)) as r");
    let [sub] = await serviceQuery<{ units_used: number }>(
      "select units_used from public.subscriptions where id = $1", [subId]);
    expect(sub!.units_used).toBe(2);

    await callAs(admin.id,
      "select api.admin_force_transition($1, 'canceled', 'ops cleanup')", [req.id]);
    [sub] = await serviceQuery<{ units_used: number }>(
      "select units_used from public.subscriptions where id = $1", [subId]);
    expect(sub!.units_used).toBe(0);

    // forcing it again cannot double-refund: sources were cleared
    await callAs(admin.id,
      "select api.admin_force_transition($1, 'expired', 'again')", [req.id]);
    [sub] = await serviceQuery<{ units_used: number }>(
      "select units_used from public.subscriptions where id = $1", [subId]);
    expect(sub!.units_used).toBe(0);
  });

  it("a paid request (payout line written) cannot be forced anywhere", async () => {
    const { user } = await residentOnPlan();
    const picker = await activePicker();
    const admin = await createTestUser();
    await makeAdmin(admin.id);
    const [{ r: req }] = await callAs<{ r: { id: string; building_id: string } }>(
      user.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);
    await callAs(picker.id, "select api.mark_collected($1, null)", [claim!.id]);
    const [{ qr }] = await serviceQuery<{ qr: string }>(
      "select bin_qr_id as qr from public.buildings where id = $1", [req.building_id]);
    await callAs(picker.id, "select api.verify_bin_scan($1, $2)", [claim!.id, qr]);

    await expectRpcError(
      callAs(admin.id, "select api.admin_force_transition($1, 'open', 'redo')", [req.id]),
      "illegal_transition");
  });
});

describe("kill switches gate on-demand", () => {
  it("charging and settling are both blocked when service_enabled is off", async () => {
    const admin = await createTestUser();
    await makeAdmin(admin.id);
    const user = await createTestUser();
    await callAs(user.id,
      `select api.onboard_residency('גבעתיים', 'כצנלסון', $1, 1, '7')`,
      [String(Math.floor(Math.random() * 1000000))]);

    // a charge created while ON but settling while OFF refunds
    const [setup] = await serviceQuery<{ s: { charge_id: string } }>(
      "select api.service_charge_on_demand($1, 'today') as s", [user.id]);
    await callAs(admin.id,
      "select api.admin_set_config('service_enabled', 'false'::jsonb, 'kill')");
    try {
      await expectRpcError(
        serviceQuery("select api.service_charge_on_demand($1, 'today')", [user.id]),
        "service_disabled");
      await settle(setup!.s.charge_id, "settled", `r3od_${setup!.s.charge_id}`);
      const refunds = await serviceQuery<{ reason: string }>(
        "select reason from public.refunds where charge_id = $1", [setup!.s.charge_id]);
      expect(refunds[0]!.reason).toBe("on_demand_unfulfillable");
      const reqs = await serviceQuery<{ n: string }>(
        "select count(*)::text as n from public.requests where charge_id = $1", [setup!.s.charge_id]);
      expect(Number(reqs[0]!.n)).toBe(0);
    } finally {
      await callAs(admin.id,
        "select api.admin_set_config('service_enabled', 'true'::jsonb, 'restore')");
    }
  });
});

describe("boost pays per request, not per unit", () => {
  it("feed display and the payout line both add the bump once", async () => {
    const { user } = await residentOnPlan();
    const picker = await activePicker();
    const [{ r: req }] = await callAs<{ r: { id: string; building_id: string } }>(
      user.id, "select to_jsonb(api.submit_request(2, 'today', null)) as r");
    await serviceQuery(
      "update public.requests set boost_agorot = 300 where id = $1", [req.id]);

    const feed = await callAs<{ request_id: string; payout_agorot: number }>(
      picker.id, "select request_id, payout_agorot from api.open_feed(null, null)");
    const mine = feed.find((f) => f.request_id === req.id);
    expect(mine!.payout_agorot).toBe(2 * 700 + 300);

    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);
    await callAs(picker.id, "select api.mark_collected($1, null)", [claim!.id]);
    const [{ qr }] = await serviceQuery<{ qr: string }>(
      "select bin_qr_id as qr from public.buildings where id = $1", [req.building_id]);
    const [{ v }] = await callAs<{ v: { amount_agorot: number } }>(
      picker.id, "select api.verify_bin_scan($1, $2) as v", [claim!.id, qr]);
    expect(v.amount_agorot).toBe(2 * 700 + 300);
    const [line] = await serviceQuery<{ amount_agorot: number; boost_agorot: number }>(
      "select amount_agorot, boost_agorot from public.payout_lines where claim_id = $1", [claim!.id]);
    expect(line).toMatchObject({ amount_agorot: 1700, boost_agorot: 300 });
  });
});

describe("meter awards are race-safe (win-gated)", () => {
  it("an existing award row suppresses a duplicate grant; a fresh one grants once", async () => {
    const admin = await createTestUser();
    await makeAdmin(admin.id);
    const { user } = await residentOnPlan();
    const [{ b }] = await serviceQuery<{ b: string }>(
      "select building_id as b from public.residencies where user_id = $1 limit 1", [user.id]);
    await callAs(admin.id,
      `select api.admin_set_config('building_meter',
         '{"enabled": true, "tiers": [{"doors": 1, "bonus_units_all": 1}]}'::jsonb, 'test')`);
    try {
      // someone else already won this tier → no grant
      await serviceQuery(
        "insert into public.building_meter_awards (building_id, tier_doors) values ($1, 1)", [b]);
      await serviceQuery("select core.check_meter_tiers($1)", [b]);
      let credits = await serviceQuery<{ n: string }>(
        `select count(*)::text as n from public.credits
          where user_id = $1 and reason = 'building_meter'`, [user.id]);
      expect(Number(credits[0]!.n)).toBe(0);

      // fresh tier → exactly one grant, idempotent on the second call
      await serviceQuery(
        "delete from public.building_meter_awards where building_id = $1 and tier_doors = 1", [b]);
      await serviceQuery("select core.check_meter_tiers($1)", [b]);
      await serviceQuery("select core.check_meter_tiers($1)", [b]);
      credits = await serviceQuery<{ n: string }>(
        `select count(*)::text as n from public.credits
          where user_id = $1 and reason = 'building_meter'`, [user.id]);
      expect(Number(credits[0]!.n)).toBe(1);
    } finally {
      await callAs(admin.id,
        `select api.admin_set_config('building_meter',
           '{"enabled": true, "tiers": [{"doors": 5, "bonus_units_all": 1}, {"doors": 10, "bonus_units_all": 2}, {"doors": 20, "bonus_units_all": 3}]}'::jsonb, 'restore')`);
    }
  });
});

describe("backstop settle with a newer active request refunds instead of aborting", () => {
  it("the unique one-active-request index becomes a refund, not a stuck webhook", async () => {
    const admin = await createTestUser();
    await makeAdmin(admin.id);
    await callAs(admin.id,
      `select api.admin_set_config('backstop', '{"enabled": true, "user_price": 15, "ttl_hours": 24}'::jsonb, 'on')`);
    try {
      const { user } = await residentOnPlan();
      const [{ r: reqA }] = await callAs<{ r: { id: string } }>(
        user.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");
      await serviceQuery(
        "update public.requests set expires_at = now() - interval '1 minute' where id = $1", [reqA.id]);
      await serviceQuery("select internal.expire_requests()");

      const [setup] = await serviceQuery<{ s: { charge_id: string } }>(
        "select api.service_charge_backstop($1) as s", [reqA.id]);
      // a NEW active request appears while the PSP settles
      await callAs(user.id, "select api.submit_request(1, 'today', null)");
      await settle(setup!.s.charge_id, "settled", `r3bs_${reqA.id}`);

      const refunds = await serviceQuery<{ reason: string }>(
        "select reason from public.refunds where charge_id = $1", [setup!.s.charge_id]);
      expect(refunds[0]!.reason).toBe("backstop_unfulfillable");
      const [charge] = await serviceQuery<{ status: string }>(
        "select status from public.charges where id = $1", [setup!.s.charge_id]);
      expect(charge!.status).toBe("settled"); // settlement completed, not aborted
    } finally {
      await callAs(admin.id,
        `select api.admin_set_config('backstop', '{"enabled": false, "user_price": 15, "ttl_hours": 24}'::jsonb, 'restore')`);
    }
  });
});

describe("ledger hygiene", () => {
  it("refund_partial shrinks the credit_consumptions journal in lockstep", async () => {
    const { user } = await residentOnPlan();
    const picker = await activePicker();
    const [{ c: creditId }] = await serviceQuery<{ c: string }>(
      "select core.grant_credit($1, 2, 'admin_grant', null, null) as c", [user.id]);
    const [{ r: req }] = await callAs<{ r: { id: string } }>(
      user.id, "select to_jsonb(api.submit_request(2, 'today', null)) as r");
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);
    // fewer bags on-site than requested → downward adjustment of 1 unit
    await callAs(picker.id,
      `select api.mark_collected($1, '{"large_bags":1}'::jsonb)`, [claim!.id]);

    const [credit] = await serviceQuery<{ units_consumed: number }>(
      "select units_consumed from public.credits where id = $1", [creditId]);
    expect(credit!.units_consumed).toBe(1);
    const [journal] = await serviceQuery<{ total: string }>(
      `select coalesce(sum(units), 0)::text as total from public.credit_consumptions
        where credit_id = $1 and request_id = $2`, [creditId, req.id]);
    expect(Number(journal!.total)).toBe(1);
  });

  it("admin credit grants of zero units are rejected loudly", async () => {
    const admin = await createTestUser();
    await makeAdmin(admin.id);
    const user = await createTestUser();
    await expectRpcError(
      callAs(admin.id, "select api.admin_grant_credit($1, 0, 'oops')", [user.id]),
      "invalid_units");
  });
});
