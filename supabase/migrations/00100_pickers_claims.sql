-- ============================================================================
-- 00100: pickers, claims (soft-lock + payout snapshot), entry-code reveal
-- (audited, time-boxed), collection with server-side unit recount, bin-QR
-- verification → payout line, no-show lapse worker.
-- ============================================================================

create table public.pickers (
  user_id        uuid primary key references public.users (id) on delete cascade,
  status         text not null default 'pending_verification' check (status in
    ('pending_verification', 'active', 'suspended', 'rejected')),
  birthdate      date not null,
  id_number_hash text not null,                -- salted sha256; plaintext ת"ז never stored
  tax_status     text not null check (tax_status in ('patur', 'murshe', 'none')),
  vat_id         text,
  poa_consent_at timestamptz not null,
  poa_version    text not null,
  bank_details   jsonb,
  strikes        int not null default 0,       -- cache; truth = picker_strikes
  available      boolean not null default true,
  verified_at    timestamptz,
  verified_by    uuid,
  created_at     timestamptz not null default now()
);

create table public.picker_strikes (
  id         bigserial primary key,
  picker_id  uuid not null references public.pickers (user_id),
  claim_id   uuid,                             -- FK added below
  reason     text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid
);
create index picker_strikes_picker on public.picker_strikes (picker_id) where revoked_at is null;

create table public.claims (
  id                     uuid primary key default gen_random_uuid(),
  request_id             uuid not null references public.requests (id),
  claim_group_id         uuid not null,        -- one building stop = one group
  picker_id              uuid not null references public.pickers (user_id),
  status                 text not null default 'active' check (status in
    ('active', 'completed', 'lapsed', 'released', 'declined_leak')),
  claimed_at             timestamptz not null default now(),
  deadline_at            timestamptz not null, -- SNAPSHOT: claim/bag-out time + cfg minutes
  payout_per_unit_agorot int not null,         -- SNAPSHOT of cfg at claim; immutable
  payout_boost_agorot    int not null default 0,
  collected_at           timestamptz,
  verified_at            timestamptz,
  units_collected        int,
  adjustment             jsonb,                -- raw chips from the collection screen
  leak_photo_path        text,
  created_at             timestamptz not null default now()
);
create unique index one_active_claim_per_request on public.claims (request_id) where status = 'active';
create index claims_lapse  on public.claims (deadline_at) where status = 'active';
create index claims_picker on public.claims (picker_id, created_at desc);
create index claims_group  on public.claims (claim_group_id);

alter table public.picker_strikes
  add constraint picker_strikes_claim_fk foreign key (claim_id) references public.claims (id);

create table public.code_reveal_audit (
  id                bigserial primary key,
  claim_id          uuid not null references public.claims (id),
  picker_id         uuid not null,
  building_id       uuid not null,
  revealed_at       timestamptz not null default now(),
  reveal_expires_at timestamptz not null
);
create index code_reveal_claim on public.code_reveal_audit (claim_id);

-- Payout ledger lines: written AT VERIFY TIME so earnings are visible
-- immediately; payout_id stays NULL until the weekly run sweeps them.
create table public.payout_lines (
  id              bigserial primary key,
  claim_id        uuid not null unique references public.claims (id),
  request_id      uuid not null references public.requests (id),
  picker_id       uuid not null references public.pickers (user_id),
  units           int not null check (units > 0),
  per_unit_agorot int not null,
  boost_agorot    int not null default 0,
  amount_agorot   int not null,
  payout_id       uuid,                        -- FK added with payouts in 00110
  created_at      timestamptz not null default now()
);
create index payout_lines_unswept on public.payout_lines (picker_id) where payout_id is null;

-- ── grants + RLS ────────────────────────────────────────────────────────────

grant select on public.pickers, public.picker_strikes, public.claims,
                public.payout_lines to authenticated;

