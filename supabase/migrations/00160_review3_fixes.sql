-- ============================================================================
-- 00160: review-round-3 fixes — all confirmed findings of the third
-- adversarial review (money-minting paths, authz gaps, races, ledger drift).
-- Each numbered section names the defect it closes.
-- ============================================================================

-- ── (1) mark_collected trusted unbounded client bag counts ──────────────────
-- The picker-supplied adjustment now honors the SAME max_units_per_request
-- cap as submit, and units the resident could not fund are no longer stamped
-- (and paid): an unfundable recount falls back to the requested units, with
-- the discrepancy still audited + notified for ops follow-up.
create or replace function api.mark_collected(p_claim_id uuid, p_adjustment jsonb default null)
returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  c public.claims;
  req public.requests;
  rules jsonb := core.cfg('unit_rules');
  v_units_final int;
  delta int;
  extra_sources jsonb;
begin
  select * into c from public.claims
   where id = p_claim_id and picker_id = auth.uid() and status = 'active'
   for update;
  if not found then perform core.raise_error('not_found'); end if;
  if c.deadline_at <= now() then perform core.raise_error('claim_expired'); end if;

  select * into req from public.requests where id = c.request_id for update;

  if p_adjustment is null then
    v_units_final := req.units_requested;
  else
    v_units_final := core.count_units(rules, p_adjustment);
    if v_units_final < 1
       or v_units_final > (rules ->> 'max_units_per_request')::int then
      perform core.raise_error('invalid_units');
    end if;
  end if;

  req := core.transition_request(c.request_id, 'claimed', 'collected', 'picker',
           jsonb_build_object('units_final', v_units_final, 'adjustment', p_adjustment));

  delta := v_units_final - req.units_requested;
  if delta > 0 then
    -- more units on-site: fund the difference; unfundable extras are NOT
    -- stamped or paid — the count stays at the funded (requested) units,
    -- audited + notified so ops can follow up
    begin
      extra_sources := core.consume_units(req.resident_id, delta, req.id);
      update public.requests
         set units_source = units_source || extra_sources where id = req.id;
    exception when others then
      insert into public.request_events (request_id, from_status, to_status, actor_id, actor_role, meta)
      values (req.id, 'collected', 'collected', auth.uid(), 'system',
              jsonb_build_object('unfunded_units', delta, 'reported_units', v_units_final));
      v_units_final := req.units_requested;
    end;
    perform core.notify(req.resident_id, 'push.units_adjusted',
      jsonb_build_object('units', v_units_final, 'reason', 'adjusted'));
  elsif delta < 0 then
    perform core.refund_partial(req.id, req.resident_id, -delta);
    perform core.notify(req.resident_id, 'push.units_adjusted',
      jsonb_build_object('units', v_units_final, 'reason', 'adjusted'));
  end if;

  update public.requests set units_final = v_units_final where id = req.id;
  update public.claims
     set collected_at = now(), units_collected = v_units_final, adjustment = p_adjustment
   where id = c.id;

  select * into req from public.requests where id = req.id;
  return req;
end $$;

-- ── (2) any self-asserted "resident" could overwrite/clear a building's
--        entry code. Non-admins now get the FIRST-SET path only (mirroring
--        onboard_residency); overwriting or clearing requires an admin. ─────
create or replace function api.set_building_entry_code(
  p_building_id uuid,
  p_entry_code  text
) returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare b public.buildings;
begin
  if auth.uid() is null then perform core.raise_error('not_authorized'); end if;
  select * into b from public.buildings where id = p_building_id for update;
  if not found then perform core.raise_error('not_found'); end if;

  if not core.is_admin() then
    if not exists (
      select 1 from public.residencies r
       where r.building_id = p_building_id and r.user_id = auth.uid()
    ) then
      perform core.raise_error('not_authorized');
    end if;
    -- residency is self-asserted (onboard find-or-create), so it may not
    -- mutate an existing building-wide secret: first-set only, no clearing
    if b.entry_code_enc is not null or coalesce(trim(p_entry_code), '') = '' then
      perform core.raise_error('not_authorized');
    end if;
  end if;

  update public.buildings
     set entry_code_enc = case when coalesce(trim(p_entry_code), '') = ''
                               then null
                               else core.encrypt_entry_code(trim(p_entry_code)) end
   where id = p_building_id;
end $$;

-- ── (3) bin_qr_id was readable by the pickers it is meant to verify ─────────
-- verify_bin_scan is SECURITY DEFINER and reads the column server-side; the
-- admin QR-poster page moves to a definer RPC below.
revoke select (bin_qr_id) on public.buildings from authenticated;

