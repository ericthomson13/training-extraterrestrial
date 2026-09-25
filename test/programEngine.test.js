// Direct unit tests for programEngine.js's own behavior -- specifically the
// capability that's genuinely NEW versus the old ski-specific logic
// (variable-length periods) and therefore isn't exercised by
// program-parity.test.js, whose fixture data is 100% uniform 7-day weeks.
import { describe, expect, it } from "vitest";
import { currentPeriod, getSession, periodEnd, periodPhase, periodStart, sessionKeysFor } from "../public/programEngine.js";

const content = {
  displayName: "Test Program",
  startDate: "2026-01-05", // a Monday
  periods: [
    { n: 1, phase: "Intro", lengthDays: 3, deload: false }, // a short first period
    { n: 2, phase: "Build", lengthDays: 10, deload: false }, // a long second period
    { n: 3, phase: "Peak", lengthDays: 7, deload: true },
  ],
  ongoingPeriod: { phase: "Maintenance", startDate: "2026-02-01" },
  seedMaxes: {},
  testDefinitions: [],
  videos: {},
  circuits: {},
  activation: {},
  warmupTemplates: [],
  sessionTemplates: [
    { key: "A", title: "Period 1 only", scope: { type: "period", n: 1 }, warmupTemplate: null, noWarmupSpikes: false, testDayNote: null, isTest: false, items: [] },
    { key: "B", title: "Periods 2-3", scope: { type: "periodRange", periods: [2, 3] }, warmupTemplate: null, noWarmupSpikes: false, testDayNote: null, isTest: false, items: [{ name: "Ex", rx: { 2: "3×5", 3: "4×5" }, options: {} }] },
    { key: "M", title: "Maintenance", scope: { type: "ongoing" }, warmupTemplate: null, noWarmupSpikes: false, testDayNote: null, isTest: false, items: [] },
  ],
};

describe("programEngine: variable-length periods (cumulative walk, not division)", () => {
  it("computes period boundaries by summing lengthDays, not by dividing by a fixed 7", () => {
    // period 1: days 0-2 (3 days), period 2: days 3-12 (10 days), period 3: days 13-19 (7 days)
    expect(periodStart(content, 1)).toEqual(new Date(2026, 0, 5));
    expect(periodEnd(content, 1)).toEqual(new Date(2026, 0, 7));
    expect(periodStart(content, 2)).toEqual(new Date(2026, 0, 8));
    expect(periodEnd(content, 2)).toEqual(new Date(2026, 0, 17));
    expect(periodStart(content, 3)).toEqual(new Date(2026, 0, 18));
    expect(periodEnd(content, 3)).toEqual(new Date(2026, 0, 24));
  });

  it("resolves the correct current period for a date inside a short period", () => {
    expect(currentPeriod(content, new Date(2026, 0, 6))).toBe(1);
  });

  it("resolves the correct current period for a date inside a long period", () => {
    expect(currentPeriod(content, new Date(2026, 0, 15))).toBe(2);
  });

  it("resolves the correct current period right at a boundary", () => {
    expect(currentPeriod(content, new Date(2026, 0, 8))).toBe(2); // first day of period 2
    expect(currentPeriod(content, new Date(2026, 0, 18))).toBe(3); // first day of period 3
  });

  it("falls back to period 1 before the program starts", () => {
    expect(currentPeriod(content, new Date(2025, 11, 1))).toBe(1);
  });

  it("returns 'ongoing' once every period has elapsed", () => {
    expect(currentPeriod(content, new Date(2026, 0, 25))).toBe("ongoing");
  });

  it("reads the ongoing phase label from ongoingPeriod, not from a period entry", () => {
    expect(periodPhase(content, "ongoing")).toBe("Maintenance");
  });
});

describe("programEngine: scope resolution", () => {
  it("a 'period' scope only matches its exact period number", () => {
    expect(sessionKeysFor(content, 1)).toEqual(["A"]);
    expect(sessionKeysFor(content, 2)).toEqual(["B"]);
  });

  it("a 'periodRange' scope matches every period it lists", () => {
    expect(sessionKeysFor(content, 2)).toContain("B");
    expect(sessionKeysFor(content, 3)).toContain("B");
  });

  it("an 'ongoing' scope only matches the ongoing sentinel, never a period number", () => {
    expect(sessionKeysFor(content, "ongoing")).toEqual(["M"]);
    expect(sessionKeysFor(content, 1)).not.toContain("M");
  });

  it("resolves rx by period number for a periodRange session", () => {
    expect(getSession(content, 2, "B").items[0].rx).toBe("3×5");
    expect(getSession(content, 3, "B").items[0].rx).toBe("4×5");
  });

  it("a deload period ORs into noWarmupSpikes even when the template itself doesn't set it", () => {
    expect(getSession(content, 3, "B").noWarmupSpikes).toBe(true);
    expect(getSession(content, 2, "B").noWarmupSpikes).toBe(false);
  });
});