alter table public.pickers enable row level security;
alter table public.picker_strikes enable row level security;
alter table public.claims enable row level security;
alter table public.code_reveal_audit enable row level security;
alter table public.payout_lines enable row level security;

-- Cross-table policy checks go through SECURITY DEFINER helpers (which run as
-- the table owner and bypass RLS) — otherwise requests↔claims policies recurse.

create or replace function core.owns_request(p_request_id uuid)
returns boolean
language sql stable security definer
set search_path = core, public, pg_temp
as $$
  select exists (select 1 from public.requests r
                  where r.id = p_request_id and r.resident_id = auth.uid())
$$;

create or replace function core.has_claim_on_request(p_request_id uuid)
returns boolean
language sql stable security definer
set search_path = core, public, pg_temp
as $$
  select exists (select 1 from public.claims c
                  where c.request_id = p_request_id and c.picker_id = auth.uid())
$$;

create or replace function core.has_active_claim_in_building(p_building_id uuid)
returns boolean
language sql stable security definer
set search_path = core, public, pg_temp
as $$
  select exists (select 1 from public.claims c
                  join public.requests r on r.id = c.request_id
                 where r.building_id = p_building_id
                   and c.picker_id = auth.uid() and c.status = 'active')
$$;

create or replace function core.has_active_claim_on_residency(p_residency_id uuid)
returns boolean
language sql stable security definer
set search_path = core, public, pg_temp
as $$
  select exists (select 1 from public.claims c
                  join public.requests r on r.id = c.request_id
                 where r.residency_id = p_residency_id
                   and c.picker_id = auth.uid() and c.status = 'active')
$$;

grant execute on function core.owns_request(uuid), core.has_claim_on_request(uuid),
  core.has_active_claim_in_building(uuid), core.has_active_claim_on_residency(uuid)
to authenticated;

create policy pickers_self on public.pickers
  for select using (user_id = auth.uid() or core.is_admin());
create policy strikes_self on public.picker_strikes
  for select using (picker_id = auth.uid() or core.is_admin());
create policy claims_parties on public.claims
  for select using (
    picker_id = auth.uid() or core.is_admin() or core.owns_request(request_id)
  );
create policy reveal_audit_admin on public.code_reveal_audit
  for select using (core.is_admin());
create policy payout_lines_self on public.payout_lines
  for select using (picker_id = auth.uid() or core.is_admin());

-- pickers with a claim can see that request + stop details
create policy requests_picker on public.requests
  for select using (core.has_claim_on_request(id));
create policy request_events_picker on public.request_events
  for select using (core.has_claim_on_request(request_id));
create policy buildings_picker on public.buildings
  for select using (core.has_active_claim_in_building(id));
create policy residencies_picker_stop on public.residencies
  for select using (core.has_active_claim_on_residency(id));

alter publication supabase_realtime add table public.claims;

-- ── helpers ─────────────────────────────────────────────────────────────────

create or replace function core.active_picker(p_uid uuid)
returns public.pickers
language plpgsql stable security definer
set search_path = core, public, pg_temp
as $$
declare p public.pickers;
begin
  select * into p from public.pickers where user_id = p_uid;
  if not found then perform core.raise_error('picker_not_active'); end if;
  if p.status = 'suspended' then perform core.raise_error('picker_suspended'); end if;
  if p.status <> 'active' then perform core.raise_error('picker_not_active'); end if;
  return p;
end $$;

create or replace function core.add_strike(p_picker_id uuid, p_claim_id uuid, p_reason text, p_count int)
returns void
language plpgsql volatile security definer
set search_path = core, public, pg_temp
as $$
declare active_strikes int; threshold int := core.cfg_int('strikes_to_suspend');
begin
  if p_count <= 0 then return; end if;
  for i in 1..p_count loop
    insert into public.picker_strikes (picker_id, claim_id, reason) values (p_picker_id, p_claim_id, p_reason);
  end loop;

  select count(*) into active_strikes from public.picker_strikes
   where picker_id = p_picker_id and revoked_at is null;
  update public.pickers set strikes = active_strikes where user_id = p_picker_id;

  if active_strikes >= threshold then
    update public.pickers set status = 'suspended' where user_id = p_picker_id and status = 'active';
    perform core.notify(p_picker_id, 'push.picker_suspended', jsonb_build_object('count', active_strikes));
  end if;
