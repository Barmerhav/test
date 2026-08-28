import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["supabase/tests/**/*.test.ts"],
    environment: "node",
    globalSetup: "supabase/tests/global-setup.ts",
    // DB suites share one database; run files sequentially, tests use unique users
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
