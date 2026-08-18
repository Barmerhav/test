-- ============================================================================
-- 00050: payments (methods/charges/refunds), versioned plans, subscriptions
--
-- Plans are IMMUTABLE VERSION ROWS: "editing" a plan inserts (code, version+1)
-- and retires the old row from signup. subscriptions.plan_id points at the
-- exact version — grandfathering is a foreign key, not logic.
-- ============================================================================

create table public.payment_methods (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  provider       text not null,
  provider_token text not null,
  brand          text,
  last4          text,
  status         text not null default 'active' check (status in ('active', 'removed')),
  created_at     timestamptz not null default now()
);
create index payment_methods_user on public.payment_methods (user_id) where status = 'active';

create table public.charges (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id),
  subscription_id    uuid,          -- FK added below after subscriptions exists
  kind               text not null check (kind in
    ('subscription', 'on_demand', 'extra_roll', 'boost', 'backstop', 'kartisiya')),
  amount_agorot      int not null check (amount_agorot >= 0),
  currency           text not null default 'ILS',
  status             text not null default 'pending' check (status in
    ('pending', 'settled', 'failed', 'refunded', 'partially_refunded')),
  provider           text not null,
  provider_charge_id text,
  idempotency_key    text not null unique,
  failure_reason     text,
  meta               jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  settled_at         timestamptz
);
create index charges_user on public.charges (user_id, created_at desc);
create index charges_provider on public.charges (provider_charge_id) where provider_charge_id is not null;

create table public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  charge_id          uuid not null references public.charges (id),
  user_id            uuid not null references public.users (id),
  amount_agorot      int not null check (amount_agorot > 0),
  reason             text not null,
  status             text not null default 'pending' check (status in ('pending', 'settled', 'failed')),
  provider_refund_id text,
  idempotency_key    text not null unique,
  created_at         timestamptz not null default now(),
  settled_at         timestamptz
);

create table public.plans (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,          -- free text: founder adds plans at will
  version           int not null,
  name_strings_key  text not null,          -- e.g. 'plan.S.name' → strings table
  price_agorot      int not null check (price_agorot >= 0),
  units_per_month   int not null check (units_per_month > 0),
  bags_included     boolean not null default true,
  active_for_signup boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  unique (code, version)
);
-- only one signup-visible version per code
create unique index plans_one_active_per_code on public.plans (code) where active_for_signup;

create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users (id),
  residency_id         uuid not null references public.residencies (id),
  plan_id              uuid not null references public.plans (id),
  status               text not null default 'pending_payment' check (status in
    ('pending_payment', 'active', 'paused', 'past_due', 'canceled')),
  payment_method_id    uuid references public.payment_methods (id),
  bag_format           text not null default 'large' check (bag_format in ('large', 'small')),
  billing_anchor_day   smallint check (billing_anchor_day between 1 and 31),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  next_reset_at        timestamptz,
  units_included       int not null default 0 check (units_included >= 0),
  units_used           int not null default 0 check (units_used >= 0),
  plan_accepted_at     timestamptz not null default now(),
  paused_at            timestamptz,
  canceled_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index one_live_sub_per_user on public.subscriptions (user_id)
  where status in ('pending_payment', 'active', 'past_due', 'paused');
create index subs_reset on public.subscriptions (next_reset_at) where status = 'active';

create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function core.touch_updated_at();

alter table public.charges
  add constraint charges_subscription_fk
  foreign key (subscription_id) references public.subscriptions (id);

create table public.subscription_events (
  id              bigserial primary key,
  subscription_id uuid not null references public.subscriptions (id),
  event           text not null,
  actor_id        uuid,
  actor_role      text not null default 'system' check (actor_role in ('resident', 'system', 'admin')),
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index sub_events_sub on public.subscription_events (subscription_id, id);

create or replace function core.log_sub_event(
  p_subscription_id uuid,
  p_event           text,
  p_actor_role      text default 'system',
  p_meta            jsonb default '{}'::jsonb
) returns void
language sql volatile security definer
set search_path = core, public, pg_temp
as $$
  insert into public.subscription_events (subscription_id, event, actor_id, actor_role, meta)
  values (p_subscription_id, p_event, auth.uid(), p_actor_role, p_meta)
$$;

-- ── grants + RLS ────────────────────────────────────────────────────────────

grant select on public.plans to authenticated, anon;  -- plan picker renders pre-signup
grant select on public.payment_methods, public.charges, public.refunds,
                public.subscriptions, public.subscription_events to authenticated;

alter table public.payment_methods enable row level security;
alter table public.charges enable row level security;
alter table public.refunds enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;

create policy plans_read on public.plans for select using (true);
create policy payment_methods_self on public.payment_methods
  for select using (user_id = auth.uid() or core.is_admin());
create policy charges_self on public.charges
  for select using (user_id = auth.uid() or core.is_admin());
create policy refunds_self on public.refunds
  for select using (user_id = auth.uid() or core.is_admin());
create policy subscriptions_self on public.subscriptions
  for select using (user_id = auth.uid() or core.is_admin());
create policy sub_events_self on public.subscription_events
  for select using (
    core.is_admin() or exists (
      select 1 from public.subscriptions s
       where s.id = subscription_events.subscription_id and s.user_id = auth.uid())
  );

-- ── plan admin RPCs ─────────────────────────────────────────────────────────

-- Insert-only "edit": new version row, old version retired from signup.
-- Warns (never blocks) above config.plan_price_ceiling.
create or replace function api.admin_upsert_plan(
  p_code           text,
  p_price_shekels  numeric,
  p_units          int,
  p_bags_included  boolean default true,
  p_note           text default null
) returns jsonb
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  next_version int;
  new_plan public.plans;
  ceiling numeric;
  warning text := null;
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  if p_units <= 0 or p_price_shekels < 0 then perform core.raise_error('invalid_units'); end if;

  ceiling := core.cfg_numeric('plan_price_ceiling');
  if p_price_shekels > ceiling then
    warning := 'price_above_ceiling';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
    from public.plans where code = p_code;

  update public.plans set active_for_signup = false
   where code = p_code and active_for_signup;

  insert into public.plans
    (code, version, name_strings_key, price_agorot, units_per_month, bags_included, created_by)
  values
    (p_code, next_version, 'plan.' || p_code || '.name',
     core.shekels_to_agorot(p_price_shekels), p_units, p_bags_included, auth.uid())
  returning * into new_plan;

  insert into public.config_audit (key, old_value, new_value, old_version, new_version, changed_by, note)
  values ('plan:' || p_code,
          null,
          jsonb_build_object('price_shekels', p_price_shekels, 'units', p_units, 'bags_included', p_bags_included),
          next_version - 1, next_version, auth.uid(), p_note);

  return jsonb_build_object('plan_id', new_plan.id, 'version', next_version, 'warning', warning);
end $$;

-- Retire a plan from signup entirely (existing subscribers keep their terms).
create or replace function api.admin_retire_plan(p_code text)
returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  update public.plans set active_for_signup = false where code = p_code and active_for_signup;
  if not found then perform core.raise_error('not_found'); end if;
  insert into public.config_audit (key, old_value, new_value, old_version, new_version, changed_by, note)
  values ('plan:' || p_code, to_jsonb('active'::text), to_jsonb('retired'::text), 0, 0, auth.uid(), 'retire');
end $$;

grant execute on function api.admin_upsert_plan(text, numeric, int, boolean, text) to authenticated;
grant execute on function api.admin_retire_plan(text) to authenticated;
