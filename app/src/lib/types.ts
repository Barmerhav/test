/**
 * Hand-written row shapes for the RPC/table contract (the generated
 * database.types.ts in @pinui/shared is still a placeholder).
 */
import type { RequestStatus } from "@pinui/shared";

export type SubscriptionStatus =
  | "pending_payment"
  | "active"
  | "paused"
  | "past_due"
  | "canceled";

export type BagFormat = "large" | "small";
export type UserMode = "resident" | "picker";
export type Locale = "he" | "en";

export interface MyStateUser {
  id: string;
  phone: string;
  full_name: string | null;
  default_mode: UserMode;
  locale: Locale;
  confirm_first: boolean;
  referral_code: string;
}

export interface MyStatePlan {
  id: string;
  code: string;
  version: number;
  price_agorot: number;
  units_per_month: number;
}

export interface MySubscription {
  id: string;
  status: SubscriptionStatus;
  units_included: number;
  units_used: number;
  next_reset_at: string | null;
  bag_format: BagFormat;
  plan: MyStatePlan;
  /** a downgrade scheduled to apply at the next renewal (null = none) */
  pending_plan?: { id: string; code: string; units_per_month: number } | null;
  /** a newer active_for_signup version of the same plan code exists */
  newer_plan_version: boolean;
}

export interface RequestRow {
  id: string;
  status: RequestStatus;
  units_requested: number;
  units_final: number | null;
  ttl_option: string;
  expires_at: string;
  confirm_first: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MyResidency {
  id: string;
  floor: number | null;
  apartment: string | null;
  building_id: string;
  city: string;
  street: string;
  house_number: string;
  building_paused: boolean;
  has_entry_code: boolean;
  /** active subscriptions in the building (building meter) */
  meter_doors: number;
}

export type PickerStatus =
  | "pending_verification"
  | "active"
  | "suspended"
  | "rejected";

export type TaxStatus = "patur" | "murshe" | "none";

export interface MyPicker {
  status: PickerStatus;
  tax_status: TaxStatus;
  strikes: number;
  available: boolean;
}

export interface MyState {
  user: MyStateUser | null;
  subscription: MySubscription | null;
  credits_available: number;
  active_request: RequestRow | null;
  /** latest request row including terminal statuses */
  last_request: RequestRow | null;
  residency: MyResidency | null;
  picker: MyPicker | null;
}

export interface PlanRow {
  id: string;
  code: string;
  version: number;
  name_strings_key: string;
  price_agorot: number;
  units_per_month: number;
  bags_included: boolean;
  active_for_signup: boolean;
}

export interface BagRollRow {
  id: string;
  format: BagFormat;
  roll_count: number;
  source: string;
  status: "ordered" | "delivered";
  ordered_at: string;
  delivered_at: string | null;
}

export interface HistoryRequestRow {
  id: string;
  status: RequestStatus;
  units_requested: number;
  units_final: number | null;
  created_at: string;
}

// ── picker domain ─────────────────────────────────────────────────────────

export interface FeedRow {
  request_id: string;
  building_id: string;
  city: string;
  street: string;
  house_number: string;
  lat: number | null;
  lng: number | null;
  units: number;
  payout_agorot: number;
  expires_at: string;
  created_at: string;
  building_open_count: number;
  distance_m: number | null;
}

export type ClaimStatus =
  | "active"
  | "completed"
  | "lapsed"
  | "released"
  | "declined_leak";

export interface ClaimRow {
  id: string;
  request_id: string;
  claim_group_id: string;
  picker_id: string;
  status: ClaimStatus;
  claimed_at: string;
  deadline_at: string;
  payout_per_unit_agorot: number;
  payout_boost_agorot: number;
  collected_at: string | null;
  units_collected: number | null;
}

export interface ClaimResult {
  claim_group_id: string;
  claims: { claim_id: string; request_id: string }[];
  deadline_at: string;
}

export interface StopRequestRow {
  id: string;
  units_requested: number;
  notes: string | null;
  residency_id: string;
  building_id: string;
  status: RequestStatus;
}

export interface StopResidencyRow {
  id: string;
  floor: number | null;
  apartment: string | null;
  door_note: string | null;
}

export interface StopBuildingRow {
  id: string;
  street: string;
  house_number: string;
  city: string;
  lat: number | null;
  lng: number | null;
  bin_location_note: string | null;
}

export interface RevealResult {
  code: string | null;
  reveal_expires_at: string | null;
}

/** Raw picker chips passed to api.mark_collected (server recounts). */
export interface CollectAdjustment {
  large_bags: number;
  small_bags: number;
  oversized_bags: number;
  small_group_overweight?: boolean;
}

export interface VerifyResult {
  units: number;
  amount_agorot: number;
  today_total_agorot: number;
}

export interface PayoutLineRow {
  id: number;
  units: number;
  amount_agorot: number;
  created_at: string;
  payout_id: string | null;
}

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  total_agorot: number;
  pdf_path: string | null;
}
