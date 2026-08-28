import { beforeAll, describe, expect, it } from "vitest";
import {
  callAs,
  createTestUser,
  expectRpcError,
  serviceQuery,
} from "./helpers";

/** Full resident setup: user + residency + plan-S subscription, settled. */
async function subscribedResident(street = "בן יהודה", houseNumber?: string) {
  const user = await createTestUser();
  const hn = houseNumber ?? String(Math.floor(Math.random() * 100000));
  const [{ r: residencyId }] = await callAs<{ r: string }>(
    user.id,
    `select api.onboard_residency('תל אביב', $1, $2, 4, '9', '5555') as r`,
    [street, hn],
  );
  const [{ id: planId }] = await serviceQuery<{ id: string }>(
    "select id from public.plans where code = 'S' and active_for_signup",
  );
  const [{ s: sub }] = await callAs<{ s: { id: string } }>(
    user.id,
    "select to_jsonb(api.start_subscription($1, $2, 'large')) as s",
    [planId, residencyId],
  );
  return { user, residencyId, subId: sub.id, planId };
}

/** Simulate the PSP webhook path: pending charge → settle_charge. */
async function settleSubscription(userId: string, subId: string, outcome = "settled") {
  const key = `test:${subId}:${Math.random()}`;
  const [charge] = await serviceQuery<{ id: string }>(
    `select id from internal.create_charge($1, 'subscription',
       (select price_agorot from public.plans p join public.subscriptions s on s.plan_id = p.id where s.id = $2),
       'mock', $3, $2)`,
    [userId, subId, key],
  );
  await serviceQuery("select internal.mark_charge_provider_id($1, $2)", [charge!.id, `mock_ch_${key}`]);
  await serviceQuery("select internal.settle_charge($1, $2, null)", [`mock_ch_${key}`, outcome]);
  return `mock_ch_${key}`;
}

describe("subscription activation via async settlement", () => {
  it("pending_payment → active with anchor, period, allowance and plan bag roll", async () => {
    const { user, subId } = await subscribedResident();

    const before = await serviceQuery<{ status: string }>(
      "select status from public.subscriptions where id = $1", [subId]);
    expect(before[0]!.status).toBe("pending_payment");

    await settleSubscription(user.id, subId);

    const [sub] = await serviceQuery<{
      status: string; billing_anchor_day: number; units_included: number;
      units_used: number; next_reset_at: string;
    }>("select status, billing_anchor_day, units_included, units_used, next_reset_at from public.subscriptions where id = $1", [subId]);
    expect(sub!.status).toBe("active");
    expect(sub!.units_included).toBe(3);
    expect(sub!.units_used).toBe(0);
    expect(sub!.billing_anchor_day).toBeGreaterThanOrEqual(1);
    expect(new Date(sub!.next_reset_at).getTime()).toBeGreaterThan(Date.now());

    const rolls = await serviceQuery<{ format: string; roll_count: number; source: string }>(
      "select format, roll_count, source from public.bag_rolls where user_id = $1", [user.id]);
    expect(rolls[0]).toMatchObject({ format: "large", roll_count: 18, source: "plan" });
  });

  it("settlement is idempotent (duplicate webhooks are no-ops)", async () => {
    const { user, subId } = await subscribedResident();
    const chargeId = await settleSubscription(user.id, subId);
    await serviceQuery("select internal.settle_charge($1, 'settled', null)", [chargeId]);
    const rolls = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.bag_rolls where user_id = $1", [user.id]);
    expect(Number(rolls[0]!.n)).toBe(1); // not double-granted
  });

  it("failed charge leaves the sub inactive and logs the event", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId, "failed");
    const [sub] = await serviceQuery<{ status: string }>(
      "select status from public.subscriptions where id = $1", [subId]);
    expect(sub!.status).toBe("pending_payment");
    const events = await serviceQuery<{ event: string }>(
      "select event from public.subscription_events where subscription_id = $1 order by id", [subId]);
    expect(events.map((e) => e.event)).toContain("charge_failed");
  });
});

