import { describe, expect, it } from "vitest";
import { validateProgram } from "../functions/_lib/programValidator.js";
import realContent from "./fixtures/content.json";
import exampleProgram from "../example-program.json";

function base() {
  return {
    units: "lb",
    startDate: "2027-01-04",
    periods: [{ n: 1, phase: "Intro", lengthDays: 7 }],
    testDefinitions: [{ key: "squat", label: "Back squat", unit: "lb x reps", kind: "load-reps-e1rm" }],
    videos: {},
    circuits: {},
    activation: {},
    warmupTemplates: [],
    sessionTemplates: [
      { key: "A", title: "Day A", scope: { type: "period", n: 1 }, items: [{ name: "Back squat", rx: "3x5" }] },
    ],
  };
}

describe("validateProgram: accepts real, known-good programs", () => {
  it("accepts the real transformed ski program", () => {
    const result = validateProgram(realContent);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts example-program.json", () => {
    const result = validateProgram(exampleProgram);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a minimal valid program", () => {
    const result = validateProgram(base());
    expect(result.valid).toBe(true);
  });
});

describe("validateProgram: structural rejections", () => {
  it("rejects a non-object", () => {
    expect(validateProgram("not an object").valid).toBe(false);
    expect(validateProgram(null).valid).toBe(false);
    expect(validateProgram([1, 2, 3]).valid).toBe(false);
  });

  it("rejects a missing required field", () => {
    const p = base();
    delete p.units;
    const result = validateProgram(p);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("units"))).toBe(true);
  });

  it("rejects an invalid units value", () => {
    const p = base();
    p.units = "stone";
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects a malformed startDate", () => {
    const p = base();
    p.startDate = "Jan 4 2027";
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects periods with a gap", () => {
    const p = base();
    p.periods = [{ n: 1, phase: "A", lengthDays: 7 }, { n: 3, phase: "B", lengthDays: 7 }];
    const result = validateProgram(p);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("no gaps"))).toBe(true);
  });

  it("rejects an empty sessionTemplates array", () => {
    const p = base();
    p.sessionTemplates = [];
    expect(validateProgram(p).valid).toBe(false);
  });
});

describe("validateProgram: reference integrity", () => {
  it("rejects a dangling video reference", () => {
    const p = base();
    p.sessionTemplates[0].items[0].options = { v: "nonexistent" };
    const result = validateProgram(p);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("v 'nonexistent' not found"))).toBe(true);
  });

  it("rejects a dangling circuit reference", () => {
    const p = base();
    p.sessionTemplates[0].items[0].options = { circuit: "nope" };
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects a dangling test/lift reference", () => {
    const p = base();
    p.sessionTemplates[0].items[0].options = { t: "nonexistent" };
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects a dangling warmupTemplate reference", () => {
    const p = base();
    p.sessionTemplates[0].warmupTemplate = "nonexistent";
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects a dangling activationGroup reference", () => {
    const p = base();
    p.warmupTemplates = [{ key: "w1", ergName: "Bike", erg: [], mobility: "x", activationGroup: "nonexistent" }];
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects pct set without a lift", () => {
    const p = base();
    p.sessionTemplates[0].items[0].options = { pct: 0.7 };
    const result = validateProgram(p);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("pct set without a lift"))).toBe(true);
  });

  it("rejects an rx period outside the session's periodRange scope", () => {
    const p = base();
    p.periods = [
      { n: 1, phase: "A", lengthDays: 7 },
      { n: 2, phase: "B", lengthDays: 7 },
    ];
    p.sessionTemplates[0].scope = { type: "periodRange", periods: [1] };
    p.sessionTemplates[0].items[0].rx = { 1: "3x5", 2: "3x5" }; // period 2 is outside scope [1]
    const result = validateProgram(p);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("outside this session's scope"))).toBe(true);
  });

  it("rejects a non-adjacent duplicate group", () => {
    const p = base();
    p.sessionTemplates[0].items = [
      { name: "A", rx: "3x5", options: { group: "X" } },
      { name: "B", rx: "3x5" },
      { name: "C", rx: "3x5", options: { group: "X" } },
    ];
    const result = validateProgram(p);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-adjacent"))).toBe(true);
  });

  it("accepts an adjacent group", () => {
    const p = base();
    p.sessionTemplates[0].items = [
      { name: "A", rx: "3x5", options: { group: "X" } },
      { name: "B", rx: "3x5", options: { group: "X" } },
    ];
    expect(validateProgram(p).valid).toBe(true);
  });
});