create or replace function api.admin_list_buildings()
returns table (
  id uuid, city text, street text, house_number text,
  bin_qr_id text, bin_location_note text, paused boolean
)
language plpgsql stable security definer
set search_path = api, core, public, pg_temp
as $$
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  return query
  select b.id, b.city, b.street, b.house_number,
         b.bin_qr_id, b.bin_location_note, b.paused
    from public.buildings b
   order by b.city, b.street, b.house_number;
end $$;

grant execute on function api.admin_list_buildings() to authenticated;

-- ── (4+5+6+7) settle_charge v4 ──────────────────────────────────────────────
--  (4) a charge settling for an already-canceled subscription now REFUNDS
--      instead of keeping the money;
--  (5) past_due recovery fast-forwards the billing period, so the stale
--      next_reset_at can no longer back-bill every locked-out month;
--  (6) the on-demand branch honors service_enabled + building pause (refund
--      path when blocked);
--  (7) the backstop branch no longer aborts settlement on the
--      one-active-request unique index — it refunds, like on-demand.
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
  new_req public.requests;
  ttl text;
  cfgk jsonb;
  rows_hit int;
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

    if sub.status = 'canceled' then
      -- checkout/renewal settled AFTER the subscription was canceled: the
      -- money buys nothing — zero-touch refund, mirroring boost/backstop noops
      perform internal.create_refund(ch.id, ch.amount_agorot, 'subscription_canceled_noop');
      perform core.log_sub_event(sub.id, 'charge_refunded_canceled', 'system',
        jsonb_build_object('charge_id', ch.id));
      return ch;
    end if;

    if sub.status = 'pending_payment' then
      -- anchor day and next_reset_at MUST come from the same clock (UTC):
      -- an IL-midnight activation must not produce a reset ~24h off
      anchor := extract(day from now() at time zone 'UTC')::smallint;
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

      select * into res from public.residencies where id = sub.residency_id;
      perform core.check_meter_tiers(res.building_id);
    else
      update public.subscriptions
         set status = case when status = 'past_due' then 'active' else status end
       where id = sub.id;
      perform core.log_sub_event(sub.id, 'renewed', 'system', jsonb_build_object('charge_id', ch.id));

      if sub.status = 'past_due'
         and sub.next_reset_at is not null and sub.next_reset_at <= now() then
        -- long lockout: this settlement buys the period STARTING NOW. Fast-
        -- forward the clock so the stale next_reset_at can never replay a
        -- renewal (and a full-price charge) for every locked-out month.
        update public.subscriptions
           set units_used = 0,
               units_included = plan.units_per_month,
               current_period_start = now(),
               next_reset_at = core.next_reset_at(billing_anchor_day, now()),
               current_period_end = core.next_reset_at(billing_anchor_day, now())
         where id = sub.id;
        perform core.log_sub_event(sub.id, 'past_due_recovered', 'system',
          jsonb_build_object('charge_id', ch.id));
      end if;
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
      if not core.cfg_bool('service_enabled') then
        raise exception 'service_disabled';
      end if;
      if res.id is null then
        raise exception 'no_residency';
      end if;
      if exists (select 1 from public.buildings b where b.id = res.building_id and b.paused) then
        raise exception 'building_paused';
      end if;
      insert into public.requests
        (resident_id, residency_id, building_id, subscription_id, charge_id, units_requested,
         units_source, ttl_option, expires_at, confirm_first, status)
      values
        (ch.user_id, res.id, res.building_id, null, ch.id, 1,
         jsonb_build_array(jsonb_build_object('type', 'charge', 'charge_id', ch.id)),
         ttl, core.ttl_expiry(ttl),
         (select confirm_first from public.users where id = ch.user_id), 'submitted')
      returning * into new_req;
      perform core.transition_request(new_req.id, 'submitted', 'open', 'system',
        jsonb_build_object('on_demand', true, 'charge_id', ch.id));
    exception when others then
      -- TTL passed, service/building paused, or an active request exists:
      -- money back, never a stranded settlement
      perform internal.create_refund(ch.id, ch.amount_agorot, 'on_demand_unfulfillable');
    end;
  end if;

  if ch.kind = 'boost' then
    cfgk := core.cfg('boost');
    update public.requests
       set boost_agorot = boost_agorot + core.shekels_to_agorot((cfgk ->> 'payout_bump')::numeric)
     where id = (ch.meta ->> 'request_id')::uuid and status = 'open';
    get diagnostics rows_hit = row_count;
    if rows_hit = 0 then
      -- request left 'open' during PSP latency: never keep the fee silently
      perform internal.create_refund(ch.id, ch.amount_agorot, 'boost_noop');
    end if;
  end if;

  if ch.kind = 'backstop' then
    cfgk := core.cfg('backstop');
    select * into req from public.requests where id = (ch.meta ->> 'request_id')::uuid;
    if found and req.status = 'expired' then
      begin
        insert into public.requests
          (resident_id, residency_id, building_id, subscription_id, charge_id, units_requested,
           units_source, ttl_option, expires_at, confirm_first, status, notes)
        values
          (req.resident_id, req.residency_id, req.building_id, null, ch.id, req.units_requested,
           jsonb_build_array(jsonb_build_object('type', 'charge', 'charge_id', ch.id)),
           'backstop',
           now() + make_interval(hours => coalesce((cfgk ->> 'ttl_hours')::int, 24)),
           false, 'submitted', 'BACKSTOP')
        returning * into new_req;
        perform core.transition_request(new_req.id, 'submitted', 'open', 'system',
          jsonb_build_object('backstop', true));
      exception when others then
        -- resident already has another active request (unique index) or the
        -- transition raced: refund the rescue fee instead of aborting the
        -- whole settlement into a webhook retry loop
        perform internal.create_refund(ch.id, ch.amount_agorot, 'backstop_unfulfillable');
      end;
    else
      perform internal.create_refund(ch.id, ch.amount_agorot, 'backstop_noop');
    end if;
  end if;

  if ch.kind = 'kartisiya' then
    cfgk := core.cfg('kartisiya');
    perform core.grant_credit(ch.user_id, (cfgk ->> 'units')::int, 'kartisiya', ch.id,
      now() + make_interval(days => (cfgk ->> 'validity_days')::int));
  end if;

  if not exists (
    select 1 from public.charges
     where user_id = ch.user_id and status = 'settled' and id <> ch.id
  ) then
    perform core.process_referral_reward(ch.user_id);
  end if;

  return ch;
