/**
 * Mock-now / PSP-later payment calls. Everything goes through the `payments`
 * edge function with the user's access token; settlement arrives via webhook,
 * so after a charge we poll api.get_my_state until the subscription flips.
 */
import { SUPABASE_URL, supabase } from "./supabase";
import type { BagFormat, MyState } from "./types";

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("not_authorized");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`payments_http_${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export interface CardToken {
  token: string;
  brand: string;
  last4: string;
}

/** Mock tokenization — returns instantly from the mock provider. */
export async function tokenizeCard(): Promise<CardToken> {
  const out = await post({ action: "tokenize" });
  return {
    token: String(out.token ?? ""),
    brand: String(out.brand ?? "mock"),
    last4: String(out.last4 ?? "0000"),
  };
}

/** Kick off the subscription charge. Response is {status:'pending'}. */
export async function payForSubscription(
  subscriptionId: string,
): Promise<Record<string, unknown>> {
  return post({ action: "charge_subscription", subscription_id: subscriptionId });
}

/** Order an extra bag roll (config `extra_roll` gates the UI). */
export async function chargeExtraRoll(
  format: BagFormat,
): Promise<Record<string, unknown>> {
  return post({ action: "charge_extra_roll", format });
}

/**
 * Poll api.get_my_state until subscription.status === 'active'
 * (mock webhook settles within a couple of seconds; cap ~15s).
 */
export async function waitForSubscriptionActive(maxSeconds = 15): Promise<boolean> {
  for (let i = 0; i < maxSeconds; i += 1) {
    const { data, error } = await supabase.schema("api").rpc("get_my_state");
    if (!error) {
      const st = data as MyState | null;
      if (st?.subscription?.status === "active") return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}
