# Lemata (למטה) — project notes for Claude Code

Israeli two-sided trash-valet marketplace MVP: Expo app (`app/`), Supabase
backend (`supabase/`), React admin (`admin/`), shared config/domain logic
(`packages/shared/`). Hebrew-first, full RTL.

**Read `HANDOFF.md` first** — it is the complete state document: architecture,
review history, demo logins, environment quirks, and the open-items list.

## The prime directive (non-negotiable)

Zero business values in code. Every price/payout/timer/threshold/label lives
in the `config` + `strings` tables. Config keys are defined ONLY in
`packages/shared/src/config/schema.ts`; after editing it run
`pnpm gen:config-seed` (the seed is generated — never edit
`supabase/seeds/01_config.sql` by hand). Money/deadline values get SNAPSHOTTED
onto rows at transition time.

## Commands

- `pnpm test:unit` — shared-package unit tests
- `pnpm test:db` — full DB suite. Local machine: `supabase start` once, then
  `SKIP_DB_RESET=1 TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db`
  after `supabase db reset`. (CI/web sessions use plain PG16 via
  `scripts/ci-db-reset.sh` — set up automatically by `.claude/hooks/session-start.sh`.)
- `pnpm --filter app exec tsc --noEmit` / `pnpm --filter admin exec tsc --noEmit` —
  the typecheck bar for app/admin changes
- `pnpm --filter admin build` · `pnpm admin:dev` · `pnpm app:start`
- `pnpm exec tsx scripts/demo-cli.ts` — narrated full-loop demo on the real engine
- `pnpm e2e:demo` — end-to-end against a RUNNING `supabase start` stack

## Conventions

- All state transitions/money/audit live in SECURITY DEFINER SQL RPCs
  (`api.*`); RLS has zero write policies for authenticated. New migrations are
  append-only (`supabase/migrations/00170_...` next); replace the LATEST
  version of a function (later migrations supersede earlier ones).
- Strings: he primary + en fallback, seeded in `supabase/seeds/02_strings.sql`,
  rendered via `str('key')` in app / `readString` in edge fns. Never hardcode copy.
- SQL↔TS twins (unit counting, state map, money) are guarded by anti-drift
  tests — change both sides together.
- Branch: `claude/trash-pickup-marketplace-mvp-2q8kzb` → draft PR #1 → `main`.
  CI runs the whole harness on every PR push.
