/**
 * Stable RPC error codes raised by the DB (RAISE EXCEPTION ... message = code)
 * mapped to strings-table keys so every user-facing error is admin-editable.
 */

export const RPC_ERROR_CODES = [
  "already_claimed",
  "insufficient_allowance",
  "illegal_transition",
  "claim_expired",
  "claim_limit_reached",
  "building_paused",
  "service_disabled",
  "not_authorized",
  "not_found",
  "picker_not_active",
  "picker_suspended",
  "rate_limited",
  "invalid_qr",
  "photo_required",
  "underage",
  "invalid_units",
  "ttl_passed",
  "subscription_not_active",
  "feature_disabled",
  "config_validation_failed",
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export function stringsKeyForError(code: string): string {
  return (RPC_ERROR_CODES as readonly string[]).includes(code)
    ? `error.${code}`
    : "error.unknown";
}

/** Extract our stable code from a PostgREST/supabase-js error shape. */
export function rpcErrorCode(err: unknown): RpcErrorCode | "unknown" {
  const msg =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  const found = RPC_ERROR_CODES.find((c) => msg.includes(c));
  return found ?? "unknown";
}
