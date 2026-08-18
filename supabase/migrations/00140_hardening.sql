-- ============================================================================
-- 00140: hardening — fixes for the confirmed findings of the adversarial
-- review (money races, fail-open auth, stranded states, dead retries).
-- Each numbered section names the defect it closes.
-- ============================================================================

-- ── (1) collected→verified may now be driven by the system (auto-complete) ──
update core.request_transitions
   set roles = '{picker,system}',
       note = 'bin QR scanned; system = auto-complete after scan_grace_minutes'
 where from_status = 'collected' and to_status = 'verified';

-- ── (2) one-active-request guard was racy: enforce at the DB level ─────────
create unique index if not exists one_active_request_per_resident
  on public.requests (resident_id)
  where status in ('submitted', 'open', 'claimed', 'resident_approval',
                   'put_out_prompt', 'collected', 'verified');

create or replace function api.submit_request(
  p_units      int,
  p_ttl_option text default null,
  p_notes      text default null
) returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sub public.subscriptions;
  res public.residencies;
  bld public.buildings;
  u public.users;
  ttl text;
  req public.requests;
  sources jsonb;
  max_units int := (core.cfg('unit_rules') ->> 'max_units_per_request')::int;
begin
  if uid is null then perform core.raise_error('not_authorized'); end if;
  if not core.cfg_bool('service_enabled') then perform core.raise_error('service_disabled'); end if;
  if p_units is null or p_units < 1 or p_units > max_units then
    perform core.raise_error('invalid_units');
  end if;

  select * into u from public.users where id = uid;

  select * into sub from public.subscriptions
   where user_id = uid and status in ('active', 'paused', 'past_due');
  if not found or sub.status <> 'active' then
    perform core.raise_error('subscription_not_active');
  end if;

  select * into res from public.residencies where id = sub.residency_id;
  select * into bld from public.buildings where id = res.building_id;
  if bld.paused then perform core.raise_error('building_paused'); end if;

  ttl := coalesce(p_ttl_option, core.cfg('request_ttl_options') ->> 'default');

  begin
    insert into public.requests
      (resident_id, residency_id, building_id, subscription_id, units_requested,
       units_source, ttl_option, expires_at, confirm_first, notes)
    values
      (uid, res.id, bld.id, sub.id, p_units,
       '[]'::jsonb, ttl, core.ttl_expiry(ttl), u.confirm_first, p_notes)
    returning * into req;
  exception when unique_violation then
    -- one_active_request_per_resident: a concurrent submit won the race
    perform core.raise_error('illegal_transition');
  end;

  sources := core.consume_units(uid, p_units, req.id);
  update public.requests set units_source = sources where id = req.id;

  req := core.transition_request(req.id, 'submitted', 'open', 'system',
           jsonb_build_object('units', p_units, 'ttl', ttl, 'funding', sources));
  return req;
end $$;

-- ── (3) cancel_request failed OPEN for anon (NULL <> uuid is NULL) ─────────
create or replace function api.cancel_request(p_request_id uuid)
returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare req public.requests;
begin
  if auth.uid() is null then perform core.raise_error('not_authorized'); end if;
  select * into req from public.requests where id = p_request_id;
  if not found then perform core.raise_error('not_found'); end if;
  if req.resident_id is distinct from auth.uid() and not core.is_admin() then
    perform core.raise_error('not_authorized');
  end if;

  req := core.transition_request(p_request_id, 'open', 'canceled',
           case when core.is_admin() and req.resident_id is distinct from auth.uid()
                then 'admin' else 'resident' end);
  perform core.refund_units(req.id, req.resident_id, req.units_source);
  return req;
end $$;

-- ── (4) failed charges were unretryable behind fixed idempotency keys ──────
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
declare
  existing public.charges;
  final_key text := p_idempotency_key;
  retries int;
