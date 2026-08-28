-- Seed plans (version 1). SEED DEFAULTS ONLY — the founder reprices/adds/
-- retires plans from the admin panel (api.admin_upsert_plan), which inserts
-- new version rows and never mutates these.
insert into public.plans (code, version, name_strings_key, price_agorot, units_per_month, bags_included)
values
  ('S', 1, 'plan.S.name', 4200, 3, true),
  ('M', 1, 'plan.M.name', 6900, 6, true),
  ('L', 1, 'plan.L.name', 9300, 9, true)
on conflict (code, version) do nothing;
