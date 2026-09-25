# Multi-season, multi-user, document-authored training programs

**Status: approved, implementation starting.** Eric completed initial real-world testing and greenlit this plan. Two amendments were folded in before implementation began: the app's top-left brand text becomes a per-program `displayName` (not hardcoded "Ski Strength"), and the interchange/storage format is explicitly JSON with documented ingestion sanitization (see "Security" below) — the risk this addresses is real once program content stops being something only Claude hand-edits and deploys, and becomes something submitted through an API endpoint.

## Context

The app currently hardcodes one season's training program as a static, per-deploy client file (`public/program.js`, loaded via `<script>` tag, never touching the database). Claude (this assistant) hand-edits that file each time the program changes, and a code deploy is required to ship any program update. `app.js` and `functions/_lib/format.js` both also hardcode a ski-specific `TEST_FIELDS` array (duplicated in two places) and several ski-specific behavioral assumptions (see "Ski-specific couplings" below).

The user wants this evolved into a real product, in this order: (1) one user, many seasons, with real version history; (2) many users, each with their own seasons; (3) a defined, document-based way to author/update a program without a code deploy — Claude still designs the program in chat, but instead of hand-editing a JS file, produces a structured interchange file the app parses and validates deterministically (no LLM call at upload time). Every step must be lossless and non-breaking for the app Eric is actively using for real gym sessions today.

Decisions locked in with the user: immutable version history on every program change (not just season boundaries); generalize the schema to an arbitrary sport/program shape now, not just "multi-season but still ski-shaped"; multi-user stays admin-managed via the existing Cloudflare Access allowlist (no self-serve signup — the app already scopes all data by Access-authenticated email).

This design was drafted, then adversarially reviewed against the actual current codebase (`program.js`, `app.js`, `format.js`, `db.js`, `sw.js`, `0001_init.sql`, `test/apply-schema.js`). The review's findings are incorporated below; where it disagreed with the draft, its recommendation was taken.

## New D1 schema (migration `0002_program.sql`, purely additive)

```sql
CREATE TABLE program (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL REFERENCES app_user(email),
  name TEXT NOT NULL,                 -- "2026-27 Ski Season"
  sport TEXT,                         -- freeform, nullable
  status TEXT NOT NULL CHECK (status IN ('draft','current','archived')) DEFAULT 'draft',
  start_date TEXT,                    -- denormalized from content, for sorting a season-history list without parsing JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_program_one_current_per_user ON program(user_email) WHERE status = 'current';

CREATE TABLE program_version (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES program(id),
  version_no INTEGER NOT NULL,
  content TEXT NOT NULL,              -- JSON, full generalized program document (see below)
  change_summary TEXT,                -- nullable, human-readable ("week 5 cue fix"), for the history view
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (program_id, version_no)
);
CREATE INDEX idx_program_version_program ON program_version(program_id);

ALTER TABLE session_log ADD COLUMN program_version_id TEXT REFERENCES program_version(id); -- nullable
ALTER TABLE test_result ADD COLUMN program_version_id TEXT REFERENCES program_version(id); -- nullable, pure provenance
```