end $$;

-- ── picker onboarding & verification ────────────────────────────────────────

create or replace function api.register_picker(
  p_birthdate    date,
  p_id_number    text,
  p_tax_status   text,
  p_poa_consent  boolean,
  p_bank_details jsonb default null,
  p_vat_id       text default null
) returns public.pickers
language plpgsql security definer
set search_path = api, core, public, extensions, pg_temp
as $$
declare pk public.pickers;
begin
  if auth.uid() is null then perform core.raise_error('not_authorized'); end if;
  if p_birthdate is null or p_birthdate > (current_date - interval '18 years') then
    perform core.raise_error('underage');
  end if;
  if coalesce(trim(p_id_number), '') = '' then perform core.raise_error('not_found'); end if;
  if p_tax_status not in ('patur', 'murshe', 'none') then perform core.raise_error('not_found'); end if;
  if not coalesce(p_poa_consent, false) then perform core.raise_error('not_authorized'); end if;

  insert into public.pickers
    (user_id, birthdate, id_number_hash, tax_status, vat_id, poa_consent_at, poa_version, bank_details)
  values
    (auth.uid(), p_birthdate,
     encode(extensions.digest(trim(p_id_number) || core.get_secret('id_hash_salt'), 'sha256'), 'hex'),
     p_tax_status, p_vat_id, now(), core.cfg_text('poa_version'), p_bank_details)
  on conflict (user_id) do update
    set tax_status = excluded.tax_status,
        vat_id = excluded.vat_id,
        bank_details = excluded.bank_details
  returning * into pk;
  return pk;
end $$;

create or replace function api.admin_verify_picker(p_user_id uuid, p_approve boolean)
returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
begin
  if not core.is_admin() then perform core.raise_error('not_authorized'); end if;
  update public.pickers
     set status = case when p_approve then 'active' else 'rejected' end,
         verified_at = case when p_approve then now() else verified_at end,
         verified_by = auth.uid()
   where user_id = p_user_id and status = 'pending_verification';
  if not found then perform core.raise_error('not_found'); end if;
end $$;

create or replace function api.set_picker_availability(p_available boolean)
returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
begin
  update public.pickers set available = p_available where user_id = auth.uid();
  if not found then perform core.raise_error('picker_not_active'); end if;
end $$;

-- ── feed (SECURITY DEFINER — pickers have no SELECT policy on open requests) ─
-- Street-level info only: NO floor/apartment/door_note until claimed.

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
         r.units_requested * payout_per_unit + r.boost_agorot * r.units_requested,
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

-- ── claim (the race) ────────────────────────────────────────────────────────

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

  -- claim the tapped request first (hard race: exactly one winner)...
  target := core.transition_request(p_request_id, 'open', 'claimed', 'picker',
              jsonb_build_object('claim_group', group_id), 'already_claimed');

  -- ...then sweep the rest of the building's open requests into the same stop
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
      continue;  -- lost a race on a sibling — skip it, the stop still works
    end;
  end loop;

  -- one claim row per request in the group; snapshots are immutable from here
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
      (r.request_id, group_id, uid, now() + make_interval(mins => minutes), payout,
       (select boost_agorot from public.requests where id = r.request_id))
    returning * into c;

    if r.confirm_first then
      perform core.transition_request(r.request_id, 'claimed', 'resident_approval', 'system',
        jsonb_build_object('claim_id', c.id));
      perform core.notify(r.resident_id, 'push.approve_eta', jsonb_build_object('request_id', r.request_id));
    else
      perform core.notify(r.resident_id, 'push.request_claimed',
        jsonb_build_object('request_id', r.request_id));
    end if;

    claimed := claimed || jsonb_build_object('claim_id', c.id, 'request_id', r.request_id);
  end loop;

  return jsonb_build_object('claim_group_id', group_id, 'claims', claimed,
                            'deadline_at', now() + make_interval(mins => minutes));
