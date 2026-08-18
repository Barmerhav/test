-- ============================================================================
-- 00070: requests + request_events + THE TRANSITION ENGINE.
--
-- Every status change goes through core.transition_request: matrix-checked
-- (core.request_transitions seed), race-safe (guarded UPDATE on the expected
-- from-status), audited (request_events row in the same transaction), and
-- broadcast to the city feed topic. TS mirror: packages/shared/src/state.
-- ============================================================================

create table public.requests (
  id              uuid primary key default gen_random_uuid(),
  resident_id     uuid not null references public.users (id),
  residency_id    uuid not null references public.residencies (id),
  building_id     uuid not null references public.buildings (id),  -- denormalized for feed/RLS speed
  subscription_id uuid references public.subscriptions (id),       -- null = on-demand
  charge_id       uuid references public.charges (id),             -- on-demand funding
  status          text not null default 'submitted' check (status in
    ('submitted', 'open', 'claimed', 'resident_approval', 'put_out_prompt',
     'collected', 'verified', 'paid', 'expired', 'declined_leak', 'noshow', 'canceled')),
  units_requested int not null check (units_requested > 0),  -- max enforced in RPC from unit_rules config
  units_final     int,
  units_source    jsonb not null default '[]'::jsonb,
  ttl_option      text not null,
  expires_at      timestamptz not null,   -- SNAPSHOT at submit from config cutoffs
  confirm_first   boolean not null default false,  -- snapshot of the user toggle at submit
  boost_agorot    int not null default 0, -- payout bump snapshot (boost feature / noshow repost)
  repost_count    int not null default 0,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index req_feed   on public.requests (building_id, created_at) where status = 'open';
create index req_expiry on public.requests (expires_at)              where status = 'open';
create index req_owner  on public.requests (resident_id, created_at desc);

create trigger requests_touch before update on public.requests
  for each row execute function core.touch_updated_at();

alter table public.photos
  add constraint photos_request_fk foreign key (request_id) references public.requests (id);
alter table public.credit_consumptions
  add constraint credit_consumptions_request_fk foreign key (request_id) references public.requests (id);

-- Append-only audit; written ONLY by core.transition_request.
create table public.request_events (
  id          bigserial primary key,
  request_id  uuid not null references public.requests (id),
  from_status text,
  to_status   text not null,
  actor_id    uuid,
  actor_role  text not null check (actor_role in ('resident', 'picker', 'system', 'admin')),
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index rev_req on public.request_events (request_id, id);

-- ── the legal-transition matrix (mirror of packages/shared/src/state) ───────
create table core.request_transitions (
  from_status text not null,
  to_status   text not null,
  roles       text[] not null,
  note        text not null default '',
  primary key (from_status, to_status)
);

insert into core.request_transitions (from_status, to_status, roles, note) values
  ('submitted',         'open',              '{system}',               'momentary — posted to pool in the submit tx'),
  ('open',              'claimed',           '{picker,admin}',         'claim (soft lock); admin = manual dispatch'),
  ('open',              'expired',           '{system}',               'TTL passed unclaimed'),
  ('open',              'canceled',          '{resident,admin}',       'resident withdraws before claim'),
  ('claimed',           'resident_approval', '{system}',               'confirm-first only'),
  ('claimed',           'collected',         '{picker}',               'checklist done at the door'),
  ('claimed',           'open',              '{picker,system,admin}',  'voluntary release OR no-show repost'),
  ('claimed',           'noshow',            '{system,admin}',         'no-show terminal (noshow_action.repost=false)'),
  ('claimed',           'declined_leak',     '{picker}',               'leaking bag; photo required'),
  ('resident_approval', 'put_out_prompt',    '{resident}',             'resident approves picker ETA'),
  ('resident_approval', 'open',              '{resident,system}',      'ETA declined / approval timeout'),
  ('put_out_prompt',    'claimed',           '{resident}',             'bag outside; claim timer starts NOW'),
  ('put_out_prompt',    'canceled',          '{resident,admin}',       'resident bails'),
  ('put_out_prompt',    'open',              '{system}',               'claim lapsed waiting for resident — release, no strike'),
  ('collected',         'verified',          '{picker}',               'bin QR scanned'),
  ('verified',          'paid',              '{system}',               'payout line written in the same tx');

-- ── the engine ──────────────────────────────────────────────────────────────

/**
 * Atomic, audited transition. The guarded UPDATE on p_from makes concurrent
 * claims race-safe: exactly one caller sees the row in the expected status.
 * p_error_if_gone: stable code to raise when the row is no longer in p_from
 * (e.g. 'already_claimed' for the claim race).
 */
create or replace function core.transition_request(
  p_request_id    uuid,
  p_from          text,
  p_to            text,
  p_actor_role    text,
  p_meta          jsonb default '{}'::jsonb,
  p_error_if_gone text default 'illegal_transition'
) returns public.requests
language plpgsql volatile security definer
set search_path = core, public, pg_temp
as $$
declare
  t core.request_transitions;
  req public.requests;
  city text;
begin
  select * into t from core.request_transitions
   where from_status = p_from and to_status = p_to;
  if not found then perform core.raise_error('illegal_transition'); end if;
  if p_actor_role <> 'admin' and not (p_actor_role = any (t.roles)) then
    perform core.raise_error('illegal_transition');
  end if;

  update public.requests
     set status = p_to
   where id = p_request_id and status = p_from
   returning * into req;

  if not found then
    if not exists (select 1 from public.requests where id = p_request_id) then
      perform core.raise_error('not_found');
    end if;
    perform core.raise_error(p_error_if_gone);
  end if;

  insert into public.request_events (request_id, from_status, to_status, actor_id, actor_role, meta)
  values (p_request_id, p_from, p_to, auth.uid(), p_actor_role, coalesce(p_meta, '{}'::jsonb));

  select b.city into city from public.buildings b where b.id = req.building_id;
  perform core.broadcast(
    'city:' || coalesce(city, 'unknown'),
    'request_update',
    jsonb_build_object('request_id', req.id, 'building_id', req.building_id, 'status', p_to)
  );

  return req;
end $$;

-- Admin escape hatch: bypasses the matrix, loudly audited.
create or replace function api.admin_force_transition(
  p_request_id uuid,
  p_to         text,
  p_note       text default null
) returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare req public.requests; old_status text;
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  select status into old_status from public.requests where id = p_request_id for update;
  if not found then perform core.raise_error('not_found'); end if;

  update public.requests set status = p_to where id = p_request_id returning * into req;
  insert into public.request_events (request_id, from_status, to_status, actor_id, actor_role, meta)
  values (p_request_id, old_status, p_to, auth.uid(), 'admin',
          jsonb_build_object('forced', true, 'note', p_note));
  return req;
end $$;

-- ── TTL cutoffs ─────────────────────────────────────────────────────────────

/** expires_at for a TTL chip: today at the option's cutoff, config timezone. */
create or replace function core.ttl_expiry(p_ttl_option text)
returns timestamptz
language plpgsql stable security definer
set search_path = core, public, pg_temp
as $$
declare
  cfg jsonb := core.cfg('request_ttl_options');
  opt jsonb;
  tz text := core.cfg_text('timezone');
  cutoff time;
  expiry timestamptz;
begin
  select o into opt from jsonb_array_elements(cfg -> 'options') o
   where o ->> 'key' = p_ttl_option;
  if opt is null then perform core.raise_error('ttl_passed'); end if;

  cutoff := (opt ->> 'cutoff')::time;
  expiry := ((now() at time zone tz)::date + cutoff) at time zone tz;
  if expiry <= now() then perform core.raise_error('ttl_passed'); end if;
  return expiry;
end $$;

-- ── resident RPCs ───────────────────────────────────────────────────────────

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

  -- one active request per resident at a time keeps HOME dead simple
  if exists (select 1 from public.requests
              where resident_id = uid
                and status in ('submitted','open','claimed','resident_approval','put_out_prompt','collected','verified')) then
    perform core.raise_error('illegal_transition');
  end if;

  ttl := coalesce(p_ttl_option, core.cfg('request_ttl_options') ->> 'default');

  insert into public.requests
    (resident_id, residency_id, building_id, subscription_id, units_requested,
     units_source, ttl_option, expires_at, confirm_first, notes)
  values
    (uid, res.id, bld.id, sub.id, p_units,
     '[]'::jsonb, ttl, core.ttl_expiry(ttl), u.confirm_first, p_notes)
  returning * into req;

  sources := core.consume_units(uid, p_units, req.id);
  update public.requests set units_source = sources where id = req.id;

  -- momentary submitted → open (audited), broadcasts to the city feed
  req := core.transition_request(req.id, 'submitted', 'open', 'system',
           jsonb_build_object('units', p_units, 'ttl', ttl, 'funding', sources));
  return req;
end $$;

create or replace function api.cancel_request(p_request_id uuid)
returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare req public.requests;
begin
  select * into req from public.requests where id = p_request_id;
  if not found then perform core.raise_error('not_found'); end if;
  if req.resident_id <> auth.uid() and not core.is_admin() then
    perform core.raise_error('not_authorized');
  end if;

  req := core.transition_request(p_request_id, 'open', 'canceled',
           case when core.is_admin() and req.resident_id <> auth.uid() then 'admin' else 'resident' end);
  perform core.refund_units(req.id, req.resident_id, req.units_source);
  return req;
end $$;

-- ── one-call hydration for the app ──────────────────────────────────────────

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
                                   'price_agorot', p.price_agorot, 'units_per_month', p.units_per_month))
      from public.subscriptions s join public.plans p on p.id = s.plan_id
      where s.user_id = uid and s.status in ('pending_payment','active','paused','past_due')
      limit 1),
    'credits_available', core.credits_available(uid),
    'active_request', (
      select to_jsonb(r) from public.requests r
       where r.resident_id = uid
         and r.status in ('submitted','open','claimed','resident_approval','put_out_prompt','collected','verified')
       order by r.created_at desc limit 1),
    'residency', (
      select jsonb_build_object('id', res.id, 'floor', res.floor, 'apartment', res.apartment,
                                'building_id', b.id, 'city', b.city, 'street', b.street,
                                'house_number', b.house_number, 'building_paused', b.paused,
                                'has_entry_code', (b.entry_code_enc is not null))
      from public.residencies res join public.buildings b on b.id = res.building_id
      where res.user_id = uid and res.is_primary
      order by res.created_at desc limit 1)
  ) into result;

  return result;
end $$;

-- ── grants + RLS ────────────────────────────────────────────────────────────

grant select on public.requests, public.request_events to authenticated;

alter table public.requests enable row level security;
alter table public.request_events enable row level security;

-- Residents see their own requests. Pickers get open requests ONLY through
-- api.open_feed (security definer, limited columns) and their claimed ones
-- via a policy added with claims in 00100.
create policy requests_resident on public.requests
  for select using (resident_id = auth.uid() or core.is_admin());

create policy request_events_resident on public.request_events
  for select using (
    core.is_admin() or exists (
      select 1 from public.requests r
       where r.id = request_events.request_id and r.resident_id = auth.uid())
  );

grant execute on function api.submit_request(int, text, text) to authenticated;
grant execute on function api.cancel_request(uuid) to authenticated;
grant execute on function api.get_my_state() to authenticated;
grant execute on function api.admin_force_transition(uuid, text, text) to authenticated;

-- Residents watch their own active request live.
alter publication supabase_realtime add table public.requests;