`test_result` stays keyed by `(user_email, date)`, not owned by a program — confirmed correct by tracing `app.js`'s `latestTest()`/`getMax()`, which already scan a user's *entire* test history with no season filter (this is exactly the mechanism that lets a new season seed its starting maxes from the previous season's final tested numbers). The new column is annotation only.

**Integrity mechanics** (both are real bugs the review caught in the naive version):
- Activating a program (archive old current + activate new) must run as `env.DB.batch([archiveStmt, activateStmt])`, not two sequential `.run()` calls — D1's `batch()` is transactional; two separate calls can leave zero or two "current" programs if the worker dies mid-sequence. The partial unique index stays as a backstop; a constraint violation there becomes a 409, not a 500.
- `version_no` assignment must be a single atomic statement, not read-then-write: `INSERT INTO program_version (..., version_no, ...) SELECT ?, ..., COALESCE(MAX(version_no),0)+1, ... FROM program_version WHERE program_id = ?`. A separate `SELECT MAX+1` followed by `INSERT` is a race under concurrent writers/retries.
- Immutability is enforced by omission (no UPDATE endpoint on `content` ever exists), not a DB trigger. A "small edit" is just another full version — at ~16.5KB per version and a handful of edits over years, storage is a non-issue (D1 free tier is 5GB); don't build a diff/patch mechanism, it only adds bug surface for a saving that doesn't matter at this scale.
- **`test/apply-schema.js` currently hardcodes a single `import ... from "../migrations/0001_init.sql?raw"`.** Adding `0002_program.sql` and forgetting to update this is a guaranteed footgun. Fix it to load all migration files automatically via `import.meta.glob("../migrations/*.sql", { as: "raw", eager: true })`, sorted by filename, so a future `0003` never requires touching the test harness again.

## Generalized `program_version.content` JSON shape

This replaces `public/program.js`'s ski-specific shape. Traced field-by-field against every real behavior in `app.js`/`format.js` to make sure nothing is silently lost:

Note: the code block below is annotated with `//` comments for readability in this document. The **actual stored/transmitted format is strict JSON** — no comments, no trailing commas, double-quoted keys and strings, no functions. See "Security" below for why this distinction is load-bearing, not stylistic.

```js
{
  displayName: "Ski Strength",          // NEW — the top-left brand text. Per-program, not per-user: switching
                                         // which program is active naturally changes what the header shows.
  units: "lb",                          // ADDED during Phase B — "lb" | "kg". Every load span/label in app.js was
                                         // hardcoded to "lb" text; that's now read from here (UNIT constant), and
                                         // %-of-max rounding uses a unit-appropriate increment (2.5kg vs 5lb).
  startDate: "2026-09-28",              // REQUIRED — season anchor date. Missing from the first draft; app.js's
                                         // currentWeek()/weekStart() are entirely derived from this and there was
                                         // nowhere for it to live in the naive shape.
  periods: [
    { n: 1, phase: "Normalize + test", lengthDays: 7, deload: false, noWarmupSpikes: false }
  ],
  ongoingPeriod: { phase: "In-season", startDate: "2026-12-14" },  // was the "S" special-case + inSeasonStart

  seedMaxes: { [testKey]: value },      // was maxes:{squat,deadlift}, now arbitrary keys
  testDefinitions: [                    // REPLACES the hardcoded TEST_FIELDS array duplicated in app.js AND
    { key, label, unit, kind }          // functions/_lib/format.js today. kind: "load-reps-e1rm" | "max-load" |
                                         // "max-value" — ALL THREE are load-bearing, not just "lift" vs. everything
                                         // else. app.js originally hardcoded a ski-specific array
                                         // (`["rfess","bench","row"].includes(it.t)`) to distinguish "heaviest load
                                         // wins" (max-load) from "highest number wins" (max-value, e.g. reps/seconds/
                                         // distance) — found and fixed during Phase B testing once a real
                                         // program-authoring spec (build-your-training-plan.md) called out the same
                                         // three-way distinction independently.
  ],

  videos: { [key]: url },               // unchanged shape
  circuits: { [key]: description },     // NEW — generalizes the single hardcoded `meCircuit` string so more than
                                         // one circuit (or a second sport's circuits) can exist. Item option
                                         // becomes circuit: "<key>" instead of a bare circuit:1 flag.
  activation: { [groupKey]: description }, // NEW — generalizes warmup.act.A/B/C, which hardcoded exactly three
                                         // session-type letters. A template now declares its own activationGroup key.

  warmupTemplates: [                    // Kept as its OWN structured section — NOT folded into the exercise
    {                                   // segment list. The review pushed back on unifying warm-up with exercises:
      key: "ergA",                      // an erg ramp table + mobility string + activation lookup doesn't map onto
      erg: [[timeLabel, desc, rpeLabel, isSpike]],  // {name,rx,options} without losing structure or turning
      mobility: "...",                  // `options` into a dumping ground.
      activationGroup: "A"              // -> looks up activation["A"]
    }
  ],

  sessionTemplates: [
    {
      key: "A", title: "Squat, hinge, power",
      scope: { type: "period", n: 1 } | { type: "periodRange", periods: [2,3,4] },  // unifies today's
                                         // "singles" (one-off, period-specific) and "blocks.sessions" (recurring)
      warmupTemplate: "ergA" | null,     // was noWarmup (inverted + explicit reference instead of a bare flag)
      noWarmupSpikes: false,             // EXPLICIT flag — today this is inferred from `type === "C"`, a ski-only
                                         // convention with no meaning in a generic schema. Must be authored data.
      testDayNote: null,                 // moves today's hardcoded "Test day: add a second block..." string
                                         // (currently literal copy inside app.js) into program data
      isTest: false,
      items: [
        {
          name: "Back squat",
          rx: "2×5 RPE 6" | { "2": "4×6 @ 70%", "3": "4×6 @ 72.5%", "4": "4×5 @ 77.5%" },  // rx-per-period is now
                                         // keyed by PERIOD NUMBER, not a positional array index. Today's
                                         // `blk.weeks.indexOf(w)` positional lookup is fragile — a non-contiguous
                                         // range or an off-by-one silently mis-assigns a prescription with no
                                         // error. Keying by period number can't misalign.
          options: { bw: 1, u: "s", norpe: 1, lift: "squat", t: "k2wL", v: "hpc", n: "cue text", circuit: "meA", pct: 0.7 }
                                         // OPEN bag — the validator checks known keys' types but must allow
                                         // additional properties. A closed enum of legal option keys would force
                                         // a schema-version bump every time a new sport needs a new concept,
                                         // which defeats "generalize now."
        }
      ]
    }
  ]
}
```

### Ski-specific couplings found and their generalized replacement

| Today (ski-only, hardcoded in app.js/format.js) | Generalized replacement |
|---|---|
| `season.start` used directly, uniform 7-day weeks (`Math.floor(days/7)+1`) | `content.startDate` + per-period `lengthDays`; `currentWeek()` becomes a cumulative walk over `periods`, not division — a real logic rewrite, not just a rename |
| `blk.weeks.indexOf(w)` positional rx-array indexing | `rx` keyed by period number (object map) |
| `noSpikes = s.me || deload || s.type === "C"` (infers meaning from a ski-only type letter) | explicit `noWarmupSpikes` boolean per template |
| `meCircuit` — one global hardcoded string | `circuits: {key: description}` map, same pattern as `videos` |
| `warmup.act.A/B/C` — exactly three hardcoded letters | `activation: {groupKey: description}`, referenced by each warm-up template's own `activationGroup` |
| `"Test day: add a second block of 3 spikes..."` literal string in `app.js` | `testDayNote` field on the session template |
| `TEST_FIELDS` array, duplicated in `app.js` and `functions/_lib/format.js` | `testDefinitions` lives once, in program content; both places read it instead of hardcoding it |
| `["rfess","bench","row"].includes(it.t)` to decide "heaviest load wins" | explicit `kind: "max-load"` per testDefinition, found during Phase B testing (see companion-files section below) |
| Every load-field span/result label hardcoded to `"lb"` | `units: "lb" \| "kg"` at content root, read as `app.js`'s `UNIT` constant |

## Security: JSON, not JS — and ingestion sanitization

This matters once program content stops being a file only Claude hand-edits and deploys, and becomes something submitted through an API endpoint that then gets stored and re-served to a browser.

**JSON, not JS, at every layer.** `program_version.content` is stored as a JSON *document* — never a `.js` file containing a `window.PROGRAM = {...}` object literal, and never anything the client `eval()`s, passes to `new Function()`, or inlines into a `<script>` tag. The client always retrieves it as a `GET /api/programs/current` JSON response and reads it with `JSON.parse` as inert data. This closes off an entire class of injection where "program content" could itself smuggle in executable code — a risk that doesn't really exist today (Claude edits a file on disk, nobody else's input ever reaches it) but becomes real the moment `POST /api/programs` accepts a document from outside. The interchange artifact Claude produces for the upload flow (Phase D) is a `.json` file, not a `.js` file — `PROGRAM_FORMAT.md`'s current JS-array-tuple format describes the old static-file authoring flow and gets a JSON-object equivalent written for the new one.

