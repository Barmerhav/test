import { describe, expect, it } from "vitest";
import {
  CONFIG_KEYS,
  configEntries,
  getConfig,
  parseConfigValue,
} from "../src/config/schema";

describe("config schemas", () => {
  it("every seed default validates against its own schema", () => {
    for (const key of CONFIG_KEYS) {
      expect(() => parseConfigValue(key, configEntries[key].default)).not.toThrow();
    }
  });

  it("every key has a non-empty description (shown in admin)", () => {
    for (const key of CONFIG_KEYS) {
      expect(configEntries[key].description.length).toBeGreaterThan(10);
    }
  });

  it("rejects malformed values", () => {
    expect(() => parseConfigValue("claim_to_scan_minutes", -5)).toThrow();
    expect(() => parseConfigValue("claim_to_scan_minutes", "45")).toThrow();
    expect(() => parseConfigValue("vat_rate", 18)).toThrow(); // rate, not percent
    expect(() =>
      parseConfigValue("unit_rules", { max_small_bags_per_unit: 3 }),
    ).toThrow(); // missing fields
    expect(() =>
      parseConfigValue("request_ttl_options", {
        options: [{ key: "x", cutoff: "25:99" }],
        default: "x",
      }),
    ).toThrow(); // bad HH:MM
  });

  it("getConfig returns typed values from a raw store", () => {
    const store = { claim_to_scan_minutes: 30 };
    expect(getConfig(store, "claim_to_scan_minutes")).toBe(30);
  });

  it("getConfig falls back to the seed default for missing keys", () => {
    expect(getConfig({}, "strikes_to_suspend")).toBe(3);
    expect(getConfig({}, "boost").enabled).toBe(false);
  });

  it("seed defaults match the product spec", () => {
    expect(getConfig({}, "picker_payout_per_unit_exvat")).toBe(7.0);
    expect(getConfig({}, "vat_rate")).toBe(0.18);
    expect(getConfig({}, "claim_to_scan_minutes")).toBe(45);
    expect(getConfig({}, "referral").monthly_stack_cap).toBe(6);
    expect(getConfig({}, "building_meter").tiers).toHaveLength(3);
    expect(getConfig({}, "kartisiya").enabled).toBe(false);
    expect(getConfig({}, "backstop").enabled).toBe(false);
    expect(getConfig({}, "request_ttl_options").default).toBe("today");
  });
});
