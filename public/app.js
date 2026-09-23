/* Ski Strength Log — offline gym logger. Data lives in this browser (localStorage);
   Export sends it to Claude, who updates program.js and the program doc. */
(function () {
  "use strict";
  const P = window.PROGRAM;
  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");

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
  // Season shape (week count, phase labels, deload weeks, in-season start)
  // comes entirely from program.js's `season` data — nothing here is tied to
  // a specific season, so a future season is a new program.js, not app.js edits.
  const start = parseISO(P.season.start);
  const weekMeta = w => P.season.weeks.find(x => x.n === w);
  const weekStart = w => new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * (w - 1));
  function currentWeek() {
    const days = Math.floor((new Date() - start) / 864e5);
    if (days < 0) return 1;
    const w = Math.floor(days / 7) + 1;
    return w > P.season.weeks.length ? "S" : w;
  }
  const PHASE = w => w === "S" ? "In-season" : (weekMeta(w) || {}).phase || "";
  const weekLabel = w => w === "S" ? "In-season" : `Week ${w}`;
  const weekDates = w => { if (w === "S") return `From ${fmt(parseISO(P.season.inSeasonStart))}`; const a = weekStart(w), b = weekStart(w); b.setDate(b.getDate() + 6); return `${fmt(a)} – ${fmt(b)}`; };

  /* ---------- program model ---------- */
  const WEEKS = P.season.weeks.map(w => w.n).concat("S");
  function sessionKeys(w) {
    const s = P.singles.filter(x => x.week === w).map(x => x.key);
    return s.length ? s : ["A", "B", "C"];
  }
  const KEYNAME = { A: "A · Heavy", B: "B · Single-leg", C: "C · Ski-specific", D1: "Day 1", D2: "Day 2", D3: "Day 3", M1: "M1 Strength", M2: "M2 Endurance", PR: "Primer", MD: "Micro-dose" };
  function parseRx(rx, o) {
    const r = { sets: 1, reps: "", pct: o.pct || null };
    let m;
    if ((m = rx.match(/^(\d+)\s*×\s*(\d+)/))) { r.sets = +m[1]; r.reps = m[2]; }
    else if ((m = rx.match(/^(\d+)\s*×/))) r.sets = +m[1];
    else if ((m = rx.match(/(\d+)\s*rounds?/))) r.sets = +m[1];
    if ((m = rx.match(/@\s*([\d.]+)%/))) r.pct = +m[1] / 100;
    return r;
  }
  function getSession(w, key) {
    const id = `w${w}-${key}`;
    const single = P.singles.find(x => x.week === w && x.key === key);
    let raw, title, type, extra = {};
    if (single) { raw = single.items.map(([n, rx, o]) => [n, rx, o || {}]); title = single.title; type = single.type; extra = single; }
    else {
      const blk = P.blocks.find(b => b.weeks.includes(w));
      const idx = blk.weeks.indexOf(w), s = blk.sessions[key];
      raw = s.items.map(([n, rx, o]) => [n, Array.isArray(rx) ? rx[idx] : rx, o || {}]);
      title = s.title; type = key; extra = s;
    }
    const items = raw.filter(([, rx]) => rx && rx !== "—").map(([name, rx, o], i) => Object.assign({ i, name, rx }, o, parseRx(rx, o)));
    return { id, week: w, key, title, type, items, test: !!extra.test, me: !!extra.me, noWarmup: !!extra.noWarmup };
  }

  /* ---------- maxes + targets ---------- */
  const e1rm = (load, reps) => Math.round(load * (1 + reps / 30));
  const r5 = x => Math.round(x / 5) * 5;
  function latestTest(key) {
    const t = getTests().filter(r => r.v && r.v[key] != null).sort((a, b) => a.date < b.date ? 1 : -1)[0];
    return t ? { date: t.date, val: t.v[key] } : null;
  }
  function getMax(lift) {
    const t = latestTest(lift);
    if (t && t.val && t.val.e1rm) return { v: t.val.e1rm, src: `tested ${t.date}` };
    if (P.maxes && P.maxes[lift]) return { v: P.maxes[lift], src: "program" };
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

  /* ---------- UI state ---------- */
  let view = "session";
  let selWeek = currentWeek();
  let selKey = null;
  const loggedIds = () => new Set(getLog().map(e => e.sessionId));
  function loggedKeysInWeek(w) {
    if (w === "S") return new Set();
    const s = weekStart(w), end = new Date(s); end.setDate(end.getDate() + 7);
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

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
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
    const typeForWarm = s.type === "B" ? "B" : s.type === "C" ? "C" : "A";
    const erg = typeForWarm === "B" ? "SkiErg" : "Assault bike";
    const noSpikes = s.me || (weekMeta(selWeek) || {}).deload || s.type === "C";

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
        ${sessionKeys(selWeek).map(k => `<button type="button" class="seg" data-key="${k}" aria-pressed="${k === selKey}">${esc(KEYNAME[k] || k)}${logged.has(`w${selWeek}-${k}`) ? '<span class="tick" aria-label="logged">●</span>' : ""}</button>`).join("")}
      </div>
      <div class="head">
        <div class="eyebrow">${esc(weekLabel(selWeek))} · ${esc(weekDates(selWeek))} · ${esc(PHASE(selWeek))}</div>
        <h1>${esc(s.title)}</h1>
        <div class="progress" id="prog"></div>
      </div>
      ${s.noWarmup ? "" : `
      <details class="panel" id="warm" open>
        <summary><span><h2>Warm-up · ${erg}</h2><span class="progress">7 min erg · mobility · activation · ~14 min</span></span></summary>
        <div class="panel-body">
          <table class="erg"><tbody>${P.warmup.erg.map((r, i) => `<tr${i === 2 && noSpikes ? ' style="opacity:.45"' : ""}><td>${r[0]}</td><td>${esc(r[1])}</td><td>${r[2]}</td></tr>`).join("")}</tbody></table>
          ${noSpikes ? '<p class="note-muted">Skip the spikes today (ME, deload or ski-specific day).</p>' : ""}
          ${s.test ? '<p class="note-muted">Test day: add a second block of 3 spikes and one extra ramp set.</p>' : ""}
          <p class="kv"><b>Mobility · 3 min</b>${esc(P.warmup.mobility)}</p>
          <p class="kv"><b>Activation · 3–4 min</b>${esc(P.warmup.act[typeForWarm])}</p>
          <p class="kv"><b>Then</b>2–4 ramp sets to the first working weight.</p>
        </div>
      </details>`}
      <div id="items"></div>
      <section class="finish" aria-label="Finish session">
        <div class="grid2">
          <div><label class="lab" for="bw">Body weight</label><div class="field"><input id="bw" inputmode="decimal" value="${esc(d.bw)}" placeholder="210"><span>lb</span></div></div>
          <div><label class="lab">Soreness today</label><div class="soreness" id="sore">${[0, 1, 2, 3, 4, 5].map(n => `<button type="button" data-s="${n}" aria-pressed="${d.sore === n}">${n}</button>`).join("")}</div></div>
        </div>
        <label class="lab" for="snotes" style="margin-top:12px">Session notes</label>
        <textarea id="snotes" placeholder="Sleep, energy, anything that felt off or great">${esc(d.notes)}</textarea>
        <button type="button" class="primary" id="saveBtn">Save to log</button>
        <div class="btns"><button type="button" class="secondary" id="clearBtn">Clear this session</button></div>
      </section>`;

    const wrap = $("#items");
    s.items.forEach((it, i) => wrap.appendChild(renderItem(s, it, d, i)));
    updateProgress(s, d);

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
          <div class="ex-name">${url ? `<a href="${url}" target="_blank" rel="noopener">${esc(it.name)}</a>` : esc(it.name)}</div>
          <div class="ex-actions">
            ${url ? `<a class="vid" href="${url}" target="_blank" rel="noopener">Video ↗</a>` : ""}
            <span class="disclosure" aria-hidden="true"></span>
          </div>
        </div>
        <div class="rx">${esc(it.rx)}</div>
        <div class="meta">
          ${tgt ? `<span class="tag target">Target ${tgt} lb</span>` : ""}
          ${it.lift && it.pct && !maxInfo ? `<span class="tag">Target appears after your Week 1 test</span>` : ""}
          ${last ? `<span class="tag">Last: ${esc([last.set.load && last.set.load + " lb", last.set.reps && last.set.reps + (it.u ? " " + it.u : ""), last.set.rpe && "@" + last.set.rpe].filter(Boolean).join(" × "))} · ${fmt(parseISO(last.date))}</span>` : ""}
        </div>
        ${it.n ? `<div class="cue">${esc(it.n)}</div>` : ""}
        ${it.circuit ? `<div class="cue">${esc(P.meCircuit)}</div>` : ""}
      </summary>
      <div class="ex-body">
        <div class="sets">
          <div class="sets-head ${cls}" aria-hidden="true"><span>Set</span>${it.bw ? "" : "<span>Load</span>"}<span>${esc(unit)}</span>${it.norpe ? "" : "<span>RPE</span>"}</div>
          ${di.sets.map((st, k) => `
            <div class="${cls}" data-k="${k}">
              <button type="button" class="n" aria-pressed="${st.done}" aria-label="Mark set ${k + 1} done">${st.done ? "✓" : k + 1}</button>
              ${it.bw ? "" : `<div class="field"><input id="l-${s.id}-${i}-${k}" data-f="load" inputmode="decimal" value="${esc(st.load)}" placeholder="${loadPh}" aria-label="Set ${k + 1} load"><span>lb</span></div>`}
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

    const refreshDone = () => el.classList.toggle("done", di.sets.length > 0 && di.sets.every(x => x.done));
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
    const log = getLog(); log.push(entry);
    if (!store.set(LOG, log)) { toast("Couldn't save: this browser is blocking storage"); return; }
    if (window.SYNC) window.SYNC.queueUpsertSession(entry);
    let msg = "Saved to log";
    const rec = testsFromEntry(entry);
    if (rec) { mergeTest(rec); msg = "Saved. Test results recorded"; }
    store.del(draftKey(s.id));
    toast(msg);
    selKey = null; render(); window.scrollTo(0, 0);
  }

  /* ---------- tests ---------- */
  const TEST_FIELDS = [
    ["squat", "Back squat", "lb × reps", "lift"], ["deadlift", "Deadlift", "lb × reps", "lift"],
    ["rfess", "RFESS 8RM", "lb/DB"], ["bench", "DB bench 8RM", "lb/DB"], ["row", "Single-arm row 8RM", "lb"],
    ["pullup", "Pull-up max", "reps"], ["broad", "Broad jump", "in"], ["hopL", "SL hop L", "in"], ["hopR", "SL hop R", "in"],
    ["lathops", "Lateral hops", "/30 s"], ["wallsit", "Wall sit 90°", "s"], ["k2wL", "Knee-to-wall L", "cm"], ["k2wR", "Knee-to-wall R", "cm"],
    ["stanceL", "SL stance L", "s"], ["stanceR", "SL stance R", "s"], ["cphL", "Copenhagen L", "s"], ["cphR", "Copenhagen R", "s"],
    ["sideL", "Side plank L", "s"], ["sideR", "Side plank R", "s"], ["tib", "Tib raises", "reps"], ["aet", "AeT heart rate", "bpm"], ["bw", "Body weight", "lb"]
  ];
  function testsFromEntry(e) {
    const v = {};
    e.items.forEach(it => {
      if (!it.t || !it.sets.length) return;
      if (it.t === "squat" || it.t === "deadlift") {
        let best = null;
        it.sets.forEach(x => { const l = num(x.load), r = num(x.reps); if (l && r) { const e1 = e1rm(l, r); if (!best || e1 > best.e1rm) best = { load: l, reps: r, e1rm: e1 }; } });
        if (best) v[it.t] = best;
      } else if (["rfess", "bench", "row"].includes(it.t)) {
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
        <div class="stat"><b>Squat e1RM</b><span>${sq ? sq.v + " lb" : "—"}</span><em>${sq ? esc(sq.src) : "Test in Week 1, Day 2"}</em></div>
        <div class="stat"><b>Deadlift e1RM</b><span>${dl ? dl.v + " lb" : "—"}</span><em>${dl ? esc(dl.src) : "Test in Week 1, Day 2"}</em></div>
      </div>
      ${tests.length ? `<div class="tbl-wrap"><table class="tests"><thead><tr><th>Test</th>${tests.map(t => `<th>${fmt(parseISO(t.date))}</th>`).join("")}</tr></thead><tbody>
        ${TEST_FIELDS.filter(f => tests.some(t => t.v[f[0]] != null)).map(f => `<tr><td>${esc(f[1])} <span class="progress">${esc(f[2])}</span></td>${tests.map(t => `<td class="num">${esc(showVal(t.v[f[0]]))}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">No tests yet. Week 1 test sessions fill this in when you save them, or add results below.</p>`}
      <details class="panel" id="addTest">
        <summary><h2>Add or correct results</h2></summary>
        <div class="panel-body">
          <div class="test-form">
            <div class="full"><label class="lab" for="tdate">Date</label><div class="field"><input id="tdate" type="date" value="${iso(new Date())}"></div></div>
            ${TEST_FIELDS.map(([k, label, unit, kind]) => kind === "lift"
              ? `<div class="full"><label class="lab">${esc(label)} (rep max)</label><div class="grid2"><div class="field"><input id="t-${k}-l" inputmode="decimal" placeholder="load"><span>lb</span></div><div class="field"><input id="t-${k}-r" inputmode="decimal" placeholder="reps"><span>reps</span></div></div></div>`
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

  /* ---------- log + export ---------- */
  function exportText() {
    const log = getLog(), tests = getTests();
    const lines = [`SKI STRENGTH LOG — exported ${iso(new Date())}`];
    const sq = getMax("squat"), dl = getMax("deadlift");
    lines.push(`Current e1RM: squat ${sq ? sq.v : "—"} lb · deadlift ${dl ? dl.v : "—"} lb`);
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
  const exportJSON = () => JSON.stringify({ app: "ski-strength-log", exported: new Date().toISOString(), programVersion: P.version, log: getLog(), tests: getTests() }, null, 1);

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

  /* ---------- shell ---------- */
  function render() {
    document.querySelectorAll(".nav button").forEach(b => b.setAttribute("aria-current", b.dataset.view === view));
    if (view === "session") renderSession(); else if (view === "log") renderLog(); else renderTests();
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
