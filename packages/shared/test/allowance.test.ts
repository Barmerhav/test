import { describe, expect, it } from "vitest";
import {
  InsufficientAllowanceError,
  creditFifoOrder,
  nextResetAt,
  planFunding,
  type CreditRow,
} from "../src/allowance/fifo";

const T = (s: string) => new Date(s);

function credit(id: string, granted: number, consumed: number, expiresAt: string | null, grantedAt = "2026-01-01T00:00:00Z"): CreditRow {
  return { id, unitsGranted: granted, unitsConsumed: consumed, expiresAt, grantedAt };
}

describe("credit FIFO funding", () => {
  it("consumes credits before allowance", () => {
    const plan = planFunding(2, [credit("a", 3, 0, "2026-06-01T00:00:00Z")], 5, T("2026-02-01T00:00:00Z"));
    expect(plan.creditConsumptions).toEqual([{ creditId: "a", units: 2 }]);
    expect(plan.allowanceUnits).toBe(0);
  });

  it("orders by soonest expiry, NULL last, then grant date", () => {
    const order = creditFifoOrder([
      credit("never", 1, 0, null, "2026-01-01T00:00:00Z"),
      credit("late", 1, 0, "2026-09-01T00:00:00Z"),
      credit("soon", 1, 0, "2026-03-01T00:00:00Z"),
      credit("never-older", 1, 0, null, "2025-12-01T00:00:00Z"),
    ]).map((c) => c.id);
    expect(order).toEqual(["soon", "late", "never-older", "never"]);
  });

  it("spans multiple credits then falls through to allowance", () => {
    const plan = planFunding(
      5,
      [credit("a", 2, 1, "2026-03-01T00:00:00Z"), credit("b", 2, 0, "2026-04-01T00:00:00Z")],
      10,
      T("2026-02-01T00:00:00Z"),
    );
    expect(plan.creditConsumptions).toEqual([
      { creditId: "a", units: 1 },
      { creditId: "b", units: 2 },
    ]);
    expect(plan.allowanceUnits).toBe(2);
  });

  it("skips expired and exhausted credits", () => {
    const plan = planFunding(
      1,
      [credit("expired", 5, 0, "2026-01-15T00:00:00Z"), credit("used-up", 2, 2, "2026-06-01T00:00:00Z")],
      1,
      T("2026-02-01T00:00:00Z"),
    );
    expect(plan.creditConsumptions).toEqual([]);
    expect(plan.allowanceUnits).toBe(1);
  });

  it("throws insufficient_allowance with the missing count", () => {
    try {
      planFunding(4, [credit("a", 1, 0, null)], 1, T("2026-02-01T00:00:00Z"));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientAllowanceError);
      expect((e as InsufficientAllowanceError).missingUnits).toBe(2);
    }
  });
});

describe("billing anchor (no drift, month-length clamp)", () => {
  it("Jan 31 → Feb 28 (non-leap)", () => {
    expect(nextResetAt(31, T("2026-01-31T08:00:00Z")).toISOString()).toBe("2026-02-28T08:00:00.000Z");
  });
  it("Jan 31 → Feb 29 (leap year)", () => {
    expect(nextResetAt(31, T("2028-01-31T08:00:00Z")).toISOString()).toBe("2028-02-29T08:00:00.000Z");
  });
  it("Feb 28 (anchor 31) → Mar 31 — anchor never drifts", () => {
    expect(nextResetAt(31, T("2026-02-28T08:00:00Z")).toISOString()).toBe("2026-03-31T08:00:00.000Z");
  });
  it("Dec → Jan year rollover", () => {
    expect(nextResetAt(15, T("2026-12-15T08:00:00Z")).toISOString()).toBe("2027-01-15T08:00:00.000Z");
  });
});
