-- ============================================================================
-- 00110: growth + zero-touch money paths — referrals (settlement-triggered,
-- capped), building meter (social + bag bonuses only), on-demand singles for
-- non-subscribers (charge-funded, money-refunded), boost/backstop/kartisiya
-- settle handlers, automatic refunds.
-- ============================================================================

create table public.referrals (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.users (id),
  referee_id  uuid not null unique references public.users (id),
  code        text not null,
  status      text not null default 'pending' check (status in ('pending', 'rewarded', 'expired')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  rewarded_at timestamptz
);
create index referrals_referrer on public.referrals (referrer_id);

create table public.building_meter_awards (
  id          uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id),
  tier_doors  int not null,
  awarded_at  timestamptz not null default now(),
  unique (building_id, tier_doors)
);

-- Live doors count: a view is always correct and needs no sync.
create view public.building_meter
with (security_invoker = false) as
  select b.id as building_id, count(distinct s.id)::int as active_doors
    from public.buildings b
    left join public.residencies r on r.building_id = b.id
    left join public.subscriptions s on s.residency_id = r.id and s.status = 'active'
   group by b.id;

grant select on public.referrals, public.building_meter_awards, public.building_meter to authenticated;

alter table public.referrals enable row level security;
alter table public.building_meter_awards enable row level security;

create policy referrals_parties on public.referrals
  for select using (referrer_id = auth.uid() or referee_id = auth.uid() or core.is_admin());
create policy meter_awards_read on public.building_meter_awards
  for select using (true);   -- social display; no PII

-- ── referral mechanics ──────────────────────────────────────────────────────

create or replace function api.apply_referral_code(p_code text)
returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  cfg jsonb := core.cfg('referral');
  referrer uuid;
begin
  if auth.uid() is null then perform core.raise_error('not_authorized'); end if;
  if not (cfg ->> 'enabled')::boolean then perform core.raise_error('feature_disabled'); end if;

  select id into referrer from public.users where referral_code = upper(trim(p_code));
  if not found or referrer = auth.uid() then perform core.raise_error('not_found'); end if;

  -- only before the first settled payment, and only once per referee ever
  if exists (select 1 from public.charges where user_id = auth.uid() and status = 'settled') then
    perform core.raise_error('illegal_transition');
  end if;

  insert into public.referrals (referrer_id, referee_id, code, expires_at)
  values (referrer, auth.uid(), upper(trim(p_code)),
          now() + make_interval(days => (cfg ->> 'expiry_days')::int));
  -- unique(referee_id) turns a second attempt into a constraint error → client shows error.unknown
end $$;

grant execute on function api.apply_referral_code(text) to authenticated;

-- Reward on the referee's FIRST settled charge (PSP-agnostic: it keys off
-- settle_charge, so mock and real providers behave identically).
create or replace function core.process_referral_reward(p_user_id uuid)
returns void
language plpgsql volatile security definer
set search_path = core, public, pg_temp
as $$
declare
  cfg jsonb := core.cfg('referral');
  ref public.referrals;
  reward int := (cfg ->> 'reward_units_each_side')::int;
  cap int := (cfg ->> 'monthly_stack_cap')::int;
  granted_this_month int;
  referrer_units int;
begin
  if not (cfg ->> 'enabled')::boolean then return; end if;

  select * into ref from public.referrals
   where referee_id = p_user_id and status = 'pending' and expires_at > now()
   for update;
  if not found then return; end if;

  -- referee: full reward, always
  perform core.grant_credit(ref.referee_id, reward, 'referral', ref.id, null);

  -- referrer: capped per calendar month
  select coalesce(sum(units_granted), 0) into granted_this_month
    from public.credits
   where user_id = ref.referrer_id and reason = 'referral'
     and granted_at >= date_trunc('month', now());
  referrer_units := least(reward, greatest(0, cap - granted_this_month));
  if referrer_units > 0 then
    perform core.grant_credit(ref.referrer_id, referrer_units, 'referral', ref.id, null);
  end if;

  update public.referrals set status = 'rewarded', rewarded_at = now() where id = ref.id;

  perform core.notify(ref.referee_id, 'push.referral_reward', jsonb_build_object('units', reward));
  if referrer_units > 0 then
    perform core.notify(ref.referrer_id, 'push.referral_reward', jsonb_build_object('units', referrer_units));
  end if;
end $$;