end $$;

create or replace function api.release_claim(p_claim_id uuid)
returns void
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare c public.claims; req public.requests;
begin
  select * into c from public.claims
   where id = p_claim_id and picker_id = auth.uid() and status = 'active'
   for update;
  if not found then perform core.raise_error('not_found'); end if;

  select * into req from public.requests where id = c.request_id;
  -- voluntary release from whatever pre-collection state we're in
  if req.status in ('claimed', 'resident_approval', 'put_out_prompt') then
    perform core.transition_request(c.request_id, req.status,
      case when req.status = 'put_out_prompt' then 'open' when req.status = 'resident_approval' then 'open' else 'open' end,
      case when req.status = 'claimed' then 'picker' else 'system' end,
      jsonb_build_object('reason', 'released', 'claim_id', c.id));
  else
    perform core.raise_error('illegal_transition');
  end if;

  update public.claims set status = 'released' where id = c.id;
  update public.requests set repost_count = repost_count + 1 where id = c.request_id;
end $$;

-- ── confirm-first resident steps ────────────────────────────────────────────

create or replace function api.approve_pickup(p_request_id uuid)
returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare req public.requests;
begin
  select * into req from public.requests where id = p_request_id and resident_id = auth.uid();
  if not found then perform core.raise_error('not_found'); end if;
  req := core.transition_request(p_request_id, 'resident_approval', 'put_out_prompt', 'resident');
  perform core.notify(req.resident_id, 'push.put_out', jsonb_build_object('request_id', req.id));
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

  select * into c from public.claims where request_id = p_request_id and status = 'active';
  req := core.transition_request(p_request_id, 'resident_approval', 'open', 'resident',
           jsonb_build_object('reason', 'eta_declined'));
  if found then
    update public.claims set status = 'released' where id = c.id;  -- no strike
  end if;
  return req;
end $$;

create or replace function api.confirm_bag_out(p_request_id uuid)
returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare req public.requests; minutes int := core.cfg_int('claim_to_scan_minutes');
begin
  select * into req from public.requests where id = p_request_id and resident_id = auth.uid();
  if not found then perform core.raise_error('not_found'); end if;

  req := core.transition_request(p_request_id, 'put_out_prompt', 'claimed', 'resident',
           jsonb_build_object('bag_out', true));
  -- the claim timer starts NOW, not at claim time (per spec)
  update public.claims
     set deadline_at = now() + make_interval(mins => minutes)
   where request_id = p_request_id and status = 'active';
  return req;
end $$;

-- ── entry-code reveal (THE security choke point) ────────────────────────────

create or replace function api.reveal_entry_code(p_claim_id uuid)
returns jsonb
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  c public.claims;
  req public.requests;
  b public.buildings;
  rl jsonb := core.cfg('rate_limits');
  window_min int := core.cfg_int('code_reveal_window_minutes');
  expires timestamptz;
begin
  select * into c from public.claims
   where id = p_claim_id and picker_id = auth.uid() and status = 'active';
  if not found then perform core.raise_error('not_found'); end if;
  if c.deadline_at <= now() then perform core.raise_error('claim_expired'); end if;

  select * into req from public.requests where id = c.request_id;
  if req.status not in ('claimed', 'collected') then perform core.raise_error('illegal_transition'); end if;

  if not core.rate_limit_ok('reveal:' || p_claim_id, (rl ->> 'reveal_per_claim')::int, 3600) then
    perform core.raise_error('rate_limited');
  end if;

  select * into b from public.buildings where id = req.building_id;
  if b.entry_code_enc is null then
    return jsonb_build_object('code', null, 'reveal_expires_at', null);
  end if;

  expires := least(c.deadline_at, now() + make_interval(mins => window_min));
  insert into public.code_reveal_audit (claim_id, picker_id, building_id, reveal_expires_at)
  values (c.id, auth.uid(), b.id, expires);

  return jsonb_build_object(
    'code', core.decrypt_entry_code(b.entry_code_enc),
    'reveal_expires_at', expires
  );
