-- ============================================================================
-- 00030: identity — users (1:1 auth.users), devices, admin_users
-- ============================================================================

create table public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  phone         text unique not null,
  full_name     text,
  default_mode  text not null default 'resident' check (default_mode in ('resident', 'picker')),
  locale        text not null default 'he' check (locale in ('he', 'en')),
  confirm_first boolean not null default false,
  referral_code text unique not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger users_touch before update on public.users
  for each row execute function core.touch_updated_at();

create table public.devices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  expo_push_token text not null,
  platform        text check (platform in ('ios', 'android')),
  last_seen_at    timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create table public.admin_users (
  user_id    uuid primary key references public.users (id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'support')),
  created_at timestamptz not null default now(),
  created_by uuid
);

-- ── auto-provision public.users on signup ───────────────────────────────────

create or replace function core.generate_referral_code()
returns text
language plpgsql volatile
set search_path = core, public, extensions, pg_temp
as $$
declare code text; tries int := 0;
begin
  loop
    -- unambiguous alphabet (no 0/O/1/I), e.g. 'PN-X7K3F9'
    code := 'PN-' || (
      select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (random() * 30)::int + 1, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from public.users where referral_code = code);
    tries := tries + 1;
    if tries > 20 then
      raise exception 'referral_code_generation_failed';
    end if;
  end loop;
  return code;
end $$;

create or replace function core.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = core, public, pg_temp
as $$
begin
  insert into public.users (id, phone, referral_code)
  values (new.id, coalesce(new.phone, 'unknown:' || new.id::text), core.generate_referral_code())
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function core.handle_new_user();

-- ── grants + RLS ────────────────────────────────────────────────────────────

grant select on public.users, public.devices, public.admin_users to authenticated;

alter table public.users enable row level security;
alter table public.devices enable row level security;
alter table public.admin_users enable row level security;

create policy users_self on public.users
  for select using (id = auth.uid() or core.is_admin());
create policy devices_self on public.devices
  for select using (user_id = auth.uid() or core.is_admin());
create policy admin_users_admin on public.admin_users
  for select using (core.is_admin());

-- ── RPCs ────────────────────────────────────────────────────────────────────

create or replace function api.update_profile(
  p_full_name     text default null,
  p_default_mode  text default null,
  p_locale        text default null,
  p_confirm_first boolean default null
) returns public.users
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare u public.users;
begin
  update public.users
     set full_name     = coalesce(p_full_name, full_name),
         default_mode  = coalesce(p_default_mode, default_mode),
         locale        = coalesce(p_locale, locale),
         confirm_first = coalesce(p_confirm_first, confirm_first)
   where id = auth.uid()
   returning * into u;
  if not found then perform core.raise_error('not_found'); end if;
  return u;
end $$;

create or replace function api.register_device(
  p_expo_push_token text,
  p_platform        text default null
) returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
begin
  if auth.uid() is null then perform core.raise_error('not_authorized'); end if;
  insert into public.devices (user_id, expo_push_token, platform)
  values (auth.uid(), p_expo_push_token, p_platform)
  on conflict (user_id, expo_push_token)
  do update set last_seen_at = now(), platform = coalesce(excluded.platform, public.devices.platform);
end $$;

grant execute on function api.update_profile(text, text, text, boolean) to authenticated;
grant execute on function api.register_device(text, text) to authenticated;
