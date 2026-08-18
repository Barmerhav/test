#!/usr/bin/env bash
# Regenerate TypeScript types from the local Supabase stack after a migration.
# Requires `supabase start` (Docker). Commit the generated file.
set -euo pipefail
cd "$(dirname "$0")/.."
npx supabase gen types typescript --local --schema public --schema api \
  > packages/shared/src/types/database.types.ts
echo "wrote packages/shared/src/types/database.types.ts"
