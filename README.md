# Pinui+ — trash-valet marketplace MVP

Two-sided Israeli marketplace: residents subscribe to have trash bags taken from
their apartment door to the building's bins; **pickers** claim pickups for
per-unit pay. Hebrew-first, full RTL, ₪.

> The product name is itself a config value (`strings.app_name`) — "Pinui+" is a
> placeholder codename.

## Prime directive: config-driven everything

No business value is hardcoded anywhere. Every price, payout, threshold, timer,
reward, label and rule lives in the versioned `config` store (and `strings`
table), editable from the admin panel with **instant effect** — no deploy.
Every change is audited (who, when, old→new). Subscribers are grandfathered on
the exact plan version they signed (a foreign key, not a policy).

- Source of truth for keys/shapes/defaults: `packages/shared/src/config/schema.ts`
- Regenerate the DB seed after changing it: `pnpm gen:config-seed`
- Money/countdown values are **snapshotted onto rows at transition time**
  (claim payout, deadlines, VAT) — config edits never touch in-flight work.

## Monorepo

| Path | What |
|---|---|
| `app/` | Expo app — one app, resident + picker modes |
| `admin/` | React admin panel (config/strings/plans editors, ops) |
| `packages/shared/` | Pure TS: config schemas (zod), unit counting, money, state machine map |
| `packages/providers/` | `PaymentProvider` / `SmsProvider` / `PushProvider` interfaces + mocks |
| `supabase/` | migrations, seeds, edge functions, DB tests |
| `scripts/` | seed generation, type generation, CI DB reset, e2e demo |

## Architecture in one paragraph

Postgres is the product. All state transitions, money math and audit run inside
SECURITY DEFINER RPCs (`api.*` exposed via PostgREST; `core.*`/`internal.*`
private). Clients never write business tables (RLS has **zero** write policies
for `authenticated`); they call RPCs and render rows + Realtime. Timers
(`request` TTL, claim no-show, allowance resets, credit expiry) run on pg_cron
over **stored** deadlines. Edge functions handle only secrets/HTTP/PDF: payment
webhooks, SMS OTP hook, push outbox drain, payout export. Payments are async
end-to-end: the mock PSP settles via the same webhook path a real Israeli PSP
(PayPlus/Cardcom/Tranzila) will use — swapping is a config edit
(`payment_provider`).

## Getting started (founder machine, with Docker)

```bash
pnpm install
npx supabase start          # local stack; prints anon/service keys
npx supabase db reset       # migrations + seeds
pnpm gen:types              # regenerate DB types after migrations

cp admin/.env.example admin/.env.local   # paste the anon key
pnpm admin:dev              # admin panel on :5180
pnpm app:start              # Expo dev server
```

Local OTP: the phone numbers in `supabase/config.toml [auth.sms.test_otp]`
(e.g. `972501000001` / code `111111`) sign in without real SMS.

## Tests (the money paths)

```bash
pnpm test:unit   # pure logic: unit counting, money/VAT, FIFO credits, state map, config schemas
pnpm test:db     # RPCs + RLS + audit against a real Postgres
pnpm e2e:demo    # full two-sided loop: submit→claim→reveal→collect→scan→pay
```

`test:db` targets, in order of preference:
1. **Local Supabase stack**: `SKIP_DB_RESET=1 TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db` (after `supabase db reset`)
2. **Plain Postgres 16** (no Docker, e.g. CI): `pnpm test:db` — auto-resets a
   `pinui_test` DB via `scripts/ci-db-reset.sh`, applying
   `supabase/tests/shim.sql` first (auth/roles/publication stand-ins +
   a pg_jsonschema subset fallback). Migrations themselves are identical in
   both environments.

## Production notes

- Set the `entry_code_key` secret once in Supabase Vault (dashboard) — it never
  appears in the repo. Entry codes are encrypted at rest, decrypted only inside
  `api.reveal_entry_code` during an active claim, time-boxed and audited.
- Point the Auth "Send SMS" hook at the `sms-hook` edge function and set the
  real SMS gateway credentials as function secrets.
- Switch `payment_provider` config to the real PSP adapter when it lands.