**Ingestion sanitization** (enforced server-side, in addition to the structural/type validation already described under the endpoints below):
- **Control characters**: strip/reject non-printable control characters from every string field (newline/tab allowed where a field is legitimately multi-line, e.g. `desc`).
- **Length caps**: short fields (`displayName`, `name`, `title`, `label`, `key`) capped around 200 chars; longer free-text fields (`desc`, `n`, `testDayNote`, circuit/activation descriptions) capped around 1000 chars. Bounds storage and rendering cost; a real season's content is ~16.5KB, so this is generous headroom, not a real constraint.
- **URL scheme allowlist**: every URL field (`videos[key]`, any future link) must parse as `http://` or `https://` — reject `javascript:`, `data:`, `vbscript:`, `file:`, anything else. This is **not** the same protection as HTML-escaping: `<a href="javascript:...">` needs no HTML metacharacters to execute, so escaping the string doesn't stop it — the scheme itself has to be checked at ingestion.
- **Render-time escaping stays in force as defense in depth, not a replacement for the above.** `app.js`'s existing `esc()` helper already HTML-escapes every string before it reaches `innerHTML`; Phase B's job is to audit that this covers every *new* field the generalized schema introduces (phase labels, `testDefinitions[].label/unit`, circuit/activation descriptions, session template `title`/`testDayNote`, item `name`/`rx`/`n`/`desc`, the new `displayName`) — not just the fields that exist today.
- **Size cap** on the whole `content` payload (e.g. 200KB) — abuse guard, not a real constraint at current scale.
- **Fail closed**: any validation or sanitization failure rejects the entire upload with a specific, per-field error. Never silently strip-and-accept a partially-invalid document.

