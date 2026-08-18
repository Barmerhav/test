/** Average weeks per calendar month — calendar arithmetic, not a business knob. */
export const WEEKS_PER_MONTH = 4.33;

export interface PlanLike {
  units_per_month: number;
}

/**
 * Smallest plan whose monthly units cover the household's estimated monthly
 * bag count (weekly midpoint × weeks-per-month). Falls back to the largest
 * plan when none is big enough.
 */
export function recommendPlan<T extends PlanLike>(
  plans: T[],
  weeklyBagsMidpoint: number,
): T | null {
  if (plans.length === 0) return null;
  const needed = Math.ceil(weeklyBagsMidpoint * WEEKS_PER_MONTH);
  const sorted = [...plans].sort((a, b) => a.units_per_month - b.units_per_month);
  const fit = sorted.find((p) => p.units_per_month >= needed);
  return fit ?? sorted[sorted.length - 1] ?? null;
}
