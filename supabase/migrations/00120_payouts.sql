-- ============================================================================
-- 00120: payout runs + self-billed invoices + admin board/metrics.
--
-- payout_lines accrue at verify time (00100). The weekly run sweeps unswept
-- lines per picker into a payout, snapshots the VAT rate (murshe only),
-- numbers a self-billed invoice, and leaves export artifacts to the
-- payout-export edge function.
-- ============================================================================

create table public.payout_batches (
  id           uuid primary key default gen_random_uuid(),
  run_at       timestamptz not null default now(),
  period_start date,
  period_end   date not null,
  status       text not null default 'created' check (status in ('created', 'exported', 'sent')),
  csv_path     text,
  masav_path   text,
  created_by   uuid                      -- null = cron
);

create table public.payouts (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references public.payout_batches (id),
  picker_id           uuid not null references public.pickers (user_id),
  period_start        date,
  period_end          date not null,
  total_units         int not null,
  amount_exvat_agorot int not null,
  vat_rate            numeric(5, 4) not null,   -- snapshot; 0 for patur/none
  vat_agorot          int not null,
  total_agorot        int not null,
  status              text not null default 'pending' check (status in ('pending', 'exported', 'paid', 'failed')),
  paid_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index payouts_picker on public.payouts (picker_id, created_at desc);

alter table public.payout_lines
  add constraint payout_lines_payout_fk foreign key (payout_id) references public.payouts (id);

create sequence core.invoice_seq;

create table public.invoices_selfbilled (
  id                  uuid primary key default gen_random_uuid(),
  payout_id           uuid not null unique references public.payouts (id),
  picker_id           uuid not null,
  invoice_number      text not null unique,     -- SB-<year>-<seq>
  tax_status_snapshot text not null,
  amount_exvat_agorot int not null,
  vat_agorot          int not null,
  total_agorot        int not null,
  pdf_path            text,
  issued_at           timestamptz not null default now()
);

grant select on public.payouts, public.invoices_selfbilled to authenticated;
grant select on public.payout_batches to authenticated;

alter table public.payout_batches enable row level security;
alter table public.payouts enable row level security;
alter table public.invoices_selfbilled enable row level security;

create policy payout_batches_admin on public.payout_batches
  for select using (core.is_admin());
create policy payouts_self on public.payouts
  for select using (picker_id = auth.uid() or core.is_admin());
create policy invoices_self on public.invoices_selfbilled
  for select using (picker_id = auth.uid() or core.is_admin());

-- ── the weekly run ──────────────────────────────────────────────────────────

create or replace function internal.run_payout(p_period_end date default null)
returns uuid
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare
  batch public.payout_batches;
  period_end date := coalesce(p_period_end, (now() at time zone core.cfg_text('timezone'))::date);
  pick record;
  vat numeric := core.cfg_numeric('vat_rate');
  p_vat numeric;
  vat_amt int;
  payout_row public.payouts;
  inv_no text;
  any_lines boolean := false;
begin
  insert into public.payout_batches (period_end) values (period_end) returning * into batch;

  for pick in
    select pl.picker_id,
           sum(pl.units)::int as total_units,
           sum(pl.amount_agorot)::int as total_amount,
           min(pl.created_at)::date as first_line,
           pk.tax_status
      from public.payout_lines pl
      join public.pickers pk on pk.user_id = pl.picker_id
     where pl.payout_id is null
     group by pl.picker_id, pk.tax_status
  loop
    any_lines := true;
    p_vat := case when pick.tax_status = 'murshe' then vat else 0 end;
    vat_amt := round(pick.total_amount * p_vat)::int;

    insert into public.payouts
      (batch_id, picker_id, period_start, period_end, total_units,
       amount_exvat_agorot, vat_rate, vat_agorot, total_agorot)
    values
      (batch.id, pick.picker_id, pick.first_line, period_end, pick.total_units,
       pick.total_amount, p_vat, vat_amt, pick.total_amount + vat_amt)
    returning * into payout_row;

    update public.payout_lines set payout_id = payout_row.id
     where picker_id = pick.picker_id and payout_id is null;

    inv_no := 'SB-' || extract(year from now())::int || '-' ||
              lpad(nextval('core.invoice_seq')::text, 6, '0');
    insert into public.invoices_selfbilled
      (payout_id, picker_id, invoice_number, tax_status_snapshot,
       amount_exvat_agorot, vat_agorot, total_agorot)
    values
      (payout_row.id, pick.picker_id, inv_no, pick.tax_status,
       pick.total_amount, vat_amt, pick.total_amount + vat_amt);

    perform core.notify(pick.picker_id, 'push.payout_sent',
      jsonb_build_object('amount_agorot', pick.total_amount + vat_amt));
  end loop;

  if not any_lines then
    delete from public.payout_batches where id = batch.id;
    return null;
  end if;
  return batch.id;
end $$;

create or replace function api.admin_run_payout()
returns uuid
language plpgsql security definer
set search_path = api, internal, core, public, pg_temp
as $$
declare bid uuid;
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  bid := internal.run_payout();
  update public.payout_batches set created_by = auth.uid() where id = bid;
  return bid;
end $$;

-- service wrapper for the payout-export function to fetch everything at once
create or replace function api.service_payout_batch(p_batch_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = api, core, public, pg_temp
as $$
begin
  return jsonb_build_object(
    'batch', (select to_jsonb(b) from public.payout_batches b where b.id = p_batch_id),
    'payouts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'payout', to_jsonb(p),
        'invoice', to_jsonb(i),
        'picker', jsonb_build_object(
          'user_id', pk.user_id, 'tax_status', pk.tax_status, 'vat_id', pk.vat_id,
          'bank_details', pk.bank_details,
          'full_name', u.full_name, 'phone', u.phone)
      )), '[]'::jsonb)
      from public.payouts p
      join public.invoices_selfbilled i on i.payout_id = p.id
      join public.pickers pk on pk.user_id = p.picker_id
      join public.users u on u.id = p.picker_id
      where p.batch_id = p_batch_id)
  );
