import { describe, expect, it } from "vitest";
import { callAs, createTestUser, expectRpcError, serviceQuery } from "./helpers";

async function residentWithSub(street?: string) {
  const user = await createTestUser();
  const hn = String(Math.floor(Math.random() * 1000000));
  const [{ r: residencyId }] = await callAs<{ r: string }>(
    user.id,
    `select api.onboard_residency('חולון', $1, $2, 2, '4', '1111') as r`,
    [street ?? "סוקולוב" + Math.random().toString(36).slice(2, 6), hn],
  );
  const [{ id: planId }] = await serviceQuery<{ id: string }>(
    "select id from public.plans where code = 'S' and active_for_signup",
  );
  const [{ s }] = await callAs<{ s: { id: string } }>(
    user.id, "select to_jsonb(api.start_subscription($1, $2, 'small')) as s", [planId, residencyId]);
  return { user, residencyId, subId: s.id };
}

/** settle a pending subscription charge through the real settle path */
async function settle(userId: string, subId: string) {
  const key = `g:${subId}:${Math.random()}`;
  const [ch] = await serviceQuery<{ id: string }>(
    `select id from internal.create_charge($1, 'subscription',
      (select price_agorot from public.plans p join public.subscriptions s on s.plan_id=p.id where s.id=$2),
      'mock', $3, $2)`, [userId, subId, key]);
  await serviceQuery("select internal.mark_charge_provider_id($1, $2)", [ch!.id, `pcid_${key}`]);
  await serviceQuery("select internal.settle_charge($1, 'settled', null)", [`pcid_${key}`]);
}

describe("referrals", () => {
  it("rewards both sides when the referee's FIRST payment settles; caps the referrer monthly", async () => {
    const referrer = await residentWithSub();
    const [refUser] = await serviceQuery<{ referral_code: string }>(
      "select referral_code from public.users where id = $1", [referrer.user.id]);

    const referee = await residentWithSub();
    await callAs(referee.user.id, "select api.apply_referral_code($1)", [refUser!.referral_code]);

    await settle(referee.user.id, referee.subId);

    const refereeCredits = await serviceQuery<{ units_granted: number; reason: string }>(
      "select units_granted, reason from public.credits where user_id = $1 and reason = 'referral'",
      [referee.user.id]);
    expect(refereeCredits[0]!.units_granted).toBe(3);

    const referrerCredits = await serviceQuery<{ units_granted: number }>(
      "select units_granted from public.credits where user_id = $1 and reason = 'referral'",
      [referrer.user.id]);
    expect(referrerCredits[0]!.units_granted).toBe(3);

    const [ref] = await serviceQuery<{ status: string }>(
      "select status from public.referrals where referee_id = $1", [referee.user.id]);
    expect(ref!.status).toBe("rewarded");

    // second settle for the same referee never re-rewards
    await settle(referee.user.id, referee.subId);
    const again = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.credits where user_id = $1 and reason = 'referral'",
      [referee.user.id]);
    expect(Number(again[0]!.n)).toBe(1);
  });

  it("monthly stack cap limits the referrer, never the referee", async () => {
    const referrer = await residentWithSub();
    const [refUser] = await serviceQuery<{ referral_code: string }>(
      "select referral_code from public.users where id = $1", [referrer.user.id]);
    // referrer already 'earned' 5 of the 6-cap this month
    await serviceQuery(
      "select core.grant_credit($1, 5, 'referral', null, now() + interval '30 days')", [referrer.user.id]);

    const referee = await residentWithSub();
    await callAs(referee.user.id, "select api.apply_referral_code($1)", [refUser!.referral_code]);
    await settle(referee.user.id, referee.subId);

    const referrerTotal = await serviceQuery<{ total: string }>(
      "select coalesce(sum(units_granted),0)::text as total from public.credits where user_id = $1 and reason = 'referral'",
      [referrer.user.id]);
    expect(Number(referrerTotal[0]!.total)).toBe(6); // capped: 5 + 1

    const refereeTotal = await serviceQuery<{ total: string }>(
      "select coalesce(sum(units_granted),0)::text as total from public.credits where user_id = $1 and reason = 'referral'",
      [referee.user.id]);
    expect(Number(refereeTotal[0]!.total)).toBe(3); // full
  });

  it("cannot self-refer or apply after first payment", async () => {
    const a = await residentWithSub();
    const [au] = await serviceQuery<{ referral_code: string }>(
      "select referral_code from public.users where id = $1", [a.user.id]);
    await expectRpcError(
      callAs(a.user.id, "select api.apply_referral_code($1)", [au!.referral_code]),
      "not_found",
    );
    await settle(a.user.id, a.subId);
    const b = await residentWithSub();
    const [bu] = await serviceQuery<{ referral_code: string }>(
      "select referral_code from public.users where id = $1", [b.user.id]);
    await expectRpcError(
      callAs(a.user.id, "select api.apply_referral_code($1)", [bu!.referral_code]),
      "illegal_transition",
    );
  });
});

