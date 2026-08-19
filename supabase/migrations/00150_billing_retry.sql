-- ============================================================================
-- 00150: zero-touch recovery for past_due subscriptions.
--
-- A failed renewal charge flips the sub to past_due; nothing re-attempted the
-- charge until the NEXT monthly reset. This creates a fresh retry charge
-- (internal.create_charge issues #rN attempt keys past failed ones) which the
-- billing-worker then takes to the provider on its next run. The app also
-- exposes a manual "pay now" that goes through the same charge path.
-- ============================================================================

create or replace function internal.retry_failed_renewals()
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
    select s.* from public.subscriptions s
     where s.status = 'past_due'
     for update skip locked
  loop
    -- skip if an attempt is already in flight
    if exists (select 1 from public.charges
                where subscription_id = sub.id and kind = 'subscription' and status = 'pending') then
      continue;
    end if;
    select * into plan from public.plans where id = sub.plan_id;
    perform internal.create_charge(
      sub.user_id, 'subscription', plan.price_agorot,
      core.cfg_text('payment_provider'),
      'renew:' || sub.id || ':' || to_char(now(), 'YYYY-MM'),
      sub.id,
      jsonb_build_object('renewal', true, 'retry', true));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function api.service_retry_failed_renewals()
returns int
language sql volatile security definer
set search_path = api, internal, public, pg_temp
as $$ select internal.retry_failed_renewals() $$;

revoke execute on function api.service_retry_failed_renewals() from public, anon, authenticated;
grant execute on function api.service_retry_failed_renewals(),
                          internal.retry_failed_renewals() to service_role;
