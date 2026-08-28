-- ============================================================================
-- 00040: buildings + residencies. Entry codes encrypted at rest (pgcrypto,
-- key via core.get_secret → Supabase Vault in prod). The ciphertext column is
-- NEVER granted to clients; decryption happens ONLY in api.reveal_entry_code
-- (defined with claims in 00070).
-- ============================================================================

create table public.buildings (
  id                uuid primary key default gen_random_uuid(),
  city              text not null,
  street            text not null,
  house_number      text not null,
  lat               numeric(9, 6),
  lng               numeric(9, 6),
  entry_code_enc    bytea,
  bin_qr_id         text unique not null default ('BIN-' || gen_random_uuid()::text),
  bin_location_note text,
  paused            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (city, street, house_number)
);

create trigger buildings_touch before update on public.buildings
  for each row execute function core.touch_updated_at();

create table public.residencies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  building_id uuid not null references public.buildings (id),
  floor       int,
  apartment   text not null,
  door_note   text,
  is_primary  boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (user_id, building_id, apartment)
);
create index residencies_building on public.residencies (building_id);

-- ── entry-code crypto (core-private) ────────────────────────────────────────

create or replace function core.encrypt_entry_code(p_code text)
returns bytea
language sql volatile security definer
set search_path = core, public, extensions, pg_temp
as $$
  select extensions.pgp_sym_encrypt(p_code, core.get_secret('entry_code_key'))
$$;

create or replace function core.decrypt_entry_code(p_enc bytea)
returns text
language sql stable security definer
set search_path = core, public, extensions, pg_temp
as $$
  select extensions.pgp_sym_decrypt(p_enc, core.get_secret('entry_code_key'))
$$;

-- ── grants + RLS ────────────────────────────────────────────────────────────
-- Column-level grant: entry_code_enc is NOT in the list — even a buggy future
-- policy cannot leak ciphertext to clients.

grant select (id, city, street, house_number, lat, lng, bin_qr_id,
              bin_location_note, paused, created_at, updated_at)
  on public.buildings to authenticated;
grant select on public.residencies to authenticated;

alter table public.buildings enable row level security;
alter table public.residencies enable row level security;

-- Residents see their own buildings; pickers additionally get rows for active
-- claims via a policy added in 00070 (claims table doesn't exist yet).
create policy buildings_resident on public.buildings
  for select using (
    core.is_admin()
    or exists (select 1 from public.residencies r
                where r.building_id = buildings.id and r.user_id = auth.uid())
  );

create policy residencies_self on public.residencies
  for select using (user_id = auth.uid() or core.is_admin());

-- ── RPCs ────────────────────────────────────────────────────────────────────

-- Resident onboarding: find-or-create the building (deduped by address),
-- store the entry code if the building doesn't have one yet, create residency.
create or replace function api.onboard_residency(
  p_city         text,
  p_street       text,
  p_house_number text,
  p_floor        int,
  p_apartment    text,
  p_entry_code   text default null,
  p_door_note    text default null,
  p_lat          numeric default null,
  p_lng          numeric default null
) returns uuid
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare b_id uuid; r_id uuid;
begin
  if auth.uid() is null then perform core.raise_error('not_authorized'); end if;
  if coalesce(trim(p_city), '') = '' or coalesce(trim(p_street), '') = ''
     or coalesce(trim(p_house_number), '') = '' or coalesce(trim(p_apartment), '') = '' then
    perform core.raise_error('not_found');
  end if;

  insert into public.buildings (city, street, house_number, lat, lng)
  values (trim(p_city), trim(p_street), trim(p_house_number), p_lat, p_lng)
  on conflict (city, street, house_number)
  do update set updated_at = now()   -- no-op update so RETURNING works on conflict
  returning id into b_id;

  if p_entry_code is not null and length(trim(p_entry_code)) > 0 then
    update public.buildings
       set entry_code_enc = core.encrypt_entry_code(trim(p_entry_code))
     where id = b_id and entry_code_enc is null;
  end if;

  insert into public.residencies (user_id, building_id, floor, apartment, door_note)
  values (auth.uid(), b_id, p_floor, trim(p_apartment), p_door_note)
  on conflict (user_id, building_id, apartment)
  do update set floor = excluded.floor, door_note = excluded.door_note
  returning id into r_id;

  return r_id;
end $$;

-- Resident updates their own building's code (they live there) or admin any.
create or replace function api.set_building_entry_code(
  p_building_id uuid,
  p_entry_code  text
) returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
begin
  if not core.is_admin() and not exists (
    select 1 from public.residencies r
     where r.building_id = p_building_id and r.user_id = auth.uid()
  ) then
    perform core.raise_error('not_authorized');
  end if;

  update public.buildings
     set entry_code_enc = case when coalesce(trim(p_entry_code), '') = ''
                               then null
                               else core.encrypt_entry_code(trim(p_entry_code)) end
   where id = p_building_id;
  if not found then perform core.raise_error('not_found'); end if;
end $$;

create or replace function api.admin_set_building_paused(
  p_building_id uuid,
  p_paused      boolean
) returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  update public.buildings set paused = p_paused where id = p_building_id;
  if not found then perform core.raise_error('not_found'); end if;
end $$;

grant execute on function api.onboard_residency(text, text, text, int, text, text, text, numeric, numeric) to authenticated;
grant execute on function api.set_building_entry_code(uuid, text) to authenticated;
grant execute on function api.admin_set_building_paused(uuid, boolean) to authenticated;
