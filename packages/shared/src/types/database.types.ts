/**
 * PLACEHOLDER — regenerate with `pnpm gen:types` against a running local
 * Supabase stack (`supabase start`). Kept minimal so packages compile before
 * first generation; app/admin code uses hand-written row interfaces until the
 * generated file lands.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: { Tables: Record<string, never>; Views: Record<string, never>; Functions: Record<string, never> };
  api: { Tables: Record<string, never>; Views: Record<string, never>; Functions: Record<string, never> };
}
