#!/usr/bin/env node
// One-time migration tool (PLANNING.md Phase A2): reads the current ski-specific
// public/program.js and writes the equivalent generalized `content` JSON
// (programEngine.js's shape) to stdout, or to a file with --out.
//
// This is a local dev-time tool operating on a trusted file we control, not an
// ingestion path for untrusted input -- the "JSON, not JS" security posture
// in PLANNING.md applies to the runtime upload endpoint (Phase D), not to this
// one-time offline transform script.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(__dirname, "../public/program.js");

// Pure: takes the file's source text directly, no filesystem access. Used by
// both the CLI (which reads the file itself, below) and by tests running
// under the Workers test pool, which sandboxes Node's fs module and can't
// resolve a real host path -- they load the text via Vite's `?raw` import
// instead (the same pattern test/apply-schema.js already uses).
export function parseLegacyProgram(srcText) {
  const objSrc = srcText.replace(/^[\s\S]*?window\.PROGRAM\s*=\s*/, "").replace(/;\s*$/, "");
  // eslint-disable-next-line no-eval
  return (0, eval)("(" + objSrc + ")");
}

function loadLegacyProgram() {
  return parseLegacyProgram(fs.readFileSync(srcPath, "utf8"));
}

function transform(P, displayName) {
  const periods = P.season.weeks.map((w) => ({
    n: w.n,
    phase: w.phase,
    lengthDays: 7,
    deload: !!w.deload,
  }));

  const testDefinitions = [
    ["squat", "Back squat", "lb × reps", "load-reps-e1rm"],
    ["deadlift", "Deadlift", "lb × reps", "load-reps-e1rm"],
    ["rfess", "RFESS 8RM", "lb/DB", "max-value"],
    ["bench", "DB bench 8RM", "lb/DB", "max-value"],
    ["row", "Single-arm row 8RM", "lb", "max-value"],
    ["pullup", "Pull-up max", "reps", "max-value"],
    ["broad", "Broad jump", "in", "max-value"],
    ["hopL", "SL hop L", "in", "max-value"],
    ["hopR", "SL hop R", "in", "max-value"],
    ["lathops", "Lateral hops", "/30 s", "max-value"],
    ["wallsit", "Wall sit 90°", "s", "max-value"],
    ["k2wL", "Knee-to-wall L", "cm", "max-value"],
    ["k2wR", "Knee-to-wall R", "cm", "max-value"],
    ["stanceL", "SL stance L", "s", "max-value"],
    ["stanceR", "SL stance R", "s", "max-value"],
    ["cphL", "Copenhagen L", "s", "max-value"],
    ["cphR", "Copenhagen R", "s", "max-value"],
    ["sideL", "Side plank L", "s", "max-value"],
    ["sideR", "Side plank R", "s", "max-value"],
    ["tib", "Tib raises", "reps", "max-value"],
    ["aet", "AeT heart rate", "bpm", "max-value"],
    ["bw", "Body weight", "lb", "max-value"],
  ].map(([key, label, unit, kind]) => ({ key, label, unit, kind }));

  const activation = { ...P.warmup.act };
  const warmupTemplates = Object.keys(P.warmup.act).map((groupKey) => ({
    key: `erg${groupKey}`,
    erg: P.warmup.erg.map(([time, desc, rpe]) => [time, desc, rpe]),
    mobility: P.warmup.mobility,
    activationGroup: groupKey,
  }));

  const circuits = { meCircuit: P.meCircuit };

  function scopeFor(weeks) {
    return weeks.length === 1 ? { type: "period", n: weeks[0] } : { type: "periodRange", periods: weeks };
  }

  function convertItems(rawItems, weeksForRx) {
    return rawItems.map(([name, rx, o = {}]) => {
      const options = o.circuit ? { ...o, circuit: "meCircuit" } : o;
      let itemRx;
      if (Array.isArray(rx)) {
        itemRx = {};
        // "—" means "skip this period" in the old format -- omit the key
        // entirely rather than storing the placeholder, so a period simply
        // absent from the map is what means "not prescribed," matching the
        // old filter's `rx && rx !== "—"` behavior.
        weeksForRx.forEach((w, i) => {
          if (rx[i] !== undefined && rx[i] !== "—") itemRx[String(w)] = rx[i];
        });
      } else {
        itemRx = rx;
      }
      return { name, rx: itemRx, options };
    });
  }

  const sessionTemplates = [];

  for (const single of P.singles) {
    const weeks = single.week === "S" ? null : [single.week];
    sessionTemplates.push({
      key: single.key,
      title: single.title,
      scope: single.week === "S" ? { type: "ongoing" } : scopeFor(weeks),
      warmupTemplate: single.noWarmup ? null : `erg${single.type === "B" ? "B" : single.type === "C" ? "C" : "A"}`,
      noWarmupSpikes: !!single.me || single.type === "C",
      testDayNote: single.test ? "Test day: add a second block of 3 spikes and one extra ramp set." : null,
      isTest: !!single.test,
      items: convertItems(single.items, weeks || []),
    });
  }

  for (const block of P.blocks) {
    for (const [key, session] of Object.entries(block.sessions)) {
      sessionTemplates.push({
        key,
        title: session.title,
        scope: scopeFor(block.weeks),
        warmupTemplate: `erg${key === "B" ? "B" : key === "C" ? "C" : "A"}`,
        noWarmupSpikes: !!session.me || key === "C",
        testDayNote: null,
        isTest: false,
        items: convertItems(session.items, block.weeks),
      });
    }
  }

  return {
    displayName,
    startDate: P.season.start,
    periods,
    ongoingPeriod: { phase: "In-season", startDate: P.season.inSeasonStart },
    seedMaxes: { ...P.maxes },
    testDefinitions,
    videos: { ...P.videos },
    circuits,
    activation,
    warmupTemplates,
    sessionTemplates,
  };
}

// Only run the CLI when this file is executed directly (`node
// scripts/transform-program.mjs`), not when imported as a module (by tests).
//
// Parsing program.js's JS-object-literal requires eval, which only plain Node
// allows -- the Workers test runtime (workerd) disallows code generation from
// strings entirely (the same restriction real deployed Workers have, and
// exactly the property PLANNING.md's "JSON, not JS" security section relies
// on). So the parity test doesn't parse program.js itself at test time; this
// CLI writes both the new content.json AND a frozen legacy.json snapshot of
// the parsed old shape, and the test imports both as plain JSON.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : null;
  const displayName = "Ski Strength";

  const legacy = loadLegacyProgram();
  const content = transform(legacy, displayName);

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "content.json"), JSON.stringify(content, null, 2));
    fs.writeFileSync(path.join(outDir, "legacy.json"), JSON.stringify(legacy, null, 2));
    console.error(`Wrote ${outDir}/content.json and ${outDir}/legacy.json`);
  } else {
    console.log(JSON.stringify(content, null, 2));
  }
}

export { transform, loadLegacyProgram };
