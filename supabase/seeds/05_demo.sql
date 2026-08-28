-- ============================================================================
-- Demo mode: one seeded building + demo users matching config.toml's
-- [auth.sms.test_otp] phones, so the e2e script (and a human with the app)
-- can run the full two-sided loop locally with fake OTPs.
--   residents 97250100000x (code 111111) · pickers 97250200000x (222222)
--   admin 972503000001 (333333) — also gets email/password login for /admin:
--   admin@pinui.local / pinui-admin-local
-- ============================================================================

-- demo auth users: works on both GoTrue's auth.users and the CI shim
create or replace function pg_temp.seed_auth_user(p_id uuid, p_phone text, p_email text default null)
returns void language plpgsql as $$
declare has_aud boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'aud'
  ) into has_aud;

  if has_aud then
    insert into auth.users
      (instance_id, id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at,
       encrypted_password, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at, confirmation_token, recovery_token,
       email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token)
    values
      ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
       p_phone, now(), p_email, case when p_email is null then null else now() end,
       case when p_email is null then null else extensions.crypt('pinui-admin-local', extensions.gen_salt('bf')) end,
       case when p_email is null then '{"provider":"phone","providers":["phone"]}'::jsonb
            else '{"provider":"email","providers":["email","phone"]}'::jsonb end,
       '{}'::jsonb, now(), now(), '', '', '', '', '', '', '')
    on conflict (id) do nothing;
    -- GoTrue needs an identities row for email/password login
    if p_email is not null and to_regclass('auth.identities') is not null then
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
      values (gen_random_uuid(), p_id, p_id::text,
              jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
              'email', now(), now(), now())
      on conflict do nothing;
    end if;
  else
    insert into auth.users (id, phone, email) values (p_id, p_phone, p_email)
    on conflict (id) do nothing;
  end if;
end $$;

do $$
declare
  res1 uuid := 'd0000000-0000-4000-8000-000000000001';
  res2 uuid := 'd0000000-0000-4000-8000-000000000002';
  res3 uuid := 'd0000000-0000-4000-8000-000000000003';
  res4 uuid := 'd0000000-0000-4000-8000-000000000004';
  res5 uuid := 'd0000000-0000-4000-8000-000000000005';
  pick1 uuid := 'd0000000-0000-4000-8000-000000000101';
  pick2 uuid := 'd0000000-0000-4000-8000-000000000102';
  pick3 uuid := 'd0000000-0000-4000-8000-000000000103';
  adm  uuid := 'd0000000-0000-4000-8000-000000000201';
  bld uuid;
  plan_m uuid;
  r uuid;
  i int;
  ids uuid[] := array['d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',
                      'd0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004',
                      'd0000000-0000-4000-8000-000000000005'];
begin
  perform pg_temp.seed_auth_user(res1, '972501000001');
  perform pg_temp.seed_auth_user(res2, '972501000002');
  perform pg_temp.seed_auth_user(res3, '972501000003');
  perform pg_temp.seed_auth_user(res4, '972501000004');
  perform pg_temp.seed_auth_user(res5, '972501000005');
  perform pg_temp.seed_auth_user(pick1, '972502000001');
  perform pg_temp.seed_auth_user(pick2, '972502000002');
  perform pg_temp.seed_auth_user(pick3, '972502000003');
  perform pg_temp.seed_auth_user(adm,  '972503000001', 'admin@pinui.local');

  -- names (the handle_new_user trigger already created public.users rows)
  update public.users set full_name = 'דנה דיירת'   where id = res1;
  update public.users set full_name = 'יוסי שכן'    where id = res2;
  update public.users set full_name = 'מיכל קומה ג' where id = res3;
  update public.users set full_name = 'אורח חד-פעמי' where id = res4;
  update public.users set full_name = 'נועה חדשה'   where id = res5;
  update public.users set full_name = 'רון מפנה'    where id = pick1;
  update public.users set full_name = 'שירה מפנה'   where id = pick2;
  update public.users set full_name = 'עידו ממתין'  where id = pick3;
  update public.users set full_name = 'המייסד/ת'    where id = adm;

  insert into public.admin_users (user_id, role) values (adm, 'owner')
  on conflict (user_id) do nothing;

  -- the demo building (known bin QR for the e2e scan)
  insert into public.buildings (city, street, house_number, lat, lng, entry_code_enc, bin_qr_id, bin_location_note)
  values ('תל אביב', 'רחוב הדוגמה', '12', 32.0743, 34.7749,
          core.encrypt_entry_code('2468#'), 'BIN-DEMO-0001', 'חניון, מימין לשער')
  on conflict (city, street, house_number) do nothing;
  select id into bld from public.buildings where bin_qr_id = 'BIN-DEMO-0001';

  for i in 1..5 loop
    insert into public.residencies (user_id, building_id, floor, apartment)
    values (ids[i], bld, i, (i * 3)::text)
    on conflict (user_id, building_id, apartment) do nothing;
  end loop;

  -- residents 1-3: active M subscriptions (activation normally flows through
  -- settle_charge; the seed shortcuts to a believable steady state)
  select id into plan_m from public.plans where code = 'M' and version = 1;
  for i in 1..3 loop
    insert into public.payment_methods (user_id, provider, provider_token, brand, last4)
    values (ids[i], 'mock', 'mock_tok_demo_' || i, 'Visa', '4242');
    select res.id into r from public.residencies res where res.user_id = ids[i] and res.building_id = bld;
    insert into public.subscriptions
      (user_id, residency_id, plan_id, status, bag_format, billing_anchor_day,
       current_period_start, next_reset_at, current_period_end, units_included, units_used)
    values
      (ids[i], r, plan_m, 'active', 'large',
       least(extract(day from now())::int, 28),
       now(), core.next_reset_at(least(extract(day from now())::int, 28)::smallint, now()),
       core.next_reset_at(least(extract(day from now())::int, 28)::smallint, now()), 6, 0);
  end loop;

  -- pickers 1-2 verified/active; picker 3 stays in the verification queue
  insert into public.pickers (user_id, status, birthdate, id_number_hash, tax_status, vat_id,
                              poa_consent_at, poa_version, bank_details, verified_at)
  values
    (pick1, 'active', '1992-04-12',
     encode(extensions.digest('demo-1' || core.get_secret('id_hash_salt'), 'sha256'), 'hex'),
     'patur', null, now(), core.cfg_text('poa_version'),
     '{"bank":"12","branch":"345","account":"111111"}'::jsonb, now()),
    (pick2, 'active', '1988-09-30',
     encode(extensions.digest('demo-2' || core.get_secret('id_hash_salt'), 'sha256'), 'hex'),
     'murshe', '512345678', now(), core.cfg_text('poa_version'),
     '{"bank":"10","branch":"800","account":"222222"}'::jsonb, now()),
    (pick3, 'pending_verification', '2000-01-15',
     encode(extensions.digest('demo-3' || core.get_secret('id_hash_salt'), 'sha256'), 'hex'),
     'none', null, now(), core.cfg_text('poa_version'), null, null)
  on conflict (user_id) do nothing;
end $$;