end $$;

-- ── (8) pay-now and the retry worker double-charged the same renewal ────────
-- service_charge_subscription now (a) reuses any in-flight pending attempt
-- and (b) keys renewals on the sub's unpaid period — the SAME key family the
-- monthly reset used — so create_charge's #rN retry logic dedupes them all.
create or replace function api.service_charge_subscription(p_subscription_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = api, internal, core, public, pg_temp
as $$
declare
  sub public.subscriptions;
  plan public.plans;
  pm public.payment_methods;
  ch public.charges;
  idem text;
begin
  select * into sub from public.subscriptions where id = p_subscription_id for update;
  if not found then perform core.raise_error('not_found'); end if;
  if sub.status not in ('pending_payment', 'active', 'past_due') then
    perform core.raise_error('illegal_transition');
  end if;

  select * into plan from public.plans where id = sub.plan_id;
  select * into pm from public.payment_methods
   where user_id = sub.user_id and status = 'active'
   order by created_at desc limit 1;

  -- an in-flight pending attempt IS the charge: hand it back, never mint twins
  select * into ch from public.charges
   where subscription_id = sub.id and kind = 'subscription' and status = 'pending'
   order by created_at desc limit 1;
  if not found then
    if sub.status = 'pending_payment' then
      idem := 'sub:' || sub.id || ':' || to_char(now(), 'YYYY-MM');
    else
      idem := 'renew:' || sub.id || ':'
              || to_char(coalesce(sub.current_period_start, now()), 'YYYY-MM');
    end if;
    ch := internal.create_charge(sub.user_id, 'subscription', plan.price_agorot,
                                 core.cfg_text('payment_provider'), idem, sub.id,
                                 jsonb_build_object('plan_code', plan.code, 'plan_version', plan.version));
  end if;

  return jsonb_build_object(
    'charge_id', ch.id,
    'amount_agorot', ch.amount_agorot,
    'status', ch.status,
    'idempotency_key', ch.idempotency_key,
    'provider', ch.provider,
    'provider_token', coalesce(pm.provider_token, 'missing'),
    'user_id', sub.user_id
  );
end $$;

-- ── (9) renewal retries were unbounded and keyed on the wall clock ──────────
-- Retries now key on the sub's unpaid period (current_period_start month —
-- exactly the key the monthly reset minted) and follow the billing_retry
-- config: at most every min_hours_between hours, up to max_attempts failed
-- attempts, then the subscription is canceled zero-touch.
create or replace function internal.retry_failed_renewals()
returns int
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare
  sub record;
  plan public.plans;
  n int := 0;
  rcfg jsonb := core.cfg('billing_retry');
  max_attempts int := (rcfg ->> 'max_attempts')::int;
  min_hours int := (rcfg ->> 'min_hours_between')::int;
  base_key text;
  failed_attempts int;
  last_attempt timestamptz;
