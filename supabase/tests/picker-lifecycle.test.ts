import { beforeAll, describe, expect, it } from "vitest";
import { UNIT_TRUTH_TABLE } from "../../packages/shared/test/units.test";
import {
  callAs,
  createTestUser,
  expectRpcError,
  serviceQuery,
} from "./helpers";

async function subscribedResident(street = "ארלוזורוב") {
  const user = await createTestUser();
  const hn = String(Math.floor(Math.random() * 1000000));
  const [{ r: residencyId }] = await callAs<{ r: string }>(
    user.id,
    `select api.onboard_residency('תל אביב', $1, $2, 4, '9', '2580') as r`,
    [street, hn],
  );
  const [{ id: planId }] = await serviceQuery<{ id: string }>(
    "select id from public.plans where code = 'L' and active_for_signup",
  );
  const [{ s: sub }] = await callAs<{ s: { id: string } }>(
    user.id,
    "select to_jsonb(api.start_subscription($1, $2, 'large')) as s",
    [planId, residencyId],
  );
  // activate directly (settlement path covered in resident suite)
  await serviceQuery(
    `update public.subscriptions
        set status='active', billing_anchor_day=15, units_used=0,
            next_reset_at = now() + interval '20 days'
      where id = $1`,
    [sub.id],
  );
  return { user, residencyId, subId: sub.id };
}

async function activePicker() {
  const user = await createTestUser("97252");
  await callAs(
    user.id,
    `select api.register_picker('1990-05-05'::date, '123456782', 'patur', true,
       '{"bank":"12","branch":"345","account":"67890"}'::jsonb)`,
  );
  await serviceQuery("update public.pickers set status = 'active' where user_id = $1", [user.id]);
  return user;
}

async function submit(residentId: string, units = 1) {
  const [{ r }] = await callAs<{ r: { id: string; building_id: string } }>(
    residentId,
    "select to_jsonb(api.submit_request($1, 'today', null)) as r",
    [units],
  );
  return r;
}

describe("picker onboarding", () => {
  it("18+ gate raises underage", async () => {
    const kid = await createTestUser("97252");
    await expectRpcError(
      callAs(kid.id, `select api.register_picker((current_date - interval '17 years')::date, '111', 'none', true)`),
      "underage",
    );
  });

  it("PoA consent is mandatory; ID stored only as a salted hash", async () => {
    const u = await createTestUser("97252");
    await expectRpcError(
      callAs(u.id, `select api.register_picker('1990-01-01'::date, '040083979', 'murshe', false)`),
      "not_authorized",
    );
    await callAs(u.id, `select api.register_picker('1990-01-01'::date, '040083979', 'murshe', true, null, '514956912')`);
    const [row] = await serviceQuery<{ id_number_hash: string; status: string; poa_version: string }>(
      "select id_number_hash, status, poa_version from public.pickers where user_id = $1", [u.id]);
    expect(row!.id_number_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.id_number_hash).not.toContain("040083979");
    expect(row!.status).toBe("pending_verification");
    expect(row!.poa_version).toBe("poa-selfbill-2026-08");
  });

  it("unverified pickers cannot see the feed or claim", async () => {
    const u = await createTestUser("97252");
    await callAs(u.id, `select api.register_picker('1990-01-01'::date, '999', 'none', true)`);
    await expectRpcError(callAs(u.id, "select * from api.open_feed()"), "picker_not_active");
  });

  it("admin verification queue activates", async () => {
    const u = await createTestUser("97252");
    await callAs(u.id, `select api.register_picker('1990-01-01'::date, '888', 'none', true)`);
    const admin = await createTestUser();
    await serviceQuery("insert into public.admin_users (user_id) values ($1)", [admin.id]);
    await callAs(admin.id, "select api.admin_verify_picker($1, true)", [u.id]);
    const [row] = await serviceQuery<{ status: string }>(
      "select status from public.pickers where user_id = $1", [u.id]);
    expect(row!.status).toBe("active");
  });
});

