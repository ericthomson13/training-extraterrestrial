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
import { transformLegacyProgram as transform } from "../public/legacyProgramAdapter.js";

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