describe("building meter", () => {
  it("tier crossing grants bonus credits to EVERY active door, exactly once", async () => {
    const street = "מד" + Math.random().toString(36).slice(2, 8);
    const first = await residentWithSub(street);
    const [{ building_id }] = await serviceQuery<{ building_id: string }>(
      "select building_id from public.residencies where id = $1", [first.residencyId]);

    const doors = [first];
    for (let i = 0; i < 4; i++) {
      const d = await residentWithSub(street);
      await serviceQuery("update public.residencies set building_id = $1 where id = $2",
        [building_id, d.residencyId]);
      doors.push(d);
    }
    // activate all 5 through the settle path (5th crosses the tier)
    for (const d of doors) await settle(d.user.id, d.subId);

    const [meter] = await serviceQuery<{ active_doors: number }>(
      "select active_doors from public.building_meter where building_id = $1", [building_id]);
    expect(meter!.active_doors).toBe(5);

    const awards = await serviceQuery<{ tier_doors: number }>(
      "select tier_doors from public.building_meter_awards where building_id = $1", [building_id]);
    expect(awards).toEqual([{ tier_doors: 5 }]);

    for (const d of doors) {
      const credits = await serviceQuery<{ units_granted: number }>(
        "select units_granted from public.credits where user_id = $1 and reason = 'building_meter'",
        [d.user.id]);
      expect(credits).toEqual([{ units_granted: 1 }]);
    }

    // idempotent: re-running the check never double-awards
    await serviceQuery("select core.check_meter_tiers($1)", [building_id]);
    const again = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.credits where reason = 'building_meter' and user_id = $1",
      [doors[0]!.user.id]);
    expect(Number(again[0]!.n)).toBe(1);
  });
});

describe("on-demand single (non-subscriber)", () => {
  it("charge settles → request appears open, funded by the charge; expiry refunds MONEY", async () => {
    const user = await createTestUser();
    await callAs(user.id,
      `select api.onboard_residency('בת ים', 'העצמאות', $1, 1, '2', '9090')`,
      [String(Math.floor(Math.random() * 100000))]);

    const [setup] = await serviceQuery<{ s: { charge_id: string; amount_agorot: number } }>(
      "select api.service_charge_on_demand($1, 'today') as s", [user.id]);
    expect(setup!.s.amount_agorot).toBe(2200); // ₪22 from config

    await serviceQuery("select internal.mark_charge_provider_id($1, $2)",
      [setup!.s.charge_id, `od_${setup!.s.charge_id}`]);
    await serviceQuery("select internal.settle_charge($1, 'settled', null)", [`od_${setup!.s.charge_id}`]);

    const [req] = await serviceQuery<{ id: string; status: string; subscription_id: string | null; units_source: unknown }>(
      "select id, status, subscription_id, units_source from public.requests where charge_id = $1",
      [setup!.s.charge_id]);
    expect(req!.status).toBe("open");
    expect(req!.subscription_id).toBeNull();

    // expiry → money refund, not bag credit
    await serviceQuery("update public.requests set expires_at = now() - interval '1 minute' where id = $1", [req!.id]);
    await serviceQuery("select internal.expire_requests()");
    const refunds = await serviceQuery<{ amount_agorot: number; status: string }>(
      "select amount_agorot, status from public.refunds where charge_id = $1", [setup!.s.charge_id]);
    expect(refunds[0]).toMatchObject({ amount_agorot: 2200, status: "pending" });
    const credits = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.credits where user_id = $1", [user.id]);
    expect(Number(credits[0]!.n)).toBe(0);
  });

  it("feature flag off → feature_disabled", async () => {
    const admin = await createTestUser();
    await serviceQuery("insert into public.admin_users (user_id) values ($1)", [admin.id]);
    await callAs(admin.id,
      `select api.admin_set_config('on_demand_single', '{"enabled": false, "price": 22}'::jsonb, 'off')`);
    const user = await createTestUser();
    await expect(
      serviceQuery("select api.service_charge_on_demand($1, 'today')", [user.id]),
    ).rejects.toThrow(/feature_disabled/);
    await callAs(admin.id,
      `select api.admin_set_config('on_demand_single', '{"enabled": true, "price": 22}'::jsonb, 'restore')`);
  });
});

describe("boost (flag-gated)", () => {
  it("off by default; enabling makes settle bump the request payout", async () => {
    const admin = await createTestUser();
    await serviceQuery("insert into public.admin_users (user_id) values ($1)", [admin.id]);

    const { user, subId } = await residentWithSub();
    await settle(user.id, subId);
    const [{ r: req }] = await callAs<{ r: { id: string } }>(
      user.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");

    await expect(
      serviceQuery("select api.service_charge_boost($1)", [req.id]),
    ).rejects.toThrow(/feature_disabled/);

    await callAs(admin.id,
      `select api.admin_set_config('boost', '{"enabled": true, "user_fee": 4, "payout_bump": 2}'::jsonb, 'on')`);

    const [setup] = await serviceQuery<{ s: { charge_id: string } }>(
      "select api.service_charge_boost($1) as s", [req.id]);
    await serviceQuery("select internal.mark_charge_provider_id($1, $2)",
      [setup!.s.charge_id, `boost_${req.id}`]);
    await serviceQuery("select internal.settle_charge($1, 'settled', null)", [`boost_${req.id}`]);

    const [r] = await serviceQuery<{ boost_agorot: number }>(
      "select boost_agorot from public.requests where id = $1", [req.id]);
    expect(r!.boost_agorot).toBe(200); // ₪2 bump

    await callAs(admin.id,
      `select api.admin_set_config('boost', '{"enabled": false, "user_fee": 4, "payout_bump": 2}'::jsonb, 'restore')`);
  });
});