describe("submit / cancel", () => {
  it("no active subscription → subscription_not_active", async () => {
    const { user } = await subscribedResident(); // pending_payment, not settled
    await expectRpcError(
      callAs(user.id, "select api.submit_request(1, 'today', null)"),
      "subscription_not_active",
    );
  });

  it("submit funds from allowance, audits, and returns the open request", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId);

    const [{ r: req }] = await callAs<{ r: { id: string; status: string; units_source: unknown[] } }>(
      user.id, "select to_jsonb(api.submit_request(2, 'today', 'ליד הדלת הירוקה')) as r");
    expect(req.status).toBe("open");
    expect(req.units_source).toEqual([{ type: "allowance", units: 2 }]);

    const [sub] = await serviceQuery<{ units_used: number }>(
      "select units_used from public.subscriptions where id = $1", [subId]);
    expect(sub!.units_used).toBe(2);

    const events = await serviceQuery<{ from_status: string | null; to_status: string }>(
      "select from_status, to_status from public.request_events where request_id = $1 order by id", [req.id]);
    expect(events).toEqual([{ from_status: "submitted", to_status: "open" }]);

    // one active request at a time
    await expectRpcError(
      callAs(user.id, "select api.submit_request(1, 'today', null)"),
      "illegal_transition",
    );
  });

  it("unit bounds come from config, not code", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId);
    await expectRpcError(callAs(user.id, "select api.submit_request(0, 'today', null)"), "invalid_units");
    await expectRpcError(callAs(user.id, "select api.submit_request(7, 'today', null)"), "invalid_units");
  });

  it("cancel refunds the exact funding and blocks double-cancel", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId);
    const [{ r: req }] = await callAs<{ r: { id: string } }>(
      user.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");

    await callAs(user.id, "select api.cancel_request($1)", [req.id]);
    const [sub] = await serviceQuery<{ units_used: number }>(
      "select units_used from public.subscriptions where id = $1", [subId]);
    expect(sub!.units_used).toBe(0);

    await expectRpcError(
      callAs(user.id, "select api.cancel_request($1)", [req.id]),
      "illegal_transition",
    );
  });

  it("building pause kill switch blocks submission", async () => {
    const { user, subId, residencyId } = await subscribedResident();
    await settleSubscription(user.id, subId);
    await serviceQuery(
      "update public.buildings set paused = true where id = (select building_id from public.residencies where id = $1)",
      [residencyId]);
    await expectRpcError(
      callAs(user.id, "select api.submit_request(1, 'today', null)"),
      "building_paused",
    );
  });
});

describe("expiry → zero-touch credit → credits-before-allowance FIFO", () => {
  it("expired request grants per-unit credits, notifies, and the next submit spends them first", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId);

    const [{ r: req }] = await callAs<{ r: { id: string } }>(
      user.id, "select to_jsonb(api.submit_request(2, 'today', null)) as r");

    await serviceQuery("update public.requests set expires_at = now() - interval '1 minute' where id = $1", [req.id]);
    const [{ n }] = await serviceQuery<{ n: number }>("select internal.expire_requests() as n");
    expect(n).toBeGreaterThanOrEqual(1);

    const [reqAfter] = await serviceQuery<{ status: string }>(
      "select status from public.requests where id = $1", [req.id]);
    expect(reqAfter!.status).toBe("expired");

    const credits = await serviceQuery<{ units_granted: number; reason: string; expires_at: string }>(
      "select units_granted, reason, expires_at from public.credits where user_id = $1", [user.id]);
    expect(credits[0]).toMatchObject({ units_granted: 2, reason: "expiry_comp" });
    expect(credits[0]!.expires_at).not.toBeNull(); // credit_expiry_days applied

    const outbox = await serviceQuery<{ template_key: string }>(
      "select template_key from public.notification_outbox where user_id = $1", [user.id]);
    expect(outbox.map((o) => o.template_key)).toContain("push.request_expired");

    // next submit: credit consumed BEFORE allowance
    const [{ r: req2 }] = await callAs<{ r: { id: string; units_source: Array<Record<string, unknown>> } }>(
      user.id, "select to_jsonb(api.submit_request(3, 'today', null)) as r");
    expect(req2.units_source[0]).toMatchObject({ type: "credit", units: 2 });
    expect(req2.units_source[1]).toMatchObject({ type: "allowance", units: 1 });
  });

  it("FIFO: soonest-expiring credit is spent first", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId);

    const [{ c: late }] = await serviceQuery<{ c: string }>(
      "select core.grant_credit($1, 1, 'admin_grant', null, now() + interval '60 days') as c", [user.id]);
    const [{ c: soon }] = await serviceQuery<{ c: string }>(
      "select core.grant_credit($1, 1, 'admin_grant', null, now() + interval '5 days') as c", [user.id]);

    const [{ r: req }] = await callAs<{ r: { id: string; units_source: Array<Record<string, unknown>> } }>(
      user.id, "select to_jsonb(api.submit_request(1, 'today', null)) as r");
    expect(req.units_source).toEqual([{ type: "credit", credit_id: soon, units: 1 }]);

    const [lateRow] = await serviceQuery<{ units_consumed: number }>(
      "select units_consumed from public.credits where id = $1", [late]);
    expect(lateRow!.units_consumed).toBe(0);
  });

  it("insufficient allowance raises the stable code for the upgrade sheet", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId);
    await callAs(user.id, "select api.submit_request(3, 'today', null)"); // drain S plan
    await callAs<{ c: unknown }>(user.id, "select api.cancel_request(r.id) from public.requests r where r.resident_id = $1 and r.status = 'open'", [user.id]);
    await callAs(user.id, "select api.submit_request(3, 'today', null)");
    await expectRpcError(
      callAs(user.id, "select api.submit_request(1, 'today', null)"),
      "illegal_transition", // active request exists — cancel first
    );
    await serviceQuery("update public.requests set status = 'paid' where resident_id = $1 and status = 'open'", [user.id]);
    await expectRpcError(
      callAs(user.id, "select api.submit_request(1, 'today', null)"),
      "insufficient_allowance",
    );
  });
});

