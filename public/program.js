/* Ski Season Strength 2026–27 — program data.
   Claude updates this file (maxes, new blocks); the app reads it.
   Item: [name, rx (string, or array per week of the block), options]
   options: bw = no load field, u = unit for the reps field, norpe = hide RPE,
            lift = key into maxes for % targets, t = test key, v = video key, n = cue */
window.PROGRAM = {
  version: "2026-09-23",
  // Season shape lives here, not hardcoded in app.js, so a future season is a
  // new program.js with no app.js changes: different week count, different
  // phase labels, a different in-season start date, all just data.
  season: {
    start: "2026-09-28",
    inSeasonStart: "2026-12-14",
    weeks: [
      { n: 1, phase: "Normalize + test" },
      { n: 2, phase: "Foundation" },
      { n: 3, phase: "Foundation" },
      { n: 4, phase: "Foundation" },
      { n: 5, phase: "Max strength + ME" },
      { n: 6, phase: "Max strength + ME" },
      { n: 7, phase: "Max strength + ME" },
      { n: 8, phase: "Deload + retest", deload: true },
      { n: 9, phase: "Power + conversion" },
      { n: 10, phase: "Power + conversion" },
      { n: 11, phase: "Power + conversion" }
    ]
  },
  // e1RM in lb. Filled in after testing; the app's own test results take priority.
  maxes: { squat: null, deadlift: null },

  videos: {
    hpc: "https://www.youtube.com/watch?v=efHjodEVf9w",
    pc: "https://youtu.be/YG8M_-11C2A",
    kot: "https://www.youtube.com/watch?v=j9Jy5RRMTrw",
    rfess: "https://www.youtube.com/shorts/lG3MsPmEQQk",
    spanish: "https://www.youtube.com/watch?v=-ksofnvkohI",
    iso: "https://www.youtube.com/watch?v=M5ZuFnI5UvU",
    cph: "https://www.youtube.com/watch?v=nhGK-DxiGBE",
    cossack: "https://www.youtube.com/watch?v=W-KbaAOpMhM",
    stepdown: "https://www.youtube.com/watch?v=KVrReQL7R9o",
    skater: "https://www.youtube.com/shorts/7-Qfb881k7o",
    nordic: "https://www.youtube.com/watch?v=Lgibr8od0yA",
    slrdl: "https://www.catalystathletics.com/exercise/483/Single-Leg-Dumbbell-RDL/",
    tib: "https://www.strengthlog.com/tibialis-raise/",
    calf: "https://support.runna.com/en/articles/6379527-bent-knee-calf-raise-exercise-tutorial",
    splitjump: "https://www.youtube.com/watch?v=72xY37N_Sww",
    me: "https://uphillathlete.com/strength-training/at-home-muscular-endurance-workout-with-progression/",
    k2w: "https://library.theprehabguys.com/vimeo-video/knee-to-wall-ankle-dorsiflexion-assessment/"
  },

  meCircuit: "Box step-ups 18–20\" with pack 1 min/leg → jump squats 30 s → walking lunges 20 steps → split-squat jumps 30 s → wall sit at ski angle 60 s. No rest between stations, 3 min between rounds. Legs should burn before lungs do.",

  warmup: {
    erg: [
      ["0–3 min", "Easy, nasal breathing", "RPE 3"],
      ["3–5 min", "Steady build", "RPE 5"],
      ["5–7 min", "3 × (10 s hard / 30 s easy)", "RPE 8 spikes"],
      ["7 min", "Easy to settle", "RPE 2"]
    ],
    mobility: "Ankle rocks 10/side · 90/90 hip switches ×8 · adductor rock-backs ×8/side",
    act: {
      A: "Band Spanish squat 2×30 s · pogos 2×15 · empty-bar clean drills (RDL to mid-thigh, jump shrug, high pull) ×5 each",
      B: "Copenhagen 1×15 s/side · lateral line hops 2×10 s · scap pull-ups ×8",
      C: "Tib raise ×15 · bodyweight knee-over-toe split squat ×6/side · pogos 2×15"
    }
  },

  // Week 1, Week 8 and in-season sessions: one prescription each.
  singles: [
    { week: 1, key: "D1", title: "Normalization", type: "A", items: [
      ["Hang power clean (light, crisp)", "5×3 RPE 6", { v: "hpc", n: "Work up from PVC → empty bar: RDL to mid-thigh, jump shrug, high pull, then the clean." }],
      ["Back squat", "2×5 RPE 6", { lift: "squat", n: "Work up in sets of 5 to RPE 6, then 2 sets there." }],
      ["Romanian deadlift", "3×8 RPE 6"],
      ["Split squat, bodyweight", "2×10/leg", { bw: 1, v: "kot" }],
      ["Push-ups", "3×10", { bw: 1 }],
      ["Strict pull-ups", "3×(max − 2)", { bw: 1 }],
      ["Knee-to-wall, left", "1×1", { bw: 1, u: "cm", norpe: 1, t: "k2wL", v: "k2w" }],
      ["Knee-to-wall, right", "1×1", { bw: 1, u: "cm", norpe: 1, t: "k2wR", v: "k2w" }],
      ["Single-leg stance eyes closed, left", "1×1", { bw: 1, u: "s", norpe: 1, t: "stanceL", n: "Max 60 s." }],
      ["Single-leg stance eyes closed, right", "1×1", { bw: 1, u: "s", norpe: 1, t: "stanceR" }],
      ["Copenhagen short lever, left", "1×1", { bw: 1, u: "s", norpe: 1, t: "cphL", v: "cph" }],
      ["Copenhagen short lever, right", "1×1", { bw: 1, u: "s", norpe: 1, t: "cphR", v: "cph" }],
      ["Tib raises against wall, max", "1×1", { bw: 1, norpe: 1, t: "tib", v: "tib" }]
    ]},
    { week: 1, key: "D2", title: "Strength + power test", type: "A", test: true, items: [
      ["Standing broad jump", "3×1", { bw: 1, u: "in", norpe: 1, t: "broad" }],
      ["Single-leg hop, left", "3×1", { bw: 1, u: "in", norpe: 1, t: "hopL", n: "Landing must be stuck to count." }],
      ["Single-leg hop, right", "3×1", { bw: 1, u: "in", norpe: 1, t: "hopR" }],
      ["Lateral line hops, 30 s", "1×1", { bw: 1, u: "touches", norpe: 1, t: "lathops" }],
      ["Back squat 5RM", "3×5", { lift: "squat", t: "squat", n: "Ramp: bar ×10, 40% ×5, 55% ×5, 70% ×3, then up to 3 attempts. Stop at RPE 9. Rest 3–4 min." }],
      ["Deadlift 5RM", "3×5", { lift: "deadlift", t: "deadlift", n: "Same ramp. Flat back is non-negotiable." }],
      ["Strict pull-up, max reps", "1×1", { bw: 1, norpe: 1, t: "pullup", n: "More than 10? Add a weighted 3RM next session." }]
    ]},
    { week: 1, key: "D3", title: "Single-leg + ski test", type: "B", test: true, items: [
      ["RFESS 8RM (lb per DB)", "3×8", { t: "rfess", v: "rfess", n: "Test each leg; log the weaker side's load." }],
      ["DB bench 8RM (lb per DB)", "3×8", { t: "bench" }],
      ["Single-arm row 8RM", "3×8", { t: "row" }],
      ["Wall sit 90°, to failure", "1×1", { bw: 1, u: "s", norpe: 1, t: "wallsit" }],
      ["Side plank, left", "1×1", { bw: 1, u: "s", norpe: 1, t: "sideL" }],
      ["Side plank, right", "1×1", { bw: 1, u: "s", norpe: 1, t: "sideR" }]
    ]},
    { week: 8, key: "D1", title: "Deload", type: "A", items: [
      ["Power clean", "3×2 RPE 6", { v: "pc" }],
      ["Back squat", "3×3 RPE 6", { lift: "squat" }],
      ["Romanian deadlift", "2×5 RPE 6"],
      ["Copenhagen plank, long lever", "2×20 s", { bw: 1, u: "s", v: "cph" }],
      ["Pull-up", "3×5 RPE 6", { bw: 1 }]
    ]},
    { week: 8, key: "D2", title: "Retest", type: "A", test: true, items: [
      ["Standing broad jump", "3×1", { bw: 1, u: "in", norpe: 1, t: "broad" }],
      ["Single-leg hop, left", "3×1", { bw: 1, u: "in", norpe: 1, t: "hopL" }],
      ["Single-leg hop, right", "3×1", { bw: 1, u: "in", norpe: 1, t: "hopR" }],
      ["Lateral line hops, 30 s", "1×1", { bw: 1, u: "touches", norpe: 1, t: "lathops" }],
      ["Back squat 3RM", "3×3", { lift: "squat", t: "squat", n: "Stop at RPE 9." }],
      ["Deadlift 3RM", "3×3", { lift: "deadlift", t: "deadlift" }],
      ["Strict pull-up, max reps", "1×1", { bw: 1, norpe: 1, t: "pullup" }],
      ["Wall sit 90°, to failure", "1×1", { bw: 1, u: "s", norpe: 1, t: "wallsit" }]
    ]},
    { week: "S", key: "M1", title: "Maintenance: strength + power", type: "A", items: [
      ["Power clean", "3×2 RPE 7–8", { v: "pc" }],
      ["Lateral bounds", "2×5/side", { bw: 1, v: "skater" }],
      ["Back squat", "3×3 @ 85%", { lift: "squat" }],
      ["RFESS", "2×5/leg RPE 8", { v: "rfess" }],
      ["Nordic curl", "2×4", { bw: 1, v: "nordic" }],
      ["Copenhagen plank", "2×20 s", { bw: 1, u: "s", v: "cph" }],
      ["Weighted pull-up", "3×3 RPE 8"]
    ]},
    { week: "S", key: "M2", title: "Maintenance: ME + isometric", type: "C", me: true, items: [
      ["Overcoming isometric: quarter squat into pins", "4×6 s", { bw: 1, u: "s", v: "iso", n: "Pins at ski-stance knee angle (~110–120°). Max push." }],
      ["ME circuit, 15–20% BW pack", "2 rounds", { u: "rounds", norpe: 1, v: "me", circuit: 1 }],
      ["Loaded wall sit, ski angle", "2×90 s", { u: "s" }]
    ]},
    { week: "S", key: "PR", title: "Primer (3–4 days before an event)", type: "A", items: [
      ["Power clean", "3×1 RPE 7", { v: "pc" }],
      ["Back squat", "2×2 RPE 7", { lift: "squat", pct: 0.8 }],
      ["Box jumps", "2×3", { bw: 1 }]
    ]},
    { week: "S", key: "MD", title: "Micro-dose (10–15 min, home)", type: "C", noWarmup: true, items: [
      ["Pogos", "2×20", { bw: 1 }],
      ["Spanish squat or wall sit at ski angle", "3×45 s", { bw: 1, u: "s", v: "spanish" }],
      ["Copenhagen plank", "2×20 s/side", { bw: 1, u: "s", v: "cph" }],
      ["Tib raise", "1×25", { bw: 1, v: "tib" }],
      ["Bent-knee calf raise", "1×15", { v: "calf" }],
      ["90/90 hip switches + ankle rocks", "1×10", { bw: 1, norpe: 1 }],
      ["Single-leg balance, eyes closed", "2×30 s/side", { bw: 1, u: "s", norpe: 1 }]
    ]}
  ],

  // Three-week blocks: each rx array is [week 1 of block, week 2, week 3]. "—" = skip that week.
  blocks: [
    { weeks: [2, 3, 4], sessions: {
      A: { title: "Squat, hinge, power", items: [
        ["Hang power clean", ["5×3 RPE 6", "5×3 RPE 6–7", "5×3 RPE 7"], { v: "hpc", n: "Stop a set if the bar path drifts." }],
        ["Box jump (step down)", ["3×3", "4×3", "4×3"], { bw: 1, n: "Mid-shin to knee height. Land quiet and stick." }],
        ["Back squat, 3 s lower", ["4×6 @ 70%", "4×6 @ 72.5%", "4×5 @ 77.5%"], { lift: "squat", n: "3 min rest." }],
        ["Romanian deadlift", ["3×8 RPE 6", "3×8 RPE 7", "3×6 RPE 7"], { n: "Hinge, don't squat it." }],
        ["Nordic curl (GHD)", ["2×3", "3×3", "3×4"], { bw: 1, v: "nordic", n: "Eccentric only; hands catch." }],
        ["Copenhagen plank, short lever", ["3×20 s", "3×25 s", "3×30 s"], { bw: 1, u: "s", v: "cph" }],
        ["Pallof press (cable)", ["3×10/side", "3×10/side", "3×12/side"]],
        ["Tib raise", ["2×20", "2×20", "3×20"], { bw: 1, v: "tib" }],
        ["Bent-knee calf raise", ["2×15", "2×15", "3×15"], { v: "calf", n: "2 s pause at the bottom." }]
      ]},
      B: { title: "Single-leg, lateral, upper", items: [
        ["Lateral line hops, precision", ["3×10 s", "3×12 s", "3×15 s"], { bw: 1, u: "s", n: "Accuracy over speed." }],
        ["Skater hop to stick", ["3×3/side", "3×4/side", "3×5/side"], { bw: 1, v: "skater", n: "Hold each landing 2 s over the outside foot." }],
        ["RFESS, 3 s lower", ["3×8 ~85% of 8RM", "3×8 RPE 7", "3×6 RPE 7"], { v: "rfess" }],
        ["Cossack squat", ["3×5/side", "3×6/side", "3×6/side light goblet"], { v: "cossack", n: "Heel down, go as deep as you own." }],
        ["Lateral step-down, 8\" box", ["2×8/side", "3×8/side", "3×10/side"], { bw: 1, v: "stepdown", n: "Knee over 2nd toe, 3 s down." }],
        ["Pull-up, strict or weighted", ["4×5 RPE 7", "4×5 RPE 7", "4×4 RPE 7–8"], { n: "Superset with DB bench." }],
        ["DB bench", ["3×8 RPE 7", "3×8 RPE 7", "3×6 RPE 7–8"]],
        ["Single-arm row", ["3×10", "3×10", "3×8"]],
        ["GHD back extension", ["3×10", "3×12", "3×12"], { bw: 1 }],
        ["Hanging knee raise", ["3×10", "3×10", "3×12"], { bw: 1 }]
      ]},
      C: { title: "Ski-specific eccentric + isometric", items: [
        ["Pogo hops", ["3×15", "3×20", "3×20"], { bw: 1, n: "Stiff ankles, quick contacts." }],
        ["Knee-over-toe split squat", ["3×8/leg BW", "3×8/leg light DB", "3×8/leg"], { v: "kot", n: "Front heel down, knee past toes." }],
        ["Heel-elevated goblet squat, 4-2-1 tempo", ["3×8", "3×8", "3×8 heavier"], { n: "Heels on 10 lb plates." }],
        ["Wall sit, ski angle (~110°)", ["4×45 s", "4×60 s", "3×90 s"], { bw: 1, u: "s", n: "Shins in contact; breathe through it." }],
        ["Single-leg RDL, DB", ["3×8/side", "3×8/side", "3×8/side"], { v: "slrdl", n: "Foot tripod; hips square." }],
        ["Farmer carry", ["4×40 m", "4×40 m", "4×50 m"], { u: "m", norpe: 1 }],
        ["ME primer: box step-ups 16–20\"", ["—", "2×1 min BW", "3×1 min 10% BW"], { u: "min", v: "me" }]
      ]}
    }},
    { weeks: [5, 6, 7], sessions: {
      A: { title: "Heavy bilateral + power", items: [
        ["Power clean (hang or floor)", ["5×2 RPE 7", "6×2 RPE 7–8", "5×2 RPE 8"], { v: "pc", n: "Fast, full rest." }],
        ["Depth drop to stick, 12\" box", ["3×3", "3×4", "4×3"], { bw: 1, n: "Absorb; no rebound yet." }],
        ["Back squat", ["5×5 @ 80%", "5×4 @ 82.5%", "4×3 @ 87%"], { lift: "squat", n: "3–4 min rest." }],
        ["Deadlift", ["4×4 @ 80%", "4×3 @ 83%", "3×3 @ 87%"], { lift: "deadlift" }],
        ["Nordic curl", ["3×4", "3×5", "3×5"], { bw: 1, v: "nordic" }],
        ["Copenhagen plank, long lever", ["3×15 s", "3×20 s", "3×25 s"], { bw: 1, u: "s", v: "cph" }],
        ["Barbell rollout (knees)", ["3×6", "3×8", "3×8"], { bw: 1 }]
      ]},
      B: { title: "Heavy single-leg + lateral + upper", items: [
        ["Lateral bound to stick", ["4×3/side", "4×4/side", "4×4/side"], { bw: 1, v: "skater", n: "Only as far as you can stick silently." }],
        ["Lateral box hop, low box", ["3×6", "3×8", "3×8"], { bw: 1, n: "Precision." }],
        ["RFESS", ["4×6 RPE 7–8", "4×5 RPE 8", "4×4 RPE 8"], { v: "rfess", n: "Heaviest single-leg day." }],
        ["Lateral lunge, DB", ["3×6/side", "3×6/side", "3×5/side"]],
        ["Weighted pull-up", ["5×3 RPE 8", "5×3 RPE 8", "4×3 RPE 8"], { n: "Superset with DB bench." }],
        ["DB bench", ["3×6", "3×6", "3×5"]],
        ["Ring row or single-arm row", ["3×8", "3×8", "3×8"]],
        ["GHD back extension, weighted", ["3×10", "3×10", "3×8"]]
      ]},
      C: { title: "Muscular endurance + isometric", me: true, items: [
        ["Pogos", ["3×20", "3×20", "3×20"], { bw: 1 }],
        ["Knee-over-toe split squat", ["2×8/leg", "2×8/leg", "2×8/leg"], { v: "kot" }],
        ["ME circuit", ["2 rounds @ 10% BW (~20 lb)", "3 rounds @ 12.5% BW (~25 lb)", "3 rounds @ 15% BW (~30 lb)"], { u: "rounds", norpe: 1, v: "me", circuit: 1, n: "Sore more than 48 h? Repeat this week instead of progressing." }],
        ["Single-leg RDL, heavy", ["3×6/side", "3×6/side", "3×6/side"], { v: "slrdl" }],
        ["Tib raise", ["2×20", "2×20", "2×20"], { bw: 1, v: "tib" }],
        ["Bent-knee calf raise", ["2×15", "2×15", "2×15"], { v: "calf" }]
      ]}
    }},
    { weeks: [9, 10, 11], sessions: {
      A: { title: "Contrast power", items: [
        ["Power clean", ["5×2 RPE 8", "6×1 RPE 8", "4×2 RPE 7–8"], { v: "pc" }],
        ["Back squat → 3 box jumps (contrast)", ["4×3 @ 85%", "4×2 @ 88%", "3×2 @ 88%"], { lift: "squat", n: "Jump 60–90 s after each squat set." }],
        ["Depth jump, 12\" box", ["3×3", "3×4", "3×3"], { bw: 1, n: "Minimal ground contact, rebound up." }],
        ["Romanian deadlift", ["3×5 RPE 7", "3×5 RPE 7–8", "2×5 RPE 7"]],
        ["Nordic curl", ["2×5", "2×5", "2×4"], { bw: 1, v: "nordic" }],
        ["Copenhagen plank, long lever", ["3×25 s", "3×30 s", "2×30 s"], { bw: 1, u: "s", v: "cph" }]
      ]},
      B: { title: "Lateral reactive + single-leg", items: [
        ["Continuous lateral bounds", ["3×6", "4×6", "3×6"], { bw: 1, v: "skater", n: "Rhythm like short-radius turns." }],
        ["Clock hops, single leg", ["2×1 lap/leg", "3×1 lap/leg", "2×1 lap/leg"], { bw: 1, u: "laps", n: "Hop to 12, 3, 6, 9; stick each." }],
        ["RFESS → skater jumps (contrast)", ["3×4 RPE 8", "3×4 RPE 8", "2×4 RPE 8"], { v: "rfess", n: "Then 3–4 skater jumps/side." }],
        ["Cossack squat, loaded", ["3×5/side", "3×5/side", "2×5/side"], { v: "cossack" }],
        ["Weighted pull-up", ["4×3 RPE 8", "4×3 RPE 8", "3×3 RPE 8"]],
        ["DB bench", ["3×5", "3×5", "2×5"]]
      ]},
      C: { title: "Heavy isometric + eccentric (3-day weeks only)", items: [
        ["Overcoming isometric: quarter squat into pins", ["5×5 s", "5×6 s", "4×6 s"], { bw: 1, u: "s", v: "iso", n: "Pins at ~110–120° knee angle; push max." }],
        ["Wall sit, ski angle, plate on thighs", ["3×60 s", "3×75 s", "2×90 s"], { u: "s", n: "Plate 25–45 lb." }],
        ["Eccentric step-down with pack, 16\"", ["3×8/leg", "3×8/leg", "2×8/leg"], { v: "stepdown", n: "4 s down." }],
        ["ME circuit, 15–20% BW", ["2 rounds", "2 rounds", "—"], { u: "rounds", norpe: 1, v: "me", circuit: 1, n: "Skip on weeks with a long skin." }]
      ]}
    }}
  ]
};
