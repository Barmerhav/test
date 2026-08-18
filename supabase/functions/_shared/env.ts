import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

/** Mock-PSP webhook signing secret (local/sandbox only; real PSPs sign their own). */
export const MOCK_WEBHOOK_SECRET =
  Deno.env.get("MOCK_WEBHOOK_SECRET") ?? "local-dev-mock-webhook-secret";

/** service-role client — bypasses RLS; use ONLY for service_* RPCs + reads. */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

/** client bound to the calling user's JWT (RLS applies) */
export function userClient(req: Request): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}

export async function requireUser(req: Request): Promise<{ id: string }> {
  const { data, error } = await userClient(req).auth.getUser();
  if (error || !data.user) throw new HttpError(401, "not_authorized");
  return { id: data.user.id };
}

/** Read config keys fresh per invocation (service read; config has no secrets). */
export async function readConfig(keys: string[]): Promise<Record<string, unknown>> {
  const { data, error } = await serviceClient().from("config").select("key, value").in("key", keys);
  if (error) throw new HttpError(500, `config read failed: ${error.message}`);
  return Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
}

export async function readString(key: string, locale = "he"): Promise<string> {
  const { data } = await serviceClient()
    .from("strings")
    .select("locale, value")
    .eq("key", key)
    .in("locale", [locale, "he", "en"]);
  const rows = (data ?? []) as { locale: string; value: string }[];
  return (
    rows.find((r) => r.locale === locale)?.value ??
    rows.find((r) => r.locale === "he")?.value ??
    rows.find((r) => r.locale === "en")?.value ??
    `!${key}`
  );
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "internal" }, 500);
    }
  };
}

export function waitUntil(p: Promise<unknown>): void {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  else void p.catch((e) => console.error("background task failed", e));
}
