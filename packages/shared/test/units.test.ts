import { describe, expect, it } from "vitest";
import { countUnits, unitsFromChips, type UnitRules } from "../src/units/countUnits";

const rules: UnitRules = {
  max_small_bags_per_unit: 3,
  max_kg_per_unit: 8,
  oversized_multiplier: 2,
  small_4to6_units: 2,
  max_units_per_request: 6,
};

/**
 * THE truth table. supabase/tests/units-antidrift.test.ts feeds the same rows
 * to core.count_units (SQL) and asserts identical results.
 */
export const UNIT_TRUTH_TABLE: Array<{
  name: string;
  bags: Parameters<typeof countUnits>[1];
  expected: number;
}> = [
  { name: "1 large = 1u", bags: { largeBags: 1, smallBags: 0, oversizedBags: 0 }, expected: 1 },
  { name: "3 large = 3u", bags: { largeBags: 3, smallBags: 0, oversizedBags: 0 }, expected: 3 },
  { name: "1 small = 1u", bags: { largeBags: 0, smallBags: 1, oversizedBags: 0 }, expected: 1 },
  { name: "3 small = 1u", bags: { largeBags: 0, smallBags: 3, oversizedBags: 0 }, expected: 1 },
  { name: "4 small = 2u", bags: { largeBags: 0, smallBags: 4, oversizedBags: 0 }, expected: 2 },
  { name: "6 small = 2u", bags: { largeBags: 0, smallBags: 6, oversizedBags: 0 }, expected: 2 },
  { name: "7 small = 3u (generalized ceil)", bags: { largeBags: 0, smallBags: 7, oversizedBags: 0 }, expected: 3 },
  { name: "oversized = 2u", bags: { largeBags: 0, smallBags: 0, oversizedBags: 1 }, expected: 2 },
  { name: "2 oversized = 4u", bags: { largeBags: 0, smallBags: 0, oversizedBags: 2 }, expected: 4 },
  { name: "1 large + 3 small = 2u", bags: { largeBags: 1, smallBags: 3, oversizedBags: 0 }, expected: 2 },
  { name: "1 large + 1 oversized + 2 small = 4u", bags: { largeBags: 1, smallBags: 2, oversizedBags: 1 }, expected: 4 },
  { name: "overweight small group (≤3 bags but >8kg) = 2u", bags: { largeBags: 0, smallBags: 2, oversizedBags: 0, smallGroupOverweight: true }, expected: 2 },
  { name: "overweight 4-small group = 4u", bags: { largeBags: 0, smallBags: 4, oversizedBags: 0, smallGroupOverweight: true }, expected: 4 },
  { name: "nothing = 0u", bags: { largeBags: 0, smallBags: 0, oversizedBags: 0 }, expected: 0 },
];

describe("countUnits truth table", () => {
  for (const row of UNIT_TRUTH_TABLE) {
    it(row.name, () => {
      expect(countUnits(rules, row.bags)).toBe(row.expected);
    });
  }

  it("clamps negatives and fractions", () => {
    expect(countUnits(rules, { largeBags: -2, smallBags: 2.9, oversizedBags: 0 })).toBe(1);
  });

  it("respects a different config (max_small=4, multiplier=3)", () => {
    const alt: UnitRules = { ...rules, max_small_bags_per_unit: 4, oversized_multiplier: 3 };
    expect(countUnits(alt, { largeBags: 0, smallBags: 4, oversizedBags: 0 })).toBe(1);
    expect(countUnits(alt, { largeBags: 0, smallBags: 0, oversizedBags: 1 })).toBe(3);
  });

  it("unitsFromChips maps the collection-screen shape", () => {
    expect(
      unitsFromChips(rules, { large_bags: 1, small_bags: 4, oversized_bags: 0 }),
    ).toBe(3);
  });
});
