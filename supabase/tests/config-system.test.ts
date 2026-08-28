import { beforeAll, describe, expect, it } from "vitest";
import {
  callAs,
  createTestUser,
  expectRpcError,
  makeAdmin,
  serviceQuery,
} from "./helpers";

let admin: { id: string };
let regular: { id: string };

beforeAll(async () => {
  admin = await createTestUser();
  await makeAdmin(admin.id);
  regular = await createTestUser();
});

describe("config store", () => {
  it("seed loaded every key from the shared schema", async () => {
    const rows = await serviceQuery<{ n: string }>("select count(*)::text as n from public.config");
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(28);
  });

  it("authenticated clients can read config + strings (instant hydration)", async () => {
    const rows = await callAs<{ key: string }>(regular.id, "select key from public.config limit 5");
    expect(rows.length).toBeGreaterThan(0);
    const s = await callAs<{ v: string }>(regular.id, "select core.str('home.big_button') as v", [], {
      role: "service_role",
    });
    expect(s[0]!.v).toBe("השקית מוכנה");
  });

  it("non-admin cannot set config", async () => {
    await expectRpcError(
      callAs(regular.id, "select api.admin_set_config('vat_rate', '0.2'::jsonb, null)"),
      "not_authorized",
    );
  });

  it("admin edit: version bump, audit row, instantly visible via core.cfg", async () => {
    const before = await serviceQuery<{ version: number }>(
      "select version from public.config where key = 'claim_to_scan_minutes'",
    );
    await callAs(admin.id, "select api.admin_set_config('claim_to_scan_minutes', '30'::jsonb, 'tighter SLA')");

    const cfg = await serviceQuery<{ v: number }>(
      "select core.cfg_int('claim_to_scan_minutes') as v",
    );
    expect(cfg[0]!.v).toBe(30);

    const audit = await serviceQuery<{ old_value: unknown; new_value: unknown; note: string }>(
      `select old_value, new_value, note from public.config_audit
        where key = 'claim_to_scan_minutes' order by id desc limit 1`,
    );
    expect(audit[0]!.old_value).toBe(45);
    expect(audit[0]!.new_value).toBe(30);
    expect(audit[0]!.note).toBe("tighter SLA");

    const after = await serviceQuery<{ version: number }>(
      "select version from public.config where key = 'claim_to_scan_minutes'",
    );
    expect(after[0]!.version).toBe(before[0]!.version + 1);
  });

  it("rejects schema-invalid values with config_validation_failed", async () => {
    await expectRpcError(
      callAs(admin.id, `select api.admin_set_config('claim_to_scan_minutes', '"soon"'::jsonb, null)`),
      "config_validation_failed",
    );
    await expectRpcError(
      callAs(
        admin.id,
        `select api.admin_set_config('unit_rules', '{"max_small_bags_per_unit": 3}'::jsonb, null)`,
      ),
      "config_validation_failed",
    );
  });

  it("unknown key → not_found", async () => {
    await expectRpcError(
      callAs(admin.id, "select api.admin_set_config('no_such_key', '1'::jsonb, null)"),
      "not_found",
    );
  });

  it("config_audit is admin-only", async () => {
    const asRegular = await callAs<{ n: string }>(
      regular.id,
      "select count(*)::text as n from public.config_audit",
    );
    expect(Number(asRegular[0]!.n)).toBe(0); // RLS filters all rows
    const asAdmin = await callAs<{ n: string }>(
      admin.id,
      "select count(*)::text as n from public.config_audit",
    );
    expect(Number(asAdmin[0]!.n)).toBeGreaterThan(0);
  });
});

describe("strings editor", () => {
  it("admin upsert + audit + fallback chain", async () => {
    await callAs(admin.id, "select api.admin_set_string('home.big_button', 'he', 'השקית מוכנה!')");
    const v = await serviceQuery<{ v: string }>("select core.str('home.big_button') as v");
    expect(v[0]!.v).toBe("השקית מוכנה!");

    // en falls back to he when missing
    await callAs(admin.id, "select api.admin_set_string('test.only_he', 'he', 'עברית בלבד')");
    const fb = await serviceQuery<{ v: string }>("select core.str('test.only_he', 'en') as v");
    expect(fb[0]!.v).toBe('עברית בלבד');

    const audit = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.config_audit where key like 'strings:%'",
    );
    expect(Number(audit[0]!.n)).toBeGreaterThan(0);
  });

  it("non-admin cannot edit strings", async () => {
    await expectRpcError(
      callAs(regular.id, "select api.admin_set_string('home.big_button', 'he', 'פריצה')"),
      "not_authorized",
    );
  });
});

