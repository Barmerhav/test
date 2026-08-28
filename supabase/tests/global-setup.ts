import { execSync } from "node:child_process";

/**
 * Reset the test database before the DB suite.
 * - Plain-Postgres CI (this repo's default): scripts/ci-db-reset.sh
 * - Local Supabase stack: SKIP_DB_RESET=1 pnpm test:db  (after `supabase db reset`)
 */
export default function setup() {
  if (process.env.SKIP_DB_RESET === "1") return;
  execSync("bash scripts/ci-db-reset.sh pinui_test", { stdio: "inherit" });
}