describe("feed + claim", () => {
  it("feed shows street-level info with config-derived payout; never your own request", async () => {
    const { user: resident } = await subscribedResident();
    await submit(resident.id, 2);
    const picker = await activePicker();

    const feed = await callAs<{ street: string; units: number; payout_agorot: number }>(
      picker.id, "select * from api.open_feed()");
    const row = feed.find((f) => f.street === "ארלוזורוב");
    expect(row).toBeDefined();
    expect(row!.units).toBe(2);
    expect(row!.payout_agorot).toBe(2 * 700); // 7.00 ₪/unit ex-VAT from config
  });

  it("THE RACE: two pickers, one request — exactly one winner, one claim row", async () => {
    const { user: resident } = await subscribedResident();
    const req = await submit(resident.id);
    const p1 = await activePicker();
    const p2 = await activePicker();

    const results = await Promise.allSettled([
      callAs(p1.id, "select api.claim_request($1)", [req.id]),
      callAs(p2.id, "select api.claim_request($1)", [req.id]),
    ]);
    const wins = results.filter((r) => r.status === "fulfilled");
    const losses = results.filter(
      (r) => r.status === "rejected" && String(r.reason).includes("already_claimed"),
    );
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);

    const claims = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.claims where request_id = $1", [req.id]);
    expect(Number(claims[0]!.n)).toBe(1);
  });

  it("building grouping: one claim sweeps every open request in the building into one stop", async () => {
    const street = "הבנייה" + Math.random().toString(36).slice(2, 7);
    const a = await subscribedResident(street);
    const b = await subscribedResident(street);
    // same building requires same address — patch b's residency onto a's building
    await serviceQuery(
      `update public.residencies set building_id = (select building_id from public.residencies where id = $1)
        where id = $2`,
      [a.residencyId, b.residencyId]);
    const reqA = await submit(a.user.id);
    const reqB = await submit(b.user.id, 3);

    const picker = await activePicker();
    const [{ c }] = await callAs<{ c: { claim_group_id: string; claims: unknown[] } }>(
      picker.id, "select api.claim_request($1) as c", [reqA.id]);
    expect(c.claims).toHaveLength(2);

    const statuses = await serviceQuery<{ status: string }>(
      "select status from public.requests where id in ($1, $2)", [reqA.id, reqB.id]);
    expect(statuses.map((s) => s.status)).toEqual(["claimed", "claimed"]);
  });

  it("payout + deadline snapshots are immutable under config change mid-flight", async () => {
    const { user: resident } = await subscribedResident();
    const req = await submit(resident.id, 2);
    const picker = await activePicker();
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);

    // founder changes the payout AFTER the claim
    const admin = await createTestUser();
    await serviceQuery("insert into public.admin_users (user_id) values ($1)", [admin.id]);
    await callAs(admin.id, "select api.admin_set_config('picker_payout_per_unit_exvat', '9.5'::jsonb, 'raise')");

    const [claim] = await serviceQuery<{ id: string; payout_per_unit_agorot: number }>(
      "select id, payout_per_unit_agorot from public.claims where request_id = $1", [req.id]);
    expect(claim!.payout_per_unit_agorot).toBe(700); // OLD rate, snapshotted

    // collect + verify → payout line uses the claim-time rate
    await callAs(picker.id, "select api.mark_collected($1, null)", [claim!.id]);
    const [{ qr }] = await serviceQuery<{ qr: string }>(
      "select bin_qr_id as qr from public.buildings where id = $1", [req.building_id]);
    await callAs(picker.id, "select api.verify_bin_scan($1, $2)", [claim!.id, qr]);

    const [line] = await serviceQuery<{ per_unit_agorot: number; amount_agorot: number }>(
      "select per_unit_agorot, amount_agorot from public.payout_lines where claim_id = $1", [claim!.id]);
    expect(line!.per_unit_agorot).toBe(700);
    expect(line!.amount_agorot).toBe(1400);

    // restore config for later tests
    await callAs(admin.id, "select api.admin_set_config('picker_payout_per_unit_exvat', '7'::jsonb, 'restore')");
  });

  it("max_active_claim_groups is enforced from config", async () => {
    const r1 = await subscribedResident();
    const r2 = await subscribedResident();
    const req1 = await submit(r1.user.id);
    const req2 = await submit(r2.user.id);
    const picker = await activePicker();
    await callAs(picker.id, "select api.claim_request($1)", [req1.id]);
    await expectRpcError(
      callAs(picker.id, "select api.claim_request($1)", [req2.id]),
      "claim_limit_reached",
    );
  });
});

