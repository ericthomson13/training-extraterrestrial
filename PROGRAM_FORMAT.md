# `program.js` interchange format (current, live format)

This documents the *current* format of `public/program.js` — the file a Claude conversation edits by hand today to update the training program. Hand this file to a Claude Desktop (or any other) session before asking it to draft program updates, so it knows the exact conventions instead of guessing from the existing file alone.

This is **not** the future generalized/versioned schema described in `PLANNING.md` (that's a database-backed, sport-agnostic redesign, not yet built). This document describes what's actually live right now.

## Top-level shape

```js
window.PROGRAM = {
  version: "YYYY-MM-DD",        // bump this to today's date whenever the file changes — informational only
  season: { start, inSeasonStart, weeks: [...] },
  maxes: { squat: null, deadlift: null },  // seed e1RM in lb; a real logged test always overrides this
  videos: { key: "https://..." },
  meCircuit: "...",             // one freeform circuit description, referenced by an item's circuit:1 option
  warmup: { erg: [...], mobility: "...", act: { A: "...", B: "...", C: "..." } },
  singles: [...],
  blocks: [...]
};
```

### `season`

```js
season: {
  start: "2026-09-28",            // Monday of week 1. Every week's date range is computed from this.
  inSeasonStart: "2026-12-14",    // first date of the "S" (in-season) block
  weeks: [
    { n: 1, phase: "Normalize + test" },
    { n: 8, phase: "Deload + retest", deload: true },   // deload:true skips the warm-up erg spikes for that week
    ...
  ]
}
```
`weeks` must list every numbered week the program has (no gaps). `deload` is optional and defaults to false. The app derives "current week," date ranges, and phase labels entirely from this — never hardcode a week count or date math elsewhere.

## Sessions: `singles` vs `blocks`

**`singles`** — one specific, non-repeating prescription tied to exactly one week number (Week 1 tests, Week 8 deload/retest, and all `"S"` in-season session types):
```js
{ week: 1, key: "D1", title: "Normalization", type: "A", items: [ ... ] }
```
- `week`: a number, or `"S"` for in-season.
- `key`: a short code (`"D1"`, `"D2"`, `"M1"`, `"PR"`, ...) — shown in the day/session picker.
- `type`: `"A"`, `"B"`, or `"C"` — selects which warm-up activation text (`warmup.act.A/B/C`) and which erg machine label to show. `"C"` also means "no warm-up spikes."
- Optional flags: `test: true` (test day — shows an extra warm-up note), `me: true` (muscular-endurance day — also skips spikes), `noWarmup: true` (skip the whole warm-up section).

**`blocks`** — a recurring 3-week template, reused across a range of weeks with a per-week-in-block prescription variant:
```js
{ weeks: [2, 3, 4], sessions: {
  A: { title: "Squat, hinge, power", items: [
    ["Back squat, 3 s lower", ["4×6 @ 70%", "4×6 @ 72.5%", "4×5 @ 77.5%"], { lift: "squat" }]
    // rx array has exactly one entry per week in `weeks`, IN ORDER. "—" means skip that week entirely.
  ]},
  B: { ... }, C: { ... }
}}
```
**The rx array's position must line up exactly with the block's `weeks` array position** — index 0 is the first week listed, index 1 the second, etc. There is no per-week key; it's purely positional, so double-check the array length matches `weeks.length` for every item.

## Item format

Every item is a 2- or 3-element array: `[name, rx, options]`.

- `name`: exact exercise name shown in the UI. **Keep existing names exactly as-is when adjusting reps/load** — the app matches "last time you did this" by exact name string, and a renamed exercise loses that history.
- `rx`: a string (`"3×8 RPE 6"`, `"2×20 s"`) for a fixed prescription, or an array of 3 strings for a `blocks` item (see above). Never an array inside `singles`.
- `options` (optional object), keys:

| Key | Meaning |
|---|---|
| `bw: 1` | Bodyweight — hides the load field, only reps/time is logged |
| `u: "s"` etc. | Unit label for the reps field (`"s"`, `"in"`, `"cm"`, `"rounds"`, `"laps"`, `"min"`, `"touches"`) — omit for plain reps |
| `norpe: 1` | Hide the RPE field |
| `lift: "squat"` \| `"deadlift"` | Ties this item to a tracked max — `pct` on this or another item computes a target load from it |
| `pct: 0.7` | Target load = `0.7 × current max` (requires `lift`), rounded to the nearest 2.5 lb |
| `t: "squat"` etc. | Marks this item as a **test** — its logged result feeds the Tests tab and (for `squat`/`deadlift`) the e1RM calculation. **Must be one of the existing test keys below**, or a new one added to both `TEST_FIELDS` arrays (see "Adding a new test" below) |
| `v: "hpc"` etc. | Video key — must exist in the top-level `videos` map |
| `n: "cue text"` | Short coaching cue, always visible under the rx line |
| `circuit: 1` | Shows the global `meCircuit` description under this item |
| `desc: "..."` | **New.** Long-form clarification for a jargon/abbreviation-prone name (e.g. RFESS, "Single-leg RDL"). Shown on tap-hold (mobile) or hover/click (desktop) via a small ⓘ next to the name. Add this whenever a name could plausibly be misread — see the existing RFESS/Copenhagen/Cossack/Spanish-squat/Nordic-curl/overcoming-isometric entries for tone and length (1–2 sentences, plain language, no jargon in the explanation itself) |

## Existing test keys (`t:`)

Defined identically (and currently duplicated) in `public/app.js`'s `TEST_FIELDS` and `functions/_lib/format.js`'s `TEST_FIELDS`:

```
squat, deadlift          — "lift" kind: load+reps → e1RM (Epley formula)
rfess, bench, row        — max-load kind: heaviest logged load wins
pullup, broad, hopL, hopR, lathops, wallsit, k2wL, k2wR,
stanceL, stanceR, cphL, cphR, sideL, sideR, tib, aet, bw   — max-value kind: highest logged number wins
```

**Adding a new test key**: pick a short camelCase key, add `[key, "Label", "unit"]` (or `[key, "Label", "unit", "lift"]` if it should get e1RM treatment) to **both** `TEST_FIELDS` arrays — `public/app.js` (~line 411) and `functions/_lib/format.js` (~line 6). They must stay identical. Never reuse or rename an existing key — old logged test results are keyed by these exact strings and would silently stop matching.

## Existing video keys (`v:`)

The `videos` map at the top of `program.js` — add a new `key: "https://..."` entry there before referencing it from an item's `v:`.

## Checklist before handing back an updated `program.js`

1. Bump `version` to today's date.
2. Every `blocks[].sessions[key].items[].rx` array (if present) has exactly as many entries as that block's `weeks` array.
3. Every `t:` value is one of the existing test keys, or you've added it to both `TEST_FIELDS` arrays and said so explicitly.
4. Every `v:` value exists in `videos`.
5. Any newly-introduced jargon/abbreviation-prone exercise name has a `desc`.
6. Exercise names for anything already logged in a prior session are unchanged (renaming breaks "last time" lookups and test history).
