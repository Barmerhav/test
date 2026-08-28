import type { MyState } from "./types";

export interface RouteTarget {
  group: string;
  href: string;
}

/** Where a signed-in user belongs, given hydrated state. */
export function routeForState(st: MyState): RouteTarget {
  if (st.user?.default_mode === "picker") {
    if (!st.picker) return { group: "(picker)", href: "/(picker)/onboarding" };
    switch (st.picker.status) {
      case "active":
        return { group: "(picker)", href: "/(picker)/(tabs)" };
      case "pending_verification":
        return { group: "(picker)", href: "/(picker)/pending" };
      default: // suspended | rejected
        return { group: "(picker)", href: "/(picker)/blocked" };
    }
  }
  if (!st.residency) {
    return { group: "(onboarding)", href: "/(onboarding)/address" };
  }
  // pending_payment = abandoned checkout — the plan screen owns recovery
  // (it re-opens the PaymentSheet; picking a different plan restarts fresh).
  if (!st.subscription || st.subscription.status === "pending_payment") {
    // an on-demand (no-subscription) resident with a live request follows it
    // on HOME — the plan screen has nothing to show them mid-pickup
    if (st.active_request) {
      return { group: "(resident)", href: "/(resident)" };
    }
    return { group: "(onboarding)", href: "/(onboarding)/plan" };
  }
  return { group: "(resident)", href: "/(resident)" };
}