describe("monthly reset on billing anchor — no rollover", () => {
  it("resets units, advances the anchor, creates the renewal charge", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId);
    await callAs(user.id, "select api.submit_request(1, 'today', null)");

    await serviceQuery(
      "update public.subscriptions set next_reset_at = now() - interval '1 hour' where id = $1", [subId]);
    const [{ n }] = await serviceQuery<{ n: number }>("select internal.reset_allowances() as n");
    expect(n).toBeGreaterThanOrEqual(1);

    const [sub] = await serviceQuery<{ units_used: number; units_included: number; next_reset_at: string }>(
      "select units_used, units_included, next_reset_at from public.subscriptions where id = $1", [subId]);
    expect(sub!.units_used).toBe(0);            // no rollover, fresh slate
    expect(sub!.units_included).toBe(3);
    expect(new Date(sub!.next_reset_at).getTime()).toBeGreaterThan(Date.now());

    const charges = await serviceQuery<{ kind: string; status: string }>(
      "select kind, status from public.charges where subscription_id = $1 and (meta->>'renewal')::boolean", [subId]);
    expect(charges[0]).toMatchObject({ kind: "subscription", status: "pending" });
  });

  it("anchor day 31 clamps to short months without drifting (SQL mirror)", async () => {
    const rows = await serviceQuery<{ feb: string; mar: string; leap: string }>(
      `select core.next_reset_at(31::smallint, '2026-01-31T08:00:00Z'::timestamptz)::text as feb,
              core.next_reset_at(31::smallint, '2026-02-28T08:00:00Z'::timestamptz)::text as mar,
              core.next_reset_at(31::smallint, '2028-01-31T08:00:00Z'::timestamptz)::text as leap`);
    expect(rows[0]!.feb).toContain("2026-02-28 08:00:00");
    expect(rows[0]!.mar).toContain("2026-03-31 08:00:00");
    expect(rows[0]!.leap).toContain("2028-02-29 08:00:00");
  });
});

describe("pause / resume / plan change", () => {
  it("pause blocks submission; resume across the anchor starts a fresh period", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId);

    await callAs(user.id, "select api.pause_subscription()");
    await expectRpcError(
      callAs(user.id, "select api.submit_request(1, 'today', null)"),
      "subscription_not_active",
    );

    await serviceQuery(
      "update public.subscriptions set next_reset_at = now() - interval '1 day', units_used = 2 where id = $1",
      [subId]);
    await callAs(user.id, "select api.resume_subscription()");
    const [sub] = await serviceQuery<{ status: string; units_used: number }>(
      "select status, units_used from public.subscriptions where id = $1", [subId]);
    expect(sub).toMatchObject({ status: "active", units_used: 0 });
  });

  it("accept_plan_change re-points to the newest version of the same code", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId);

    const admin = await createTestUser();
    await serviceQuery("insert into public.admin_users (user_id) values ($1)", [admin.id]);
    await callAs(admin.id, "select api.admin_upsert_plan('S', 45, 3, true, 'reprice test')");

    // still grandfathered on v1 pricing
    const [before] = await serviceQuery<{ version: number }>(
      "select p.version from public.subscriptions s join public.plans p on p.id = s.plan_id where s.id = $1", [subId]);
    expect(before!.version).toBe(1);

    await callAs(user.id, "select api.accept_plan_change()");
    const [after] = await serviceQuery<{ version: number; price_agorot: number }>(
      "select p.version, p.price_agorot from public.subscriptions s join public.plans p on p.id = s.plan_id where s.id = $1", [subId]);
    expect(after!.version).toBe(2);
    expect(after!.price_agorot).toBe(4500);
  });

  it("get_my_state hydrates in one call", async () => {
    const { user, subId } = await subscribedResident();
    await settleSubscription(user.id, subId);
    const [{ s }] = await callAs<{ s: Record<string, any> }>(
      user.id, "select api.get_my_state() as s");
    expect(s.subscription.status).toBe("active");
    expect(s.subscription.plan.code).toBe("S");
    expect(s.credits_available).toBe(0);
    expect(s.residency.city).toBe("תל אביב");
    expect(s.residency.has_entry_code).toBe(true);
    expect(s.user.referral_code).toMatch(/^PN-/);
  });
});