describe("entry-code reveal", () => {
  it("reveals only during an active claim, audited, time-boxed", async () => {
    const { user: resident } = await subscribedResident();
    const req = await submit(resident.id);
    const picker = await activePicker();
    const stranger = await activePicker();
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string; deadline_at: string }>(
      "select id, deadline_at from public.claims where request_id = $1", [req.id]);

    // stranger cannot reveal someone else's claim
    await expectRpcError(
      callAs(stranger.id, "select api.reveal_entry_code($1)", [claim!.id]),
      "not_found",
    );

    const [{ r }] = await callAs<{ r: { code: string; reveal_expires_at: string } }>(
      picker.id, "select api.reveal_entry_code($1) as r", [claim!.id]);
    expect(r.code).toBe("2580");
    expect(new Date(r.reveal_expires_at).getTime()).toBeLessThanOrEqual(
      new Date(claim!.deadline_at).getTime());

    const audit = await serviceQuery<{ picker_id: string }>(
      "select picker_id from public.code_reveal_audit where claim_id = $1", [claim!.id]);
    expect(audit).toHaveLength(1);

    // reveal dies with the deadline
    await serviceQuery("update public.claims set deadline_at = now() - interval '1 second' where id = $1", [claim!.id]);
    await expectRpcError(
      callAs(picker.id, "select api.reveal_entry_code($1)", [claim!.id]),
      "claim_expired",
    );
  });

  it("codes never appear in events or the outbox", async () => {
    const [{ n: inEvents }] = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.request_events where meta::text like '%2580%'");
    const [{ n: inOutbox }] = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.notification_outbox where params::text like '%2580%'");
    expect(Number(inEvents)).toBe(0);
    expect(Number(inOutbox)).toBe(0);
  });
});

describe("unit counting anti-drift (SQL twin must equal the TS brain)", () => {
  it("core.count_units agrees with countUnits across the shared truth table", async () => {
    const rules = JSON.stringify({
      max_small_bags_per_unit: 3, max_kg_per_unit: 8,
      oversized_multiplier: 2, small_4to6_units: 2, max_units_per_request: 6,
    });
    for (const row of UNIT_TRUTH_TABLE) {
      const bags = JSON.stringify({
        large_bags: row.bags.largeBags,
        small_bags: row.bags.smallBags,
        oversized_bags: row.bags.oversizedBags,
        small_group_overweight: row.bags.smallGroupOverweight ?? false,
      });
      const [res] = await serviceQuery<{ u: number }>(
        "select core.count_units($1::jsonb, $2::jsonb) as u", [rules, bags]);
      expect(res!.u, row.name).toBe(row.expected);
    }
  });
});