begin
  for sub in
    select s.* from public.subscriptions s
     where s.status = 'past_due'
     for update skip locked
  loop
    -- skip if an attempt is already in flight
    if exists (select 1 from public.charges
                where subscription_id = sub.id and kind = 'subscription' and status = 'pending') then
      continue;
    end if;

    base_key := 'renew:' || sub.id || ':'
                || to_char(coalesce(sub.current_period_start, now()), 'YYYY-MM');
    select count(*), max(created_at) into failed_attempts, last_attempt
      from public.charges
     where subscription_id = sub.id and kind = 'subscription' and status = 'failed'
       and (idempotency_key = base_key or idempotency_key like base_key || '#r%');

    if failed_attempts >= max_attempts then
      update public.subscriptions
         set status = 'canceled', canceled_at = now()
       where id = sub.id;
      perform core.log_sub_event(sub.id, 'canceled_after_failed_retries', 'system',
        jsonb_build_object('attempts', failed_attempts));
      perform core.notify(sub.user_id, 'push.subscription_canceled', '{}'::jsonb);
      continue;
    end if;
    if last_attempt is not null
       and last_attempt > now() - make_interval(hours => min_hours) then
      continue;
    end if;

    select * into plan from public.plans where id = sub.plan_id;
    perform internal.create_charge(
      sub.user_id, 'subscription', plan.price_agorot,
      core.cfg_text('payment_provider'),
      base_key,
      sub.id,
      jsonb_build_object('renewal', true, 'retry', true));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── (10) the kill switches did not gate on-demand charging ──────────────────
create or replace function api.service_charge_on_demand(p_user_id uuid, p_ttl_option text)
returns jsonb
language plpgsql volatile security definer
set search_path = api, internal, core, public, pg_temp
as $$
declare
  cfg jsonb := core.cfg('on_demand_single');
  res public.residencies;
  pm public.payment_methods;
  ch public.charges;
begin
  if not (cfg ->> 'enabled')::boolean then perform core.raise_error('feature_disabled'); end if;
  if not core.cfg_bool('service_enabled') then perform core.raise_error('service_disabled'); end if;
  select * into res from public.residencies
   where user_id = p_user_id order by is_primary desc, created_at desc limit 1;
  if not found then perform core.raise_error('not_found'); end if;
  if exists (select 1 from public.buildings b where b.id = res.building_id and b.paused) then
    perform core.raise_error('building_paused');
  end if;
  perform core.ttl_expiry(coalesce(p_ttl_option, core.cfg('request_ttl_options') ->> 'default'));

  select * into pm from public.payment_methods
   where user_id = p_user_id and status = 'active'
   order by created_at desc limit 1;

  -- a pending on-demand charge for this user IS the in-flight attempt: reuse it
  select * into ch from public.charges
   where user_id = p_user_id and kind = 'on_demand' and status = 'pending'
   order by created_at desc limit 1;
  if not found then
    ch := internal.create_charge(p_user_id, 'on_demand',
            core.shekels_to_agorot((cfg ->> 'price')::numeric),
            core.cfg_text('payment_provider'),
            'od:' || p_user_id || ':' || extract(epoch from now())::bigint,
            null,
            jsonb_build_object('ttl_option', coalesce(p_ttl_option, core.cfg('request_ttl_options') ->> 'default')));
  end if;

  return jsonb_build_object('charge_id', ch.id, 'amount_agorot', ch.amount_agorot,
    'status', ch.status,
    'idempotency_key', ch.idempotency_key, 'provider', ch.provider,
    'provider_token', coalesce(pm.provider_token, 'missing'));
end $$;

-- ── (11) change_plan minted free allowance on upgrade/downgrade cycles ──────
-- Upgrades stay immediate but now charge the price difference for the
-- running period; downgrades take effect at the next renewal via
-- pending_plan_id (applied by reset_allowances below).
alter table public.subscriptions
  add column if not exists pending_plan_id uuid references public.plans (id);

create or replace function api.change_plan(p_plan_id uuid)
returns public.subscriptions
language plpgsql security definer
set search_path = api, internal, core, public, pg_temp
as $$
declare
  sub public.subscriptions;
  cur_plan public.plans;
  new_plan public.plans;
  diff int;
