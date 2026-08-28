-- ============================================================================
-- 00055: operational tables — notification outbox, photos, rate limits,
-- bag rolls, local mock SMS log.
--
-- DB transitions never call HTTP: they insert into notification_outbox and
-- the notify-worker edge function drains it. params NEVER contain entry codes
-- or apartment-level addresses.
-- ============================================================================

create table public.notification_outbox (
  id           bigserial primary key,
  user_id      uuid not null references public.users (id) on delete cascade,
  channel      text not null default 'push' check (channel in ('push', 'sms')),
  template_key text not null,          -- strings key prefix, e.g. 'push.request_expired'
  params       jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts     int not null default 0,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  last_error   text
);
create index outbox_pending on public.notification_outbox (id) where status = 'pending';

create or replace function core.notify(
  p_user_id      uuid,
  p_template_key text,
  p_params       jsonb default '{}'::jsonb
) returns void
language sql volatile security definer
set search_path = core, public, pg_temp
as $$
  insert into public.notification_outbox (user_id, template_key, params)
  values (p_user_id, p_template_key, coalesce(p_params, '{}'::jsonb))
$$;

create table public.photos (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.users (id),
  request_id   uuid,                   -- FK added in 00070 (requests not created yet)
  kind         text not null default 'leak' check (kind in ('leak')),
  storage_path text not null unique,
  created_at   timestamptz not null default now(),
  delete_after date not null           -- created + cfg photo_retention_days
);
create index photos_reap on public.photos (delete_after);

-- App-level rate limiting enforced INSIDE RPCs (holds regardless of client).
create table public.rate_limits (
  bucket       text primary key,       -- e.g. 'claim:<uid>', 'reveal:<claim_id>'
  window_start timestamptz not null,
  count        int not null default 0
);

-- Fixed-window limiter; returns true when the call is allowed.
create or replace function core.rate_limit_ok(
  p_bucket         text,
  p_max            int,
  p_window_seconds int
) returns boolean
language plpgsql volatile security definer
set search_path = core, public, pg_temp
as $$
declare rl public.rate_limits;
begin
  insert into public.rate_limits (bucket, window_start, count)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set count        = case when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                            then 1 else public.rate_limits.count + 1 end,
        window_start = case when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                            then now() else public.rate_limits.window_start end
  returning * into rl;
  return rl.count <= p_max;
end $$;

create table public.bag_rolls (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id),
  format       text not null check (format in ('large', 'small')),
  roll_count   int not null,           -- bags per roll, snapshot of cfg('bag_formats') at grant
  source       text not null check (source in ('plan', 'extra_purchase', 'admin')),
  charge_id    uuid references public.charges (id),
  status       text not null default 'ordered' check (status in ('ordered', 'delivered')),
  ordered_at   timestamptz not null default now(),
  delivered_at timestamptz
);
create index bag_rolls_user on public.bag_rolls (user_id, ordered_at desc);

-- Local-dev sink for the mock SmsProvider (sms-hook edge fn writes here so
-- the e2e script/dev can read OTPs). Harmless and empty in production.
create table public.mock_sms_log (
  id      bigserial primary key,
  phone   text not null,
  body    text not null,
  sent_at timestamptz not null default now()
);

-- ── grants + RLS ────────────────────────────────────────────────────────────
grant select on public.bag_rolls, public.photos to authenticated;

alter table public.notification_outbox enable row level security;
alter table public.photos enable row level security;
alter table public.rate_limits enable row level security;
alter table public.bag_rolls enable row level security;
alter table public.mock_sms_log enable row level security;

create policy photos_owner on public.photos
  for select using (owner_id = auth.uid() or core.is_admin());
create policy bag_rolls_self on public.bag_rolls
  for select using (user_id = auth.uid() or core.is_admin());
-- outbox / rate_limits / mock_sms_log: service-role only (no policies at all)
