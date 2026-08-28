-- ============================================================================
-- 00170: make core.validate_jsonb find the REAL pg_jsonschema.
--
-- Found in founder-machine validation: pg_jsonschema's function is
-- `jsonb_matches_schema(schema json, instance jsonb)` — first argument is
-- `json`, and the extension lands in whatever schema `create extension`
-- defaulted to (`public` on the local image; `extensions` on hosted projects
-- created via the dashboard). 00010 probed only for the CI shim's signature
-- `extensions.jsonb_matches_schema(jsonb, jsonb)`, so on a real Supabase
-- stack the probe missed and config validation silently accepted everything.
--
-- Behavior is unchanged where a validator exists: valid → true, invalid →
-- false (admin_set_config raises config_validation_failed). A validator that
-- errors (malformed schema) now counts as invalid rather than aborting with
-- an unstable error. No validator available (plain PG without the shim) still
-- accepts — zod already validated client-side.
-- ============================================================================

create or replace function core.validate_jsonb(p_schema jsonb, p_value jsonb)
returns boolean
language plpgsql stable
set search_path = core, extensions, public, pg_temp
as $$
declare ok boolean;
begin
  -- Real pg_jsonschema: jsonb_matches_schema(schema json, instance jsonb)
  if to_regprocedure('extensions.jsonb_matches_schema(json, jsonb)') is not null then
    execute 'select extensions.jsonb_matches_schema($1::json, $2)' into ok using p_schema, p_value;
    return coalesce(ok, false);
  end if;
  if to_regprocedure('public.jsonb_matches_schema(json, jsonb)') is not null then
    execute 'select public.jsonb_matches_schema($1::json, $2)' into ok using p_schema, p_value;
    return coalesce(ok, false);
  end if;
  -- CI shim's plpgsql subset validator: (jsonb, jsonb)
  if to_regprocedure('extensions.jsonb_matches_schema(jsonb, jsonb)') is not null then
    execute 'select extensions.jsonb_matches_schema($1, $2)' into ok using p_schema, p_value;
    return coalesce(ok, false);
  end if;
  return true; -- no validator available: accept (zod already validated client-side)
exception when others then
  return false; -- validator blew up (malformed schema): treat as invalid
end $$;
