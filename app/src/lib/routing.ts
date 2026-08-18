import type { MyState } from "./types";

export interface RouteTarget {
  group: string;
  href: string;
}

/** Where a signed-in user belongs, given hydrated state. */
export function routeForState(st: MyState): RouteTarget {
  if (st.user?.default_mode === "picker") {
    return { group: "(picker)", href: "/(picker)/placeholder" };
  }
  if (!st.residency) {
    return { group: "(onboarding)", href: "/(onboarding)/address" };
  }
  if (!st.subscription) {
    return { group: "(onboarding)", href: "/(onboarding)/plan" };
  }
  return { group: "(resident)", href: "/(resident)" };
}
