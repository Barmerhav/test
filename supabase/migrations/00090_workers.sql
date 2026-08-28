-- ============================================================================
-- 00090: zero-touch workers + cron wiring.
--
-- All workers are idempotent guarded scans over STORED deadlines — a config
-- change never moves an in-flight countdown. pg_cron fires them on Supabase;
-- tests call them directly; environments without pg_cron skip scheduling.
-- ============================================================================

-- TTL expiry: open requests past expires_at → expired + bag credit per
-- expiry_action (per requested unit) + push. No allowance refund on top of the
-- credit — the credit IS the restitution (prevents submit-expire farming).
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
    select id, resident_id, units_requested from public.requests
     where status = 'open' and expires_at <= now()
     for update skip locked
  loop
    perform core.transition_request(r.id, 'open', 'expired', 'system',
      jsonb_build_object('reason', 'ttl_expired'));

    if credit_per_unit > 0 then
      perform core.grant_credit(r.resident_id, credit_per_unit * r.units_requested,
                                'expiry_comp', r.id, null);
    end if;

    perform core.notify(r.resident_id, 'push.request_expired',
      jsonb_build_object('request_id', r.id, 'units', credit_per_unit * r.units_requested));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Minutely tick (claims lapse handler joins in 00100 via CREATE OR REPLACE).
create or replace function internal.tick_minutely()
returns jsonb
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
begin
  return jsonb_build_object('expired', internal.expire_requests());
end $$;

create or replace function internal.tick_daily()
returns jsonb
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
begin
  return jsonb_build_object(
    'allowance_resets', internal.reset_allowances(),
    'credits_expired', internal.expire_credits()
  );
end $$;

-- ── cron wiring (only where pg_cron exists) ────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('pinui-tick-minutely', '* * * * *', 'select internal.tick_minutely()');
    -- 01:00 UTC = 03:00/04:00 Israel
    perform cron.schedule('pinui-tick-daily', '0 1 * * *', 'select internal.tick_daily()');
  end if;
exception when others then
  raise notice 'cron scheduling skipped: %', sqlerrm;
end $$;