begin
  select * into sub from public.subscriptions
   where user_id = auth.uid() and status = 'active' for update;
  if not found then perform core.raise_error('subscription_not_active'); end if;

  select * into new_plan from public.plans where id = p_plan_id and active_for_signup;
  if not found then perform core.raise_error('not_found'); end if;
  select * into cur_plan from public.plans where id = sub.plan_id;

  if new_plan.id = cur_plan.id then
    -- picking the current plan again cancels a scheduled downgrade
    update public.subscriptions set pending_plan_id = null where id = sub.id
    returning * into sub;
    return sub;
  end if;

  if new_plan.units_per_month > cur_plan.units_per_month then
    -- upgrade: bigger allowance NOW, and the price difference is charged now —
    -- cycling up and down can no longer mint unpaid units
    update public.subscriptions
       set plan_id = new_plan.id,
           plan_accepted_at = now(),
           units_included = new_plan.units_per_month,
           pending_plan_id = null
     where id = sub.id
     returning * into sub;

    diff := greatest(0, new_plan.price_agorot - cur_plan.price_agorot);
    if diff > 0 then
      perform internal.create_charge(
        sub.user_id, 'subscription', diff,
        core.cfg_text('payment_provider'),
        'upgrade:' || sub.id || ':' || new_plan.id || ':'
          || to_char(coalesce(sub.current_period_start, now()), 'YYYY-MM'),
        sub.id,
        jsonb_build_object('plan_upgrade', true,
                           'from_code', cur_plan.code, 'to_code', new_plan.code));
    end if;

    perform core.log_sub_event(sub.id, 'plan_changed', 'resident',
      jsonb_build_object('to_code', new_plan.code, 'to_version', new_plan.version,
                         'upgrade_charge_agorot', diff));
  else
    -- downgrade (or equal units): applies at the next renewal
    update public.subscriptions set pending_plan_id = new_plan.id where id = sub.id
    returning * into sub;
    perform core.log_sub_event(sub.id, 'plan_change_scheduled', 'resident',
      jsonb_build_object('to_code', new_plan.code, 'to_version', new_plan.version));
  end if;

  return sub;
end $$;

create or replace function internal.reset_allowances()
returns int
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare
  sub record;
  plan public.plans;
  n int := 0;
begin
  for sub in
    select * from public.subscriptions
     where status = 'active' and next_reset_at is not null and next_reset_at <= now()
     for update skip locked
  loop
    if sub.pending_plan_id is not null then
      -- a scheduled downgrade lands exactly at the renewal boundary
      update public.subscriptions
         set plan_id = sub.pending_plan_id, pending_plan_id = null, plan_accepted_at = now()
       where id = sub.id;
      perform core.log_sub_event(sub.id, 'plan_change_applied', 'system',
        jsonb_build_object('plan_id', sub.pending_plan_id));
      select * into plan from public.plans where id = sub.pending_plan_id;
    else
      select * into plan from public.plans where id = sub.plan_id;
    end if;

    update public.subscriptions
       set units_used = 0,                             -- שקיות שלא נוצלו אינן נצברות
           units_included = plan.units_per_month,      -- grandfathered via plan FK
           current_period_start = sub.next_reset_at,
           next_reset_at = core.next_reset_at(sub.billing_anchor_day, sub.next_reset_at),
           current_period_end = core.next_reset_at(sub.billing_anchor_day, sub.next_reset_at)
     where id = sub.id;

    -- renewal charge (pending; the billing worker takes it to the provider)
    perform internal.create_charge(
      sub.user_id, 'subscription', plan.price_agorot,
      core.cfg_text('payment_provider'),
      'renew:' || sub.id || ':' || to_char(sub.next_reset_at, 'YYYY-MM'),
      sub.id,
      jsonb_build_object('renewal', true));

    perform core.log_sub_event(sub.id, 'allowance_reset', 'system',
      jsonb_build_object('units', plan.units_per_month));
    n := n + 1;
  end loop;
  return n;
end $$;

-- get_my_state v3: expose a scheduled plan change so the app can show it
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
        'pending_plan', (
          select jsonb_build_object('id', pp.id, 'code', pp.code,
                                    'units_per_month', pp.units_per_month)
          from public.plans pp where pp.id = s.pending_plan_id),
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

-- ── (12) admin force-transition burned units and enabled double payouts ─────
create or replace function api.admin_force_transition(
  p_request_id uuid,
  p_to         text,
  p_note       text default null
) returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  req public.requests;
  old_status text;
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  select * into req from public.requests where id = p_request_id for update;
  if not found then perform core.raise_error('not_found'); end if;
  old_status := req.status;

  -- money already left through pay_claim: forcing out of (or into) 'paid'
  -- would strand or duplicate a payout line
  if p_to = 'paid'
     or old_status = 'paid'
     or exists (select 1 from public.payout_lines pl where pl.request_id = p_request_id) then
    perform core.raise_error('illegal_transition');
  end if;

  update public.requests set status = p_to where id = p_request_id returning * into req;
  insert into public.request_events (request_id, from_status, to_status, actor_id, actor_role, meta)
  values (p_request_id, old_status, p_to, auth.uid(), 'admin',
          jsonb_build_object('forced', true, 'note', p_note));

  -- forcing a funded request into a refund-terminal state gives the units
  -- back exactly like the normal cancel path (then clears the sources so a
  -- repeated force can never refund twice)
  if p_to in ('canceled', 'expired')
     and old_status in ('submitted', 'open', 'claimed', 'resident_approval',
                        'put_out_prompt', 'collected', 'verified') then
    perform core.refund_units(req.id, req.resident_id, req.units_source);
    update public.requests set units_source = '[]'::jsonb where id = req.id
    returning * into req;
  end if;

  -- release live claims when the request leaves the claim pipeline, so the
  -- one-active-claim index can never wedge a re-opened request
  if p_to in ('open', 'canceled', 'expired', 'noshow') then
    update public.claims set status = 'released'
     where request_id = p_request_id and status = 'active';
  end if;

  return req;
