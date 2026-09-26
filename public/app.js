/* Training Log — offline gym logger, program content is user-uploaded and
   generic (see PLANNING.md), not tied to any one sport. Data lives in this
   browser (localStorage); Export sends it to Claude, who updates the program,
   which lives in D1, with the static program.js kept only as an offline/
   emergency-rollback fallback for the original ski program. */
import { currentPeriod, getSession as engineGetSession, periodEnd, periodPhase, periodStart, sessionKeysFor } from "./programEngine.js";
import { transformLegacyProgram } from "./legacyProgramAdapter.js";

// Feature flag: which program source to read from. Revertible without a
// redeploy -- flip via ?src=static / ?src=api in the URL (persists to
// localStorage), or clear localStorage's ssl:programSource key directly.
// Defaults to "api" now that Phase B/C/D are live -- "static" (the bundled,
// Eric-specific ski program) is an explicit emergency override only, never a
// silent fallback for another user's failed/empty fetch (see resolveProgram).
function resolveProgramSourceFlag() {
  const qp = new URLSearchParams(location.search).get("src");
  if (qp === "api" || qp === "static") {
    try { localStorage.setItem("ssl:programSource", qp); } catch (e) {}
    return qp;
  }
  try { return localStorage.getItem("ssl:programSource") || "api"; } catch (e) { return "api"; }
}

// Returns { content, meta }. `content` is null when there's genuinely no
// program to show -- a brand-new user with zero programs, an unauthenticated
// request, or an unrecoverable fetch error with no cached copy. It must NEVER
// silently substitute a different program (e.g. the bundled static ski file)
// in place of "this user has none yet" -- that was a real bug: every path
// used to fall through to `window.PROGRAM` regardless of why the fetch came
// back empty, so a second user with no program of their own silently saw
// Eric's ski program instead of an empty state.
async function resolveProgram() {
  if (resolveProgramSourceFlag() === "static") {
    return { content: transformLegacyProgram(window.PROGRAM, "Ski Strength"), meta: { source: "static" } };
  }
  try {
    const res = await fetch("/api/programs/current");
    if (res.ok) {
      const { program } = await res.json();
      if (program && program.content) {
        try { localStorage.setItem("ssl:program:lastGood", JSON.stringify(program.content)); } catch (e) {}
        return { content: program.content, meta: { source: "api", programId: program.programId, versionNo: program.versionNo } };
      }
      return { content: null, meta: { source: "none" } }; // authenticated, just no current program yet
    }
    if (res.status === 401) return { content: null, meta: { source: "unauthorized" } };
  } catch (e) { /* network error -- fall through to this device's own cache below */ }
  try {
    const cached = localStorage.getItem("ssl:program:lastGood");
    if (cached) return { content: JSON.parse(cached), meta: { source: "api-cache" } };
  } catch (e) { /* fall through to the error state */ }
  return { content: null, meta: { source: "error" } };
}