describe("plans: versioned rows + grandfathering base", () => {
  it("editing a plan creates a new version and retires the old from signup", async () => {
    const v1 = await serviceQuery<{ id: string; price_agorot: number }>(
      "select id, price_agorot from public.plans where code = 'M' and version = 1",
    );

    await callAs(admin.id, "select api.admin_upsert_plan('M', 74, 6, true, 'reprice')");

    const rows = await serviceQuery<{
      version: number;
      price_agorot: number;
      active_for_signup: boolean;
    }>("select version, price_agorot, active_for_signup from public.plans where code = 'M' order by version");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ version: 1, price_agorot: 6900, active_for_signup: false });
    expect(rows[1]).toMatchObject({ version: 2, price_agorot: 7400, active_for_signup: true });

    // v1 row untouched — a subscription pointing at it keeps its signed terms
    const v1After = await serviceQuery<{ id: string; price_agorot: number }>(
      "select id, price_agorot from public.plans where code = 'M' and version = 1",
    );
    expect(v1After[0]).toEqual(v1[0]);
  });

  it("warns (never blocks) above plan_price_ceiling", async () => {
    const res = await callAs<{ admin_upsert_plan: { warning: string | null } }>(
      admin.id,
      "select api.admin_upsert_plan('XL', 120, 12, true, null) as admin_upsert_plan",
    );
    expect(res[0]!.admin_upsert_plan.warning).toBe("price_above_ceiling");
    const created = await serviceQuery<{ n: string }>(
      "select count(*)::text as n from public.plans where code = 'XL'",
    );
    expect(Number(created[0]!.n)).toBe(1);
  });

  it("non-admin cannot touch plans", async () => {
    await expectRpcError(
      callAs(regular.id, "select api.admin_upsert_plan('HACK', 1, 1, false, null)"),
      "not_authorized",
    );
  });
});

describe("identity + buildings foundations", () => {
  it("auth signup auto-provisions public.users with a referral code", async () => {
    const u = await createTestUser();
    const rows = await serviceQuery<{ referral_code: string; locale: string }>(
      "select referral_code, locale from public.users where id = $1",
      [u.id],
    );
    expect(rows[0]!.referral_code).toMatch(/^PN-[2-9A-Z]{6}$/);
    expect(rows[0]!.locale).toBe("he");
  });

  it("onboard_residency dedupes buildings by address and stores the code encrypted", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const r1 = await callAs<{ r: string }>(
      a.id,
      "select api.onboard_residency('תל אביב', 'דיזנגוף', '100', 3, '12', '1234#') as r",
    );
    const r2 = await callAs<{ r: string }>(
      b.id,
      "select api.onboard_residency('תל אביב', 'דיזנגוף', '100', 1, '2', '9999') as r",
    );
    expect(r1[0]!.r).not.toEqual(r2[0]!.r);

    const buildings = await serviceQuery<{ id: string; code: string }>(
      `select id, core.decrypt_entry_code(entry_code_enc) as code
         from public.buildings where city = 'תל אביב' and street = 'דיזנגוף' and house_number = '100'`,
    );
    expect(buildings).toHaveLength(1);
    expect(buildings[0]!.code).toBe("1234#"); // first writer wins; second didn't overwrite
  });

  it("clients can never select the ciphertext column", async () => {
    const u = await createTestUser();
    await callAs(u.id, "select api.onboard_residency('חיפה', 'הרצל', '5', 2, '7', '2468') ");
    await expect(
      callAs(u.id, "select entry_code_enc from public.buildings limit 1"),
    ).rejects.toThrow(/permission denied/);
    // but the granted columns work
    const ok = await callAs<{ street: string }>(u.id, "select street from public.buildings where street = 'הרצל'");
    expect(ok[0]!.street).toBe("הרצל");
  });

  it("residents see only their own residencies", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await callAs(a.id, "select api.onboard_residency('רמת גן', 'ביאליק', '8', 1, '3', null)");
    const asB = await callAs<{ n: string }>(
      b.id,
      "select count(*)::text as n from public.residencies",
    );
    expect(Number(asB[0]!.n)).toBe(0);
  });
});