describe("collection adjustments", () => {
  it("server recount up: '4 small' chips on a 1-unit request → 2 units, resident notified", async () => {
    const { user: resident, subId } = await subscribedResident();
    const req = await submit(resident.id, 1);
    const picker = await activePicker();
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);

    await callAs(picker.id,
      `select api.mark_collected($1, '{"large_bags":0,"small_bags":4,"oversized_bags":0}'::jsonb)`,
      [claim!.id]);

    const [r] = await serviceQuery<{ units_final: number; status: string }>(
      "select units_final, status from public.requests where id = $1", [req.id]);
    expect(r).toMatchObject({ units_final: 2, status: "collected" });

    const [sub] = await serviceQuery<{ units_used: number }>(
      "select units_used from public.subscriptions where id = $1", [subId]);
    expect(sub!.units_used).toBe(2); // extra unit charged transparently

    const outbox = await serviceQuery<{ template_key: string }>(
      "select template_key from public.notification_outbox where user_id = $1 order by id desc limit 1",
      [resident.id]);
    expect(outbox[0]!.template_key).toBe("push.units_adjusted");
  });

  it("recount down refunds the difference", async () => {
    const { user: resident, subId } = await subscribedResident();
    const req = await submit(resident.id, 2);
    const picker = await activePicker();
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);

    await callAs(picker.id,
      `select api.mark_collected($1, '{"large_bags":1,"small_bags":0,"oversized_bags":0}'::jsonb)`,
      [claim!.id]);

    const [sub] = await serviceQuery<{ units_used: number }>(
      "select units_used from public.subscriptions where id = $1", [subId]);
    expect(sub!.units_used).toBe(1);
  });
});

describe("leak decline", () => {
  it("requires a photo, refunds fully, terminal state, NO strike", async () => {
    const { user: resident, subId } = await subscribedResident();
    const req = await submit(resident.id, 1);
    const picker = await activePicker();
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);

    await expectRpcError(
      callAs(picker.id, "select api.decline_leak($1, 'no/such/photo.jpg')", [claim!.id]),
      "photo_required",
    );

    const path = `${picker.id}/leak-${req.id}.jpg`;
    await callAs(picker.id, "select api.register_leak_photo($1, $2)", [req.id, path]);
    await callAs(picker.id, "select api.decline_leak($1, $2)", [claim!.id, path]);

    const [r] = await serviceQuery<{ status: string }>(
      "select status from public.requests where id = $1", [req.id]);
    expect(r!.status).toBe("declined_leak");

    const [sub] = await serviceQuery<{ units_used: number }>(
      "select units_used from public.subscriptions where id = $1", [subId]);
    expect(sub!.units_used).toBe(0); // no charge

    const [pk] = await serviceQuery<{ strikes: number }>(
      "select strikes from public.pickers where user_id = $1", [picker.id]);
    expect(pk!.strikes).toBe(0); // no strike

    const [photo] = await serviceQuery<{ delete_after: string }>(
      "select delete_after::text from public.photos where storage_path = $1", [path]);
    const days = (new Date(photo!.delete_after).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(85); // 90-day retention from config
  });
});

describe("verify → paid + wrong QR", () => {
  it("wrong QR is rejected; right QR completes the whole group and pays", async () => {
    const { user: resident } = await subscribedResident();
    const req = await submit(resident.id, 2);
    const picker = await activePicker();
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [claim] = await serviceQuery<{ id: string }>(
      "select id from public.claims where request_id = $1", [req.id]);
    await callAs(picker.id, "select api.mark_collected($1, null)", [claim!.id]);

    await expectRpcError(
      callAs(picker.id, "select api.verify_bin_scan($1, 'BIN-wrong')", [claim!.id]),
      "invalid_qr",
    );

    const [{ qr }] = await serviceQuery<{ qr: string }>(
      "select bin_qr_id as qr from public.buildings where id = $1", [req.building_id]);
    const [{ v }] = await callAs<{ v: { units: number; amount_agorot: number; today_total_agorot: number } }>(
      picker.id, "select api.verify_bin_scan($1, $2) as v", [claim!.id, qr]);
    expect(v.units).toBe(2);
    expect(v.amount_agorot).toBe(1400);
    expect(v.today_total_agorot).toBeGreaterThanOrEqual(1400);

    const [r] = await serviceQuery<{ status: string }>(
      "select status from public.requests where id = $1", [req.id]);
    expect(r!.status).toBe("paid");

    // full audit trail exists
    const events = await serviceQuery<{ to_status: string }>(
      "select to_status from public.request_events where request_id = $1 order by id", [req.id]);
    expect(events.map((e) => e.to_status)).toEqual(["open", "claimed", "collected", "verified", "paid"]);
  });
});

