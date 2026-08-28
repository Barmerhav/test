-- ============================================================================
-- 00080: subscription lifecycle — start (pending_payment) → settle → active,
-- monthly allowance resets on the billing anchor (NO rollover), pause/resume,
-- explicit plan-change acceptance, extra-roll orders.
--
-- Settlement is ALWAYS asynchronous: charges are created pending; the PSP
-- (mock or real) calls the payments-webhook edge fn → internal.settle_charge.
-- ============================================================================

-- Next billing reset after p_from, anchor clamped to month length WITHOUT
-- drifting (Jan 31 → Feb 28/29 → Mar 31). Mirror of shared/allowance nextResetAt.
create or replace function core.next_reset_at(p_anchor_day smallint, p_from timestamptz)
returns timestamptz
language plpgsql immutable
as $$
declare
  base date := (p_from at time zone 'UTC')::date;
  next_month date := date_trunc('month', base)::date + interval '1 month';
  days_in int;
begin
  days_in := extract(day from (next_month + interval '1 month' - interval '1 day'))::int;
  return (next_month + (least(p_anchor_day, days_in) - 1) * interval '1 day')
         + (p_from - date_trunc('day', p_from at time zone 'UTC') at time zone 'UTC');
end $$;

-- ── payment methods & charges ───────────────────────────────────────────────

create or replace function api.attach_payment_method(
  p_provider text,
  p_token    text,
  p_brand    text default null,
  p_last4    text default null
) returns uuid
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare pm_id uuid;
begin
  if auth.uid() is null then perform core.raise_error('not_authorized'); end if;
  update public.payment_methods set status = 'removed'
   where user_id = auth.uid() and status = 'active';
  insert into public.payment_methods (user_id, provider, provider_token, brand, last4)
  values (auth.uid(), p_provider, p_token, p_brand, p_last4)
  returning id into pm_id;

  update public.subscriptions set payment_method_id = pm_id
   where user_id = auth.uid() and status in ('pending_payment', 'active', 'past_due');
  return pm_id;
end $$;

-- Service-side charge creation (called by edge functions with service role).
create or replace function internal.create_charge(
  p_user_id         uuid,
  p_kind            text,
  p_amount_agorot   int,
  p_provider        text,
  p_idempotency_key text,
  p_subscription_id uuid default null,
  p_meta            jsonb default '{}'::jsonb
) returns public.charges
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare ch public.charges;
begin
  insert into public.charges
    (user_id, kind, amount_agorot, provider, idempotency_key, subscription_id, meta)
  values
    (p_user_id, p_kind, p_amount_agorot, p_provider, p_idempotency_key, p_subscription_id, p_meta)
  on conflict (idempotency_key) do update set meta = public.charges.meta  -- no-op; return existing
  returning * into ch;
  return ch;
end $$;

create or replace function internal.mark_charge_provider_id(
  p_charge_id uuid, p_provider_charge_id text
) returns void
language sql volatile security definer
set search_path = internal, public, pg_temp
as $$
  update public.charges set provider_charge_id = p_provider_charge_id where id = p_charge_id
$$;

-- ── start subscription ──────────────────────────────────────────────────────

create or replace function api.start_subscription(
  p_plan_id      uuid,
  p_residency_id uuid,
  p_bag_format   text default 'large'
) returns public.subscriptions
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  plan public.plans;
  sub public.subscriptions;
begin
  if uid is null then perform core.raise_error('not_authorized'); end if;

  select * into plan from public.plans where id = p_plan_id;
  if not found or not plan.active_for_signup then perform core.raise_error('not_found'); end if;
  if not exists (select 1 from public.residencies where id = p_residency_id and user_id = uid) then
    perform core.raise_error('not_authorized');
  end if;
  if exists (select 1 from public.subscriptions
              where user_id = uid and status in ('pending_payment','active','past_due','paused')) then
    perform core.raise_error('illegal_transition');
  end if;

  insert into public.subscriptions
    (user_id, residency_id, plan_id, status, bag_format, units_included)
  values
    (uid, p_residency_id, p_plan_id, 'pending_payment', p_bag_format, plan.units_per_month)
  returning * into sub;

  perform core.log_sub_event(sub.id, 'created', 'resident',
    jsonb_build_object('plan_code', plan.code, 'plan_version', plan.version));
  return sub;
