-- ============================================================================
-- 00095: service-only API wrappers.
--
-- PostgREST exposes only public/api schemas, so edge functions (service_role)
-- reach internal.* through these thin wrappers. EXECUTE is granted to
-- service_role ONLY — authenticated/anon get nothing.
-- ============================================================================

-- One-call charge setup for a subscription: validates, reads the grandfathered
-- plan price via the FK, creates the pending charge, hands the edge function
-- everything the provider needs.
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

  idem := 'sub:' || sub.id || ':' || to_char(now(), 'YYYY-MM');
  ch := internal.create_charge(sub.user_id, 'subscription', plan.price_agorot,
                               core.cfg_text('payment_provider'), idem, sub.id,
                               jsonb_build_object('plan_code', plan.code, 'plan_version', plan.version));

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

create or replace function api.service_charge_extra_roll(p_user_id uuid, p_format text)
returns jsonb
language plpgsql volatile security definer
set search_path = api, internal, core, public, pg_temp
as $$
declare
  cfg jsonb := core.cfg('extra_roll');
  pm public.payment_methods;
  ch public.charges;
begin
  if not (cfg ->> 'enabled')::boolean then perform core.raise_error('feature_disabled'); end if;
  if p_format not in ('large', 'small') then perform core.raise_error('not_found'); end if;

  select * into pm from public.payment_methods
   where user_id = p_user_id and status = 'active'
   order by created_at desc limit 1;

  ch := internal.create_charge(p_user_id, 'extra_roll',
          core.shekels_to_agorot((cfg ->> 'price')::numeric),
          core.cfg_text('payment_provider'),
          'roll:' || p_user_id || ':' || extract(epoch from now())::bigint,
          null,
          jsonb_build_object('format', p_format));

  return jsonb_build_object(
    'charge_id', ch.id, 'amount_agorot', ch.amount_agorot,
    'idempotency_key', ch.idempotency_key, 'provider', ch.provider,
    'provider_token', coalesce(pm.provider_token, 'missing'));
end $$;

create or replace function api.service_mark_charge_provider(p_charge_id uuid, p_provider_charge_id text)
returns void
language sql volatile security definer
set search_path = api, internal, public, pg_temp
as $$
  select internal.mark_charge_provider_id(p_charge_id, p_provider_charge_id)
$$;

create or replace function api.service_settle_charge(
  p_provider_charge_id text,
  p_outcome            text,
  p_failure_reason     text default null
) returns jsonb
language plpgsql volatile security definer
set search_path = api, internal, core, public, pg_temp
as $$
declare ch public.charges;
begin
  ch := internal.settle_charge(p_provider_charge_id, p_outcome, p_failure_reason);
  return jsonb_build_object('charge_id', ch.id, 'status', ch.status, 'kind', ch.kind);
end $$;

create or replace function api.service_log_sms(p_phone text, p_body text)
returns void
language sql volatile security definer
set search_path = api, public, pg_temp
as $$
  insert into public.mock_sms_log (phone, body) values (p_phone, p_body)
$$;

-- Manual worker triggers (admin panel / e2e script convenience).
create or replace function api.service_tick_minutely()
returns jsonb
language sql volatile security definer
set search_path = api, internal, public, pg_temp
as $$ select internal.tick_minutely() $$;

create or replace function api.service_tick_daily()
returns jsonb
language sql volatile security definer
set search_path = api, internal, public, pg_temp
as $$ select internal.tick_daily() $$;

revoke execute on function
  api.service_charge_subscription(uuid),
  api.service_charge_extra_roll(uuid, text),
  api.service_mark_charge_provider(uuid, text),
  api.service_settle_charge(text, text, text),
  api.service_log_sms(text, text),
  api.service_tick_minutely(),
  api.service_tick_daily()
from public, anon, authenticated;

grant execute on function
  api.service_charge_subscription(uuid),
  api.service_charge_extra_roll(uuid, text),
  api.service_mark_charge_provider(uuid, text),
  api.service_settle_charge(text, text, text),
  api.service_log_sms(text, text),
  api.service_tick_minutely(),
  api.service_tick_daily()
to service_role;