create or replace function internal.expire_referrals()
returns int
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare n int;
begin
  update public.referrals set status = 'expired'
   where status = 'pending' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ── building meter tiers (bag bonuses only — NEVER gates service) ───────────

create or replace function core.check_meter_tiers(p_building_id uuid)
returns void
language plpgsql volatile security definer
set search_path = core, public, pg_temp
as $$
declare
  cfg jsonb := core.cfg('building_meter');
  doors int;
  tier jsonb;
  door record;
begin
  if not (cfg ->> 'enabled')::boolean then return; end if;

  select active_doors into doors from public.building_meter where building_id = p_building_id;

  for tier in select * from jsonb_array_elements(cfg -> 'tiers')
  loop
    if doors >= (tier ->> 'doors')::int and not exists (
      select 1 from public.building_meter_awards
       where building_id = p_building_id and tier_doors = (tier ->> 'doors')::int
    ) then
      insert into public.building_meter_awards (building_id, tier_doors)
      values (p_building_id, (tier ->> 'doors')::int);

      for door in
        select distinct s.user_id from public.subscriptions s
          join public.residencies r on r.id = s.residency_id
         where r.building_id = p_building_id and s.status = 'active'
      loop
        perform core.grant_credit(door.user_id, (tier ->> 'bonus_units_all')::int,
                                  'building_meter', p_building_id, null);
        perform core.notify(door.user_id, 'push.meter_tier',
          jsonb_build_object('doors', (tier ->> 'doors')::int,
                             'bonus', (tier ->> 'bonus_units_all')::int));
      end loop;
    end if;
  end loop;
end $$;

-- ── refunds (zero-touch money back for charge-funded work) ─────────────────

create or replace function internal.create_refund(
  p_charge_id uuid,
  p_amount_agorot int,
  p_reason text
) returns uuid
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare ch public.charges; rid uuid;
begin
  select * into ch from public.charges where id = p_charge_id for update;
  if not found or ch.status not in ('settled', 'partially_refunded') then return null; end if;

  insert into public.refunds (charge_id, user_id, amount_agorot, reason, idempotency_key)
  values (ch.id, ch.user_id, least(p_amount_agorot, ch.amount_agorot), p_reason,
          'rf:' || ch.id || ':' || p_reason)
  on conflict (idempotency_key) do nothing
  returning id into rid;
  return rid;   -- pending; the billing worker takes it to the provider
end $$;

-- charge-funded units_source entries now refund money instead of units
create or replace function core.refund_units(p_request_id uuid, p_user_id uuid, p_sources jsonb)
returns void
language plpgsql volatile security definer
set search_path = core, internal, public, pg_temp
as $$
declare s jsonb;
begin
  for s in select * from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
  loop
    if s ->> 'type' = 'credit' then
      update public.credits
         set units_consumed = greatest(0, units_consumed - (s ->> 'units')::int),
             status = case when status = 'exhausted' then 'active' else status end
       where id = (s ->> 'credit_id')::uuid;
      delete from public.credit_consumptions
       where credit_id = (s ->> 'credit_id')::uuid and request_id = p_request_id;
    elsif s ->> 'type' = 'allowance' then
      update public.subscriptions
         set units_used = greatest(0, units_used - (s ->> 'units')::int)
       where user_id = p_user_id
         and status in ('active', 'paused', 'past_due');
    elsif s ->> 'type' = 'charge' then
      perform internal.create_refund((s ->> 'charge_id')::uuid,
        (select amount_agorot from public.charges where id = (s ->> 'charge_id')::uuid),
        'request_refund');
    end if;
  end loop;
end $$;

-- expiry worker: on-demand (charge-funded) requests get MONEY back, not credits
create or replace function internal.expire_requests()
returns int
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare
  r record;
  n int := 0;
  credit_per_unit int := (core.cfg('expiry_action') ->> 'resident_credit_units')::int;
begin
  for r in
    select id, resident_id, units_requested, subscription_id, units_source
      from public.requests
     where status = 'open' and expires_at <= now()
     for update skip locked
  loop
    perform core.transition_request(r.id, 'open', 'expired', 'system',
      jsonb_build_object('reason', 'ttl_expired'));

    if r.subscription_id is not null then
      if credit_per_unit > 0 then
        perform core.grant_credit(r.resident_id, credit_per_unit * r.units_requested,
                                  'expiry_comp', r.id, null);
      end if;
    else
      perform core.refund_units(r.id, r.resident_id, r.units_source);  -- money back
    end if;

    perform core.notify(r.resident_id, 'push.request_expired',
      jsonb_build_object('request_id', r.id, 'units', credit_per_unit * r.units_requested));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── on-demand single (non-subscribers): charge first, request on settle ────

