/* Offline queue + cross-device sync. Loads before app.js and exposes
   window.SYNC; app.js hooks its handful of LOG/TESTS mutation points into it.
   localStorage stays the source of truth the app renders from — this module
   only pushes local mutations to the backend and pulls other devices' writes
   back in, it never changes how app.js renders. */
(function () {
  "use strict";
  const QUEUE = "ssl:queue", MIGRATED = "ssl:migrated", LOG = "ssl:log", TESTS = "ssl:tests";
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  let statusEl = null;
  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  async function send(op) {
    if (op.type === "upsertSession") {
      const res = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op.entry) });
      if (!res.ok) throw Object.assign(new Error("upsertSession failed"), { status: res.status });
    } else if (op.type === "deleteSession") {
      const res = await fetch("/api/sessions/" + encodeURIComponent(op.id), { method: "DELETE" });
      if (!res.ok) throw Object.assign(new Error("deleteSession failed"), { status: res.status });
    } else if (op.type === "upsertTest") {
      const res = await fetch("/api/tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op.record) });
      if (!res.ok) throw Object.assign(new Error("upsertTest failed"), { status: res.status });
    }
  }

  let flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      let q = get(QUEUE, []);
      while (q.length) {
        try {
          await send(q[0]);
        } catch (e) {
          setStatus(e.status === 401 ? "Signed out" : navigator.onLine ? "Sync error — retrying" : "Offline — queued");
          return; // keep order; retry on next flush() call
        }
        q = q.slice(1);
        set(QUEUE, q);
      }
      if (!q.length) setStatus("Synced");
    } finally {
      flushing = false;
    }
  }

  function queue(op) {
    const q = get(QUEUE, []);
    q.push(op);
    set(QUEUE, q);
    flush();
  }

  function mergeSessions(local, remote) {
    const byId = new Map(local.map((e) => [e.id, e]));
    remote.forEach((e) => { if (!byId.has(e.id)) byId.set(e.id, e); });
    return Array.from(byId.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  function mergeTests(local, remote) {
    const byDate = new Map(local.map((t) => [t.date, t]));
    remote.forEach((t) => {
      const ex = byDate.get(t.date);
      if (ex) Object.assign(ex.v, t.v);
      else byDate.set(t.date, t);
    });
    return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  async function pull() {
    try {
      const [sRes, tRes] = await Promise.all([fetch("/api/sessions"), fetch("/api/tests")]);
      if (sRes.status === 401 || tRes.status === 401) { setStatus("Signed out"); return; }
      if (!sRes.ok || !tRes.ok) { setStatus("Sync error"); return; }
      const { sessions } = await sRes.json();
      const { tests } = await tRes.json();
      set(LOG, mergeSessions(get(LOG, []), sessions));
      set(TESTS, mergeTests(get(TESTS, []), tests));
      setStatus("Synced");
      window.dispatchEvent(new Event("ssl:data-updated"));
    } catch (e) {
      setStatus(navigator.onLine ? "Sync error" : "Offline");
    }
  }

  async function migrateLocalIfNeeded() {
    if (get(MIGRATED, false)) return;
    try {
      const log = get(LOG, []), tests = get(TESTS, []);
      if (log.length) {
        const r = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries: log }) });
        if (!r.ok) return;
      }
      if (tests.length) {
        const r = await fetch("/api/tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ records: tests }) });
        if (!r.ok) return;
      }
      set(MIGRATED, true);
    } catch (e) {
      /* retry on next load */
    }
  }

  window.SYNC = {
    queueUpsertSession(entry) { queue({ type: "upsertSession", entry }); },
    queueDeleteSession(id) { queue({ type: "deleteSession", id }); },
    queueUpsertTest(record) { queue({ type: "upsertTest", record }); },
    flush,
    pull,
  };

  statusEl = document.getElementById("syncStatus");
  migrateLocalIfNeeded().then(() => { flush(); pull(); });
  window.addEventListener("online", () => { flush(); pull(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { flush(); pull(); } });
})();
