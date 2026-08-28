/**
 * Request lifecycle — TypeScript mirror of the DB seed table
 * `core.request_transitions` (the transition engine's source of truth).
 * `supabase/tests/state-machine.test.ts` asserts the two stay in sync.
 *
 * Normal flow:  submitted → open → claimed → collected → verified → paid
 * Confirm-first inserts: claimed → resident_approval → put_out_prompt → claimed
 * Alt ends: expired · declined_leak · noshow (only when noshow_action.repost=false) · canceled
 */

export const REQUEST_STATUSES = [
  "submitted",
  "open",
  "claimed",
  "resident_approval",
  "put_out_prompt",
  "collected",
  "verified",
  "paid",
  "expired",
  "declined_leak",
  "noshow",
  "canceled",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type ActorRole = "resident" | "picker" | "system" | "admin";

export interface Transition {
  from: RequestStatus;
  to: RequestStatus;
  roles: ActorRole[];
  note: string;
}

export const TRANSITIONS: Transition[] = [
  { from: "submitted", to: "open", roles: ["system"], note: "momentary — posted to pool in the submit tx" },

  { from: "open", to: "claimed", roles: ["picker", "admin"], note: "claim (soft lock); admin = manual dispatch" },
  { from: "open", to: "expired", roles: ["system"], note: "TTL passed unclaimed → credit per expiry_action" },
  { from: "open", to: "canceled", roles: ["resident", "admin"], note: "resident withdraws before claim; units refunded" },

  { from: "claimed", to: "resident_approval", roles: ["system"], note: "confirm-first only: auto after claim" },
  { from: "claimed", to: "collected", roles: ["picker"], note: "per-unit checklist done at the door" },
  { from: "claimed", to: "open", roles: ["picker", "system", "admin"], note: "voluntary release OR no-show repost" },
  { from: "claimed", to: "noshow", roles: ["system", "admin"], note: "no-show terminal (only when noshow_action.repost=false)" },
  { from: "claimed", to: "declined_leak", roles: ["picker"], note: "leaking bag; photo required; refund, no strike" },

  { from: "resident_approval", to: "put_out_prompt", roles: ["resident"], note: "resident approves picker ETA" },
  { from: "resident_approval", to: "open", roles: ["resident", "system"], note: "resident declines ETA (claim released, no strike) or approval timeout" },

  { from: "put_out_prompt", to: "claimed", roles: ["resident"], note: "bag confirmed outside; claim timer starts NOW" },
  { from: "put_out_prompt", to: "canceled", roles: ["resident", "admin"], note: "resident bails; units refunded" },
  { from: "put_out_prompt", to: "open", roles: ["system"], note: "claim window lapsed while waiting for the resident — release without strike" },

  { from: "collected", to: "verified", roles: ["picker", "system"], note: "bin QR scanned; system = auto-complete after scan_grace_minutes" },
  { from: "verified", to: "paid", roles: ["system"], note: "payout line written (same tx as verify)" },
];

export function canTransition(
  from: RequestStatus,
  to: RequestStatus,
  role: ActorRole,
): boolean {
  if (role === "admin") {
    // admin may drive any seeded edge; force_transition (audited) bypasses the matrix entirely
    return TRANSITIONS.some((t) => t.from === from && t.to === to);
  }
  return TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.roles.includes(role),
  );
}

export const TERMINAL_STATUSES: RequestStatus[] = [
  "paid",
  "expired",
  "declined_leak",
  "noshow",
  "canceled",
];

export const ACTIVE_FOR_RESIDENT: RequestStatus[] = [
  "open",
  "claimed",
  "resident_approval",
  "put_out_prompt",
  "collected",
  "verified",
];
