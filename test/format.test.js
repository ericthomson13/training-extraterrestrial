import { describe, expect, it } from "vitest";
import { formatExportText } from "../functions/_lib/format.js";

describe("formatExportText", () => {
  it("matches the client's Copy for Claude shape: e1RM line, tests, session detail, notes", () => {
    const tests = [{ date: "2026-09-29", v: { squat: { load: 225, reps: 5, e1rm: 262 }, bw: 205 } }];
    const sessions = [
      {
        id: "s1",
        date: "2026-09-29",
        week: 1,
        key: "A",
        title: "Normalization",
        bw: "205",
        sore: 2,
        notes: "felt good",
        items: [{ name: "Back squat", rx: "2x5 RPE 6", target: null, u: "", note: "", sets: [{ load: "135", reps: "5", rpe: "6" }] }],
      },
    ];

    const text = formatExportText(sessions, tests);

    expect(text).toContain("Current e1RM: squat 262 lb · deadlift — lb");
    expect(text).toContain("2026-09-29: Back squat 225×5 → 262; Body weight 205 lb");
    expect(text).toContain("## 2026-09-29 · Week 1 A · Normalization · BW 205 · soreness 2/5");
    expect(text).toContain("- Back squat [2x5 RPE 6]: 135×5@6");
    expect(text).toContain("Notes: felt good");
  });

  it("shows a target and a note when the item has them", () => {
    const sessions = [
      {
        id: "s2",
        date: "2026-10-01",
        week: 2,
        key: "A",
        title: "Squat, hinge, power",
        bw: "",
        sore: null,
        notes: "",
        items: [{ name: "Back squat", rx: "4×6 @ 70%", target: 155, u: "", note: "felt heavy", sets: [{ load: "155", reps: "6", rpe: "7" }] }],
      },
    ];
    const text = formatExportText(sessions, []);
    expect(text).toContain("- Back squat [4×6 @ 70%, target 155]: 155×6@7 — felt heavy");
  });

  it("omits an item with no logged sets and no note", () => {
    const sessions = [
      {
        id: "s3",
        date: "2026-10-02",
        week: 2,
        key: "B",
        title: "Single-leg, lateral, upper",
        items: [{ name: "Skipped exercise", rx: "3×8", target: null, u: "", note: "", sets: [] }],
      },
    ];
    const text = formatExportText(sessions, []);
    expect(text).not.toContain("Skipped exercise");
  });

  it("shows em-dashes for e1RM and skips the TESTS section when there are no tests yet", () => {
    const text = formatExportText([], []);
    expect(text).toContain("Current e1RM: squat — lb · deadlift — lb");
    expect(text).not.toContain("TESTS");
  });
});