describe("validateProgram: sanitization (the actual security boundary)", () => {
  it("rejects a javascript: URL in a video field", () => {
    const p = base();
    p.videos = { evil: "javascript:alert(document.cookie)" };
    p.sessionTemplates[0].items[0].options = { v: "evil" };
    const result = validateProgram(p);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("http:// or https://"))).toBe(true);
  });

  it("rejects a data: URL in a video field", () => {
    const p = base();
    p.videos = { evil: "data:text/html,<script>alert(1)</script>" };
    p.sessionTemplates[0].items[0].options = { v: "evil" };
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects a vbscript: URL", () => {
    const p = base();
    p.videos = { evil: "vbscript:msgbox(1)" };
    p.sessionTemplates[0].items[0].options = { v: "evil" };
    expect(validateProgram(p).valid).toBe(false);
  });

  it("accepts a real https video URL", () => {
    const p = base();
    p.videos = { good: "https://www.youtube.com/watch?v=abc123" };
    p.sessionTemplates[0].items[0].options = { v: "good" };
    expect(validateProgram(p).valid).toBe(true);
  });

  it("rejects control characters embedded in a name", () => {
    const p = base();
    p.sessionTemplates[0].items[0].name = "Back squat\x00\x07";
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects a null byte smuggled into a cue", () => {
    const p = base();
    p.sessionTemplates[0].items[0].options = { n: "Normal text\x00hidden" };
    expect(validateProgram(p).valid).toBe(false);
  });

  it("allows newlines in genuinely multiline fields (desc, n, phase) but not in single-line fields (name)", () => {
    const p = base();
    p.periods[0].phase = "Line one\nLine two";
    p.sessionTemplates[0].items[0].options = { desc: "Line one\nLine two", n: "cue\nmore cue" };
    expect(validateProgram(p).valid).toBe(true);

    const p2 = base();
    p2.sessionTemplates[0].items[0].name = "Back squat\nBack squat";
    expect(validateProgram(p2).valid).toBe(false);
  });

  it("rejects an oversized name beyond the length cap", () => {
    const p = base();
    p.sessionTemplates[0].items[0].name = "x".repeat(300);
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects an oversized desc beyond the length cap", () => {
    const p = base();
    p.sessionTemplates[0].items[0].options = { desc: "x".repeat(1500) };
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects a whole-document payload over the size cap", () => {
    const p = base();
    // Pad with a big (but individually-under-cap) legitimate-looking field set
    // to blow the total size, not any single field's own length check.
    p.testDefinitions = Array.from({ length: 2000 }, (_, i) => ({
      key: `k${i}`,
      label: "x".repeat(150),
      unit: "lb",
      kind: "max-value",
    }));
    const result = validateProgram(p);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("too large"))).toBe(true);
  });

  it("rejects a session key containing a quote character -- keys become DOM ids/data-attributes at render time, where HTML-escaping can't help", () => {
    const p = base();
    p.sessionTemplates[0].key = 'A" onmouseover="alert(1)';
    const result = validateProgram(p);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("short identifier"))).toBe(true);
  });

  it("rejects a testDefinitions key containing unsafe characters", () => {
    const p = base();
    p.testDefinitions[0].key = "squat<img src=x onerror=alert(1)>";
    p.sessionTemplates[0].items[0].options = { t: "squat<img src=x onerror=alert(1)>" };
    expect(validateProgram(p).valid).toBe(false);
  });

  it("rejects a warmupTemplates key containing unsafe characters", () => {
    const p = base();
    p.warmupTemplates = [{ key: 'w1"><script>', ergName: "Bike", erg: [], mobility: "x", activationGroup: "a" }];
    p.activation = { a: "text" };
    expect(validateProgram(p).valid).toBe(false);
  });

  it("accepts ordinary alphanumeric session/test/warmup keys", () => {
    const p = base();
    p.sessionTemplates[0].key = "D1";
    expect(validateProgram(p).valid).toBe(true);
  });

  it("rejects an XSS-shaped string in a name -- not because '<script>' is special-cased, but because render-time escaping is the actual defense; validator still accepts syntactically valid short strings", () => {
    // This is intentionally documenting a boundary, not a gap: the validator's
    // job is structural/reference/sanitization integrity, not to guess at
    // HTML-escaping. A string like this is legal DATA (a plain string field) --
    // app.js's `esc()` at render time is what neutralizes it, not this
    // validator. Confirms the validator doesn't falsely reject legitimate
    // exercise names containing angle brackets or ampersands.
    const p = base();
    p.sessionTemplates[0].items[0].name = "Row <3 sets> & press";
    expect(validateProgram(p).valid).toBe(true);
  });
});
