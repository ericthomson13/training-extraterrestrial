// Server-side port of app.js's exportText(), reading from D1-shaped rows
// instead of localStorage. Kept as a plain duplicate rather than a shared
// import — app.js is a classic (non-module) script, and this is ~40 lines,
// not worth a build step to share.

// Fallback only -- used when the caller has no program content to read
// testDefinitions from (e.g. a brand-new user with no program yet). Once a
// program exists, its own testDefinitions are what's actually used, so a
// non-ski program's test fields are labeled correctly without any code change.
const DEFAULT_TEST_FIELDS = [
  ["squat", "Back squat", "lb × reps"],
  ["deadlift", "Deadlift", "lb × reps"],
  ["rfess", "RFESS 8RM", "lb/DB"],
  ["bench", "DB bench 8RM", "lb/DB"],
  ["row", "Single-arm row 8RM", "lb"],
  ["pullup", "Pull-up max", "reps"],
  ["broad", "Broad jump", "in"],
  ["hopL", "SL hop L", "in"],
  ["hopR", "SL hop R", "in"],
  ["lathops", "Lateral hops", "/30 s"],
  ["wallsit", "Wall sit 90°", "s"],
  ["k2wL", "Knee-to-wall L", "cm"],
  ["k2wR", "Knee-to-wall R", "cm"],
  ["stanceL", "SL stance L", "s"],
  ["stanceR", "SL stance R", "s"],
  ["cphL", "Copenhagen L", "s"],
  ["cphR", "Copenhagen R", "s"],
  ["sideL", "Side plank L", "s"],
  ["sideR", "Side plank R", "s"],
  ["tib", "Tib raises", "reps"],
  ["aet", "AeT heart rate", "bpm"],
  ["bw", "Body weight", "lb"],
].map(([key, label, unit]) => ({ key, label, unit }));

function showVal(v) {
  if (v == null) return "";
  if (typeof v === "object") return `${v.load}×${v.reps} → ${v.e1rm}`;
  return String(v);
}

function weekLabel(w) {
  return w === "S" ? "In-season" : `Week ${w}`;
}

function getMax(tests, lift) {
  const matches = tests.filter((t) => t.v && t.v[lift] != null).sort((a, b) => (a.date < b.date ? 1 : -1));
  const val = matches[0] && matches[0].v[lift];
  if (val && val.e1rm) return { v: val.e1rm, date: matches[0].date };
  return null;
}

export function formatExportText(sessions, tests, testDefinitions = DEFAULT_TEST_FIELDS) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`SKI STRENGTH LOG — exported ${today}`];
  const sq = getMax(tests, "squat"),
    dl = getMax(tests, "deadlift");
  lines.push(`Current e1RM: squat ${sq ? sq.v : "—"} lb · deadlift ${dl ? dl.v : "—"} lb`);

  if (tests.length) {
    lines.push("", "TESTS");
    tests
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .forEach((t) => {
        const parts = testDefinitions
          .filter((f) => t.v[f.key] != null)
          .map((f) => `${f.label} ${showVal(t.v[f.key])}${typeof t.v[f.key] === "object" ? "" : " " + f.unit}`);
        lines.push(`${t.date}: ${parts.join("; ")}`);
      });
  }

  lines.push("", "SESSIONS");
  sessions.forEach((e) => {
    const suffix = [e.bw && ` · BW ${e.bw}`, e.sore != null && ` · soreness ${e.sore}/5`].filter(Boolean).join("");
    lines.push("", `## ${e.date} · ${weekLabel(e.week)} ${e.key} · ${e.title}${suffix}`);
    (e.items || []).forEach((it) => {
      if (!it.sets.length && !it.note) return;
      const sets = it.sets
        .map((x) => [x.load && x.load, x.reps && x.reps + (it.u ? it.u : "")].filter(Boolean).join("×") + (x.rpe ? "@" + x.rpe : ""))
        .join(", ");
      lines.push(`- ${it.name} [${it.rx}${it.target ? `, target ${it.target}` : ""}]: ${sets || "done"}${it.note ? ` — ${it.note}` : ""}`);
    });
    if (e.notes) lines.push(`Notes: ${e.notes}`);
  });

  return lines.join("\n");
}