end $$;

-- ── collection (server recounts units — never trusts client math) ──────────

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
    if v_units_final < 1 then perform core.raise_error('invalid_units'); end if;
  end if;

  req := core.transition_request(c.request_id, 'claimed', 'collected', 'picker',
           jsonb_build_object('units_final', v_units_final, 'adjustment', p_adjustment));

  delta := v_units_final - req.units_requested;
  if delta > 0 then
    -- more units on-site: fund the difference; if the resident can't cover it,
    -- record it unfunded — the resident is NOTIFIED, never silently charged.
    begin
      extra_sources := core.consume_units(req.resident_id, delta, req.id);
      update public.requests
         set units_source = units_source || extra_sources where id = req.id;
    exception when others then
      insert into public.request_events (request_id, from_status, to_status, actor_id, actor_role, meta)
      values (req.id, 'collected', 'collected', auth.uid(), 'system',
              jsonb_build_object('unfunded_units', delta));
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

-- Partial refund: walk units_source in REVERSE (allowance was appended last,
-- credits first) so decreases give back the most-recently-charged units first.
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
      new_sources := entry || new_sources;   -- rebuild preserving order
    end if;
  end loop;

  update public.requests set units_source = new_sources where id = p_request_id;
end $$;

-- SQL twin of packages/shared countUnits (anti-drift test keeps them honest).
create or replace function core.count_units(p_rules jsonb, p_bags jsonb)
returns int
language plpgsql immutable
as $$
declare
  max_small int := (p_rules ->> 'max_small_bags_per_unit')::int;
  mult int := (p_rules ->> 'oversized_multiplier')::int;
  four_six int := (p_rules ->> 'small_4to6_units')::int;
  large int := greatest(0, floor(coalesce((p_bags ->> 'large_bags')::numeric, 0)))::int;
  small int := greatest(0, floor(coalesce((p_bags ->> 'small_bags')::numeric, 0)))::int;
  oversized int := greatest(0, floor(coalesce((p_bags ->> 'oversized_bags')::numeric, 0)))::int;
  overweight boolean := coalesce((p_bags ->> 'small_group_overweight')::boolean, false);
  units int;
  small_units int;
begin
  units := large + oversized * mult;
  if small > 0 then
    if small <= max_small then small_units := 1;
    elsif small <= 2 * max_small then small_units := four_six;
    else small_units := ceil(small::numeric / max_small)::int;
    end if;
    if overweight then small_units := small_units * mult; end if;
    units := units + small_units;
  end if;
  return units;
end $$;

-- ── leak decline (photo required; refund; NO strike) ────────────────────────

create or replace function api.register_leak_photo(p_request_id uuid, p_storage_path text)
returns uuid
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare pid uuid;
begin
  if auth.uid() is null then perform core.raise_error('not_authorized'); end if;
  insert into public.photos (owner_id, request_id, kind, storage_path, delete_after)
  values (auth.uid(), p_request_id, 'leak', p_storage_path,
          current_date + core.cfg_int('photo_retention_days'))
  returning id into pid;
  return pid;
end $$;