(async function () {
  "use strict";
  const { content: P, meta: programMeta } = await resolveProgram();
  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");
  // Branding is entirely program-driven, never a hardcoded sport/program name
  // in the markup -- this runs unconditionally (not just when a program
  // loads) so a brand-new user with no program yet, or a program missing
  // displayName, gets this generic fallback instead of stale HTML defaults
  // or a blank brand.
  const DEFAULT_APP_NAME = "Training Log";
  document.title = (P && P.displayName) || DEFAULT_APP_NAME;
  const brandEl = $(".brand");
  if (brandEl && brandEl.firstChild) brandEl.firstChild.textContent = (P && P.displayName) || DEFAULT_APP_NAME;
  const UNIT = P?.units || "lb";
  // Plate/increment granularity for %-of-max target rounding depends on the
  // unit -- nearest-5kg is a huge jump (11 lb), nearest-2.5kg is the sane
  // equivalent of the old fixed nearest-5lb rounding.
  const ROUND_TO = UNIT === "kg" ? 2.5 : 5;

  /* ---------- storage ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const LOG = "ssl:log", TESTS = "ssl:tests", THEME = "ssl:theme";
  const getLog = () => store.get(LOG, []);
  const getTests = () => store.get(TESTS, []);

  /* ---------- dates ---------- */
  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = d => `${MON[d.getMonth()]} ${d.getDate()}`;

  // Program-shape access goes through programEngine.js's generic interpreter
  // (see PLANNING.md) -- app.js keeps its own "S" sentinel for in-season
  // internally (draft keys, logged-session ids, and UI comparisons throughout
  // this file already assume it), translating to/from the engine's "ongoing"
  // sentinel only at these boundary functions.
  const toEnginePeriod = w => w === "S" ? "ongoing" : w;
  const currentWeek = () => { if (!P) return 1; const p = currentPeriod(P, new Date()); return p === "ongoing" ? "S" : p; };
  const PHASE = w => periodPhase(P, toEnginePeriod(w));
  const weekLabel = w => w === "S" ? "In-season" : `Week ${w}`;
  const weekDates = w => {
    if (w === "S") return `From ${fmt(parseISO(P.ongoingPeriod.startDate))}`;
    return `${fmt(periodStart(P, w))} – ${fmt(periodEnd(P, w))}`;
  };

  /* ---------- program model ---------- */
  const WEEKS = P ? P.periods.map(p => p.n).concat("S") : [];
  function sessionKeys(w) {
    return sessionKeysFor(P, toEnginePeriod(w));
  }
  // Legacy id convention (`w${w}-${key}`, `w` can be a number or "S")
  // preserved exactly -- localStorage draft keys and every already-logged
  // session's `sessionId` field depend on this exact format.
  function getSession(w, key) {
    const s = engineGetSession(P, toEnginePeriod(w), key);
    if (!s) return null;
    return { ...s, id: `w${w}-${key}`, week: w, key };
  }

  /* ---------- maxes + targets ---------- */
  const e1rm = (load, reps) => Math.round(load * (1 + reps / 30));
  const r5 = x => Math.round(x / ROUND_TO) * ROUND_TO;
  function latestTest(key) {
    const t = getTests().filter(r => r.v && r.v[key] != null).sort((a, b) => a.date < b.date ? 1 : -1)[0];
    return t ? { date: t.date, val: t.v[key] } : null;
  }
  function getMax(lift) {
    const t = latestTest(lift);
    if (t && t.val && t.val.e1rm) return { v: t.val.e1rm, src: `tested ${t.date}` };
    if (P.seedMaxes && P.seedMaxes[lift]) return { v: P.seedMaxes[lift], src: "program" };
    return null;
  }
  function targetLoad(it) {
    if (!it.lift || !it.pct) return null;
    const m = getMax(it.lift);
    return m ? r5(m.v * it.pct) : null;
  }
  function lastFor(name, excludeId) {
    const log = getLog();
    for (let j = log.length - 1; j >= 0; j--) {
      const e = log[j]; if (e.id === excludeId) continue;
      const it = e.items.find(x => x.name === name);
      if (!it) continue;
      const done = it.sets.filter(s => s.load || s.reps);
      if (!done.length) continue;
      const top = done.reduce((a, b) => (+b.load || 0) > (+a.load || 0) ? b : a);
      return { date: e.date, set: top };
    }
    return null;
  }
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };

  /* ---------- progress + PRs ---------- */
  // A given exercise's PR metric is heaviest load ever logged (any rep count)
  // for loaded exercises, or highest reps/seconds/distance for bodyweight
  // ones -- inferred from the data itself (does any set for this name have a
  // load value?) rather than needing extra metadata on the logged entry.
  function exerciseUsesLoad(name, entries) {
    return entries.some(e => (e.items.find(x => x.name === name) || {}).sets?.some(s => num(s.load) != null));
  }
  function bestValue(sets, useLoad) {
    let best = null;
    sets.forEach(s => { const v = num(useLoad ? s.load : s.reps); if (v != null && (best == null || v > best)) best = v; });
    return best;
  }
  // Full-history time series for one exercise: one point per session where it
  // was logged, using that session's own best set. Used by both the save-time
  // PR toast and the Progress tab's chart.
  function exerciseHistory(name) {
    const log = getLog();
    const useLoad = exerciseUsesLoad(name, log);
    let unit = useLoad ? UNIT : "reps";
    const points = [];
    log.forEach(e => {
      const it = e.items.find(x => x.name === name);
      if (!it || !it.sets.length) return;
      const v = bestValue(it.sets, useLoad);
      if (v != null) { points.push({ date: e.date, value: v }); if (!useLoad && it.u) unit = it.u; }
    });
    points.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return { useLoad, unit, points };
  }
  // Compares the just-logged entry's items against every OTHER session's
  // history (priorLog should be captured before the new entry is added) and
  // returns the exercises where this entry set a new all-time best. The very
  // first time an exercise is ever logged is a baseline, not a PR.
  function detectPRs(entry, priorLog) {
    const prior = priorLog.filter(e => e.id !== entry.id);
    const prs = [];
    entry.items.forEach(it => {
      if (!it.sets.length) return;
      const historicalSets = prior.flatMap(e => (e.items.find(x => x.name === it.name) || {}).sets || []);
      if (!historicalSets.length) return;
      const useLoad = historicalSets.some(s => num(s.load) != null) || it.sets.some(s => num(s.load) != null);
      const priorBest = bestValue(historicalSets, useLoad);
      const newBest = bestValue(it.sets, useLoad);
      if (priorBest != null && newBest != null && newBest > priorBest) {
        prs.push({ name: it.name, value: newBest, unit: useLoad ? UNIT : (it.u || "reps") });
      }
    });
    return prs;
  }
  // Small hand-built line chart -- no charting library, consistent with the
  // app's dependency-light approach. A single point renders as a lone dot.
  function renderSparkline(points, unit) {
    const W = 280, H = 80, PAD = 10;
    if (!points.length) return "";
    const values = points.map(p => p.value);
    const min = Math.min(...values), max = Math.max(...values);
    const x = i => points.length === 1 ? W / 2 : PAD + (i / (points.length - 1)) * (W - 2 * PAD);
    const y = v => H - PAD - (max === min ? 0.5 : (v - min) / (max - min)) * (H - 2 * PAD);
    const coords = points.map((p, i) => [x(i), y(p.value)]);
    const line = coords.map(([cx, cy]) => `${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ");
    const dots = coords.map(([cx, cy]) => `<circle class="spark-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3"></circle>`).join("");
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${points[0].value}${unit} to ${points[points.length - 1].value}${unit} over ${points.length} sessions">
      ${points.length > 1 ? `<polyline class="spark-line" points="${line}"></polyline>` : ""}
      ${dots}
      <text class="spark-label" x="${PAD}" y="${H - 2}">${esc(fmt(parseISO(points[0].date)))}</text>
      <text class="spark-label" x="${W - PAD}" y="${H - 2}" text-anchor="end">${esc(fmt(parseISO(points[points.length - 1].date)))}</text>
    </svg>`;
  }

  /* ---------- UI state ---------- */
  let view = P ? "session" : "start";
  let selWeek = currentWeek();
  let selKey = null;
  const loggedIds = () => new Set(getLog().map(e => e.sessionId));
  function loggedKeysInWeek(w) {
    if (w === "S") return new Set();
    const s = periodStart(P, w);
    const end = periodEnd(P, w); end.setDate(end.getDate() + 1);
    return new Set(getLog().filter(e => { const d = parseISO(e.date); return d >= s && d < end; }).map(e => e.key));
  }
  function defaultKey(w) {
    const done = loggedKeysInWeek(w);
    return sessionKeys(w).find(k => !done.has(k)) || sessionKeys(w)[0];
  }
  // A past week is "hit" once every one of its planned sessions has a logged
  // entry dated inside that week; "S" (in-season) never resolves to hit/miss
  // since it isn't a fixed 7-day block.
  function isWeekHit(w) {
    const done = loggedKeysInWeek(w);
    return sessionKeys(w).every(k => done.has(k));
  }
  function weekStatus(w) {
    const cw = currentWeek();
    if (w === "S") return cw === "S" ? "current" : "upcoming";
    if (cw === "S" || w < cw) return isWeekHit(w) ? "hit" : "miss";
    return w === cw ? "current" : "upcoming";
  }
  const draftKey = id => "ssl:draft:" + id;
  function getDraft(s) {
    const d = store.get(draftKey(s.id), null);
    if (d) return d;
    return { items: s.items.map(it => ({ sets: Array.from({ length: it.sets }, () => ({ done: false, load: "", reps: "", rpe: "" })), note: "" })), bw: "", sore: null, notes: "" };
  }
  let saveTimer = null;
  function saveDraft(s, d) { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(draftKey(s.id), d), 250); }

  function toast(msg, opts = {}) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    t.classList.toggle("pr", !!opts.pr);
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, opts.pr ? 4200 : 2600);
  }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- render: session ---------- */
  function renderSession() {
    if (!selKey || !sessionKeys(selWeek).includes(selKey)) selKey = defaultKey(selWeek);
    const s = getSession(selWeek, selKey);
    const d = getDraft(s);
    // guard against a program change altering item counts
    while (d.items.length < s.items.length) d.items.push({ sets: [], note: "" });
    s.items.forEach((it, i) => { while (d.items[i].sets.length < it.sets) d.items[i].sets.push({ done: false, load: "", reps: "", rpe: "" }); });

    const logged = loggedIds();
    $("#phaseLine").textContent = `${weekLabel(selWeek)} · ${PHASE(selWeek)}`;
    const warmupTpl = s.warmupTemplate ? P.warmupTemplates.find(t => t.key === s.warmupTemplate) : null;
    const noSpikes = s.noWarmupSpikes;

    app.innerHTML = `
      <div class="weeks-row">
        <button type="button" class="weeks-nav" id="weeksPrev" aria-label="Scroll weeks left">‹</button>
        <div class="weeks" role="group" aria-label="Week" id="weeksScroll">
          ${WEEKS.map(w => {
            const status = weekStatus(w);
            const label = w === "S" ? "In-season" : "Wk " + w;
            // status conveyed by more than color alone (WCAG 1.4.1): a glyph in
            // the label plus a fuller aria-label for screen readers
            const glyph = status === "hit" ? " ✓" : status === "miss" ? " ✕" : "";
            const statusWord = { hit: "completed", miss: "missed", current: "current week", upcoming: "upcoming" }[status];
            const dateInfo = w === "S" ? "" : `, ${weekDates(w)}`;
            return `<button type="button" class="chip status-${status}" data-week="${w}" aria-pressed="${w === selWeek}" aria-label="${esc(label)}${esc(dateInfo)}, ${statusWord}">${esc(label)}${glyph}</button>`;
          }).join("")}
        </div>
        <button type="button" class="weeks-nav" id="weeksNext" aria-label="Scroll weeks right">›</button>
      </div>
      <div class="sessions" role="group" aria-label="Session">
        ${sessionKeys(selWeek).map(k => {
          const label = (getSession(selWeek, k) || {}).shortLabel || k;
          return `<button type="button" class="seg" data-key="${k}" aria-pressed="${k === selKey}">${esc(label)}${logged.has(`w${selWeek}-${k}`) ? '<span class="tick" aria-label="logged">●</span>' : ""}</button>`;
        }).join("")}
      </div>
      <div class="head">
        <div class="eyebrow">${esc(weekLabel(selWeek))} · ${esc(weekDates(selWeek))} · ${esc(PHASE(selWeek))}</div>
        <h1>${esc(s.title)}</h1>
        <div class="progress" id="prog"></div>
      </div>
      ${warmupTpl ? `
      <details class="panel" id="warm" open>
        <summary><span><h2>Warm-up · ${esc(warmupTpl.ergName)}</h2><span class="progress">7 min erg · mobility · activation · ~14 min</span></span></summary>
        <div class="panel-body">
          <table class="erg"><tbody>${warmupTpl.erg.map((r, i) => `<tr${i === 2 && noSpikes ? ' style="opacity:.45"' : ""}><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join("")}</tbody></table>
          ${noSpikes ? '<p class="note-muted">Skip the spikes today (ME, deload or ski-specific day).</p>' : ""}
          ${s.testDayNote ? `<p class="note-muted">${esc(s.testDayNote)}</p>` : ""}
          <p class="kv"><b>Mobility · 3 min</b>${esc(warmupTpl.mobility)}</p>
          <p class="kv"><b>Activation · 3–4 min</b>${esc(P.activation[warmupTpl.activationGroup])}</p>
          <p class="kv"><b>Then</b>2–4 ramp sets to the first working weight.</p>
          <button type="button" class="ex-next" id="warmDone">✓ Done — start workout</button>
        </div>
      </details>` : ""}
      <div id="items"></div>
      <section class="finish" aria-label="Finish session">
        <div class="grid2">
          <div><label class="lab" for="bw">Body weight</label><div class="field"><input id="bw" inputmode="decimal" value="${esc(d.bw)}" placeholder="210"><span>${UNIT}</span></div></div>
          <div><label class="lab">Soreness today</label><div class="soreness" id="sore">${[0, 1, 2, 3, 4, 5].map(n => `<button type="button" data-s="${n}" aria-pressed="${d.sore === n}">${n}</button>`).join("")}</div></div>
        </div>
        <label class="lab" for="snotes" style="margin-top:12px">Session notes</label>
        <textarea id="snotes" placeholder="Sleep, energy, anything that felt off or great">${esc(d.notes)}</textarea>
        <button type="button" class="primary" id="saveBtn">Save to log</button>
        <div class="btns"><button type="button" class="secondary" id="clearBtn">Clear this session</button></div>
      </section>`;

    const wrap = $("#items");
    groupSessionItems(s.items).forEach(({ items, indices }) => {
      wrap.appendChild(items.length > 1 ? renderItemGroup(s, items, indices, d) : renderItem(s, items[0], d, indices[0]));
    });
    updateProgress(s, d);

    const warmDone = $("#warmDone");
    if (warmDone) warmDone.onclick = () => {
      $("#warm").open = false;
      const first = wrap.firstElementChild;
      if (first) { first.open = true; first.scrollIntoView({ behavior: "smooth", block: "start" }); }
    };

    app.querySelectorAll("[data-week]").forEach(b => b.onclick = () => { selWeek = b.dataset.week === "S" ? "S" : +b.dataset.week; selKey = null; render(); window.scrollTo(0, 0); });
    app.querySelectorAll("[data-key]").forEach(b => b.onclick = () => { selKey = b.dataset.key; render(); });
    $("#bw").oninput = e => { d.bw = e.target.value; saveDraft(s, d); };
    $("#snotes").oninput = e => { d.notes = e.target.value; saveDraft(s, d); };
    $("#sore").querySelectorAll("button").forEach(b => b.onclick = () => {
      d.sore = +b.dataset.s; saveDraft(s, d);
      $("#sore").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
    });
    $("#saveBtn").onclick = () => saveSession(s, d);
    const clr = $("#clearBtn");
    clr.onclick = () => {
      if (clr.dataset.armed) { store.del(draftKey(s.id)); toast("Cleared"); render(); return; }
      clr.dataset.armed = "1"; clr.textContent = "Tap again to clear"; clr.classList.add("danger");
      setTimeout(() => { if (clr.isConnected) { delete clr.dataset.armed; clr.textContent = "Clear this session"; clr.classList.remove("danger"); } }, 3000);
    };
    const pressed = app.querySelector('.chip[aria-pressed="true"]');
    if (pressed) pressed.scrollIntoView({ block: "nearest", inline: "center" });

    const scroller = $("#weeksScroll"), prevBtn = $("#weeksPrev"), nextBtn = $("#weeksNext");
    const updateNav = () => {
      prevBtn.disabled = scroller.scrollLeft <= 0;
      nextBtn.disabled = scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 1;
    };
    prevBtn.onclick = () => scroller.scrollBy({ left: -160, behavior: "smooth" });
    nextBtn.onclick = () => scroller.scrollBy({ left: 160, behavior: "smooth" });
    scroller.onscroll = updateNav;
    updateNav();
  }

  // Groups consecutive items sharing the same options.group value into one
  // block (a superset/paired exercise); ungrouped items, or a lone item that
  // happens to carry a group value by itself, render as normal singles.
  function groupSessionItems(items) {
    const groups = [];
    let i = 0;
    while (i < items.length) {
      const g = items[i].group;
      const groupItems = [items[i]], indices = [i];
      let j = i + 1;
      if (g) while (j < items.length && items[j].group === g) { groupItems.push(items[j]); indices.push(j); j++; }
      groups.push({ items: groupItems, indices });
      i = j;
    }
    return groups;
  }

  function renderItem(s, it, d, i, open) {
    const el = document.createElement("details");
    const di = d.items[i];
    const tgt = targetLoad(it);
    const last = lastFor(it.name, null);
    const url = it.v && P.videos[it.v];
    const unit = it.u || "reps";
    const cls = `set${it.bw ? " nl" : ""}${it.norpe ? " nr" : ""}`;
    const loadPh = tgt ? String(tgt) : last && last.set.load ? String(last.set.load) : "";
    const repsPh = it.reps || "";
    const maxInfo = it.lift && it.pct ? getMax(it.lift) : null;
    const isLast = i === s.items.length - 1;
    el.className = "ex";
    if (open) el.open = true;
    el.innerHTML = `
      <summary>
        <div class="ex-top">
          <div class="ex-name">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(it.name)}</a>` : esc(it.name)}${it.desc ? `<button type="button" class="ex-info" aria-expanded="false" aria-controls="desc-${s.id}-${i}" aria-label="What is ${esc(it.name)}?">ⓘ</button>` : ""}</div>
          <div class="ex-actions">
            <span class="ex-done-badge" hidden>✓ Done</span>
            ${url ? `<a class="vid" href="${esc(url)}" target="_blank" rel="noopener">Video ↗</a>` : ""}
            <span class="disclosure" aria-hidden="true"></span>
          </div>
        </div>
        ${it.desc ? `<p class="ex-desc" id="desc-${s.id}-${i}" hidden>${esc(it.desc)}</p>` : ""}
        <div class="rx">${esc(it.rx)}</div>
        <div class="meta">
          ${tgt ? `<span class="tag target">Target ${tgt} ${UNIT}</span>` : ""}
          ${it.lift && it.pct && !maxInfo ? `<span class="tag">Target appears after your Week 1 test</span>` : ""}
          ${last ? `<span class="tag">Last: ${esc([last.set.load && last.set.load + " " + UNIT, last.set.reps && last.set.reps + (it.u ? " " + it.u : ""), last.set.rpe && "@" + last.set.rpe].filter(Boolean).join(" × "))} · ${fmt(parseISO(last.date))}</span>` : ""}
        </div>
        ${it.n ? `<div class="cue">${esc(it.n)}</div>` : ""}
        ${it.circuit ? `<div class="cue">${esc(P.circuits[it.circuit])}</div>` : ""}
      </summary>
      <div class="ex-body">
        <div class="sets">
          <div class="sets-head ${cls}" aria-hidden="true"><span>Set</span>${it.bw ? "" : "<span>Load</span>"}<span>${esc(unit)}</span>${it.norpe ? "" : "<span>RPE</span>"}</div>
          ${di.sets.map((st, k) => `
            <div class="${cls}" data-k="${k}">
              <button type="button" class="n" aria-pressed="${st.done}" aria-label="Mark set ${k + 1} done">${st.done ? "✓" : k + 1}</button>
              ${it.bw ? "" : `<div class="field"><input id="l-${s.id}-${i}-${k}" data-f="load" inputmode="decimal" value="${esc(st.load)}" placeholder="${loadPh}" aria-label="Set ${k + 1} load"><span>${UNIT}</span></div>`}
              <div class="field"><input id="r-${s.id}-${i}-${k}" data-f="reps" inputmode="decimal" value="${esc(st.reps)}" placeholder="${esc(repsPh)}" aria-label="Set ${k + 1} ${esc(unit)}"><span>${esc(it.u || "")}</span></div>
              ${it.norpe ? "" : `<div class="field"><input id="p-${s.id}-${i}-${k}" data-f="rpe" inputmode="decimal" value="${esc(st.rpe)}" placeholder="RPE" aria-label="Set ${k + 1} RPE"></div>`}
            </div>`).join("")}
        </div>
        <div class="row-actions">
          <button type="button" class="link-btn" data-act="add">+ Set</button>
          <button type="button" class="link-btn" data-act="note">${di.note ? "Edit note" : "+ Note"}</button>
        </div>
        <textarea data-f="note" placeholder="How it felt, pain, form cues" ${di.note ? "" : "hidden"}>${esc(di.note)}</textarea>
        <button type="button" class="ex-next" data-act="next" aria-label="${isLast ? "Mark done" : "Mark done and go to next exercise"}">✓ Done${isLast ? "" : " — next exercise"}</button>
      </div>`;

    // Exercise-name clarification: hover or keyboard focus shows it (desktop);
    // a long-press shows it as a temporary peek (mobile); a quick tap/click or
    // Enter/Space pins it open until tapped again. stopPropagation keeps the
    // button from also toggling the enclosing <details> disclosure.
    const infoBtn = el.querySelector(".ex-info");
    if (infoBtn) {
      const descEl = el.querySelector(".ex-desc");
      let longPressTimer = null, longPressFired = false;
      const showDesc = () => { descEl.hidden = false; infoBtn.setAttribute("aria-expanded", "true"); };
      const hideDesc = () => { descEl.hidden = true; infoBtn.setAttribute("aria-expanded", "false"); };
      infoBtn.onclick = e => {
        e.preventDefault(); e.stopPropagation();
        if (longPressFired) { longPressFired = false; return; }
        descEl.hidden ? showDesc() : hideDesc();
      };
      infoBtn.onmouseenter = showDesc;
      infoBtn.onmouseleave = () => { if (document.activeElement !== infoBtn) hideDesc(); };
      infoBtn.onfocus = showDesc;
      infoBtn.onblur = hideDesc;
      infoBtn.ontouchstart = e => {
        e.stopPropagation();
        longPressFired = false;
        longPressTimer = setTimeout(() => { longPressFired = true; showDesc(); }, 450);
      };
      infoBtn.ontouchend = e => {
        e.stopPropagation();
        clearTimeout(longPressTimer);
        if (longPressFired) hideDesc();
      };
      infoBtn.ontouchcancel = () => { clearTimeout(longPressTimer); longPressFired = false; };
    }

    const doneBadge = el.querySelector(".ex-done-badge");
    // "done" isn't color-only (WCAG 1.4.1): the badge is real text, not a
    // CSS-generated glyph, so it's read by screen readers and visible
    // regardless of the green tint for colorblind users.
    const refreshDone = () => {
      const isDone = di.sets.length > 0 && di.sets.every(x => x.done);
      el.classList.toggle("done", isDone);
      doneBadge.hidden = !isDone;
    };
    refreshDone();
    el.querySelectorAll(".set[data-k]").forEach(row => {
      const k = +row.dataset.k, st = di.sets[k];
      row.querySelector(".n").onclick = e => {
        st.done = !st.done;
        if (st.done) {
          row.querySelectorAll("input").forEach(inp => {
            if (!inp.value && inp.placeholder && /^\d+(\.\d+)?$/.test(inp.placeholder)) { inp.value = inp.placeholder; st[inp.dataset.f] = inp.value; }
          });
        }
        e.currentTarget.setAttribute("aria-pressed", st.done); e.currentTarget.textContent = st.done ? "✓" : k + 1;
        refreshDone(); updateProgress(s, d); saveDraft(s, d);
      };
      row.querySelectorAll("input").forEach(inp => inp.oninput = () => {
        st[inp.dataset.f] = inp.value; saveDraft(s, d);
        // carry a typed load/RPE forward as the placeholder for later sets
        if (inp.dataset.f !== "reps") el.querySelectorAll(`.set[data-k] input[data-f="${inp.dataset.f}"]`).forEach(o => { if (+o.closest(".set").dataset.k > k && !o.value) o.placeholder = inp.value; });
      });
    });
    const ta = el.querySelector("textarea");
    ta.oninput = () => { di.note = ta.value; saveDraft(s, d); };
    el.querySelector('[data-act="note"]').onclick = () => { ta.hidden = false; ta.focus(); };
    el.querySelector('[data-act="add"]').onclick = () => {
      di.sets.push({ done: false, load: "", reps: "", rpe: "" }); store.set(draftKey(s.id), d);
      el.replaceWith(renderItem(s, it, d, i, el.open)); updateProgress(s, d);
    };
    el.querySelector('[data-act="next"]').onclick = () => {
      el.open = false;
      const next = el.nextElementSibling;
      if (next && next.tagName === "DETAILS") { next.open = true; next.scrollIntoView({ behavior: "smooth", block: "start" }); }
    };
    return el;
  }

  // A superset/paired block: one <details> card containing every exercise in
  // the group, each labeled A1/A2/... Each sub-exercise keeps its own name,
  // video, description, target, "last time", cue, and set-table -- only the
  // outer disclosure, done-badge, and "Done -> next" button are shared.
  function renderItemGroup(s, items, indices, d, open) {
    const el = document.createElement("details");
    el.className = "ex ex-group";
    if (open) el.open = true;
    const isLast = indices[indices.length - 1] === s.items.length - 1;
    const groupKey = items[0].group;

    const subHTML = items.map((it, gi) => {
      const i = indices[gi];
      const di = d.items[i];
      const tgt = targetLoad(it);
      const last = lastFor(it.name, null);
      const url = it.v && P.videos[it.v];
      const unit = it.u || "reps";
      const cls = `set${it.bw ? " nl" : ""}${it.norpe ? " nr" : ""}`;
      const loadPh = tgt ? String(tgt) : last && last.set.load ? String(last.set.load) : "";
      const repsPh = it.reps || "";
      const maxInfo = it.lift && it.pct ? getMax(it.lift) : null;
      return `
        <div class="ex-sub" data-i="${i}">
          <div class="ex-sub-label">${esc(groupKey)}${gi + 1}</div>
          <div class="ex-top">
            <div class="ex-name">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(it.name)}</a>` : esc(it.name)}${it.desc ? `<button type="button" class="ex-info" aria-expanded="false" aria-controls="desc-${s.id}-${i}" aria-label="What is ${esc(it.name)}?">ⓘ</button>` : ""}</div>
            ${url ? `<a class="vid" href="${esc(url)}" target="_blank" rel="noopener">Video ↗</a>` : ""}
          </div>
          ${it.desc ? `<p class="ex-desc" id="desc-${s.id}-${i}" hidden>${esc(it.desc)}</p>` : ""}
          <div class="rx">${esc(it.rx)}</div>
          <div class="meta">
            ${tgt ? `<span class="tag target">Target ${tgt} ${UNIT}</span>` : ""}
            ${it.lift && it.pct && !maxInfo ? `<span class="tag">Target appears after your Week 1 test</span>` : ""}
            ${last ? `<span class="tag">Last: ${esc([last.set.load && last.set.load + " " + UNIT, last.set.reps && last.set.reps + (it.u ? " " + it.u : ""), last.set.rpe && "@" + last.set.rpe].filter(Boolean).join(" × "))} · ${fmt(parseISO(last.date))}</span>` : ""}
          </div>
          ${it.n ? `<div class="cue">${esc(it.n)}</div>` : ""}
          ${it.circuit ? `<div class="cue">${esc(P.circuits[it.circuit])}</div>` : ""}
          <div class="sets">
            <div class="sets-head ${cls}" aria-hidden="true"><span>Set</span>${it.bw ? "" : "<span>Load</span>"}<span>${esc(unit)}</span>${it.norpe ? "" : "<span>RPE</span>"}</div>
            ${di.sets.map((st, k) => `
              <div class="${cls}" data-k="${k}">
                <button type="button" class="n" aria-pressed="${st.done}" aria-label="Mark set ${k + 1} done">${st.done ? "✓" : k + 1}</button>
                ${it.bw ? "" : `<div class="field"><input id="l-${s.id}-${i}-${k}" data-f="load" inputmode="decimal" value="${esc(st.load)}" placeholder="${loadPh}" aria-label="Set ${k + 1} load"><span>${UNIT}</span></div>`}
                <div class="field"><input id="r-${s.id}-${i}-${k}" data-f="reps" inputmode="decimal" value="${esc(st.reps)}" placeholder="${esc(repsPh)}" aria-label="Set ${k + 1} ${esc(unit)}"><span>${esc(it.u || "")}</span></div>
                ${it.norpe ? "" : `<div class="field"><input id="p-${s.id}-${i}-${k}" data-f="rpe" inputmode="decimal" value="${esc(st.rpe)}" placeholder="RPE" aria-label="Set ${k + 1} RPE"></div>`}
              </div>`).join("")}
          </div>
          <div class="row-actions">
            <button type="button" class="link-btn" data-act="add" data-i="${i}">+ Set</button>
            <button type="button" class="link-btn" data-act="note" data-i="${i}">${di.note ? "Edit note" : "+ Note"}</button>
          </div>
          <textarea data-f="note" data-i="${i}" placeholder="How it felt, pain, form cues" ${di.note ? "" : "hidden"}>${esc(di.note)}</textarea>
        </div>`;
    }).join(`<hr class="ex-sub-divider">`);

    el.innerHTML = `
      <summary>
        <div class="ex-top">
          <div class="ex-name">${esc(items.map(it => it.name).join(" + "))}</div>
          <div class="ex-actions">
            <span class="ex-done-badge" hidden>✓ Done</span>
            <span class="tag">Superset</span>
            <span class="disclosure" aria-hidden="true"></span>
          </div>
        </div>
        <div class="rx">${esc(items.map(it => it.rx).join(" · "))}</div>
      </summary>
      <div class="ex-body">
        ${subHTML}
        <button type="button" class="ex-next" data-act="next" aria-label="${isLast ? "Mark done" : "Mark done and go to next exercise"}">✓ Done${isLast ? "" : " — next exercise"}</button>
      </div>`;

    // Exercise-name clarification, wired per sub-exercise -- identical
    // hover/long-press/click behavior to a single exercise's info button.
    el.querySelectorAll(".ex-sub").forEach(sub => {
      const infoBtn = sub.querySelector(".ex-info");
      if (!infoBtn) return;
      const descEl = sub.querySelector(".ex-desc");
      let longPressTimer = null, longPressFired = false;
      const showDesc = () => { descEl.hidden = false; infoBtn.setAttribute("aria-expanded", "true"); };
      const hideDesc = () => { descEl.hidden = true; infoBtn.setAttribute("aria-expanded", "false"); };
      infoBtn.onclick = e => {
        e.preventDefault(); e.stopPropagation();
        if (longPressFired) { longPressFired = false; return; }
        descEl.hidden ? showDesc() : hideDesc();
      };
      infoBtn.onmouseenter = showDesc;
      infoBtn.onmouseleave = () => { if (document.activeElement !== infoBtn) hideDesc(); };
      infoBtn.onfocus = showDesc;
      infoBtn.onblur = hideDesc;
      infoBtn.ontouchstart = e => {
        e.stopPropagation();
        longPressFired = false;
        longPressTimer = setTimeout(() => { longPressFired = true; showDesc(); }, 450);
      };
      infoBtn.ontouchend = e => {
        e.stopPropagation();
        clearTimeout(longPressTimer);
        if (longPressFired) hideDesc();
      };
      infoBtn.ontouchcancel = () => { clearTimeout(longPressTimer); longPressFired = false; };
    });

    // "Done" for the group reflects every sub-exercise being fully done, not
    // just one -- matches WCAG 1.4.1 the same way a single exercise's badge
    // does (real text, not a color-only signal).
    const doneBadge = el.querySelector(".ex-done-badge");
    const refreshDone = () => {
      const allDone = indices.every(i => d.items[i].sets.length > 0 && d.items[i].sets.every(x => x.done));
      el.classList.toggle("done", allDone);
      doneBadge.hidden = !allDone;
    };
    refreshDone();

    items.forEach((it, gi) => {
      const i = indices[gi];
      const di = d.items[i];
      const sub = el.querySelector(`.ex-sub[data-i="${i}"]`);
      sub.querySelectorAll(".set[data-k]").forEach(row => {
        const k = +row.dataset.k, st = di.sets[k];
        row.querySelector(".n").onclick = e => {
          st.done = !st.done;
          if (st.done) {
            row.querySelectorAll("input").forEach(inp => {
              if (!inp.value && inp.placeholder && /^\d+(\.\d+)?$/.test(inp.placeholder)) { inp.value = inp.placeholder; st[inp.dataset.f] = inp.value; }
            });
          }
          e.currentTarget.setAttribute("aria-pressed", st.done); e.currentTarget.textContent = st.done ? "✓" : k + 1;
          refreshDone(); updateProgress(s, d); saveDraft(s, d);
        };
        row.querySelectorAll("input").forEach(inp => inp.oninput = () => {
          st[inp.dataset.f] = inp.value; saveDraft(s, d);
          if (inp.dataset.f !== "reps") sub.querySelectorAll(`.set[data-k] input[data-f="${inp.dataset.f}"]`).forEach(o => { if (+o.closest(".set").dataset.k > k && !o.value) o.placeholder = inp.value; });
        });
      });
      const ta = sub.querySelector("textarea");
      ta.oninput = () => { di.note = ta.value; saveDraft(s, d); };
      sub.querySelector('[data-act="note"]').onclick = () => { ta.hidden = false; ta.focus(); };
      sub.querySelector('[data-act="add"]').onclick = () => {
        di.sets.push({ done: false, load: "", reps: "", rpe: "" }); store.set(draftKey(s.id), d);
        el.replaceWith(renderItemGroup(s, items, indices, d, el.open)); updateProgress(s, d);
      };
    });

    el.querySelector('[data-act="next"]').onclick = () => {
      el.open = false;
      const next = el.nextElementSibling;
      if (next && next.tagName === "DETAILS") { next.open = true; next.scrollIntoView({ behavior: "smooth", block: "start" }); }
    };

    return el;
  }

  function updateProgress(s, d) {
    const all = d.items.slice(0, s.items.length).flatMap(x => x.sets);
    const done = all.filter(x => x.done).length;
    const p = $("#prog"); if (p) p.textContent = `${done}/${all.length} sets done · ${s.items.length} exercises`;
  }

  function saveSession(s, d) {
    const entry = {
      id: `${iso(new Date())}-${s.id}-${Date.now().toString(36)}`,
      date: iso(new Date()), sessionId: s.id, week: s.week, key: s.key, title: s.title,
      bw: d.bw, sore: d.sore, notes: d.notes,
      items: s.items.map((it, i) => ({
        name: it.name, rx: it.rx, u: it.u || "", t: it.t || null,
        target: targetLoad(it),
        sets: d.items[i].sets.filter(x => x.done || x.load || x.reps || x.rpe).map(x => ({ load: x.load, reps: x.reps, rpe: x.rpe })),
        note: d.items[i].note
      }))
    };
    if (!entry.items.some(x => x.sets.length) && !entry.notes) { toast("Nothing logged yet: tap a set number to mark it done"); return; }
    const priorLog = getLog();
    const prs = detectPRs(entry, priorLog);
    const log = priorLog.slice(); log.push(entry);
    if (!store.set(LOG, log)) { toast("Couldn't save: this browser is blocking storage"); return; }
    if (window.SYNC) window.SYNC.queueUpsertSession(entry);
    let msg = "Saved to log";
    const rec = testsFromEntry(entry);
    if (rec) { mergeTest(rec); msg = "Saved. Test results recorded"; }
    store.del(draftKey(s.id));
    if (prs.length) {
      const list = prs.map(p => `${p.name} ${p.value} ${p.unit}`).join(", ");
      toast(`Saved — 🎉 New PR: ${list}`, { pr: true });
    } else {
      toast(msg);
    }
    selKey = null; render(); window.scrollTo(0, 0);
  }

  /* ---------- tests ---------- */
  // Sourced from the program's testDefinitions instead of a hardcoded array,
  // so a future non-ski program can define entirely different tests without
  // any app.js change. "lift" here is app.js's own local sentinel (matching
  // the pre-existing load+reps-pair rendering below), translated from the
  // program-schema's "load-reps-e1rm" kind.
  // "lift"/"max-load"/"max-value" are app.js's own local sentinels (kept for
  // the pre-existing load+reps-pair rendering below), translated from the
  // program schema's own kind vocabulary: load-reps-e1rm / max-load / max-value.
  const TEST_FIELDS = P ? P.testDefinitions.map(t => [t.key, t.label, t.unit, t.kind === "load-reps-e1rm" ? "lift" : t.kind]) : [];
  const kindForTest = key => (TEST_FIELDS.find(f => f[0] === key) || [])[3];
  function testsFromEntry(e) {
    const v = {};
    e.items.forEach(it => {
      if (!it.t || !it.sets.length) return;
      const kind = kindForTest(it.t);
      if (kind === "lift") {
        let best = null;
        it.sets.forEach(x => { const l = num(x.load), r = num(x.reps); if (l && r) { const e1 = e1rm(l, r); if (!best || e1 > best.e1rm) best = { load: l, reps: r, e1rm: e1 }; } });
        if (best) v[it.t] = best;
      } else if (kind === "max-load") {
        const m = Math.max(...it.sets.map(x => num(x.load) || 0)); if (m) v[it.t] = m;
      } else {
        const m = Math.max(...it.sets.map(x => num(x.reps) || 0)); if (m) v[it.t] = m;
      }
    });
    if (!Object.keys(v).length) return null;
    if (num(e.bw)) v.bw = num(e.bw);
    return { date: e.date, v };
  }
  function mergeTest(rec) {
    const t = getTests(); const ex = t.find(r => r.date === rec.date);
    if (ex) Object.assign(ex.v, rec.v); else t.push(rec);
    store.set(TESTS, t);
    if (window.SYNC) window.SYNC.queueUpsertTest(ex || rec);
  }
  const showVal = v => v == null ? "" : typeof v === "object" ? `${v.load}×${v.reps} → ${v.e1rm}` : String(v);

  function renderTests() {
    const tests = getTests().slice().sort((a, b) => a.date < b.date ? -1 : 1);
    $("#phaseLine").textContent = "Tests + maxes";
    const sq = getMax("squat"), dl = getMax("deadlift");
    app.innerHTML = `
      <div class="head"><div class="eyebrow">Estimated 1RM drives every % target</div><h1>Tests + maxes</h1></div>
      <div class="maxes">
        <div class="stat"><b>Squat e1RM</b><span>${sq ? sq.v + " " + UNIT : "—"}</span><em>${sq ? esc(sq.src) : "Test in Week 1, Day 2"}</em></div>
        <div class="stat"><b>Deadlift e1RM</b><span>${dl ? dl.v + " " + UNIT : "—"}</span><em>${dl ? esc(dl.src) : "Test in Week 1, Day 2"}</em></div>
      </div>
      ${tests.length ? `<div class="tbl-wrap"><table class="tests"><thead><tr><th scope="col">Test</th>${tests.map(t => `<th scope="col">${fmt(parseISO(t.date))}</th>`).join("")}</tr></thead><tbody>
        ${TEST_FIELDS.filter(f => tests.some(t => t.v[f[0]] != null)).map(f => `<tr><th scope="row">${esc(f[1])} <span class="progress">${esc(f[2])}</span></th>${tests.map(t => `<td class="num">${esc(showVal(t.v[f[0]]))}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">No tests yet. Week 1 test sessions fill this in when you save them, or add results below.</p>`}
      <details class="panel" id="addTest">
        <summary><h2>Add or correct results</h2></summary>
        <div class="panel-body">
          <div class="test-form">
            <div class="full"><label class="lab" for="tdate">Date</label><div class="field"><input id="tdate" type="date" value="${iso(new Date())}"></div></div>
            ${TEST_FIELDS.map(([k, label, unit, kind]) => kind === "lift"
              ? `<div class="full"><label class="lab">${esc(label)} (rep max)</label><div class="grid2"><div class="field"><input id="t-${k}-l" inputmode="decimal" placeholder="load"><span>${UNIT}</span></div><div class="field"><input id="t-${k}-r" inputmode="decimal" placeholder="reps"><span>reps</span></div></div></div>`
              : `<div><label class="lab" for="t-${k}">${esc(label)}</label><div class="field"><input id="t-${k}" inputmode="decimal"><span>${esc(unit)}</span></div></div>`).join("")}
          </div>
          <button type="button" class="primary" id="tSave">Save results</button>
        </div>
      </details>`;
    $("#tSave").onclick = () => {
      const date = $("#tdate").value || iso(new Date()); const v = {};
      TEST_FIELDS.forEach(([k, , , kind]) => {
        if (kind === "lift") { const l = num($(`#t-${k}-l`).value), r = num($(`#t-${k}-r`).value); if (l && r) v[k] = { load: l, reps: r, e1rm: e1rm(l, r) }; }
        else { const x = num($(`#t-${k}`).value); if (x != null) v[k] = x; }
      });
      if (!Object.keys(v).length) { toast("Enter at least one result"); return; }
      mergeTest({ date, v }); toast("Results saved"); render();
    };
  }

  function renderProgress() {
    const log = getLog();
    $("#phaseLine").textContent = "Progress + PRs";
    const names = Array.from(new Set(log.flatMap(e => e.items.filter(it => it.sets.length).map(it => it.name)))).sort();
    const recentCutoff = new Date(); recentCutoff.setDate(recentCutoff.getDate() - 7);
    const rows = names.map(name => {
      const { unit, points } = exerciseHistory(name);
      if (!points.length) return null;
      const best = points.reduce((a, b) => b.value > a.value ? b : a);
      const isRecent = parseISO(best.date) >= recentCutoff;
      return { name, unit, best, isRecent, points };
    }).filter(Boolean);

    app.innerHTML = `
      <div class="head"><div class="eyebrow">Best lifts across your whole log</div><h1>Progress</h1></div>
      ${rows.length ? `<div id="prList"></div>` : `<p class="empty">Nothing logged yet. Personal records show up here once you've saved a few sessions.</p>`}`;

    const box = $("#prList");
    if (!box) return;
    rows.forEach(row => {
      const det = document.createElement("details"); det.className = "entry";
      det.innerHTML = `<summary><span><b>${esc(row.name)}</b>${row.isRecent ? '<span class="pr-badge">New PR</span>' : ""}</span><span class="d">${esc(String(row.best.value))} ${esc(row.unit)} · ${fmt(parseISO(row.best.date))}</span></summary>
        <div class="b">${renderSparkline(row.points, row.unit)}</div>`;
      box.appendChild(det);
    });
  }

  /* ---------- log + export ---------- */
  function exportText() {
    const log = getLog(), tests = getTests();
    const lines = [`SKI STRENGTH LOG — exported ${iso(new Date())}`];
    const sq = getMax("squat"), dl = getMax("deadlift");
    lines.push(`Current e1RM: squat ${sq ? sq.v : "—"} ${UNIT} · deadlift ${dl ? dl.v : "—"} ${UNIT}`);
    if (tests.length) {
      lines.push("", "TESTS");
      tests.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach(t => lines.push(`${t.date}: ` + TEST_FIELDS.filter(f => t.v[f[0]] != null).map(f => `${f[1]} ${showVal(t.v[f[0]])}${typeof t.v[f[0]] === "object" ? "" : " " + f[2]}`).join("; ")));
    }
    lines.push("", "SESSIONS");
    log.forEach(e => {
      lines.push("", `## ${e.date} · ${weekLabel(e.week)} ${e.key} · ${e.title}` + [e.bw && ` · BW ${e.bw}`, e.sore != null && ` · soreness ${e.sore}/5`].filter(Boolean).join(""));
      e.items.forEach(it => {
        if (!it.sets.length && !it.note) return;
        const sets = it.sets.map(x => [x.load && x.load, x.reps && x.reps + (it.u ? it.u : "")].filter(Boolean).join("×") + (x.rpe ? "@" + x.rpe : "")).join(", ");
        lines.push(`- ${it.name} [${it.rx}${it.target ? `, target ${it.target}` : ""}]: ${sets || "done"}${it.note ? ` — ${it.note}` : ""}`);
      });
      if (e.notes) lines.push(`Notes: ${e.notes}`);
    });
    return lines.join("\n");
  }
  const exportJSON = () => JSON.stringify({ app: "ski-strength-log", exported: new Date().toISOString(), programVersion: programMeta.versionNo ?? null, log: getLog(), tests: getTests() }, null, 1);

  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch (e) { const ta = $("#ioText"); if (ta) { ta.value = text; ta.hidden = false; ta.select(); } toast("Select all and copy the text below"); }
  }

  function renderLog() {
    const log = getLog().slice().reverse();
    $("#phaseLine").textContent = `${log.length} session${log.length === 1 ? "" : "s"} logged`;
    app.innerHTML = `
      <div class="head"><div class="eyebrow">Send this to Claude to update the program</div><h1>Log</h1></div>
      <section class="panel io"><div class="panel-body" style="padding-top:14px">
        <div class="btns" style="margin-top:0">
          <button type="button" class="secondary" id="cpText">Copy for Claude</button>
          <button type="button" class="secondary" id="share">Share file</button>
          <button type="button" class="secondary" id="dl">Download backup</button>
          <button type="button" class="secondary" id="imp">Import backup</button>
        </div>
        <p class="note-muted">Copy for Claude gives a plain-text summary to paste into our chat. Share file sends a backup to Drive, Gmail or Keep.</p>
        <textarea id="ioText" hidden aria-label="Export or import text"></textarea>
        <input type="file" id="impFile" accept="application/json,.json" hidden>
        <div id="impBox" hidden>
          <label class="lab" for="impPaste" style="margin-top:10px">Paste backup JSON, or pick a file</label>
          <textarea id="impPaste" placeholder='{"app":"ski-strength-log", ...}'></textarea>
          <div class="btns"><button type="button" class="secondary" id="impGo">Import pasted</button><button type="button" class="secondary" id="impPick">Choose file</button></div>
        </div>
      </div></section>
      <div id="entries">${log.length ? "" : '<p class="empty">No sessions saved yet.</p>'}</div>`;
    const box = $("#entries");
    log.forEach(e => {
      const det = document.createElement("details"); det.className = "entry";
      const setCount = e.items.reduce((a, it) => a + it.sets.length, 0);
      det.innerHTML = `<summary><span><b>${esc(weekLabel(e.week))} ${esc(e.key)}</b> · ${esc(e.title)}</span><span class="d">${fmt(parseISO(e.date))} · ${setCount} sets</span></summary>
        <div class="b">
          ${e.items.filter(it => it.sets.length || it.note).map(it => `<p><span class="x">${esc(it.name)}</span><br><span class="v">${esc(it.sets.map(x => [x.load, x.reps && x.reps + (it.u || "")].filter(Boolean).join("×") + (x.rpe ? "@" + x.rpe : "")).join(", "))}</span>${it.note ? `<br><i>${esc(it.note)}</i>` : ""}</p>`).join("")}
          ${e.notes ? `<p><i>${esc(e.notes)}</i></p>` : ""}
          <p class="progress">${[e.bw && "BW " + e.bw, e.sore != null && "Soreness " + e.sore + "/5"].filter(Boolean).join(" · ")}</p>
          <button type="button" class="link-btn danger" data-del="${esc(e.id)}">Delete entry</button>
        </div>`;
      box.appendChild(det);
    });
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to delete"; return; }
      store.set(LOG, getLog().filter(x => x.id !== b.dataset.del));
      if (window.SYNC) window.SYNC.queueDeleteSession(b.dataset.del);
      toast("Entry deleted"); render();
    });
    $("#cpText").onclick = () => copy(exportText(), "Copied. Paste it into your chat with Claude");
    const file = () => new File([exportJSON()], `ski-strength-log-${iso(new Date())}.json`, { type: "application/json" });
    $("#share").onclick = async () => {
      const f = file();
      if (navigator.canShare && navigator.canShare({ files: [f] })) {
        try { await navigator.share({ files: [f], title: "Ski strength log", text: exportText().slice(0, 2000) }); } catch (e) { /* dismissed */ }
      } else copy(exportJSON(), "Sharing isn't available here; backup JSON copied instead");
    };
    $("#dl").onclick = () => {
      const a = document.createElement("a"); a.href = URL.createObjectURL(file()); a.download = file().name;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
    $("#imp").onclick = () => { $("#impBox").hidden = false; $("#impPaste").focus(); };
    $("#impPick").onclick = () => $("#impFile").click();
    $("#impFile").onchange = async ev => { const f = ev.target.files[0]; if (f) importData(await f.text()); };
    $("#impGo").onclick = () => importData($("#impPaste").value);
  }
  function importData(text) {
    let data; try { data = JSON.parse(text); } catch (e) { toast("That isn't valid backup JSON"); return; }
    if (!data || !Array.isArray(data.log)) { toast("No log found in that backup"); return; }
    const log = getLog(), ids = new Set(log.map(x => x.id)); const newEntries = [];
    data.log.forEach(e => { if (e && e.id && !ids.has(e.id)) { log.push(e); newEntries.push(e); } });
    log.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    store.set(LOG, log);
    if (window.SYNC) newEntries.forEach(e => window.SYNC.queueUpsertSession(e));
    (data.tests || []).forEach(mergeTest);
    toast(`Imported ${newEntries.length} session${newEntries.length === 1 ? "" : "s"}`); render();
  }

  /* ---------- getting started / program management ---------- */
  async function loadProgramList(box) {
    box.innerHTML = `<p class="note-muted">Loading…</p>`;
    let programs;
    try {
      const res = await fetch("/api/programs");
      if (res.status === 401) { box.innerHTML = `<p class="empty">Signed out — reload the page to sign back in.</p>`; return; }
      if (!res.ok) throw new Error("bad status");
      ({ programs } = await res.json());
    } catch (e) {
      box.innerHTML = `<p class="empty">Couldn't load your programs. Check your connection and try again.</p>`;
      return;
    }
    if (!programs.length) { box.innerHTML = `<p class="empty">No programs yet — upload one below to get started.</p>`; return; }
    box.innerHTML = "";
    programs.forEach(p => {
      const row = document.createElement("div");
      row.className = "entry";
      row.innerHTML = `<div class="b" style="padding:12px 14px">
        <p><span class="x">${esc(p.name)}</span>${p.sport ? ` · ${esc(p.sport)}` : ""}</p>
        <p class="progress">${esc(p.status)} · v${p.versionCount}${p.startDate ? ` · starts ${esc(p.startDate)}` : ""}</p>
        ${p.status !== "current" ? `<button type="button" class="link-btn" data-activate="${esc(p.id)}">Activate</button>` : ""}
      </div>`;
      box.appendChild(row);
    });
    box.querySelectorAll("[data-activate]").forEach(btn => btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Activating…";
      try {
        const res = await fetch(`/api/programs/${encodeURIComponent(btn.dataset.activate)}/activate`, { method: "POST" });
        if (!res.ok) throw new Error("bad status");
        toast("Activated. Reloading…");
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        toast("Couldn't activate that program"); btn.disabled = false; btn.textContent = "Activate";
      }
    });
  }

  function renderStart() {
    $("#phaseLine").textContent = "Getting started";
    app.innerHTML = `
      <div class="head"><div class="eyebrow">Program management</div><h1>Getting started</h1></div>
      ${P ? "" : `<p class="empty">You don't have a training program yet. Build one with Claude using the guide below, then upload it here.</p>`}
      <details class="panel" open>
        <summary><h2>Build a program with Claude</h2></summary>
        <div class="panel-body">
          <p class="note-muted">No coach or written plan yet? Use this guide in a chat with Claude to design one, then upload the result below.</p>
          <p class="kv"><a href="build-your-training-plan.md" target="_blank" rel="noopener">Program-building guide</a></p>
          <p class="kv"><a href="program.schema.json" target="_blank" rel="noopener">Program schema (for Claude to follow)</a></p>
          <p class="kv"><a href="example-program.json" target="_blank" rel="noopener">Example program</a></p>
        </div>
      </details>
      <details class="panel" open>
        <summary><h2>Your programs</h2></summary>
        <div class="panel-body" id="progListBody"></div>
      </details>
      <details class="panel">
        <summary><h2>Upload a program</h2></summary>
        <div class="panel-body">
          <div class="grid2">
            <div><label class="lab" for="progName">Name</label><div class="field"><input id="progName" placeholder="2027 Off-season"></div></div>
            <div><label class="lab" for="progSport">Sport (optional)</label><div class="field"><input id="progSport" placeholder="ski"></div></div>
          </div>
          <label class="lab" for="progFile" style="margin-top:12px">Upload a .json file</label>
          <input type="file" id="progFile" accept="application/json,.json">
          <label class="lab" for="progPaste" style="margin-top:12px">…or paste program JSON</label>
          <textarea id="progPaste" placeholder='{"startDate": "2027-01-04", ...}'></textarea>
          <p class="note-muted" id="uploadErrors" hidden></p>
          <button type="button" class="primary" id="progUpload">Validate + create draft</button>
          <p class="note-muted">Creates a draft — it won't replace your active program until you tap Activate above.</p>
        </div>
      </details>`;

    loadProgramList($("#progListBody"));

    $("#progFile").onchange = async ev => {
      const f = ev.target.files[0];
      if (f) $("#progPaste").value = await f.text();
    };

    $("#progUpload").onclick = async () => {
      const errBox = $("#uploadErrors");
      errBox.hidden = true;
      const name = $("#progName").value.trim();
      const sport = $("#progSport").value.trim();
      const raw = $("#progPaste").value;
      if (!name) { errBox.hidden = false; errBox.textContent = "Name is required."; return; }
      let content;
      try { content = JSON.parse(raw); }
      catch (e) { errBox.hidden = false; errBox.textContent = "That doesn't look like valid JSON — check for a missing comma or bracket."; return; }

      const btn = $("#progUpload");
      btn.disabled = true; btn.textContent = "Validating…";
      try {
        const res = await fetch("/api/programs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, sport: sport || null, content }),
        });
        if (res.status === 401) { errBox.hidden = false; errBox.textContent = "Signed out — reload the page to sign back in."; return; }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          errBox.hidden = false;
          errBox.textContent = Array.isArray(body.details) && body.details.length
            ? `Fix these issues and try again:\n${body.details.join("\n")}`
            : body.error || "Couldn't create the program.";
          errBox.style.whiteSpace = "pre-line";
          return;
        }
        toast("Draft created. Activate it above when you're ready.");
        $("#progName").value = ""; $("#progSport").value = ""; $("#progPaste").value = ""; $("#progFile").value = "";
        loadProgramList($("#progListBody"));
      } catch (e) {
        errBox.hidden = false; errBox.textContent = "Network error — check your connection and try again.";
      } finally {
        btn.disabled = false; btn.textContent = "Validate + create draft";
      }
    };
  }

  /* ---------- shell ---------- */
  function render() {
    if (!P && view !== "start") view = "start"; // no program to log against, view Session/Log/Tests/Progress
    document.querySelectorAll(".nav button").forEach(b => b.setAttribute("aria-current", b.dataset.view === view));
    if (view === "session") renderSession();
    else if (view === "log") renderLog();
    else if (view === "tests") renderTests();
    else if (view === "progress") renderProgress();
    else renderStart();
  }
  document.querySelectorAll(".nav button").forEach(b => b.onclick = () => { view = b.dataset.view; render(); window.scrollTo(0, 0); });
  // a background sync pull merged in data from another device; re-render
  // unless we're mid-session (a live re-render there would drop focus/typing)
  window.addEventListener("ssl:data-updated", () => { if (view !== "session") render(); });

  // theme: Auto (system) / Light / Dark, via a custom listbox (not a native
  // <select> — its open-state chrome is OS-rendered and ignores page CSS)
  const applyTheme = t => { if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); };
  const themeBtn = $("#themeBtn"), themeMenu = $("#themeMenu");
  const themeItems = () => Array.from(themeMenu.querySelectorAll("li"));
  const THEME_LABEL = { "": "Auto", light: "Light", dark: "Dark" };

  function setThemeUI(v) {
    themeBtn.textContent = THEME_LABEL[v];
    themeItems().forEach(li => li.setAttribute("aria-selected", String(li.dataset.value === v)));
  }
  function closeThemeMenu(focusBtn) {
    themeMenu.hidden = true; themeBtn.setAttribute("aria-expanded", "false");
    if (focusBtn) themeBtn.focus();
  }
  function openThemeMenu() {
    themeMenu.hidden = false; themeBtn.setAttribute("aria-expanded", "true");
    (themeItems().find(li => li.getAttribute("aria-selected") === "true") || themeItems()[0]).focus();
  }
  function selectTheme(v) { store.set(THEME, v || null); applyTheme(v || null); setThemeUI(v); }

  const storedTheme = store.get(THEME, null) || "";
  applyTheme(storedTheme || null);
  setThemeUI(storedTheme);

  themeBtn.onclick = () => (themeMenu.hidden ? openThemeMenu() : closeThemeMenu(false));
  themeItems().forEach(li => {
    li.onclick = () => { selectTheme(li.dataset.value); closeThemeMenu(true); };
    li.onkeydown = e => {
      const items = themeItems(), i = items.indexOf(li);
      if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectTheme(li.dataset.value); closeThemeMenu(true); }
      else if (e.key === "Escape") { closeThemeMenu(true); }
      else if (e.key === "Tab") { closeThemeMenu(false); }
    };
  });
  document.addEventListener("click", e => { if (!themeMenu.hidden && !e.target.closest(".theme-picker")) closeThemeMenu(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !themeMenu.hidden) closeThemeMenu(true); });

  // keep the screen on while logging, where allowed
  async function wake() { try { if (navigator.wakeLock && document.visibilityState === "visible") await navigator.wakeLock.request("screen"); } catch (e) {} }
  document.addEventListener("visibilitychange", wake); wake();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  render();
})();