end $$;

-- ── (13) meter-tier award raced concurrent activations into an abort ────────
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
  won int;
begin
  if not (cfg ->> 'enabled')::boolean then return; end if;

  select active_doors into doors from public.building_meter where building_id = p_building_id;

  for tier in select * from jsonb_array_elements(cfg -> 'tiers')
  loop
    if doors >= (tier ->> 'doors')::int then
      -- race-safe: only the settlement that actually WINS the award row
      -- hands out the bonuses; the loser is a silent no-op
      insert into public.building_meter_awards (building_id, tier_doors)
      values (p_building_id, (tier ->> 'doors')::int)
      on conflict (building_id, tier_doors) do nothing;
      get diagnostics won = row_count;

      if won > 0 then
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
    end if;
  end loop;
end $$;

-- ── (14) referrer monthly cap read was not serialized ───────────────────────
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

  -- serialize per referrer so concurrent first-settlements of two referees
  -- see each other's grants before reading the monthly cap
  perform pg_advisory_xact_lock(hashtext('pinui.referral:' || ref.referrer_id::text));

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

-- ── (15) lock-order inversion vs lapse_claims (claim → request everywhere) ──
create or replace function api.confirm_bag_out(p_request_id uuid)
returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare req public.requests; c public.claims; minutes int := core.cfg_int('claim_to_scan_minutes');
begin
  select * into req from public.requests where id = p_request_id and resident_id = auth.uid();
  if not found then perform core.raise_error('not_found'); end if;

  -- take the claim lock FIRST — the lapse worker locks claim→request, and a
  -- reversed order here could deadlock an entire minutely tick
  select * into c from public.claims
   where request_id = p_request_id and status = 'active'
   for update;

  req := core.transition_request(p_request_id, 'put_out_prompt', 'claimed', 'resident',
           jsonb_build_object('bag_out', true));
  -- the claim timer starts NOW, not at claim time (per spec)
  if c.id is not null then
    update public.claims
       set deadline_at = now() + make_interval(mins => minutes)
     where id = c.id;
  end if;
  return req;
end $$;

create or replace function api.decline_eta(p_request_id uuid)
returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare req public.requests; c public.claims;
begin
  select * into req from public.requests where id = p_request_id and resident_id = auth.uid();
  if not found then perform core.raise_error('not_found'); end if;

  -- claim lock first (see confirm_bag_out)
  select * into c from public.claims
   where request_id = p_request_id and status = 'active'
   for update;
  req := core.transition_request(p_request_id, 'resident_approval', 'open', 'resident',
           jsonb_build_object('reason', 'eta_declined'));
  if c.id is not null then
    update public.claims set status = 'released' where id = c.id;  -- no strike
  end if;
  return req;
end $$;

