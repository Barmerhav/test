/**
 * SOURCE OF TRUTH for every business config key.
 *
 * Each entry defines: the zod schema (validation shape), the seed default,
 * and a description shown in the admin config editor.
 *
 * `scripts/gen-config-seed.ts` converts this file into the SQL seed
 * (defaults + JSON Schema per key). `admin_set_config` re-validates values
 * against the stored JSON Schema via pg_jsonschema, so the DB enforces the
 * same shapes even when a caller bypasses the admin UI.
 *
 * PRIME DIRECTIVE: no business value is ever hardcoded in app/DB/edge code —
 * it must be a key here. Money values in this file are SHEKELS (the founder's
 * mental model); the DB snapshots amounts into agorot at transition time.
 */
import { z } from "zod";

const shekels = z.number().nonnegative();
const positiveInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();

/** HH:MM 24h local time (Asia/Jerusalem unless config.timezone says otherwise) */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

export interface ConfigEntry<S extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: S;
  default: z.infer<S>;
  description: string;
}

function entry<S extends z.ZodTypeAny>(
  schema: S,
  def: z.infer<S>,
  description: string,
): ConfigEntry<S> {
  return { schema, default: def, description };
}

export const configEntries = {
  // ── pricing & plans ────────────────────────────────────────────────
  plan_price_ceiling: entry(
    shekels,
    99,
    "Ceiling (₪/month) above which the admin plan editor warns (never blocks) when creating/repricing a plan.",
  ),

  // ── units ──────────────────────────────────────────────────────────
  unit_rules: entry(
    z.object({
      max_small_bags_per_unit: positiveInt,
      max_kg_per_unit: z.number().positive(),
      oversized_multiplier: positiveInt,
      small_4to6_units: positiveInt,
      max_units_per_request: positiveInt,
    }),
    {
      max_small_bags_per_unit: 3,
      max_kg_per_unit: 8,
      oversized_multiplier: 2,
      small_4to6_units: 2,
      max_units_per_request: 6,
    },
    "Unit counting rules: 1 large bag OR ≤max_small_bags_per_unit small bags (≤max_kg_per_unit kg) = 1 unit; oversized/overweight = oversized_multiplier units; 4–6 small bags = small_4to6_units units. max_units_per_request caps a single request (enforced in the submit RPC).",
  ),

  // ── picker economics ───────────────────────────────────────────────
  picker_payout_per_unit_exvat: entry(
    shekels,
    7.0,
    "Picker payout per unit, ₪ excluding VAT. Snapshotted onto the claim at claim time — config edits never change in-flight claims.",
  ),
  net_display_factor: entry(
    z.number().positive().max(1),
    0.7143,
    'Factor applied to the ex-VAT payout for the "₪N נטו" display shown to pickers (7.00 × 0.7143 ≈ ₪5 נטו). Display only — never affects actual payout.',
  ),
  vat_rate: entry(
    z.number().min(0).max(1),
    0.18,
    "VAT rate. Snapshotted per payout run; applied only for tax_status='murshe' pickers on self-billed invoices.",
  ),
  payment_fee_fixed: entry(
    shekels,
    1.5,
    "Fixed payment processing fee (₪) per charge — reporting/metrics only, never charged to users.",
  ),

  // ── request lifecycle ──────────────────────────────────────────────
  request_ttl_options: entry(
    z.object({
      options: z
        .array(
          z.object({
            key: z.string().min(1),
            cutoff: hhmm,
          }),
        )
        .min(1),
      default: z.string().min(1),
    }),
    {
      options: [
        { key: "noon", cutoff: "12:00" },
        { key: "evening", cutoff: "18:00" },
        { key: "today", cutoff: "23:00" },
      ],
      default: "today",
    },
    'TTL deadline chips on the submit sheet. Labels come from strings keys "ttl.<key>" (seeded: noon="עד הצהריים", evening="עד 18:00", today="היום"). Each option maps to a local cutoff time; the request\'s expires_at is snapshotted at submit. Chips whose cutoff already passed today are hidden in the app.',
  ),
  claim_to_scan_minutes: entry(
    positiveInt,
    45,
    "Minutes a picker has from claim (or from bag-out confirmation in confirm-first flow) until bin-QR scan, before the claim lapses as a no-show. Snapshotted as claims.deadline_at.",
  ),
  code_reveal_window_minutes: entry(
    positiveInt,
    10,
    "Maximum minutes a revealed building entry code stays displayed (never beyond the claim deadline). Every reveal is audited.",
  ),
  noshow_action: entry(
    z.object({
      repost: z.boolean(),
      payout_boost_pct: nonNegInt,
      resident_credit_units: nonNegInt,
      picker_strike: nonNegInt,
    }),
    { repost: true, payout_boost_pct: 0, resident_credit_units: 1, picker_strike: 1 },
    "What happens when a claim lapses (picker no-show): repost the request to the open pool (optionally boosting payout by payout_boost_pct %), grant the resident bag credits, add strikes to the picker.",
  ),
  expiry_action: entry(
    z.object({ resident_credit_units: nonNegInt }),
    { resident_credit_units: 1 },
    "What happens when an open request passes its TTL with no claim: resident automatically receives this many bag credits (zero-touch).",
  ),
  strikes_to_suspend: entry(
    positiveInt,
    3,
    "Active (non-revoked) strikes at which a picker is automatically suspended.",
  ),
  credit_expiry_days: entry(
    positiveInt,
    90,
    "Days until bag credits from expiry/no-show/building-meter grants expire. (Referral credits use referral.expiry_days; kartisiya uses kartisiya.validity_days.)",
  ),
  max_active_claim_groups: entry(
    positiveInt,
    1,
    "How many claim groups (buildings) a picker may hold simultaneously.",
  ),

  // ── optional features (kill-switched) ──────────────────────────────
  boost: entry(
    z.object({ enabled: z.boolean(), user_fee: shekels, payout_bump: shekels }),
    { enabled: false, user_fee: 4, payout_bump: 2 },
    "Boost: resident pays user_fee (₪) to bump the picker payout by payout_bump (₪) on one request. OFF until the founder enables.",
  ),
  backstop: entry(
    z.object({ enabled: z.boolean(), user_price: shekels }),
    { enabled: false, user_price: 15 },
    "Backstop: paid rescue option offered on expired requests (manual-dispatch lever). OFF until the founder enables.",
  ),
  on_demand_single: entry(
    z.object({ enabled: z.boolean(), price: shekels }),
    { enabled: true, price: 22 },
    "One-off pickup for non-subscribers: single request at this price (₪), charged per request.",
  ),
  extra_roll: entry(
    z.object({ enabled: z.boolean(), price: shekels }),
    { enabled: true, price: 15 },
    "Extra bag-roll order for subscribers, price in ₪.",
  ),
  kartisiya: entry(
    z.object({
      enabled: z.boolean(),
      price: shekels,
      units: positiveInt,
      validity_days: positiveInt,
    }),
    { enabled: false, price: 95, units: 8, validity_days: 90 },
    "Punch-card (כרטיסיה): prepaid bundle of units with limited validity. Schema + flag only in MVP — no UI until legal check passes.",
  ),

  // ── growth ─────────────────────────────────────────────────────────
  referral: entry(
    z.object({
      enabled: z.boolean(),
      reward_units_each_side: positiveInt,
      expiry_days: positiveInt,
      monthly_stack_cap: positiveInt,
    }),
    { enabled: true, reward_units_each_side: 3, expiry_days: 60, monthly_stack_cap: 6 },
    "Referral program: both sides receive reward_units_each_side bag credits when the referee's first payment settles. Pending referrals expire after expiry_days; a referrer can earn at most monthly_stack_cap referral units per calendar month.",
  ),
  building_meter: entry(
    z.object({
      enabled: z.boolean(),
      tiers: z
        .array(z.object({ doors: positiveInt, bonus_units_all: positiveInt }))
        .min(1),
    }),
    {
      enabled: true,
      tiers: [
        { doors: 5, bonus_units_all: 1 },
        { doors: 10, bonus_units_all: 2 },
        { doors: 20, bonus_units_all: 3 },
      ],
    },
    "Building meter: when a building reaches `doors` active subscriptions, every active door receives bonus_units_all bag credits (once per tier per building). Social proof + bag bonuses ONLY — never gates service.",
  ),

  // ── bags ───────────────────────────────────────────────────────────
  bag_formats: entry(
    z.object({
      large: z.object({ units_per_bag: positiveInt, roll_count: positiveInt }),
      small: z.object({ bags_per_unit: positiveInt, roll_count: positiveInt }),
    }),
    {
      large: { units_per_bag: 1, roll_count: 18 },
      small: { bags_per_unit: 3, roll_count: 54 },
    },
    "Bag roll formats: large = 1 unit per bag, 18 bags per roll; small = 3 bags per unit, 54 bags per roll.",
  ),

  // ── privacy / limits / ops ─────────────────────────────────────────
  photo_retention_days: entry(
    positiveInt,
    90,
    "Days leak-decline photos are retained in private storage before automatic deletion.",
  ),
  rate_limits: entry(
    z.object({
      otp_per_phone_per_hour: positiveInt,
      claim_per_picker_per_hour: positiveInt,
      reveal_per_claim: positiveInt,
    }),
    { otp_per_phone_per_hour: 5, claim_per_picker_per_hour: 20, reveal_per_claim: 5 },
    "Abuse limits enforced inside the RPCs / SMS hook (not only at the edge).",
  ),
  timezone: entry(
    z.string().min(1),
    "Asia/Jerusalem",
    "IANA timezone used to resolve TTL cutoff times and daily jobs.",
  ),
  service_enabled: entry(
    z.boolean(),
    true,
    "Global kill switch: when false, new request submission is disabled everywhere (existing in-flight requests still finish).",
  ),
  payment_provider: entry(
    z.enum(["mock", "payplus", "cardcom", "tranzila"]),
    "mock",
    "Which PaymentProvider adapter the edge functions instantiate. Switching mock → real PSP is a config edit, not a deploy.",
  ),
  mock_payment: entry(
    z.object({
      settle_delay_seconds: nonNegInt,
      outcome: z.enum(["settle", "fail"]),
    }),
    { settle_delay_seconds: 2, outcome: "settle" },
    "Mock PSP behavior: how long after chargeToken the simulated webhook settles, and whether it settles or fails (for testing).",
  ),
} as const;

export type ConfigKey = keyof typeof configEntries;

export type ConfigValues = {
  [K in ConfigKey]: z.infer<(typeof configEntries)[K]["schema"]>;
};

export const CONFIG_KEYS = Object.keys(configEntries) as ConfigKey[];

/** Validate a raw value for a key; throws ZodError with details on mismatch. */
export function parseConfigValue<K extends ConfigKey>(
  key: K,
  raw: unknown,
): ConfigValues[K] {
  return configEntries[key].schema.parse(raw) as ConfigValues[K];
}

/** A hydrated snapshot of the whole config table: key → raw jsonb value. */
export type ConfigStore = Partial<Record<string, unknown>>;

/**
 * Typed accessor used by app/admin/edge code. Falls back to the seed default
 * when the store has no row (e.g. brand-new key not yet migrated) so clients
 * never crash mid-rollout, but validation failures throw loudly.
 */
export function getConfig<K extends ConfigKey>(
  store: ConfigStore,
  key: K,
): ConfigValues[K] {
  const raw = store[key];
  if (raw === undefined) return configEntries[key].default as ConfigValues[K];
  return parseConfigValue(key, raw);
}