begin
  -- the LATEST attempt for this key governs (base key or a #r<N> retry)
  select * into existing from public.charges
   where idempotency_key = p_idempotency_key
      or idempotency_key like p_idempotency_key || '#r%'
   order by created_at desc, idempotency_key desc limit 1;
  if found then
    if existing.status <> 'failed' then
      return existing;                      -- true idempotent replay
    end if;
    -- a FAILED attempt must not block retrying forever: new attempt row
    select count(*) into retries from public.charges
     where idempotency_key like p_idempotency_key || '#r%';
    final_key := p_idempotency_key || '#r' || (retries + 1);
  end if;

  insert into public.charges
    (user_id, kind, amount_agorot, provider, idempotency_key, subscription_id, meta)
  values
    (p_user_id, p_kind, p_amount_agorot, p_provider, final_key, p_subscription_id, p_meta)
  on conflict (idempotency_key) do update set meta = public.charges.meta
  returning * into existing;
  return existing;
end $$;

-- ── (5) on-demand / extra-roll timestamp keys didn't dedupe double-taps ────
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

  select * into ch from public.charges
   where user_id = p_user_id and kind = 'extra_roll' and status = 'pending'
     and meta ->> 'format' = p_format
   order by created_at desc limit 1;
  if not found then
    ch := internal.create_charge(p_user_id, 'extra_roll',
            core.shekels_to_agorot((cfg ->> 'price')::numeric),
            core.cfg_text('payment_provider'),
            'roll:' || p_user_id || ':' || extract(epoch from now())::bigint,
            null,
            jsonb_build_object('format', p_format));
  end if;

  return jsonb_build_object('charge_id', ch.id, 'amount_agorot', ch.amount_agorot,
    'status', ch.status,
    'idempotency_key', ch.idempotency_key, 'provider', ch.provider,
    'provider_token', coalesce(pm.provider_token, 'missing'));
end $$;

-- ── (6) run_payout raced itself: advisory lock + totals from the EXACT rows
--        swept (mid-run verify_bin_scan lines are no longer silently stamped) ─
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
  -- one run at a time, ever (cron + admin button + service can all overlap)
  perform pg_advisory_xact_lock(hashtext('pinui.run_payout'));

  insert into public.payout_batches (period_end) values (period_end) returning * into batch;

  for pick in
    select pl.picker_id,
           sum(pl.units)::int as total_units,
           sum(pl.amount_agorot)::int as total_amount,
           min(pl.created_at)::date as first_line,
           array_agg(pl.id) as line_ids,
           pk.tax_status
      from (select * from public.payout_lines where payout_id is null for update) pl
      join public.pickers pk on pk.user_id = pl.picker_id
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

    -- sweep EXACTLY the rows that were totaled (locked above); a line
    -- committed mid-run stays unswept for the next batch
    update public.payout_lines set payout_id = payout_row.id
     where id = any (pick.line_ids);

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

-- ── (7) collected-but-never-scanned pickups were stranded forever ──────────
-- Shared completion path: verified→paid + payout line + claim completed.
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
  line_amount := line_units * (c.payout_per_unit_agorot + c.payout_boost_agorot);

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

create or replace function api.verify_bin_scan(p_claim_id uuid, p_qr_payload text)
returns jsonb
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  c public.claims;
  sibling record;
  req public.requests;
  b public.buildings;
  amount int;
  total_units int := 0;
  total_amount int := 0;
  today_total int;
begin
  select * into c from public.claims
   where id = p_claim_id and picker_id = auth.uid() and status = 'active';
  if not found then perform core.raise_error('not_found'); end if;

  select * into req from public.requests where id = c.request_id;
  select * into b from public.buildings where id = req.building_id;
  if trim(p_qr_payload) is distinct from b.bin_qr_id then
    perform core.raise_error('invalid_qr');
  end if;

  for sibling in
    select cl.id, cl.units_collected, cl.request_id from public.claims cl
      join public.requests r on r.id = cl.request_id
     where cl.claim_group_id = c.claim_group_id
       and cl.picker_id = auth.uid()
       and cl.status = 'active'
       and r.status = 'collected'
  loop
    amount := core.pay_claim(sibling.id, 'picker', jsonb_build_object('qr', b.bin_qr_id));
    total_units := total_units + coalesce(sibling.units_collected,
                     (select units_requested from public.requests where id = sibling.request_id));
    total_amount := total_amount + amount;
  end loop;

  if total_units = 0 then perform core.raise_error('illegal_transition'); end if;

  select coalesce(sum(amount_agorot), 0)::int into today_total
    from public.payout_lines
   where picker_id = auth.uid()
     and created_at >= date_trunc('day', now() at time zone core.cfg_text('timezone'))
                       at time zone core.cfg_text('timezone');

  return jsonb_build_object(
    'units', total_units,
    'amount_agorot', total_amount,
    'today_total_agorot', today_total
  );
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
               boost_agorot = boost_agorot + (payout_per_unit * boost_pct / 100)::int
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

-- ── (8) settle_charge v3: consistent UTC anchor; boost/backstop no-ops now
--        REFUND instead of silently keeping the money; backstop TTL from config ─
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
      returning * into new_req;
      perform core.transition_request(new_req.id, 'submitted', 'open', 'system',
        jsonb_build_object('on_demand', true, 'charge_id', ch.id));
    exception when others then
      -- TTL passed while settling, or an active request exists: money back
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

-- ── (9) pause across the anchor granted a free month with no charge ────────
create or replace function api.resume_subscription()
returns void
language plpgsql security definer
set search_path = api, internal, core, public, pg_temp
as $$
declare sub public.subscriptions; plan public.plans;
begin
  select * into sub from public.subscriptions
   where user_id = auth.uid() and status = 'paused' for update;
  if not found then perform core.raise_error('subscription_not_active'); end if;

  if sub.next_reset_at <= now() then
    -- resumed into a NEW billing period: fresh allowance AND a renewal charge
    select * into plan from public.plans where id = sub.plan_id;
    update public.subscriptions
       set status = 'active',
           paused_at = null,
           units_used = 0,
           units_included = plan.units_per_month,
           current_period_start = now(),
           next_reset_at = core.next_reset_at(sub.billing_anchor_day, now()),
           current_period_end = core.next_reset_at(sub.billing_anchor_day, now())
     where id = sub.id;
    perform internal.create_charge(
      sub.user_id, 'subscription', plan.price_agorot,
      core.cfg_text('payment_provider'),
      'renew:' || sub.id || ':' || to_char(now(), 'YYYY-MM'),
      sub.id,
      jsonb_build_object('renewal', true, 'resume', true));
  else
    update public.subscriptions
       set status = 'active', paused_at = null
     where id = sub.id;
  end if;
  perform core.log_sub_event(sub.id, 'resumed', 'resident');
end $$;

-- ── (10) abandoned pending_payment checkout blocked subscribing forever ────
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
  stale public.subscriptions;
begin
  if uid is null then perform core.raise_error('not_authorized'); end if;

  select * into plan from public.plans where id = p_plan_id;
  if not found or not plan.active_for_signup then perform core.raise_error('not_found'); end if;
  if not exists (select 1 from public.residencies where id = p_residency_id and user_id = uid) then
    perform core.raise_error('not_authorized');
  end if;

  -- an abandoned checkout is not a subscription: clear it and start fresh
  select * into stale from public.subscriptions
   where user_id = uid and status = 'pending_payment' for update;
  if found then
    update public.subscriptions
       set status = 'canceled', canceled_at = now() where id = stale.id;
    perform core.log_sub_event(stale.id, 'abandoned_checkout_canceled', 'system');
  end if;

  if exists (select 1 from public.subscriptions
              where user_id = uid and status in ('active', 'past_due', 'paused')) then
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

-- ── (11) refund_partial silently destroyed charge-type funding entries ─────
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

-- ── (12) push templates referenced params the enqueue sites never sent ─────
-- claim: the resident-facing push now carries the actual deadline time
create or replace function core.claim_notify_params(p_deadline timestamptz)
returns jsonb
language sql stable security definer
set search_path = core, public, pg_temp
as $$
  select jsonb_build_object(
    'deadline', to_char(p_deadline at time zone core.cfg_text('timezone'), 'HH24:MI'))
$$;

create or replace function api.claim_request(p_request_id uuid)
returns jsonb
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  pk public.pickers;
  target public.requests;
  r record;
  group_id uuid := gen_random_uuid();
  minutes int := core.cfg_int('claim_to_scan_minutes');
  payout int := core.shekels_to_agorot(core.cfg_numeric('picker_payout_per_unit_exvat'));
  max_groups int := core.cfg_int('max_active_claim_groups');
  rl jsonb := core.cfg('rate_limits');
  claimed jsonb := '[]'::jsonb;
  c public.claims;
  deadline timestamptz := now() + make_interval(mins => minutes);
begin
  pk := core.active_picker(uid);

  if not core.rate_limit_ok('claim:' || uid, (rl ->> 'claim_per_picker_per_hour')::int, 3600) then
    perform core.raise_error('rate_limited');
  end if;

  if (select count(distinct claim_group_id) from public.claims
       where picker_id = uid and status = 'active') >= max_groups then
    perform core.raise_error('claim_limit_reached');
  end if;

  select * into target from public.requests where id = p_request_id;
  if not found then perform core.raise_error('not_found'); end if;
  if target.resident_id = uid then perform core.raise_error('not_authorized'); end if;

  target := core.transition_request(p_request_id, 'open', 'claimed', 'picker',
              jsonb_build_object('claim_group', group_id), 'already_claimed');

  for r in
    select id, resident_id from public.requests
     where building_id = target.building_id and status = 'open' and id <> p_request_id
       and resident_id <> uid
     for update skip locked
  loop
    begin
      perform core.transition_request(r.id, 'open', 'claimed', 'picker',
                jsonb_build_object('claim_group', group_id, 'grouped_with', p_request_id));
    exception when others then
      continue;
    end;
  end loop;

  for r in
    select req.id as request_id, req.resident_id, req.confirm_first
      from public.requests req
     where req.status = 'claimed' and req.building_id = target.building_id
       and not exists (select 1 from public.claims cc
                        where cc.request_id = req.id and cc.status = 'active')
  loop
    insert into public.claims
      (request_id, claim_group_id, picker_id, deadline_at, payout_per_unit_agorot, payout_boost_agorot)
    values
      (r.request_id, group_id, uid, deadline, payout,
       (select boost_agorot from public.requests where id = r.request_id))
    returning * into c;

    if r.confirm_first then
      perform core.transition_request(r.request_id, 'claimed', 'resident_approval', 'system',
        jsonb_build_object('claim_id', c.id));
      perform core.notify(r.resident_id, 'push.approve_eta', jsonb_build_object('request_id', r.request_id));
    else
      perform core.notify(r.resident_id, 'push.request_claimed',
        jsonb_build_object('request_id', r.request_id) || core.claim_notify_params(deadline));
    end if;

    claimed := claimed || jsonb_build_object('claim_id', c.id, 'request_id', r.request_id);
  end loop;

  return jsonb_build_object('claim_group_id', group_id, 'claims', claimed,
                            'deadline_at', deadline);
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
      'amount_agorot', req.units_requested * (payout + req.boost_agorot)));
  perform core.notify(req.resident_id, 'push.request_claimed',
    jsonb_build_object('request_id', req.id) || core.claim_notify_params(c.deadline_at));
  return jsonb_build_object('claim_id', c.id);