-- ── (16) boost is a PER-REQUEST bump (config: "payout_bump (₪) on one
--         request") but every payout path multiplied it by units ────────────
create or replace function core.pay_claim(
  p_claim_id   uuid,
  p_actor_role text,
  p_meta       jsonb default '{}'::jsonb
) returns int  -- amount_agorot paid for this claim
language plpgsql volatile security definer
set search_path = core, public, pg_temp
as $$
declare
  c public.claims;
  line_units int;
  line_amount int;
begin
  select * into c from public.claims where id = p_claim_id for update;
  if not found or c.status <> 'active' then perform core.raise_error('not_found'); end if;

  perform core.transition_request(c.request_id, 'collected', 'verified', p_actor_role, p_meta);
  perform core.transition_request(c.request_id, 'verified', 'paid', 'system',
    jsonb_build_object('claim_id', c.id));

  line_units := coalesce(c.units_collected,
                         (select units_requested from public.requests where id = c.request_id));
  line_amount := line_units * c.payout_per_unit_agorot + c.payout_boost_agorot;

  insert into public.payout_lines
    (claim_id, request_id, picker_id, units, per_unit_agorot, boost_agorot, amount_agorot)
  values
    (c.id, c.request_id, c.picker_id, line_units,
     c.payout_per_unit_agorot, c.payout_boost_agorot, line_amount);

  update public.claims set status = 'completed', verified_at = now() where id = c.id;

  perform core.notify((select resident_id from public.requests where id = c.request_id),
    'push.request_done', jsonb_build_object('request_id', c.request_id));

  return line_amount;
end $$;

create or replace function api.open_feed(p_lat numeric default null, p_lng numeric default null)
returns table (
  request_id     uuid,
  building_id    uuid,
  city           text,
  street         text,
  house_number   text,
  lat            numeric,
  lng            numeric,
  units          int,
  payout_agorot  int,
  expires_at     timestamptz,
  created_at     timestamptz,
  building_open_count bigint,
  distance_m     int
)
language plpgsql stable security definer
set search_path = api, core, public, pg_temp
as $$
declare payout_per_unit int := core.shekels_to_agorot(core.cfg_numeric('picker_payout_per_unit_exvat'));
begin
  perform core.active_picker(auth.uid());

  return query
  select r.id, b.id, b.city, b.street, b.house_number, b.lat, b.lng,
         r.units_requested,
         r.units_requested * payout_per_unit + r.boost_agorot,
         r.expires_at, r.created_at,
         count(*) over (partition by b.id),
         case when p_lat is not null and p_lng is not null and b.lat is not null then
           (111320 * sqrt(power(b.lat - p_lat, 2)
                        + power((b.lng - p_lng) * cos(radians(p_lat)), 2)))::int
         end
    from public.requests r
    join public.buildings b on b.id = r.building_id
   where r.status = 'open'
     and not b.paused
     and r.resident_id <> auth.uid()          -- never your own bag
   order by r.created_at;
end $$;

create or replace function internal.lapse_claims()
returns int
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare
  c record;
  req public.requests;
  action jsonb := core.cfg('noshow_action');
  n int := 0;
  boost_pct int := coalesce((core.cfg('noshow_action') ->> 'payout_boost_pct')::int, 0);
  payout_per_unit int := core.shekels_to_agorot(core.cfg_numeric('picker_payout_per_unit_exvat'));
  grace int := core.cfg_int('scan_grace_minutes');
begin
  for c in
    select cl.* from public.claims cl
     where cl.status = 'active' and cl.deadline_at <= now()
     for update skip locked
  loop
    select * into req from public.requests where id = c.request_id for update;

    if req.status in ('resident_approval', 'put_out_prompt') then
      -- waiting on the RESIDENT — release without punishing anyone
      perform core.transition_request(req.id, req.status, 'open', 'system',
        jsonb_build_object('reason', 'approval_timeout', 'claim_id', c.id));
      update public.claims set status = 'released' where id = c.id;
      update public.requests set repost_count = repost_count + 1 where id = req.id;
      n := n + 1;

    elsif req.status = 'claimed' then
      -- picker no-show
      if (action ->> 'repost')::boolean then
        perform core.transition_request(req.id, 'claimed', 'open', 'system',
          jsonb_build_object('reason', 'noshow_repost', 'claim_id', c.id));
        update public.requests
           set repost_count = repost_count + 1,
               -- per-request bump: boost_pct % of the request's total payout
               boost_agorot = boost_agorot
                 + (payout_per_unit * req.units_requested * boost_pct / 100)::int
         where id = req.id;
      else
        perform core.transition_request(req.id, 'claimed', 'noshow', 'system',
          jsonb_build_object('claim_id', c.id));
      end if;

      update public.claims set status = 'lapsed' where id = c.id;
      perform core.grant_credit(req.resident_id,
        coalesce((action ->> 'resident_credit_units')::int, 0) * req.units_requested,
        'noshow_comp', req.id, null);
      perform core.add_strike(c.picker_id, c.id, 'noshow',
        coalesce((action ->> 'picker_strike')::int, 0));
      perform core.notify(c.picker_id, 'push.claim_lapsed', jsonb_build_object('claim_id', c.id));
      n := n + 1;

    elsif req.status = 'collected' then
      -- bags are physically gone: give the picker a scan grace window, then
      -- auto-complete (flagged) rather than stranding resident + picker
      if now() >= c.deadline_at + make_interval(mins => grace) then
        perform core.pay_claim(c.id, 'system', jsonb_build_object('auto_completed', true));
        n := n + 1;
      end if;
      -- inside the grace window: leave the claim active, try again next tick

    else
      update public.claims set status = 'lapsed' where id = c.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function api.admin_assign_request(p_request_id uuid, p_picker_id uuid)
returns jsonb
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  req public.requests;
  minutes int := core.cfg_int('claim_to_scan_minutes');
  payout int := core.shekels_to_agorot(core.cfg_numeric('picker_payout_per_unit_exvat'));
  c public.claims;
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  perform core.active_picker(p_picker_id);

  req := core.transition_request(p_request_id, 'open', 'claimed', 'admin',
           jsonb_build_object('manual_dispatch', true, 'picker_id', p_picker_id), 'already_claimed');

  insert into public.claims
    (request_id, claim_group_id, picker_id, deadline_at, payout_per_unit_agorot, payout_boost_agorot)
  values
    (p_request_id, gen_random_uuid(), p_picker_id, now() + make_interval(mins => minutes),
     payout, req.boost_agorot)
  returning * into c;

  perform core.notify(p_picker_id, 'push.requests_nearby',
    jsonb_build_object('count', 1,
      'amount_agorot', req.units_requested * payout + req.boost_agorot));
  perform core.notify(req.resident_id, 'push.request_claimed',
    jsonb_build_object('request_id', req.id) || core.claim_notify_params(c.deadline_at));
  return jsonb_build_object('claim_id', c.id);
end $$;

-- ── (17) refund_partial desynced the credit_consumptions journal ────────────
create or replace function core.refund_partial(p_request_id uuid, p_user_id uuid, p_units int)
returns void
language plpgsql volatile security definer
set search_path = core, public, pg_temp
as $$
declare
  req public.requests;
  entries jsonb;
  i int;
  entry jsonb;
  remaining int := p_units;
  take int;
  jt int;
  jc record;
  new_sources jsonb := '[]'::jsonb;
begin
  select * into req from public.requests where id = p_request_id;
  entries := coalesce(req.units_source, '[]'::jsonb);

  for i in reverse jsonb_array_length(entries) - 1 .. 0 loop
    entry := entries -> i;
    if entry ->> 'units' is null then
      -- charge-funded entry (on-demand/backstop): all-or-nothing at
      -- expiry/leak — unit deltas never touch it, and it must SURVIVE
      new_sources := entry || new_sources;
      continue;
    end if;
    take := least((entry ->> 'units')::int, remaining);
    if take > 0 and remaining > 0 then
      if entry ->> 'type' = 'allowance' then
        update public.subscriptions
           set units_used = greatest(0, units_used - take)
         where user_id = p_user_id and status in ('active', 'paused', 'past_due');
      elsif entry ->> 'type' = 'credit' then
        update public.credits
           set units_consumed = greatest(0, units_consumed - take),
               status = case when status = 'exhausted' then 'active' else status end
         where id = (entry ->> 'credit_id')::uuid;
        -- keep the consumption journal in lockstep with the ledger,
        -- newest rows first (a request can consume the same credit twice
        -- via a collection adjustment)
        jt := take;
        for jc in
          select cc.id, cc.units from public.credit_consumptions cc
           where cc.credit_id = (entry ->> 'credit_id')::uuid
             and cc.request_id = p_request_id
           order by cc.id desc
        loop
          exit when jt = 0;
          if jc.units <= jt then
            delete from public.credit_consumptions where id = jc.id;
            jt := jt - jc.units;
          else
            update public.credit_consumptions set units = units - jt where id = jc.id;
            jt := 0;
          end if;
        end loop;
      end if;
      remaining := remaining - take;
      entry := jsonb_set(entry, '{units}', to_jsonb((entry ->> 'units')::int - take));
    end if;
    if (entry ->> 'units')::int > 0 then
      new_sources := entry || new_sources;
    end if;
  end loop;

  update public.requests set units_source = new_sources where id = p_request_id;
end $$;

-- ── (18) admin credit grant accepted units ≤ 0 as a silent no-op "success" ──
create or replace function api.admin_grant_credit(
  p_user_id uuid,
  p_units   int,
  p_note    text default null
) returns uuid
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare cid uuid;
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  if p_units is null or p_units <= 0 then perform core.raise_error('invalid_units'); end if;
  cid := core.grant_credit(p_user_id, p_units, 'admin_grant', null, null);
  insert into public.config_audit (key, old_value, new_value, old_version, new_version, changed_by, note)
  values ('credit_grant:' || p_user_id, null,
          jsonb_build_object('units', p_units, 'credit_id', cid), 0, 0, auth.uid(), p_note);
  return cid;
end $$;

-- ── (19) outbox rows need an atomic claim so overlapping notify-worker runs
--         cannot double-send (worker flips pending→sending per row) ─────────
alter table public.notification_outbox
  add column if not exists claimed_at timestamptz;
alter table public.notification_outbox
  drop constraint notification_outbox_status_check;
alter table public.notification_outbox
  add constraint notification_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
