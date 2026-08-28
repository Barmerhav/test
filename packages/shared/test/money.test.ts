import { describe, expect, it } from "vitest";
import {
  agorotToShekels,
  formatILS,
  netDisplayShekels,
  shekelsToAgorot,
  vatSplit,
} from "../src/money/index";

describe("money", () => {
  it("shekels ↔ agorot round-trips config seed values", () => {
    expect(shekelsToAgorot(42)).toBe(4200);
    expect(shekelsToAgorot(7.0)).toBe(700);
    expect(shekelsToAgorot(1.5)).toBe(150);
    expect(agorotToShekels(9300)).toBe(93);
  });

  it("vatSplit at 18% (murshe payout: 3 units × ₪7)", () => {
    const { exVat, vat, total } = vatSplit(2100, 0.18);
    expect(exVat).toBe(2100);
    expect(vat).toBe(378);
    expect(total).toBe(2478);
  });

  it("vatSplit rounds half-up on fractions", () => {
    expect(vatSplit(105, 0.18).vat).toBe(19); // 18.9 → 19
  });

  it("patur/none payout has zero VAT", () => {
    expect(vatSplit(2100, 0).vat).toBe(0);
    expect(vatSplit(2100, 0).total).toBe(2100);
  });

  it('netDisplay: ₪7.00 ex-VAT × 0.7143 shows as "₪5 נטו"', () => {
    expect(netDisplayShekels(7.0, 0.7143)).toBe(5);
  });

  it("formatILS wraps in LTR isolates and groups digits", () => {
    expect(formatILS(4200, { isolate: false })).toBe("₪42");
    expect(formatILS(123456700, { isolate: false })).toBe("₪1,234,567");
    expect(formatILS(4250, { isolate: false, withAgorot: true })).toBe("₪42.50");
    const isolated = formatILS(4200);
    expect(isolated.startsWith("⁦")).toBe(true);
    expect(isolated.endsWith("⁩")).toBe(true);
  });
});
