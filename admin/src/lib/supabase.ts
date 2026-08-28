import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Fail loudly at boot — a silent misconfig would look like an auth bug.
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example)");
}

export const supabase = createClient(url, anonKey, {
  db: { schema: "public" },
});

/** RPCs live in the exposed `api` schema. */
export const rpc = createClient(url, anonKey, { db: { schema: "api" } });

// Share one auth session across both clients.
supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    void rpc.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
  }
});