end $$;

-- ── settlement (the single entry point for ALL charge outcomes) ─────────────

create or replace function internal.settle_charge(
  p_provider_charge_id text,
  p_outcome            text,               -- 'settled' | 'failed'
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
      -- first settlement: activate, set the billing anchor, grant the plan roll
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
    else
      -- renewal settlement: recover from past_due if needed
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

  -- referral first-payment reward hook lands here in a later migration
  return ch;
end $$;

-- ── monthly allowance reset (NO rollover) ───────────────────────────────────

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
    select * into plan from public.plans where id = sub.plan_id;

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

-- ── pause (חופשה) / resume / plan change ────────────────────────────────────

create or replace function api.pause_subscription()
returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare sub public.subscriptions;
begin
  select * into sub from public.subscriptions
   where user_id = auth.uid() and status = 'active' for update;
  if not found then perform core.raise_error('subscription_not_active'); end if;
  update public.subscriptions set status = 'paused', paused_at = now() where id = sub.id;
  perform core.log_sub_event(sub.id, 'paused', 'resident');
end $$;

create or replace function api.resume_subscription()
returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare sub public.subscriptions;
begin
  select * into sub from public.subscriptions
   where user_id = auth.uid() and status = 'paused' for update;
  if not found then perform core.raise_error('subscription_not_active'); end if;

  update public.subscriptions
     set status = 'active',
         paused_at = null,
         -- paused across the anchor? start a fresh period from now
         next_reset_at = case when sub.next_reset_at <= now()
                              then core.next_reset_at(sub.billing_anchor_day, now())
                              else sub.next_reset_at end,
         units_used = case when sub.next_reset_at <= now() then 0 else sub.units_used end
   where id = sub.id;
  perform core.log_sub_event(sub.id, 'resumed', 'resident');
end $$;

-- Explicit acceptance of newer plan terms (grandfathering ends only here).
create or replace function api.accept_plan_change()
returns public.subscriptions
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  sub public.subscriptions;
  old_plan public.plans;
  new_plan public.plans;
begin
  select * into sub from public.subscriptions
   where user_id = auth.uid() and status in ('active', 'paused', 'past_due') for update;
  if not found then perform core.raise_error('subscription_not_active'); end if;

  select * into old_plan from public.plans where id = sub.plan_id;
  select * into new_plan from public.plans
   where code = old_plan.code and active_for_signup;
  if not found or new_plan.id = old_plan.id then perform core.raise_error('not_found'); end if;

  update public.subscriptions
     set plan_id = new_plan.id, plan_accepted_at = now()
   where id = sub.id
   returning * into sub;

  perform core.log_sub_event(sub.id, 'plan_change_accepted', 'resident',
    jsonb_build_object('from_version', old_plan.version, 'to_version', new_plan.version));
  return sub;
end $$;

-- Upgrade/downgrade to a different plan code: takes effect immediately for
-- allowance ceiling (units_used preserved), price applies from next renewal.
create or replace function api.change_plan(p_plan_id uuid)
returns public.subscriptions
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare sub public.subscriptions; new_plan public.plans;
begin
  select * into sub from public.subscriptions
   where user_id = auth.uid() and status in ('active', 'past_due') for update;
  if not found then perform core.raise_error('subscription_not_active'); end if;

  select * into new_plan from public.plans where id = p_plan_id and active_for_signup;
  if not found then perform core.raise_error('not_found'); end if;

  update public.subscriptions
     set plan_id = new_plan.id,
         plan_accepted_at = now(),
         units_included = new_plan.units_per_month
   where id = sub.id
   returning * into sub;

  perform core.log_sub_event(sub.id, 'plan_changed', 'resident',
    jsonb_build_object('to_code', new_plan.code, 'to_version', new_plan.version));
  return sub;
end $$;

grant execute on function api.attach_payment_method(text, text, text, text) to authenticated;
grant execute on function api.start_subscription(uuid, uuid, text) to authenticated;
grant execute on function api.pause_subscription() to authenticated;
grant execute on function api.resume_subscription() to authenticated;
grant execute on function api.accept_plan_change() to authenticated;
grant execute on function api.change_plan(uuid) to authenticated;
