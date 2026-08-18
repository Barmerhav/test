/**
 * The unit-counting brain. Mirrored by `core.count_units` in SQL —
 * `supabase/tests/units-antidrift.test.ts` asserts the two agree across the
 * truth table. Change BOTH together.
 *
 * Rules (all values from the `unit_rules` config key, never hardcoded):
 * - 1 large bag                                   = 1 unit
 * - 1..max_small_bags_per_unit small bags (≤kg)   = 1 unit
 * - (max_small+1)..(2*max_small) small bags       = small_4to6_units units
 * - beyond that: ceil(smallBags / max_small)      (generalization)
 * - each oversized/overweight large bag           = oversized_multiplier units
 * - a small-bag group over max_kg_per_unit        = counted oversized
 */

export interface UnitRules {
  max_small_bags_per_unit: number;
  max_kg_per_unit: number;
  oversized_multiplier: number;
  small_4to6_units: number;
  max_units_per_request: number;
}

export interface BagCount {
  /** normal large bags (tied, within weight) */
  largeBags: number;
  /** small bags (grouped; ≤ max_small_bags_per_unit per unit) */
  smallBags: number;
  /** oversized or overweight large bags */
  oversizedBags: number;
  /** picker flagged the small-bag group as over the per-unit kg cap */
  smallGroupOverweight?: boolean;
}

export function countUnits(rules: UnitRules, bags: BagCount): number {
  const large = Math.max(0, Math.floor(bags.largeBags));
  const small = Math.max(0, Math.floor(bags.smallBags));
  const oversized = Math.max(0, Math.floor(bags.oversizedBags));

  let units = large; // 1 large bag = 1 unit
  units += oversized * rules.oversized_multiplier;

  if (small > 0) {
    let smallUnits: number;
    if (small <= rules.max_small_bags_per_unit) {
      smallUnits = 1;
    } else if (small <= 2 * rules.max_small_bags_per_unit) {
      smallUnits = rules.small_4to6_units;
    } else {
      smallUnits = Math.ceil(small / rules.max_small_bags_per_unit);
    }
    if (bags.smallGroupOverweight) {
      smallUnits *= rules.oversized_multiplier;
    }
    units += smallUnits;
  }

  return units;
}

/** Raw picker chip input from the collection screen. */
export interface ChipAdjustment {
  large_bags: number;
  small_bags: number;
  oversized_bags: number;
  small_group_overweight?: boolean;
}

export function unitsFromChips(rules: UnitRules, chips: ChipAdjustment): number {
  return countUnits(rules, {
    largeBags: chips.large_bags,
    smallBags: chips.small_bags,
    oversizedBags: chips.oversized_bags,
    smallGroupOverweight: chips.small_group_overweight,
  });
}
