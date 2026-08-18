-- ============================================================================
-- CI SHIM — plain-Postgres stand-in for the Supabase platform surface.
-- Applied BEFORE migrations when running on vanilla Postgres (no Docker).
-- NEVER applied to a real Supabase project (everything here ships built-in).
--
-- Provides: roles, auth schema (users + uid()), the supabase_realtime
-- publication, and a plpgsql subset fallback for pg_jsonschema.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  phone              text unique,
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Tests impersonate users with:
--   set local role authenticated;
--   select set_config('request.jwt.claim.sub', '<uuid>', true);
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ── pg_jsonschema fallback ──────────────────────────────────────────────────
-- Subset validator: type / properties / required / items / enum / min-max /
-- minItems / pattern. Enough for the config schemas + rejection-path tests.
-- Real Supabase uses the Rust pg_jsonschema extension under this exact name.
create schema if not exists extensions;

create or replace function extensions.jsonb_matches_schema(p_schema jsonb, p_value jsonb)
returns boolean
language plpgsql immutable
as $$
declare
  t text;
  prop record;
  req text;
  item jsonb;
  i int;
  ok boolean;
begin
  -- enum
  if p_schema ? 'enum' then
    ok := false;
    for item in select * from jsonb_array_elements(p_schema -> 'enum') loop
      if item = p_value then ok := true; end if;
    end loop;
    if not ok then return false; end if;
  end if;

  -- type
  if p_schema ? 'type' then
    t := p_schema ->> 'type';
    if t = 'object' then
      if jsonb_typeof(p_value) <> 'object' then return false; end if;
    elsif t = 'array' then
      if jsonb_typeof(p_value) <> 'array' then return false; end if;
    elsif t = 'string' then
      if jsonb_typeof(p_value) <> 'string' then return false; end if;
    elsif t = 'boolean' then
      if jsonb_typeof(p_value) <> 'boolean' then return false; end if;
    elsif t = 'number' then
      if jsonb_typeof(p_value) <> 'number' then return false; end if;
    elsif t = 'integer' then
      if jsonb_typeof(p_value) <> 'number' then return false; end if;
      if (p_value::text)::numeric % 1 <> 0 then return false; end if;
    elsif t = 'null' then
      if jsonb_typeof(p_value) <> 'null' then return false; end if;
    end if;
  end if;

  -- numeric bounds
  if jsonb_typeof(p_value) = 'number' then
    if p_schema ? 'minimum' and (p_value::text)::numeric < (p_schema ->> 'minimum')::numeric then
      return false;
    end if;
    if p_schema ? 'maximum' and (p_value::text)::numeric > (p_schema ->> 'maximum')::numeric then
      return false;
    end if;
    if p_schema ? 'exclusiveMinimum' and (p_value::text)::numeric <= (p_schema ->> 'exclusiveMinimum')::numeric then
      return false;
    end if;
  end if;

  -- string pattern
  if jsonb_typeof(p_value) = 'string' and p_schema ? 'pattern' then
    if not ((p_value #>> '{}') ~ (p_schema ->> 'pattern')) then return false; end if;
  end if;

  -- required + properties
  if jsonb_typeof(p_value) = 'object' then
    if p_schema ? 'required' then
      for req in select jsonb_array_elements_text(p_schema -> 'required') loop
        if not (p_value ? req) then return false; end if;
      end loop;
    end if;
    if p_schema ? 'properties' then
      for prop in select key, value from jsonb_each(p_schema -> 'properties') loop
        if p_value ? prop.key then
          if not extensions.jsonb_matches_schema(prop.value, p_value -> prop.key) then
            return false;
          end if;
        end if;
      end loop;
    end if;
  end if;

  -- arrays
  if jsonb_typeof(p_value) = 'array' then
    if p_schema ? 'minItems' and jsonb_array_length(p_value) < (p_schema ->> 'minItems')::int then
      return false;
    end if;
    if p_schema ? 'items' then
      for i in 0 .. jsonb_array_length(p_value) - 1 loop
        if not extensions.jsonb_matches_schema(p_schema -> 'items', p_value -> i) then
          return false;
        end if;
      end loop;
    end if;
  end if;

  return true;
end $$;