## New backend endpoints (`functions/api/programs/`)

- `POST /api/programs` — create a draft program + version 1 (validates `content` against the documented schema and the sanitization rules above: required fields present, types correct, referenced `video`/`circuit`/`activation`/`testDefinition` keys resolve, option-bag types checked with additional properties allowed, every string/URL field sanitized per "Security" above).
- `POST /api/programs/:id/versions` — append a new immutable version to an existing program (every call creates a new version; no "is this meaningful" logic).
- `POST /api/programs/:id/activate` — flip to `current`, archive the prior current, via `DB.batch()`.
- `GET /api/programs/current` — the live program's latest version content; this is what the PWA fetches once Phase B cuts over.
- `GET /api/programs` — list a user's programs (name, sport, status, start_date, version count) for a season-history view.

## New client module: `public/programEngine.js`

The generic-schema interpretation logic (cumulative period walk for `currentWeek()`/`weekStart()`, phase lookup, %-of-max target computation, rx-per-period-number resolution) is factored out of `app.js`'s render functions into its own pure, unit-testable module — not wired into the live UI yet when first written (see Phase A2). `app.js` and `functions/_lib/format.js` both come to depend on `testDefinitions` from program content instead of their current hardcoded/duplicated `TEST_FIELDS` array.

## "Getting Started" nav tab

A fourth bottom-nav tab, always present (Session / Log / Tests / Getting Started) for every user, not just first-run — added at Eric's request while approving this plan. It's the general program-management surface, not a one-time onboarding screen:

- **No current program**: shows onboarding content and a link to `build-your-training-plan.md` — the starter-prompt document Eric wrote, now in the repo — with copy along the lines of *"Don't have a coach or an existing plan? Use this guide to build one with an AI assistant."* Plus the upload flow to submit the result once they have a file.
- **Has a current program**: shows the program list (name, sport, status, start date — from `GET /api/programs`), which one is active, and the same upload/switch/activate flow from here — this is where Phase D's ingestion UI lives, rather than a separate settings screen invented for it.

### The program interchange format is now specified twice — reconcile before Phase D

