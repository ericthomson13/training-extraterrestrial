import { describe, expect, it } from "vitest";
import { findUpdateViolations, lockedPeriodNumbers } from "../functions/_lib/programLock.js";

function base(overrides = {}) {
  return {
    startDate: "2027-01-04", // periods: 1 = Jan 4-10, 2 = Jan 11-17, 3 = Jan 18-24
    units: "lb",
    periods: [
      { n: 1, phase: "Intro", lengthDays: 7 },
      { n: 2, phase: "Build", lengthDays: 7 },
      { n: 3, phase: "Peak", lengthDays: 7 },
    ],
    testDefinitions: [],
    videos: {},
    circuits: {},
    activation: {},
    warmupTemplates: [],
    sessionTemplates: [
      { key: "A", title: "Day A", scope: { type: "period", n: 1 }, items: [{ name: "Squat", rx: "3x5" }] },
      { key: "B", title: "Day B", scope: { type: "periodRange", periods: [2, 3] }, items: [{ name: "Bench", rx: { 2: "3x5", 3: "3x3" } }] },
    ],
    ...overrides,
  };
}

const NOW = new Date(2027, 0, 20); // Jan 20, 2027 -- inside period 3, so periods 1 and 2 are already-elapsed/locked

describe("lockedPeriodNumbers", () => {
  it("locks every period strictly before the current one", () => {
    expect(lockedPeriodNumbers(base(), NOW)).toEqual([1, 2]);
  });

  it("locks nothing before the program has started", () => {
    expect(lockedPeriodNumbers(base(), new Date(2026, 11, 1))).toEqual([]);
  });

  it("locks every numbered period once in the ongoing phase", () => {
    expect(lockedPeriodNumbers(base(), new Date(2027, 2, 1))).toEqual([1, 2, 3]);
  });
});

describe("findUpdateViolations", () => {
  it("allows an update that only changes future periods", () => {
    const updated = base();
    updated.sessionTemplates[1].items[0].rx = { 2: "3x5", 3: "4x3" }; // period 3 (future) changes, period 2 (locked) unchanged
    expect(findUpdateViolations(base(), updated, NOW)).toEqual([]);
  });

  it("allows extending the program with a brand-new future period", () => {
    const updated = base({ periods: [...base().periods, { n: 4, phase: "Taper", lengthDays: 7 }] });
    expect(findUpdateViolations(base(), updated, NOW)).toEqual([]);
  });

  it("rejects changing a locked period's phase", () => {
    const updated = base();
    updated.periods[0] = { ...updated.periods[0], phase: "Rewritten" };
    const violations = findUpdateViolations(base(), updated, NOW);
    expect(violations.some((v) => v.includes("period 1") && v.includes("cannot change"))).toBe(true);
  });

  it("rejects changing a locked period's session content (rx hidden inside a periodRange map)", () => {
    const updated = base();
    updated.sessionTemplates[1].items[0].rx = { 2: "5x5", 3: "3x3" }; // period 2 is locked
    const violations = findUpdateViolations(base(), updated, NOW);
    expect(violations.some((v) => v.includes("period 2") && v.includes("session B"))).toBe(true);
  });

  it("rejects removing a session from a locked period", () => {
    const updated = base({ sessionTemplates: [base().sessionTemplates[1]] }); // drops session A, which is in locked period 1
    const violations = findUpdateViolations(base(), updated, NOW);
    expect(violations.some((v) => v.includes("period 1") && v.includes("sessions cannot be added or removed"))).toBe(true);
  });

  it("rejects removing a locked period entirely", () => {
    const updated = base({ periods: base().periods.filter((p) => p.n !== 1), sessionTemplates: [base().sessionTemplates[1]] });
    const violations = findUpdateViolations(base(), updated, NOW);
    expect(violations.some((v) => v.includes("period 1") && v.includes("cannot be removed"))).toBe(true);
  });

  it("rejects a startDate change", () => {
    const violations = findUpdateViolations(base(), base({ startDate: "2027-02-01" }), NOW);
    expect(violations.some((v) => v.includes("startDate"))).toBe(true);
  });

  it("rejects a units change", () => {
    const violations = findUpdateViolations(base(), base({ units: "kg" }), NOW);
    expect(violations.some((v) => v.includes("units"))).toBe(true);
  });

  it("allows freely editing the ongoing phase even after it has started", () => {
    const withOngoing = base({
      periods: [{ n: 1, phase: "Intro", lengthDays: 7 }],
      ongoingPeriod: { phase: "In-season", startDate: "2027-01-11" },
      sessionTemplates: [{ key: "M", title: "Maintenance", scope: { type: "ongoing" }, items: [{ name: "Squat", rx: "2x5" }] }],
    });
    const updated = { ...withOngoing, sessionTemplates: [{ ...withOngoing.sessionTemplates[0], items: [{ name: "Squat", rx: "3x3" }] }] };
    expect(findUpdateViolations(withOngoing, updated, new Date(2027, 1, 1))).toEqual([]);
  });
});