end $$;

create or replace function api.service_mark_batch_exported(
  p_batch_id uuid, p_csv_path text, p_masav_path text, p_invoice_paths jsonb
) returns void
language plpgsql volatile security definer
set search_path = api, core, public, pg_temp
as $$
declare entry record;
begin
  update public.payout_batches
     set status = 'exported', csv_path = p_csv_path, masav_path = p_masav_path
   where id = p_batch_id;
  update public.payouts set status = 'exported' where batch_id = p_batch_id and status = 'pending';
  for entry in select * from jsonb_each_text(coalesce(p_invoice_paths, '{}'::jsonb))
  loop
    update public.invoices_selfbilled set pdf_path = entry.value
     where payout_id = entry.key::uuid;
  end loop;
end $$;

revoke execute on function api.service_payout_batch(uuid),
  api.service_mark_batch_exported(uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function api.service_payout_batch(uuid),
  api.service_mark_batch_exported(uuid, text, text, jsonb) to service_role;

grant execute on function api.admin_run_payout() to authenticated;

-- ── admin board + metrics (single gated RPCs — no wide-open views) ──────────

create or replace function api.admin_requests_board()
returns jsonb
language plpgsql stable security definer
set search_path = api, core, public, pg_temp
as $$
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  return (
    select coalesce(jsonb_agg(row order by (row ->> 'created_at') desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', r.id, 'status', r.status, 'units', r.units_requested,
        'units_final', r.units_final, 'created_at', r.created_at,
        'expires_at', r.expires_at, 'repost_count', r.repost_count,
        'boost_agorot', r.boost_agorot,
        'city', b.city, 'street', b.street, 'house_number', b.house_number,
        'building_id', b.id, 'building_paused', b.paused,
        'resident_phone', u.phone,
        'on_demand', (r.subscription_id is null),
        'claim', (select jsonb_build_object('picker_id', c.picker_id, 'status', c.status,
                                            'deadline_at', c.deadline_at, 'picker_phone', pu.phone)
                    from public.claims c join public.users pu on pu.id = c.picker_id
                   where c.request_id = r.id order by c.created_at desc limit 1)
      ) as row
      from public.requests r
      join public.buildings b on b.id = r.building_id
      join public.users u on u.id = r.resident_id
      where r.created_at > now() - interval '7 days'
         or r.status in ('open', 'claimed', 'resident_approval', 'put_out_prompt', 'collected')
      limit 500
    ) rows
  );
end $$;

create or replace function api.admin_metrics()
returns jsonb
language plpgsql stable security definer
set search_path = api, core, public, pg_temp
as $$
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  return jsonb_build_object(
    'requests_30d', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*)::int as n from public.requests
             where created_at > now() - interval '30 days' group by status) s),
    'claim_rate_30d', (
      select case when count(*) = 0 then null
             else round(count(*) filter (where status not in ('expired', 'canceled'))::numeric
                        / count(*), 3) end
      from public.requests
      where created_at > now() - interval '30 days'
        and status not in ('open', 'submitted')),
    'median_seconds_to_claim_30d', (
      select percentile_cont(0.5) within group (order by extract(epoch from claim_t - open_t))
      from (
        select min(e1.created_at) as open_t, min(e2.created_at) as claim_t
          from public.request_events e1
          join public.request_events e2
            on e2.request_id = e1.request_id and e2.to_status = 'claimed'
         where e1.to_status = 'open' and e1.created_at > now() - interval '30 days'
         group by e1.request_id) t
      where claim_t is not null),
    'expiry_rate_30d', (
      select case when count(*) = 0 then null
             else round(count(*) filter (where status = 'expired')::numeric / count(*), 3) end
      from public.requests
      where created_at > now() - interval '30 days'
        and status in ('paid', 'expired', 'declined_leak', 'noshow', 'canceled')),
    'utilization_pct', (
      select case when sum(units_included) = 0 then null
             else round(100 * sum(units_used)::numeric / sum(units_included), 1) end
      from public.subscriptions where status = 'active'),
    'active_subscriptions', (select count(*)::int from public.subscriptions where status = 'active'),
    'active_pickers_7d', (
      select count(distinct picker_id)::int from public.claims
      where created_at > now() - interval '7 days'),
    'pending_verification', (
      select count(*)::int from public.pickers where status = 'pending_verification'),
    'unswept_payout_agorot', (
      select coalesce(sum(amount_agorot), 0)::int from public.payout_lines where payout_id is null),
    'buildings', (
      select coalesce(jsonb_agg(row order by (row ->> 'requests_30d')::int desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'building_id', b.id, 'city', b.city, 'street', b.street,
          'house_number', b.house_number, 'paused', b.paused,
          'active_doors', coalesce(bm.active_doors, 0),
          'requests_30d', (select count(*)::int from public.requests r
                            where r.building_id = b.id
                              and r.created_at > now() - interval '30 days')) as row
        from public.buildings b
        left join public.building_meter bm on bm.building_id = b.id
        limit 100) rows)
  );
end $$;

grant execute on function api.admin_requests_board(), api.admin_metrics() to authenticated;

-- weekly payout cron (Sun 04:00 IL ≈ 01:00 UTC)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('pinui-payout-weekly', '0 1 * * 0', 'select internal.run_payout()');
  end if;
exception when others then
  raise notice 'cron scheduling skipped: %', sqlerrm;
end $$;
