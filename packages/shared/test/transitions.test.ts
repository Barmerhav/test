import { describe, expect, it } from "vitest";
import {
  REQUEST_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  canTransition,
} from "../src/state/transitions";

describe("request state machine map", () => {
  it("happy path is fully connected for the right roles", () => {
    expect(canTransition("submitted", "open", "system")).toBe(true);
    expect(canTransition("open", "claimed", "picker")).toBe(true);
    expect(canTransition("claimed", "collected", "picker")).toBe(true);
    expect(canTransition("collected", "verified", "picker")).toBe(true);
    expect(canTransition("verified", "paid", "system")).toBe(true);
  });

  it("confirm-first detour exists", () => {
    expect(canTransition("claimed", "resident_approval", "system")).toBe(true);
    expect(canTransition("resident_approval", "put_out_prompt", "resident")).toBe(true);
    expect(canTransition("put_out_prompt", "claimed", "resident")).toBe(true);
  });

  it("role gating: residents cannot claim, pickers cannot approve", () => {
    expect(canTransition("open", "claimed", "resident")).toBe(false);
    expect(canTransition("resident_approval", "put_out_prompt", "picker")).toBe(false);
  });

  it("terminal states have no outgoing edges", () => {
    for (const s of TERMINAL_STATUSES) {
      expect(TRANSITIONS.filter((t) => t.from === s)).toHaveLength(0);
    }
  });

  it("no illegal shortcuts", () => {
    expect(canTransition("open", "paid", "system")).toBe(false);
    expect(canTransition("open", "collected", "picker")).toBe(false);
    expect(canTransition("claimed", "verified", "picker")).toBe(false);
    expect(canTransition("expired", "open", "picker")).toBe(false);
  });

  it("every status referenced by a transition is declared", () => {
    for (const t of TRANSITIONS) {
      expect(REQUEST_STATUSES).toContain(t.from);
      expect(REQUEST_STATUSES).toContain(t.to);
    }
  });
});
