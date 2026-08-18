#!/usr/bin/env bash
# Recreate the CI validation database on a plain local Postgres 16 and apply
# shim + migrations + seeds. Mirrors `supabase db reset` for environments
# without Docker. Usage: scripts/ci-db-reset.sh [dbname]
set -euo pipefail

DB="${1:-pinui_test}"
PSQL="psql -v ON_ERROR_STOP=1 -q"
export PGHOST="${PGHOST:-/var/run/postgresql}"
export PGUSER="${PGUSER:-postgres}"

run_psql() { su postgres -c "PGHOST=$PGHOST $PSQL $*" 2>&1; }

echo "── recreating $DB"
su postgres -c "dropdb --if-exists --force $DB" >/dev/null 2>&1 || true
su postgres -c "createdb $DB" >/dev/null

echo "── shim"
su postgres -c "$PSQL -d $DB -f supabase/tests/shim.sql"

echo "── migrations"
for f in supabase/migrations/*.sql; do
  echo "   $f"
  su postgres -c "$PSQL -d $DB -f $f"
done

echo "── seeds"
for f in supabase/seeds/*.sql; do
  [ -e "$f" ] || continue
  echo "   $f"
  su postgres -c "$PSQL -d $DB -f $f"
done

echo "✓ $DB ready"