create or replace function api.service_charge_on_demand(p_user_id uuid, p_ttl_option text)
returns jsonb
language plpgsql volatile security definer
set search_path = api, internal, core, public, pg_temp
as $$
declare
  cfg jsonb := core.cfg('on_demand_single');
  pm public.payment_methods;
  ch public.charges;
begin
  if not (cfg ->> 'enabled')::boolean then perform core.raise_error('feature_disabled'); end if;
  if not exists (select 1 from public.residencies where user_id = p_user_id) then
    perform core.raise_error('not_found');
  end if;
  -- validate the TTL now so a bad chip fails before money moves
  perform core.ttl_expiry(coalesce(p_ttl_option, core.cfg('request_ttl_options') ->> 'default'));

  select * into pm from public.payment_methods
   where user_id = p_user_id and status = 'active'
   order by created_at desc limit 1;

  ch := internal.create_charge(p_user_id, 'on_demand',
          core.shekels_to_agorot((cfg ->> 'price')::numeric),
          core.cfg_text('payment_provider'),
          'od:' || p_user_id || ':' || extract(epoch from now())::bigint,
          null,
          jsonb_build_object('ttl_option', coalesce(p_ttl_option, core.cfg('request_ttl_options') ->> 'default')));

  return jsonb_build_object('charge_id', ch.id, 'amount_agorot', ch.amount_agorot,
    'idempotency_key', ch.idempotency_key, 'provider', ch.provider,
    'provider_token', coalesce(pm.provider_token, 'missing'));
end $$;