describe("no-show ladder", () => {
  it("lapse → repost + per-unit resident credit + strike; 3 strikes suspends", async () => {
    const picker = await activePicker();

    for (let i = 1; i <= 3; i++) {
      const { user: resident } = await subscribedResident();
      const req = await submit(resident.id, 2);
      await callAs(picker.id, "select api.claim_request($1)", [req.id]);
      await serviceQuery(
        "update public.claims set deadline_at = now() - interval '1 minute' where request_id = $1", [req.id]);
      await serviceQuery("select internal.lapse_claims()");

      const [r] = await serviceQuery<{ status: string; repost_count: number }>(
        "select status, repost_count from public.requests where id = $1", [req.id]);
      expect(r).toMatchObject({ status: "open", repost_count: 1 }); // reposted

      const credits = await serviceQuery<{ units_granted: number; reason: string }>(
        "select units_granted, reason from public.credits where user_id = $1", [resident.id]);
      expect(credits[0]).toMatchObject({ units_granted: 2, reason: "noshow_comp" });

      const [pk] = await serviceQuery<{ strikes: number; status: string }>(
        "select strikes, status from public.pickers where user_id = $1", [picker.id]);
      expect(pk!.strikes).toBe(i);
      expect(pk!.status).toBe(i >= 3 ? "suspended" : "active");
    }

    // suspended picker is locked out
    const { user: resident } = await subscribedResident();
    const req = await submit(resident.id);
    await expectRpcError(
      callAs(picker.id, "select api.claim_request($1)", [req.id]),
      "picker_suspended",
    );
  });

  it("lapse while waiting on the resident (confirm-first) releases WITHOUT strike", async () => {
    const { user: resident } = await subscribedResident();
    await callAs(resident.id, "select api.update_profile(null, null, null, true)"); // confirm-first ON
    const req = await submit(resident.id);
    const picker = await activePicker();
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);

    const [r0] = await serviceQuery<{ status: string; confirm_first: boolean }>(
      "select status, confirm_first from public.requests where id = $1", [req.id]);
    expect(r0).toMatchObject({ status: "resident_approval", confirm_first: true });

    await serviceQuery(
      "update public.claims set deadline_at = now() - interval '1 minute' where request_id = $1", [req.id]);
    await serviceQuery("select internal.lapse_claims()");

    const [r] = await serviceQuery<{ status: string }>(
      "select status from public.requests where id = $1", [req.id]);
    expect(r!.status).toBe("open");
    const [pk] = await serviceQuery<{ strikes: number }>(
      "select strikes from public.pickers where user_id = $1", [picker.id]);
    expect(pk!.strikes).toBe(0);
  });

  it("confirm-first happy path: approve → put out → claimed with a FRESH deadline", async () => {
    const { user: resident } = await subscribedResident();
    await callAs(resident.id, "select api.update_profile(null, null, null, true)");
    const req = await submit(resident.id);
    const picker = await activePicker();
    await callAs(picker.id, "select api.claim_request($1)", [req.id]);
    const [before] = await serviceQuery<{ deadline_at: string }>(
      "select deadline_at from public.claims where request_id = $1", [req.id]);

    await callAs(resident.id, "select api.approve_pickup($1)", [req.id]);
    await new Promise((r) => setTimeout(r, 1100));
    await callAs(resident.id, "select api.confirm_bag_out($1)", [req.id]);

    const [after] = await serviceQuery<{ deadline_at: string; status: string }>(
      "select c.deadline_at, r.status from public.claims c join public.requests r on r.id = c.request_id where c.request_id = $1",
      [req.id]);
    expect(after!.status).toBe("claimed");
    expect(new Date(after!.deadline_at).getTime()).toBeGreaterThan(new Date(before!.deadline_at).getTime());
  });
});
