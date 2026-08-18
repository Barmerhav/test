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
}

export interface MyState {
  user: MyStateUser | null;
  subscription: MySubscription | null;
  credits_available: number;
  active_request: RequestRow | null;
  residency: MyResidency | null;
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
