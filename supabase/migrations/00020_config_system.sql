-- ============================================================================
-- 00020: config store (versioned, audited, schema-validated) + strings (i18n)
--
-- PRIME DIRECTIVE: every business value lives here, admin-editable with
-- instant effect. Code reads via core.cfg*(); the ONLY write path is
-- api.admin_set_config, which validates against the stored JSON Schema
-- (generated from packages/shared/src/config/schema.ts) and writes the audit
-- row in the same transaction.
-- ============================================================================

create table public.config (
  key         text primary key,
  value       jsonb not null,
  schema      jsonb not null,
  description text not null default '',
  version     int  not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table public.config_audit (
  id          bigserial primary key,
  key         text not null,
  old_value   jsonb,
  new_value   jsonb not null,
  old_version int,
  new_version int not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  note        text
);
create index config_audit_key on public.config_audit (key, id desc);

-- All user-facing copy. he = primary, en = fallback. Also push templates.
create table public.strings (
  key        text not null,
  locale     text not null check (locale in ('he', 'en')),
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (key, locale)
);

-- ── grants + RLS ────────────────────────────────────────────────────────────
grant select on public.config, public.strings to authenticated, anon;
grant select on public.config_audit to authenticated;
grant all on public.config, public.config_audit, public.strings to service_role;
grant usage, select on sequence public.config_audit_id_seq to service_role;

alter table public.config enable row level security;
alter table public.config_audit enable row level security;
alter table public.strings enable row level security;

-- config + strings hold zero secrets; readable by every signed-in client
-- (and anon, so the login screen can render copy). NO write policies: the
-- only write path is the SECURITY DEFINER RPCs below.
create policy config_read on public.config for select using (true);
create policy strings_read on public.strings for select using (true);
create policy config_audit_admin_read on public.config_audit
  for select using (core.is_admin());

-- ── read accessors ──────────────────────────────────────────────────────────

create or replace function core.cfg(p_key text)
returns jsonb
language plpgsql stable security definer
set search_path = core, public, pg_temp
as $$
declare v jsonb;
begin
  select value into v from public.config where key = p_key;
  if v is null then
    raise exception using errcode = 'P0001', message = 'config_key_missing:' || p_key;
  end if;
  return v;
end $$;

create or replace function core.cfg_int(p_key text)
returns int language sql stable security definer
set search_path = core, public, pg_temp
as $$ select (core.cfg(p_key))::int $$;

create or replace function core.cfg_numeric(p_key text)
returns numeric language sql stable security definer
set search_path = core, public, pg_temp
as $$ select (core.cfg(p_key))::numeric $$;

create or replace function core.cfg_bool(p_key text)
returns boolean language sql stable security definer
set search_path = core, public, pg_temp
as $$ select (core.cfg(p_key))::boolean $$;

create or replace function core.cfg_text(p_key text)
returns text language sql stable security definer
set search_path = core, public, pg_temp
as $$ select core.cfg(p_key) #>> '{}' $$;

-- shekels (numeric, founder-facing) → agorot (int, DB truth)
create or replace function core.shekels_to_agorot(p numeric)
returns int language sql immutable
as $$ select round(p * 100)::int $$;

-- localized string with he→en fallback; '!key' when missing entirely
create or replace function core.str(p_key text, p_locale text default 'he')
returns text
language sql stable security definer
set search_path = core, public, pg_temp
as $$
  select coalesce(
    (select value from public.strings where key = p_key and locale = p_locale),
    (select value from public.strings where key = p_key and locale = 'he'),
    (select value from public.strings where key = p_key and locale = 'en'),
    '!' || p_key
  )
$$;

-- ── write path (the only one) ───────────────────────────────────────────────

create or replace function api.admin_set_config(
  p_key   text,
  p_value jsonb,
  p_note  text default null
) returns jsonb
language plpgsql security definer
set search_path = api, core, public, extensions, pg_temp
as $$
declare
  old_row public.config%rowtype;
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;

  select * into old_row from public.config where key = p_key for update;
  if not found then perform core.raise_error('not_found'); end if;

  if not core.validate_jsonb(old_row.schema, p_value) then
    perform core.raise_error('config_validation_failed');
  end if;

  update public.config
     set value = p_value,
         version = old_row.version + 1,
         updated_at = now(),
         updated_by = auth.uid()
   where key = p_key;

  insert into public.config_audit
    (key, old_value, new_value, old_version, new_version, changed_by, note)
  values
    (p_key, old_row.value, p_value, old_row.version, old_row.version + 1, auth.uid(), p_note);

  return jsonb_build_object('key', p_key, 'version', old_row.version + 1);
end $$;

-- Strings editor write path; audited into config_audit under 'strings:<key>:<locale>'.
create or replace function api.admin_set_string(
  p_key    text,
  p_locale text,
  p_value  text
) returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare old_val text; new_ver int;
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;

  select value into old_val from public.strings where key = p_key and locale = p_locale for update;

  insert into public.strings (key, locale, value, updated_by)
  values (p_key, p_locale, p_value, auth.uid())
  on conflict (key, locale)
  do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;

  select coalesce(max(new_version), 0) + 1 into new_ver
    from public.config_audit where key = 'strings:' || p_key || ':' || p_locale;

  insert into public.config_audit (key, old_value, new_value, old_version, new_version, changed_by)
  values ('strings:' || p_key || ':' || p_locale,
          to_jsonb(old_val), to_jsonb(p_value), new_ver - 1, new_ver, auth.uid());
end $$;

grant execute on function api.admin_set_config(text, jsonb, text) to authenticated;
grant execute on function api.admin_set_string(text, text, text) to authenticated;

-- Instant effect: clients subscribe to postgres_changes on these tables.
alter publication supabase_realtime add table public.config;
alter publication supabase_realtime add table public.strings;
