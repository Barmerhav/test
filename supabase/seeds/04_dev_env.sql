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

-- Private storage bucket for leak-decline photos (real Supabase only).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('leak-photos', 'leak-photos', false)
    on conflict (id) do nothing;
  end if;
end $$;
