// Converts the old ski-specific window.PROGRAM shape into the generalized
// content shape programEngine.js understands (see PLANNING.md). Shared
// between the browser (app.js, when the API has no program yet and falls
// back to the bundled static program.js) and the one-time Node migration
// script (scripts/transform-program.mjs) -- kept in one place so the two
// paths can't drift apart.
export function transformLegacyProgram(P, displayName) {
  const periods = P.season.weeks.map((w) => ({
    n: w.n,
    phase: w.phase,
    lengthDays: 7,
    deload: !!w.deload,
  }));

  const testDefinitions = [
    ["squat", "Back squat", "lb × reps", "load-reps-e1rm"],
    ["deadlift", "Deadlift", "lb × reps", "load-reps-e1rm"],
    ["rfess", "RFESS 8RM", "lb/DB", "max-load"],
    ["bench", "DB bench 8RM", "lb/DB", "max-load"],
    ["row", "Single-arm row 8RM", "lb", "max-load"],
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
    ergName: groupKey === "B" ? "SkiErg" : "Assault bike",
    erg: P.warmup.erg.map(([time, desc, rpe]) => [time, desc, rpe]),
    mobility: P.warmup.mobility,
    activationGroup: groupKey,
  }));

  const circuits = { meCircuit: P.meCircuit };

  const KEYNAME = { A: "A · Heavy", B: "B · Single-leg", C: "C · Ski-specific", D1: "Day 1", D2: "Day 2", D3: "Day 3", M1: "M1 Strength", M2: "M2 Endurance", PR: "Primer", MD: "Micro-dose" };

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
        // absent from the map is what means "not prescribed."
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
      shortLabel: KEYNAME[single.key] || single.key,
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
        shortLabel: KEYNAME[key] || key,
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
    units: "lb",
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