`build-your-training-plan.md` (Eric's doc) ships with its own precise appendix describing the program file format, and references two companion files that now also exist in the repo: **`program.schema.json`** (a full JSON Schema for the shape below, written to match `programEngine.js` exactly) and **`example-program.json`** (a complete valid example exercising every schema feature). **`validate_program.py`** implements both the schema check (using `jsonschema` if installed, a minimal structural check if not) and the cross-reference integrity checks a schema alone can't express — every `v`/`circuit`/`t`/`lift`/`activationGroup`/`warmupTemplate` reference actually resolves, period numbers have no gaps, a `periodRange` session's `rx` only covers periods in its own scope, a `pct` target has a `lift`.

This is the same content shape as the `program_version.content` design above, cross-checked and found to demand two real fixes (both applied):
- **`units: "lb" | "kg"`** at the content root — missing from the original draft. `app.js` had "lb" hardcoded in every load-field span and result label; now reads `P.units`, and %-of-max rounding uses a unit-appropriate increment (2.5kg vs. 5lb) instead of a fixed nearest-5.
- **Three-way `kind`**, not two: `load-reps-e1rm` | `max-load` | `max-value`. The original draft only distinguished `"lift"` from everything else; `app.js` was still hardcoding `["rfess","bench","row"].includes(it.t)` to know "heaviest load wins" vs. "highest number wins" — a leftover ski-specific coupling the schema audit above didn't originally catch. `testsFromEntry()` now dispatches on the real `kind` instead.

When Phase D's actual validator ships, `program.schema.json`/`validate_program.py` are the reference implementation to build it from — don't design a second, different validator from scratch.

Because this needs `GET /api/programs`/`GET /api/programs/current` to mean anything, the tab itself (with its empty state) is real UI work that lands in Phase C, and gets its full program-list/upload capability once Phase D's validator and endpoints exist. The starter-prompt `.md` content is a copy asset from Eric, not something to draft speculatively.

## Phased rollout

**Phase A — schema only.** Add `0002_program.sql` (additive DDL above), fix `test/apply-schema.js`'s migration loading. No data transform, no client-visible change. Trivially rollback-safe (new tables can be dropped; new columns are nullable additions to existing tables).

**Phase A2 — transform + parity-test, before any real data moves.** Write the `program.js → content` transform and `programEngine.js`. Write a golden-master test: for every real `(week, key)` combination in the actual live 2026-27 season, assert the old `getSession()`-derived output and the new engine's output are equivalent (same items, same rx per period, same targets). Only after this passes, insert the transformed content as `program_id=<new>, version_no=1, status='current'` for the real user. This is the step that actually protects against silently corrupting Eric's running season — a reindexing or option-mapping bug here would otherwise ship invisibly.

**Phase B — read-path cutover only.** Swap `app.js` from `window.PROGRAM` to fetching `/api/programs/current`, behind a simple feature flag revertible without a redeploy. No bespoke offline-merge machinery needed: `sw.js`'s existing network-first-with-timeout-then-cache-fallback already covers this endpoint for free, the same way it already does for `/api/sessions`/`/api/tests` — program content has no local mutations to reconcile (only Claude "writes" it), so it doesn't need `sync.js`'s queue/merge logic. Add one small stash of the last successful fetch in `localStorage` for the cold-start-with-empty-SW-cache case. `functions/_lib/format.js`'s export also switches to reading `testDefinitions` from the current program version instead of its hardcoded array. Keep `public/program.js` in the repo as an emergency rollback path for one release cycle.

**Phase C — multi-user checklist + the Getting Started tab's empty state.** Confirm the program endpoints respect the same email-scoping pattern as `db.js`'s existing functions (small, since `user_email` is already the tenant boundary everywhere), document the "add an email to the Access policy" onboarding step, and build the actual "Getting Started" nav tab (see above) with its no-program empty state — no seed program by default, clear messaging, not a crash.

**Phase D — ingestion format + upload UI.** Document the interchange JSON schema (the shape above, plus `displayName`) as the contract Claude produces — a `.json` file, not `.js` — matching a new JSON-object version of `PROGRAM_FORMAT.md`'s conventions; build the deterministic validator described under the endpoints, including every sanitization rule in "Security" above; build the upload/switch/program-list UI inside the Getting Started tab (paste/upload → validate → create draft → review → activate); retire whatever manual/interim insert path was used to seed Phase A2's data. Eric supplies the starter-prompt `.md` content shown in the empty state.

**Phase E (later, ask first)** — richer authoring UX, season-comparison views, anything beyond what's needed for the above to work. Not planned in detail here.

## Verification

- Phase A: migrations apply cleanly to both local and remote D1 with no data loss on existing tables; `npm test` picks up the new migration automatically via the glob-based loader.
- Phase A2: golden-master parity test passes for every real week/session-key combination in the current live season before any production insert; manually diff a sample of old-vs-new rendered sessions.
- Phase B: with the feature flag on, the app behaves identically to today in a side-by-side comparison; airplane-mode test confirms the program still loads from cache; flipping the flag off instantly reverts to the static file with no redeploy.
- Phase C: create a second Access-allowlisted test email, confirm it sees an empty/no-program state and cannot see the first user's program or logs.
- Phase D: round-trip a Claude-authored interchange file through validation → draft → activate, confirm the app renders it correctly, confirm an intentionally malformed file (bad option type, dangling video/circuit key reference) is rejected with a clear error rather than silently accepted. Also confirm each sanitization rule independently: a `javascript:` URL in a video field is rejected, an overlong string is rejected, control characters are rejected, and a payload over the size cap is rejected — each with a specific error, not a silent strip.
