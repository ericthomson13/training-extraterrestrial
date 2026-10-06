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
  // While a pull is in flight the UI locks its save buttons (see
  // applySyncLock in app.js) and the status chip spins, so nothing can be
  // edited against a snapshot that's about to be merged over it.
  // Sticky failure flag (data-sync-error on <html>): set when a push or pull
  // fails, cleared when one fully succeeds. app.js uses it to relabel the save
  // buttons so it's clear the change is only on this device for now.
  function setError(on) {
    if (document.documentElement.hasAttribute("data-sync-error") === on) return;
    document.documentElement.toggleAttribute("data-sync-error", on);
    window.dispatchEvent(new Event("ssl:sync-state"));
  }
  function setSyncing(on) {
    document.documentElement.toggleAttribute("data-syncing", on);
    if (statusEl) statusEl.toggleAttribute("data-busy", on);
    if (on) setStatus("Syncing…");
    window.dispatchEvent(new Event("ssl:sync-state"));
  }

  async function send(op) {
    if (op.type === "upsertSession") {
      const res = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op.entry), signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw Object.assign(new Error("upsertSession failed"), { status: res.status });
    } else if (op.type === "deleteSession") {
      const res = await fetch("/api/sessions/" + encodeURIComponent(op.id), { method: "DELETE" });
      if (!res.ok) throw Object.assign(new Error("deleteSession failed"), { status: res.status });
    } else if (op.type === "upsertTest") {
      const res = await fetch("/api/tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op.record) });
      if (!res.ok) throw Object.assign(new Error("upsertTest failed"), { status: res.status });
    }
  }

  // flush() hands back the in-flight run so callers (pull) can wait for it.
  let flushing = null;
  function flush() {
    if (!flushing) flushing = Promise.resolve().then(runFlush).finally(() => { flushing = null; });
    return flushing;
  }
  async function runFlush() {
    // Re-read the queue each pass: queue() may append while a send is in flight.
    for (let q = get(QUEUE, []); q.length; q = get(QUEUE, [])) {
      try {
        await send(q[0]);
      } catch (e) {
        setStatus(e.status === 401 ? "Signed out" : navigator.onLine ? "Sync error — retrying" : "Offline — queued");
        setError(true);
        return; // keep order; retry on next flush() call
      }
      set(QUEUE, get(QUEUE, []).slice(1));
    }
    setStatus("Synced");
    setError(false);
  }

  // Bumped on every local mutation so an in-flight pull can tell its server
  // snapshot predates a local edit/delete and must not be merged.
  let localVersion = 0;
  function queue(op) {
    localVersion++;
    const q = get(QUEUE, []);
    q.push(op);
    set(QUEUE, q);
    flush();
  }

  // Remote wins whenever an id exists on both sides, except for ids with a
  // still-queued local change (see `pending` below). Otherwise local and
  // remote only disagree because of a direct DB
  // correction or a stale local cache, never a newer local edit worth
  // keeping. A local-only id (not yet pushed, e.g. saved offline) is left
  // alone since remote won't have it yet.
  function mergeSessions(local, remote) {
    const byId = new Map(local.map((e) => [e.id, e]));
    // Local changes not yet on the server beat the (stale) remote copy: an
    // unsent edit keeps the local entry, an unsent delete stays deleted.
    const pending = new Map();
    get(QUEUE, []).forEach((op) => {
      if (op.type === "upsertSession") pending.set(op.entry.id, "upsert");
      else if (op.type === "deleteSession") pending.set(op.id, "delete");
    });
    remote.forEach((e) => { if (!pending.has(e.id)) byId.set(e.id, e); });
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

  let pulling = null;
  function pull() {
    if (!pulling) pulling = Promise.resolve().then(() => runPull()).finally(() => { pulling = null; });
    return pulling;
  }
  async function runPull(attempt = 0) {
    let retrying = false;
    setSyncing(true);
    try {
      // Push unsent local changes first so the snapshot we fetch includes them.
      await flush();
      setStatus("Syncing…");
      const startVersion = localVersion;
      const [sRes, tRes] = await Promise.all([fetch("/api/sessions", { signal: AbortSignal.timeout(15000) }), fetch("/api/tests", { signal: AbortSignal.timeout(15000) })]);
      if (sRes.status === 401 || tRes.status === 401) { setStatus("Signed out"); setError(true); return; }
      if (!sRes.ok || !tRes.ok) { setStatus("Sync error"); setError(true); return; }
      const { sessions } = await sRes.json();
      const { tests } = await tRes.json();
      if (localVersion !== startVersion) {
        // Edited/deleted while the request was in flight: snapshot is stale.
        if (attempt < 2) { retrying = true; return runPull(attempt + 1); }
        setStatus("Will retry sync");
        return;
      }
      set(LOG, mergeSessions(get(LOG, []), sessions));
      set(TESTS, mergeTests(get(TESTS, []), tests));
      setStatus("Synced");
      if (!get(QUEUE, []).length) setError(false);
      window.dispatchEvent(new Event("ssl:data-updated"));
    } catch (e) {
      setStatus(navigator.onLine ? "Sync error" : "Offline");
      setError(true);
    } finally {
      // a retry (stale snapshot) re-enters runPull, which re-locks
      if (!retrying) setSyncing(false);
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
  // `ready` resolves once startup's one-time migration + first pull are done.
  window.SYNC.ready = migrateLocalIfNeeded().then(() => { flush(); return pull(); });
  window.addEventListener("online", () => { flush(); pull(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { flush(); pull(); } });
})();
