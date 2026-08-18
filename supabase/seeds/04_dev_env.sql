-- LOCAL / CI ONLY environment wiring. Production: set the entry_code_key
-- secret ONCE via the Supabase dashboard (Vault) — never in a migration or
-- seed that gets committed with a real value.

do $$
begin
  if to_regclass('vault.secrets') is not null then
    -- local Supabase stack: put the dev key in the real Vault
    if not exists (select 1 from vault.secrets where name = 'entry_code_key') then
      perform vault.create_secret('local-dev-entry-code-key-not-for-prod', 'entry_code_key');
    end if;
  else
    -- plain-Postgres CI: core.dev_secrets fallback (core schema is private)
    insert into core.dev_secrets (name, value)
    values ('entry_code_key', 'local-dev-entry-code-key-not-for-prod')
    on conflict (name) do nothing;
  end if;
end $$;

do $$
begin
  if to_regclass('vault.secrets') is not null then
    if not exists (select 1 from vault.secrets where name = 'id_hash_salt') then
      perform vault.create_secret('local-dev-id-salt-not-for-prod', 'id_hash_salt');
    end if;
  else
    insert into core.dev_secrets (name, value)
    values ('id_hash_salt', 'local-dev-id-salt-not-for-prod')
    on conflict (name) do nothing;
  end if;
end $$;

-- Private storage buckets (real Supabase only): leak photos (auto-expiring),
-- payout exports, self-billed invoices.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values
      ('leak-photos', 'leak-photos', false),
      ('exports', 'exports', false),
      ('invoices', 'invoices', false)
    on conflict (id) do nothing;
  end if;
end $$;

-- Storage RLS: pickers upload leak photos only into their own folder;
-- reads happen via short-lived signed URLs (service/admin generated).
do $$
begin
  if to_regclass('storage.objects') is not null then
    begin
      execute $pol$
        create policy leak_photos_own_folder on storage.objects
          for insert to authenticated
          with check (bucket_id = 'leak-photos'
                      and (storage.foldername(name))[1] = auth.uid()::text)
      $pol$;
    exception when duplicate_object then null;
    end;
    -- admins read exports/invoices/photos (signed URLs from the admin panel);
    -- pickers read their own invoices
    begin
      execute $pol$
        create policy admin_reads_ops_buckets on storage.objects
          for select to authenticated
          using (bucket_id in ('exports', 'invoices', 'leak-photos') and core.is_admin())
      $pol$;
    exception when duplicate_object then null;
    end;
    begin
      execute $pol$
        create policy picker_reads_own_invoice on storage.objects
          for select to authenticated
          using (bucket_id = 'invoices' and exists (
            select 1 from public.invoices_selfbilled i
             where i.pdf_path = storage.objects.name and i.picker_id = auth.uid()))
      $pol$;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