end $$;

-- ── (13) OTP anti-pumping limit was seeded but enforced nowhere ────────────
create or replace function api.service_rate_limit_ok(
  p_bucket text, p_max int, p_window_seconds int
) returns boolean
language sql volatile security definer
set search_path = api, core, public, pg_temp
as $$ select core.rate_limit_ok(p_bucket, p_max, p_window_seconds) $$;

revoke execute on function api.service_rate_limit_ok(text, int, int) from public, anon, authenticated;
grant execute on function api.service_rate_limit_ok(text, int, int) to service_role;

-- ── (14) payment_fee_fixed was dead config: surface it in reporting ────────
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
    'payment_fees_30d_agorot', (
      -- reporting only, per spec: fixed processing fee × settled charges
      select (count(*) * core.shekels_to_agorot(core.cfg_numeric('payment_fee_fixed')))::int
      from public.charges
      where status = 'settled' and settled_at > now() - interval '30 days'),
    'auto_completed_30d', (
      select count(*)::int from public.request_events
      where to_status = 'verified' and (meta ->> 'auto_completed')::boolean
        and created_at > now() - interval '30 days'),
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

-- ── (15) function-privilege hardening: Postgres grants EXECUTE to PUBLIC by
--        default, and per-schema `alter default privileges ... revoke` is a
--        no-op against that built-in grant. Strip PUBLIC/anon everywhere and
--        re-grant exactly what RLS policies need. ──────────────────────────
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, n.nspname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('api', 'core', 'internal')
  loop
    execute format('revoke execute on function %s from public', fn.sig);
    execute format('revoke execute on function %s from anon', fn.sig);
    if fn.nspname in ('core', 'internal') then
      execute format('revoke execute on function %s from authenticated', fn.sig);
    end if;
  end loop;
end $$;

-- future functions created by postgres get no PUBLIC execute either
alter default privileges for role postgres revoke execute on functions from public;

-- service_role previously rode on the PUBLIC default; make its access explicit
grant execute on all functions in schema api to service_role;
grant execute on all functions in schema core to service_role;
grant execute on all functions in schema internal to service_role;
alter default privileges for role postgres in schema api grant execute on functions to service_role;
alter default privileges for role postgres in schema core grant execute on functions to service_role;
alter default privileges for role postgres in schema internal grant execute on functions to service_role;

-- RLS policies evaluate these AS the querying role — they must stay callable
grant execute on function core.is_admin() to authenticated, anon;
grant execute on function
  core.owns_request(uuid),
  core.has_claim_on_request(uuid),
  core.has_active_claim_in_building(uuid),
  core.has_active_claim_on_residency(uuid)
to authenticated;
