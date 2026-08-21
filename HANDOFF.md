# HANDOFF — Lemata (למטה) MVP · sessions 2026-08-19 → 2026-08-21

Complete state document for continuing this project in a fresh Claude Code
session. Read this end-to-end before touching anything.

## Where the code lives

GitHub `barmerhav/test`: branch `claude/trash-pickup-marketplace-mvp-2q8kzb`,
**draft PR #1 → main** (main is a bootstrap README). CI (GitHub Actions) runs
the full harness on every PR/main push, and `.claude/hooks/session-start.sh`
rebuilds the local test harness automatically in Claude Code web sessions.

## What this is

Israeli two-sided trash-valet marketplace: residents subscribe (מכסת שקיות
monthly), put a bag outside the door, a courier (שליח) who's "going down
anyway" takes it to the building bins for per-bag pay. Hebrew-first, full RTL.
Brand: **למטה / Lemata** (strings key `app_name`). Packages keep the `@pinui`
codename.

**PRIME DIRECTIVE (non-negotiable): zero business values in code.** Every
price/payout/timer/threshold/label lives in the `config` + `strings` tables,
admin-editable with instant effect, fully audited, schema-validated. Source of
truth for config keys: `packages/shared/src/config/schema.ts` (zod) →
`pnpm gen:config-seed` regenerates `supabase/seeds/01_config.sql`. Money/
countdown values are SNAPSHOTTED onto rows at transition time (claim payout,
deadlines, VAT) so config edits never touch in-flight work.

## Architecture (see README.md for more)

- **Postgres is the product**: all transitions/money/audit in SECURITY DEFINER
  RPCs (`api.*` exposed via PostgREST; `core.*`/`internal.*` private). RLS has
  ZERO write policies for authenticated; cross-table policies go through
  definer helper fns (recursion). Entry codes pgcrypto-encrypted, decrypted
  only in `api.reveal_entry_code` (time-boxed + audited). Migrations
  `supabase/migrations/00010…00150` (00140 = hardening fixes, 00150 = billing retry).
- **Payments are async-only**: mock PSP settles via webhook →
  `internal.settle_charge` (activation, bag rolls, referrals, meter tiers,
  boost/backstop, refunds). Swap to real PSP = `payment_provider` config key.
- **Workers**: pg_cron (`internal.tick_minutely/tick_daily`, weekly
  `run_payout` with advisory lock) + edge fns (notify-worker outbox drain,
  billing-worker incl. past_due retry + stuck-webhook retry, photo-reaper,
  payout-export → CSV/MASAV/RTL invoice HTML).
- **App** (`app/`): Expo SDK 52, expo-router, two modes. Design = canvas theme
  "גרפיט וירוק שקט" (green #3E7E62 system; picker mode dark #212528). Canvas
  source: `design/Lemata App UI.dc.html` (artboard byte-offset map is in the
  git history of the session, but the file is self-explanatory). Interactive
  demo page: `design/interactive-demo.html`, published at
  https://claude.ai/code/artifact/a03e0e76-8e90-4a51-ac60-f6289f6cb550
  (update it cross-session by passing that URL as `url` to the Artifact tool).
- **Admin** (`admin/`): Vite/React, 11 pages (config editor w/ audit, strings,
  plans versioning, live board + dispatch, picker queue, payouts/exports,
  credits, buildings/QR posters, kill switches, metrics).

## Verification status (all green at handoff)

- `pnpm test:unit` — 44 tests (unit counting truth table, money/VAT, FIFO,
  state map, config schemas).
- `pnpm test:db` — 109 tests incl. claim race, payout double-run race,
  config-change-mid-flight snapshots, SQL↔TS anti-drift, no-show ladder,
  hardening + review-round-3 regressions. Runs on plain Postgres 16 via
  `scripts/ci-db-reset.sh` + `supabase/tests/shim.sql` (Docker images are
  BLOCKED by this environment's proxy; on the founder's machine use
  `supabase start` + `SKIP_DB_RESET=1 TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres`).
- `tsc --noEmit` strict-clean in `app/` and `admin/`; `pnpm --filter admin build` ok.
- THREE adversarial review rounds completed and ALL confirmed findings fixed:
  backend (20: payout double-pay race, anon cancel bypass, PUBLIC-execute
  default, pause free-month, stranded collected state → scan_grace
  auto-complete, retryable failed charges…), app (26: OTP stale-session
  routing, pending_payment lockout, blank-boot retry, stop refetch, toasts
  over modals, RTL first-launch reload…), and round 3 (31, fixed in migration
  `00160_review3_fixes.sql` + app/admin/edge patches: mark_collected payout
  clamp, entry-code first-set authz, bin_qr_id secrecy, past_due back-billing,
  renewal retry policy via `billing_retry` config, plan-change money
  (`pending_plan_id`), forced-transition refunds, kill-switch gating of
  on-demand, per-request boost, meter/referral races, outbox claiming, CSV/
  HTML injection in payout-export + its authz, plan-survey config, on-demand
  UI entry point).
- Live demo of the real engine: `pnpm exec tsx scripts/demo-cli.ts` (after
  ci-db-reset) — narrated full loop incl. payout + invoice.

## Environment quirks of the remote container

- Docker daemon must be started manually (`dockerd &`) but **image pulls are
  blocked** (Docker Hub/ECR/GHCR CDNs 403 at the egress gateway) → local
  Supabase stack unusable here; use the plain-PG16 harness (`pg_ctlcluster 16
  main start`, DB `pinui_test`, postgres password `postgres`,
  `shared_preload_libraries=pg_cron`).
- Expo/emulators can't run here — typecheck is the bar for app changes.
- Demo logins (config.toml test OTPs): residents 0501000001-3/`111111`
  (M plan active), picker 0502000001-2/`222222`, admin 0503000001/`333333`
  (web: admin@pinui.local / pinui-admin-local). Demo building bin QR:
  `BIN-DEMO-0001`, entry code `2468#`.

## Open items (in priority order)

1. Founder-machine validation: `supabase start && supabase db reset`,
   `pnpm gen:types` (regenerate `packages/shared/src/types/database.types.ts`
   — currently a placeholder), `pnpm e2e:demo`, run the Expo dev build
   (RTL requires a dev build, not Expo Go).
2. Merge decision on draft PR #1 (flip to ready when the founder is happy).
3. Deferred by design: real PSP adapter (PayPlus/Cardcom/Tranzila) behind the
   existing `PaymentProvider` interface; real SMS gateway in sms-hook;
   headless-PDF invoices (currently print-ready RTL HTML); feed realtime
   broadcast subscription (30s polling now); kartisiya UI (schema+flag only);
   Android Maps API key for the feed map view.
4. Small notes: `earnings.payout_schedule` day is derived (last payout + 7d);
   supermarket-price compare on plan cards omitted (no config key); courier
   name/distance not shown to residents (RLS doesn't expose it — deliberate).
   Downgrades now apply at the next renewal (`pending_plan_id`; upgrades are
   immediate + difference charged) — surface the scheduled change in the app
   UI beyond the usage-tab toast if the founder wants more visibility.
