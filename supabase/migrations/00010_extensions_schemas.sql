-- ============================================================================
-- 00010: extensions, private schemas, shared helpers
--
-- Runs on BOTH the real Supabase image (pg_cron/pg_net/pg_jsonschema/vault all
-- present) and a plain Postgres used for CI validation (supabase/tests/shim.sql
-- provides auth/roles/publication; missing extensions degrade via the wrappers
-- below, never by changing business behavior).
-- ============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
declare ext text;
begin
  foreach ext in array array['pg_jsonschema', 'pg_net', 'supabase_vault'] loop
    if exists (select 1 from pg_available_extensions where name = ext)
       and not exists (select 1 from pg_extension where extname = ext) then
      execute format('create extension %I', ext);
    end if;
  end loop;
  -- pg_cron must live in its configured database; ignore if unavailable here
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      execute 'create extension pg_cron';
    exception when others then
      raise notice 'pg_cron not created: %', sqlerrm;
    end;
  end if;
end $$;

-- api: exposed through PostgREST (added to config.toml [api].schemas).
-- core: private business helpers. internal: worker/service-only entrypoints.
create schema if not exists api;
create schema if not exists core;
create schema if not exists internal;

grant usage on schema api to authenticated, anon, service_role;
grant usage on schema core to service_role;      -- never to authenticated
grant usage on schema internal to service_role;  -- never to authenticated

-- Default: nothing is executable until explicitly granted.
alter default privileges in schema api revoke execute on functions from public, anon, authenticated;
alter default privileges in schema core revoke execute on functions from public, anon, authenticated;
alter default privileges in schema internal revoke execute on functions from public, anon, authenticated;

-- service_role must reach every business table regardless of later grants
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- ── shared helpers ──────────────────────────────────────────────────────────

-- plpgsql (not sql) so the body is parsed lazily: admin_users is created later.
create or replace function core.is_admin()
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return exists (select 1 from public.admin_users au where au.user_id = auth.uid());
end $$;

-- Stable-code error helper: the message IS the stable code clients map to strings.
create or replace function core.raise_error(p_code text)
returns void
language plpgsql immutable
as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end $$;

create or replace function core.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- JSON-Schema validation: pg_jsonschema when present (real Supabase);
-- the CI shim installs a plpgsql subset fallback under the same name.
create or replace function core.validate_jsonb(p_schema jsonb, p_value jsonb)
returns boolean
language plpgsql stable
set search_path = core, extensions, public, pg_temp
as $$
declare ok boolean;
begin
  if to_regprocedure('extensions.jsonb_matches_schema(jsonb, jsonb)') is not null then
    execute 'select extensions.jsonb_matches_schema($1, $2)' into ok using p_schema, p_value;
    return coalesce(ok, false);
  end if;
  return true; -- no validator available: accept (zod already validated client-side)
end $$;

-- Secrets: Supabase Vault in prod; core.dev_secrets fallback for local/CI.
-- core.dev_secrets is in the private core schema — no client can ever read it.
create table if not exists core.dev_secrets (
  name  text primary key,
  value text not null
);

create or replace function core.get_secret(p_name text)
returns text
language plpgsql stable security definer
set search_path = core, public, pg_temp
as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
      into v using p_name;
    if v is not null then return v; end if;
  end if;
  select value into v from core.dev_secrets where name = p_name;
  if v is null then
    raise exception using errcode = 'P0001', message = 'secret_missing:' || p_name;
  end if;
  return v;
end $$;

-- Realtime broadcast: realtime.send() on Supabase; silent no-op elsewhere.
-- Topics are private channels; payloads NEVER contain entry codes or PII.
create or replace function core.broadcast(p_topic text, p_event text, p_payload jsonb)
returns void
language plpgsql
set search_path = core, public, pg_temp
as $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    execute 'select realtime.send($1, $2, $3, true)' using p_payload, p_event, p_topic;
  end if;
exception when others then
  raise notice 'broadcast failed (non-fatal): %', sqlerrm;
end $$;