create or replace function api.service_charge_boost(p_request_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = api, internal, core, public, pg_temp
as $$
declare
  cfg jsonb := core.cfg('boost');
  req public.requests;
  pm public.payment_methods;
  ch public.charges;
begin
  if not (cfg ->> 'enabled')::boolean then perform core.raise_error('feature_disabled'); end if;
  select * into req from public.requests where id = p_request_id;
  if not found or req.status <> 'open' then perform core.raise_error('illegal_transition'); end if;

  select * into pm from public.payment_methods
   where user_id = req.resident_id and status = 'active'
   order by created_at desc limit 1;

  ch := internal.create_charge(req.resident_id, 'boost',
          core.shekels_to_agorot((cfg ->> 'user_fee')::numeric),
          core.cfg_text('payment_provider'),
          'boost:' || p_request_id, null,
          jsonb_build_object('request_id', p_request_id));

  return jsonb_build_object('charge_id', ch.id, 'amount_agorot', ch.amount_agorot,
    'idempotency_key', ch.idempotency_key, 'provider', ch.provider,
    'provider_token', coalesce(pm.provider_token, 'missing'));
end $$;

create or replace function api.service_charge_backstop(p_request_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = api, internal, core, public, pg_temp
as $$
declare
  cfg jsonb := core.cfg('backstop');
  req public.requests;
  pm public.payment_methods;
  ch public.charges;
begin
  if not (cfg ->> 'enabled')::boolean then perform core.raise_error('feature_disabled'); end if;
  select * into req from public.requests where id = p_request_id;
  if not found or req.status <> 'expired' then perform core.raise_error('illegal_transition'); end if;

  select * into pm from public.payment_methods
   where user_id = req.resident_id and status = 'active'
   order by created_at desc limit 1;

  ch := internal.create_charge(req.resident_id, 'backstop',
          core.shekels_to_agorot((cfg ->> 'user_price')::numeric),
          core.cfg_text('payment_provider'),
          'backstop:' || p_request_id, null,
          jsonb_build_object('request_id', p_request_id));

  return jsonb_build_object('charge_id', ch.id, 'amount_agorot', ch.amount_agorot,
    'idempotency_key', ch.idempotency_key, 'provider', ch.provider,
    'provider_token', coalesce(pm.provider_token, 'missing'));
end $$;

revoke execute on function api.service_charge_on_demand(uuid, text),
  api.service_charge_boost(uuid), api.service_charge_backstop(uuid)
from public, anon, authenticated;
grant execute on function api.service_charge_on_demand(uuid, text),
  api.service_charge_boost(uuid), api.service_charge_backstop(uuid)
to service_role;

-- ── settle_charge v2: + referral reward, meter tiers, on-demand request
--    creation, boost bump, backstop repost, kartisiya credits ────────────────

create or replace function internal.settle_charge(
  p_provider_charge_id text,
  p_outcome            text,
  p_failure_reason     text default null
) returns public.charges
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare
  ch public.charges;
  sub public.subscriptions;
  plan public.plans;
  anchor smallint;
  fmt jsonb;
  res public.residencies;
  req public.requests;
  ttl text;
  cfgk jsonb;
begin
  select * into ch from public.charges
   where provider_charge_id = p_provider_charge_id
   for update;
  if not found then perform core.raise_error('not_found'); end if;
  if ch.status <> 'pending' then return ch; end if;   -- idempotent

  if p_outcome = 'failed' then
    update public.charges
       set status = 'failed', failure_reason = p_failure_reason
     where id = ch.id returning * into ch;
    if ch.kind = 'subscription' and ch.subscription_id is not null then
      update public.subscriptions
         set status = case when status = 'active' then 'past_due' else status end
       where id = ch.subscription_id;
      perform core.log_sub_event(ch.subscription_id, 'charge_failed', 'system',
        jsonb_build_object('charge_id', ch.id, 'reason', p_failure_reason));
    end if;
    return ch;
  end if;

  update public.charges
     set status = 'settled', settled_at = now()
   where id = ch.id returning * into ch;

  if ch.kind = 'subscription' and ch.subscription_id is not null then
    select * into sub from public.subscriptions where id = ch.subscription_id for update;
    select * into plan from public.plans where id = sub.plan_id;

    if sub.status = 'pending_payment' then
      anchor := extract(day from (now() at time zone core.cfg_text('timezone')))::smallint;
      update public.subscriptions
         set status = 'active',
             billing_anchor_day = anchor,
             current_period_start = now(),
             next_reset_at = core.next_reset_at(anchor, now()),
             current_period_end = core.next_reset_at(anchor, now()),
             units_included = plan.units_per_month,
             units_used = 0,
             plan_accepted_at = now()
       where id = sub.id;
      perform core.log_sub_event(sub.id, 'activated', 'system',
        jsonb_build_object('charge_id', ch.id, 'anchor_day', anchor));

      if plan.bags_included then
        fmt := core.cfg('bag_formats') -> sub.bag_format;
        insert into public.bag_rolls (user_id, format, roll_count, source)
        values (sub.user_id, sub.bag_format, coalesce((fmt ->> 'roll_count')::int, 0), 'plan');
      end if;

      -- a new active door may cross a meter tier
      select * into res from public.residencies where id = sub.residency_id;
      perform core.check_meter_tiers(res.building_id);
    else
      update public.subscriptions
         set status = case when status = 'past_due' then 'active' else status end
       where id = sub.id;
      perform core.log_sub_event(sub.id, 'renewed', 'system', jsonb_build_object('charge_id', ch.id));
    end if;
  end if;

  if ch.kind = 'extra_roll' then
    fmt := core.cfg('bag_formats');
    insert into public.bag_rolls (user_id, format, roll_count, source, charge_id)
    values (ch.user_id,
            coalesce(ch.meta ->> 'format', 'large'),
            coalesce((fmt -> coalesce(ch.meta ->> 'format', 'large') ->> 'roll_count')::int, 0),
            'extra_purchase', ch.id);
  end if;

  if ch.kind = 'on_demand' then
    select * into res from public.residencies
     where user_id = ch.user_id order by is_primary desc, created_at desc limit 1;
    ttl := coalesce(ch.meta ->> 'ttl_option', core.cfg('request_ttl_options') ->> 'default');
    begin
      insert into public.requests
        (resident_id, residency_id, building_id, subscription_id, charge_id, units_requested,
         units_source, ttl_option, expires_at, confirm_first, status)
      values
        (ch.user_id, res.id, res.building_id, null, ch.id, 1,
         jsonb_build_array(jsonb_build_object('type', 'charge', 'charge_id', ch.id)),
         ttl, core.ttl_expiry(ttl),
         (select confirm_first from public.users where id = ch.user_id), 'submitted')
      returning * into req;
      perform core.transition_request(req.id, 'submitted', 'open', 'system',
        jsonb_build_object('on_demand', true, 'charge_id', ch.id));
    exception when others then
      -- TTL passed while settling (rare): refund instead of stranding money
      perform internal.create_refund(ch.id, ch.amount_agorot, 'ttl_passed_at_settle');
    end;
  end if;

  if ch.kind = 'boost' then
    cfgk := core.cfg('boost');
    update public.requests
       set boost_agorot = boost_agorot + core.shekels_to_agorot((cfgk ->> 'payout_bump')::numeric)
     where id = (ch.meta ->> 'request_id')::uuid and status = 'open';
  end if;

  if ch.kind = 'backstop' then
    -- paid rescue: relist the expired request as a fresh charge-funded one;
    -- it lands on the admin live board for manual dispatch
    select * into req from public.requests where id = (ch.meta ->> 'request_id')::uuid;
    if found and req.status = 'expired' then
      insert into public.requests
        (resident_id, residency_id, building_id, subscription_id, charge_id, units_requested,
         units_source, ttl_option, expires_at, confirm_first, status, notes)
      values
        (req.resident_id, req.residency_id, req.building_id, null, ch.id, req.units_requested,
         jsonb_build_array(jsonb_build_object('type', 'charge', 'charge_id', ch.id)),
         req.ttl_option, now() + interval '24 hours', false, 'submitted', 'BACKSTOP');
      perform core.transition_request(
        (select id from public.requests where charge_id = ch.id order by created_at desc limit 1),
        'submitted', 'open', 'system', jsonb_build_object('backstop', true));
    end if;
  end if;

  if ch.kind = 'kartisiya' then
    cfgk := core.cfg('kartisiya');
    perform core.grant_credit(ch.user_id, (cfgk ->> 'units')::int, 'kartisiya', ch.id,
      now() + make_interval(days => (cfgk ->> 'validity_days')::int));
  end if;

  -- referral reward fires on the user's FIRST settled charge of any kind
  if not exists (
    select 1 from public.charges
     where user_id = ch.user_id and status = 'settled' and id <> ch.id
  ) then
    perform core.process_referral_reward(ch.user_id);
  end if;

  return ch;
end $$;

-- daily tick picks up referral expiry too
create or replace function internal.tick_daily()
returns jsonb
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
begin
  return jsonb_build_object(
    'allowance_resets', internal.reset_allowances(),
    'credits_expired', internal.expire_credits(),
    'referrals_expired', internal.expire_referrals()
  );
end $$;

-- get_my_state v2: + building meter + newer-plan-version flag
create or replace function api.get_my_state()
returns jsonb
language plpgsql stable security definer
set search_path = api, core, public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then perform core.raise_error('not_authorized'); end if;

  select jsonb_build_object(
    'user', (select to_jsonb(u) - 'created_at' from public.users u where u.id = uid),
    'subscription', (
      select jsonb_build_object(
        'id', s.id, 'status', s.status, 'units_included', s.units_included,
        'units_used', s.units_used, 'next_reset_at', s.next_reset_at,
        'bag_format', s.bag_format,
        'plan', jsonb_build_object('id', p.id, 'code', p.code, 'version', p.version,
                                   'price_agorot', p.price_agorot, 'units_per_month', p.units_per_month),
        'newer_plan_version', exists (
          select 1 from public.plans np
           where np.code = p.code and np.active_for_signup and np.version > p.version))
      from public.subscriptions s join public.plans p on p.id = s.plan_id
      where s.user_id = uid and s.status in ('pending_payment','active','paused','past_due')
      limit 1),
    'credits_available', core.credits_available(uid),
    'active_request', (
      select to_jsonb(r) from public.requests r
       where r.resident_id = uid
         and r.status in ('submitted','open','claimed','resident_approval','put_out_prompt','collected','verified')
       order by r.created_at desc limit 1),
    'last_request', (
      select to_jsonb(r) from public.requests r
       where r.resident_id = uid
       order by r.created_at desc limit 1),
    'residency', (
      select jsonb_build_object('id', res.id, 'floor', res.floor, 'apartment', res.apartment,
                                'building_id', b.id, 'city', b.city, 'street', b.street,
                                'house_number', b.house_number, 'building_paused', b.paused,
                                'has_entry_code', (b.entry_code_enc is not null),
                                'meter_doors', coalesce(bm.active_doors, 0))
      from public.residencies res
      join public.buildings b on b.id = res.building_id
      left join public.building_meter bm on bm.building_id = b.id
      where res.user_id = uid and res.is_primary
      order by res.created_at desc limit 1),
    'picker', (
      select jsonb_build_object('status', pk.status, 'tax_status', pk.tax_status,
                                'strikes', pk.strikes, 'available', pk.available)
      from public.pickers pk where pk.user_id = uid)
  ) into result;

  return result;
end $$;
