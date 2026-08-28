#!/bin/bash
# Web-session bootstrap: pnpm deps + the plain-PG16 DB test harness.
# Local machines use the real Supabase stack instead (see HANDOFF.md / README.md).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

pnpm install

# Docker image pulls are blocked in web containers, so `supabase start` is not
# an option: pnpm test:db runs against a local Postgres 16 with pg_cron
# preloaded (postgres/postgres @ 127.0.0.1:5432, DB pinui_test).
if ! dpkg -s postgresql-16-cron >/dev/null 2>&1; then
  apt-get install -y -qq postgresql-16 postgresql-16-cron \
    || { apt-get update -qq; apt-get install -y -qq postgresql-16 postgresql-16-cron; }
fi

PGCONF=/etc/postgresql/16/main/postgresql.conf
if ! grep -q "shared_preload_libraries = 'pg_cron'" "$PGCONF"; then
  printf "shared_preload_libraries = 'pg_cron'\ncron.database_name = 'pinui_test'\n" >> "$PGCONF"
fi

# restart, not start-if-stopped: apt may have auto-started the cluster before
# the pg_cron conf above was appended
pg_ctlcluster 16 main stop 2>/dev/null || true
pg_ctlcluster 16 main start
su postgres -c "psql -qc \"alter user postgres password 'postgres'\""

bash scripts/ci-db-reset.sh pinui_test
