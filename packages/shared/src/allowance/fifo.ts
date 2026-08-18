/**
 * Pure mirror of the DB's unit-funding logic (`core.consume_units`):
 * bag credits first — FIFO by soonest expiry (NULL expiry last) — then the
 * subscription allowance. Used by unit tests to cross-check the SQL.
 */

export interface CreditRow {
  id: string;
  unitsGranted: number;
  unitsConsumed: number;
  /** ISO timestamp or null (never expires) */
  expiresAt: string | null;
  grantedAt: string;
}

export interface FundingPlan {
  creditConsumptions: { creditId: string; units: number }[];
  allowanceUnits: number;
}

export class InsufficientAllowanceError extends Error {
  constructor(public readonly missingUnits: number) {
    super("insufficient_allowance");
  }
}

export function creditFifoOrder(credits: CreditRow[]): CreditRow[] {
  return [...credits].sort((a, b) => {
    if (a.expiresAt === null && b.expiresAt === null)
      return a.grantedAt.localeCompare(b.grantedAt);
    if (a.expiresAt === null) return 1;
    if (b.expiresAt === null) return -1;
    const byExpiry = a.expiresAt.localeCompare(b.expiresAt);
    return byExpiry !== 0 ? byExpiry : a.grantedAt.localeCompare(b.grantedAt);
  });
}

export function planFunding(
  unitsNeeded: number,
  activeCredits: CreditRow[],
  allowanceRemaining: number,
  now: Date = new Date(),
): FundingPlan {
  if (!Number.isInteger(unitsNeeded) || unitsNeeded <= 0) {
    throw new Error("unitsNeeded must be a positive integer");
  }
  const nowIso = now.toISOString();
  const usable = creditFifoOrder(activeCredits).filter(
    (c) =>
      c.unitsConsumed < c.unitsGranted &&
      (c.expiresAt === null || c.expiresAt > nowIso),
  );

  let remaining = unitsNeeded;
  const creditConsumptions: { creditId: string; units: number }[] = [];
  for (const c of usable) {
    if (remaining === 0) break;
    const available = c.unitsGranted - c.unitsConsumed;
    const take = Math.min(available, remaining);
    creditConsumptions.push({ creditId: c.id, units: take });
    remaining -= take;
  }

  const allowanceUnits = Math.min(remaining, allowanceRemaining);
  remaining -= allowanceUnits;

  if (remaining > 0) throw new InsufficientAllowanceError(remaining);
  return { creditConsumptions, allowanceUnits };
}

/**
 * Next billing-anchor reset after `from`, clamping the anchor day to month
 * length WITHOUT drifting the anchor (Jan 31 → Feb 28/29 → Mar 31).
 * Mirrors `core.next_reset_at` in SQL. Pure calendar math in UTC.
 */
export function nextResetAt(anchorDay: number, from: Date): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth(); // 0-based
  const nextMonth = m === 11 ? 0 : m + 1;
  const nextYear = m === 11 ? y + 1 : y;
  const daysInNext = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const day = Math.min(anchorDay, daysInNext);
  return new Date(
    Date.UTC(nextYear, nextMonth, day,
      from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds()),
  );
}
