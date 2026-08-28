-- ============================================================================
-- 00060: bag-credits ledger. Credits (expiry/no-show/referral/meter/admin/
-- kartisiya) are a true ledger, consumed BEFORE the subscription allowance,
-- FIFO by soonest expiry. Refunds reverse exactly via requests.units_source.
-- ============================================================================

create table public.credits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id),
  units_granted  int not null check (units_granted > 0),
  units_consumed int not null default 0 check (units_consumed >= 0 and units_consumed <= units_granted),
  reason         text not null check (reason in
    ('expiry_comp', 'noshow_comp', 'referral', 'building_meter', 'admin_grant', 'kartisiya')),
  source_id      uuid,                 -- request / referral / award / charge id
  granted_at     timestamptz not null default now(),
  expires_at     timestamptz,          -- null = never
  status         text not null default 'active' check (status in ('active', 'exhausted', 'expired'))
);
create index credits_fifo on public.credits (user_id, expires_at asc nulls last, granted_at asc)
  where status = 'active';

create table public.credit_consumptions (
  id          bigserial primary key,
  credit_id   uuid not null references public.credits (id),
  request_id  uuid not null,           -- FK added in 00070
  units       int not null check (units > 0),
  consumed_at timestamptz not null default now()
);
create index credit_consumptions_request on public.credit_consumptions (request_id);

grant select on public.credits, public.credit_consumptions to authenticated;
alter table public.credits enable row level security;
alter table public.credit_consumptions enable row level security;

create policy credits_self on public.credits
  for select using (user_id = auth.uid() or core.is_admin());
create policy credit_consumptions_self on public.credit_consumptions
  for select using (
    core.is_admin() or exists (
      select 1 from public.credits c
       where c.id = credit_consumptions.credit_id and c.user_id = auth.uid())
  );

-- ── core ledger functions ───────────────────────────────────────────────────

create or replace function core.grant_credit(
  p_user_id    uuid,
  p_units      int,
  p_reason     text,
  p_source_id  uuid default null,
  p_expires_at timestamptz default null
) returns uuid
language plpgsql volatile security definer
set search_path = core, public, pg_temp
as $$
declare cid uuid;
begin
  if p_units <= 0 then return null; end if;
  insert into public.credits (user_id, units_granted, reason, source_id, expires_at)
  values (p_user_id, p_units, p_reason,  p_source_id,
          coalesce(p_expires_at, now() + make_interval(days => core.cfg_int('credit_expiry_days'))))
  returning id into cid;
  return cid;
end $$;

/**
 * Fund p_units for a request: credits first (FIFO by soonest expiry, row-
 * locked), then the subscription allowance (row-locked). Returns the exact
 * funding breakdown stored as requests.units_source:
 *   [{"type":"credit","credit_id":"…","units":n}, …, {"type":"allowance","units":n}]
 * Raises insufficient_allowance / subscription_not_active.
 */
create or replace function core.consume_units(
  p_user_id    uuid,
  p_units      int,
  p_request_id uuid
) returns jsonb
language plpgsql volatile security definer
set search_path = core, public, pg_temp
as $$
declare
  remaining int := p_units;
  sources jsonb := '[]'::jsonb;
  c record;
  take int;
  sub public.subscriptions;
  allowance_left int;
begin
  if p_units <= 0 then perform core.raise_error('invalid_units'); end if;

  -- credits first, FIFO by soonest expiry (never-expiring last)
  for c in
    select * from public.credits
     where user_id = p_user_id and status = 'active'
       and (expires_at is null or expires_at > now())
       and units_consumed < units_granted
     order by expires_at asc nulls last, granted_at asc
     for update
  loop
    exit when remaining = 0;
    take := least(c.units_granted - c.units_consumed, remaining);
    update public.credits
       set units_consumed = units_consumed + take,
           status = case when units_consumed + take >= units_granted then 'exhausted' else 'active' end
     where id = c.id;
    insert into public.credit_consumptions (credit_id, request_id, units)
    values (c.id, p_request_id, take);
    sources := sources || jsonb_build_object('type', 'credit', 'credit_id', c.id, 'units', take);
    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    select * into sub from public.subscriptions
     where user_id = p_user_id and status = 'active'
     for update;
    if not found then perform core.raise_error('subscription_not_active'); end if;

    allowance_left := sub.units_included - sub.units_used;
    if allowance_left < remaining then
      perform core.raise_error('insufficient_allowance');
    end if;

    update public.subscriptions set units_used = units_used + remaining where id = sub.id;
    sources := sources || jsonb_build_object('type', 'allowance', 'units', remaining);
    remaining := 0;
  end if;

  return sources;
end $$;

/**
 * Reverse a request's funding exactly (cancel / leak-decline). Credits get
 * their units back (re-activated if they were exhausted); allowance usage is
 * decremented with a floor of 0 (a monthly reset may have happened since).
 */
create or replace function core.refund_units(p_request_id uuid, p_user_id uuid, p_sources jsonb)
returns void
language plpgsql volatile security definer
set search_path = core, public, pg_temp
as $$
declare s jsonb;
begin
  for s in select * from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
  loop
    if s ->> 'type' = 'credit' then
      update public.credits
         set units_consumed = greatest(0, units_consumed - (s ->> 'units')::int),
             status = case when status = 'exhausted' then 'active' else status end
       where id = (s ->> 'credit_id')::uuid;
      delete from public.credit_consumptions
       where credit_id = (s ->> 'credit_id')::uuid and request_id = p_request_id;
    elsif s ->> 'type' = 'allowance' then
      update public.subscriptions
         set units_used = greatest(0, units_used - (s ->> 'units')::int)
       where user_id = p_user_id
         and status in ('active', 'paused', 'past_due');
    end if;
  end loop;
end $$;

-- Sum of usable credit units right now (for the HOME allowance ring).
create or replace function core.credits_available(p_user_id uuid)
returns int
language sql stable security definer
set search_path = core, public, pg_temp
as $$
  select coalesce(sum(units_granted - units_consumed), 0)::int
    from public.credits
   where user_id = p_user_id and status = 'active'
     and (expires_at is null or expires_at > now())
$$;

-- Daily worker: expire stale credits.
create or replace function internal.expire_credits()
returns int
language plpgsql volatile security definer
set search_path = internal, core, public, pg_temp
as $$
declare n int;
begin
  update public.credits
     set status = 'expired'
   where status = 'active' and expires_at is not null and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Admin override (zero-touch principle: admin CAN intervene, nothing waits on it).
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
  cid := core.grant_credit(p_user_id, p_units, 'admin_grant', null, null);
  insert into public.config_audit (key, old_value, new_value, old_version, new_version, changed_by, note)
  values ('credit_grant:' || p_user_id, null,
          jsonb_build_object('units', p_units, 'credit_id', cid), 0, 0, auth.uid(), p_note);
  return cid;
end $$;

grant execute on function api.admin_grant_credit(uuid, int, text) to authenticated;