create or replace function api.decline_leak(p_claim_id uuid, p_photo_path text)
returns public.requests
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare c public.claims; req public.requests;
begin
  select * into c from public.claims
   where id = p_claim_id and picker_id = auth.uid() and status = 'active'
   for update;
  if not found then perform core.raise_error('not_found'); end if;

  if p_photo_path is null or not exists (
    select 1 from public.photos
     where storage_path = p_photo_path and owner_id = auth.uid() and request_id = c.request_id
  ) then
    perform core.raise_error('photo_required');
  end if;

  req := core.transition_request(c.request_id, 'claimed', 'declined_leak', 'picker',
           jsonb_build_object('photo', p_photo_path));

  update public.claims set status = 'declined_leak', leak_photo_path = p_photo_path where id = c.id;

  -- resident made whole automatically, no charge, and the picker gets NO strike
  perform core.refund_units(req.id, req.resident_id, req.units_source);
  perform core.notify(req.resident_id, 'push.request_leak', jsonb_build_object('request_id', req.id));
  return req;
end $$;

-- ── bin-QR verification → paid + payout line (one scan closes the stop) ─────

create or replace function api.verify_bin_scan(p_claim_id uuid, p_qr_payload text)
returns jsonb
language plpgsql security definer
set search_path = api, core, public, pg_temp
as $$
declare
  c public.claims;
  sibling public.claims;
  req public.requests;
  b public.buildings;
  line_units int;
  line_amount int;
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

  -- every collected claim in this group completes with the single scan
  for sibling in
    select cl.* from public.claims cl
      join public.requests r on r.id = cl.request_id
     where cl.claim_group_id = c.claim_group_id
       and cl.picker_id = auth.uid()
       and cl.status = 'active'
       and r.status = 'collected'
     for update
  loop
    perform core.transition_request(sibling.request_id, 'collected', 'verified', 'picker',
      jsonb_build_object('qr', b.bin_qr_id));
    perform core.transition_request(sibling.request_id, 'verified', 'paid', 'system',
      jsonb_build_object('claim_id', sibling.id));

    line_units := coalesce(sibling.units_collected,
                           (select units_requested from public.requests where id = sibling.request_id));
    line_amount := line_units * (sibling.payout_per_unit_agorot + sibling.payout_boost_agorot);

    insert into public.payout_lines
      (claim_id, request_id, picker_id, units, per_unit_agorot, boost_agorot, amount_agorot)
    values
      (sibling.id, sibling.request_id, auth.uid(), line_units,
       sibling.payout_per_unit_agorot, sibling.payout_boost_agorot, line_amount);

    update public.claims set status = 'completed', verified_at = now() where id = sibling.id;

    perform core.notify((select resident_id from public.requests where id = sibling.request_id),
      'push.request_done', jsonb_build_object('request_id', sibling.request_id));

    total_units := total_units + line_units;
    total_amount := total_amount + line_amount;
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

-- ── no-show lapse worker ────────────────────────────────────────────────────

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
    else
      -- collected-but-never-scanned etc: release quietly; admin board surfaces it
      update public.claims set status = 'lapsed' where id = c.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- fold the lapse pass into the minutely tick
create or replace function internal.tick_minutely()
returns jsonb
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
begin
  return jsonb_build_object(
    'expired', internal.expire_requests(),
    'lapsed', internal.lapse_claims()
  );
end $$;

-- ── admin manual dispatch (the future backstop lever) ───────────────────────

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

  perform core.notify(p_picker_id, 'push.requests_nearby', jsonb_build_object('count', 1));
  return jsonb_build_object('claim_id', c.id);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────
grant execute on function
  api.register_picker(date, text, text, boolean, jsonb, text),
  api.admin_verify_picker(uuid, boolean),
  api.set_picker_availability(boolean),
  api.open_feed(numeric, numeric),
  api.claim_request(uuid),
  api.release_claim(uuid),
  api.approve_pickup(uuid),
  api.decline_eta(uuid),
  api.confirm_bag_out(uuid),
  api.reveal_entry_code(uuid),
  api.mark_collected(uuid, jsonb),
  api.register_leak_photo(uuid, text),
  api.decline_leak(uuid, text),
  api.verify_bin_scan(uuid, text),
  api.admin_assign_request(uuid, uuid)
to authenticated;
