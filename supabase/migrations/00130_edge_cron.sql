-- ============================================================================
-- 00130: schedule the HTTP-side workers (edge functions) from pg_cron + pg_net.
--
-- Requires two Vault secrets, set ONCE per environment (dashboard):
--   edge_base_url      e.g. https://<ref>.supabase.co/functions/v1
--   service_role_key   the service key the functions expect
-- Where pg_net/pg_cron/secrets are missing (plain-Postgres CI), nothing is
-- scheduled — the e2e script and admin panel can invoke workers directly.
-- ============================================================================

create or replace function internal.call_edge(p_function text)
returns void
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare base text; key text;
begin
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    raise notice 'pg_net missing — skipped %', p_function;
    return;
  end if;
  begin
    base := core.get_secret('edge_base_url');
    key := core.get_secret('service_role_key');
  exception when others then
    raise notice 'edge secrets missing — skipped %', p_function;
    return;
  end;
  perform net.http_post(
    url := base || '/' || p_function,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || key)
  );
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('pinui-notify-worker', '* * * * *',   $job$select internal.call_edge('notify-worker')$job$);
    perform cron.schedule('pinui-billing-worker', '*/10 * * * *', $job$select internal.call_edge('billing-worker')$job$);
    perform cron.schedule('pinui-photo-reaper', '30 1 * * *',   $job$select internal.call_edge('photo-reaper')$job$);
    -- export runs right after the weekly payout batch (payout run is 01:00 Sunday UTC)
    perform cron.schedule('pinui-payout-export', '15 1 * * 0',  $job$select internal.call_edge('payout-export')$job$);
  end if;
exception when others then
  raise notice 'cron scheduling skipped: %', sqlerrm;
end $$;
