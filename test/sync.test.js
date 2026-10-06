// Unit tests for public/sync.js's race handling. sync.js is a browser IIFE
// (window/localStorage/fetch/document), so each test installs minimal stubs
// on globalThis and imports a fresh copy of the module. fetch is a scripted
// fake server: tests control what GET /api/sessions returns, whether POSTs
// succeed, and can hook a callback into an in-flight request.
import { beforeEach, describe, expect, it, vi } from "vitest";

const LOG = "ssl:log", QUEUE = "ssl:queue";

let store, calls, server, attrs, events;

function entry(id, over = {}) {
  return { id, date: "2026-09-28", sessionId: "w1-A", week: 1, key: "A", title: "Day A", bw: "", sore: null, notes: "", items: [], ...over };
}
const readLog = () => JSON.parse(store.get(LOG) || "[]");
const readQueue = () => JSON.parse(store.get(QUEUE) || "[]");
const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

async function load() {
  vi.resetModules();
  await import("../public/sync.js");
  // let the startup migrate/flush/pull settle
  await globalThis.window.SYNC.pull();
  calls.length = 0;
  return globalThis.window.SYNC;
}

beforeEach(() => {
  store = new Map([["ssl:migrated", "true"]]);
  calls = [];
  attrs = new Set();
  events = [];
  server = {
    sessions: [],
    postOk: true,
    onGetSessions: null, // async hook run while the GET is "in flight"
    onPost: null,
  };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  const status = { textContent: "", toggleAttribute() {} };
  globalThis.document = {
    getElementById: () => status,
    documentElement: { toggleAttribute: (a, on) => { on ? attrs.add(a) : attrs.delete(a); }, hasAttribute: (a) => attrs.has(a) },
    addEventListener() {},
    visibilityState: "hidden",
  };
  globalThis.document.status = status;
  globalThis.window = globalThis;
  globalThis.addEventListener = (type) => { void type; };
  globalThis.dispatchEvent = (e) => { events.push({ type: e.type, syncing: attrs.has("data-syncing") }); return true; };
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ method, url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (method === "POST" && String(url) === "/api/sessions") {
      if (server.onPost) await server.onPost();
      if (!server.postOk) throw new Error("offline");
      return json({ ok: true });
    }
    if (method === "DELETE") return server.postOk ? json({ ok: true }) : Promise.reject(new Error("offline"));
    if (String(url) === "/api/sessions") {
      const snapshot = JSON.parse(JSON.stringify(server.sessions));
      if (server.onGetSessions) { const hook = server.onGetSessions; server.onGetSessions = null; await hook(); }
      return json({ sessions: snapshot });
    }
    if (String(url) === "/api/tests") return json({ tests: [] });
    throw new Error("unexpected fetch " + url);
  });
});

describe("pull merge", () => {
  it("lets remote overwrite a stale local entry with no pending change", async () => {
    const SYNC = await load();
    store.set(LOG, JSON.stringify([entry("a", { notes: "stale" })]));
    server.sessions = [entry("a", { notes: "corrected" })];
    await SYNC.pull();
    expect(readLog()[0].notes).toBe("corrected");
  });

  it("keeps a local-only entry that remote doesn't have yet", async () => {
    const SYNC = await load();
    store.set(LOG, JSON.stringify([entry("local-only")]));
    await SYNC.pull();
    expect(readLog().map((e) => e.id)).toEqual(["local-only"]);
  });

  it("keeps a locally edited entry whose upsert is still queued (offline)", async () => {
    const SYNC = await load();
    store.set(LOG, JSON.stringify([entry("a", { sore: 3 })]));
    server.sessions = [entry("a", { sore: null })];
    server.postOk = false;
    SYNC.queueUpsertSession(entry("a", { sore: 3 }));
    await SYNC.flush();
    await SYNC.pull();
    expect(readLog()[0].sore).toBe(3);
    expect(readQueue()).toHaveLength(1);
  });

  it("does not resurrect an entry whose delete is still queued (offline)", async () => {
    const SYNC = await load();
    server.sessions = [entry("gone")];
    server.postOk = false;
    SYNC.queueDeleteSession("gone");
    await SYNC.flush();
    await SYNC.pull();
    expect(readLog()).toEqual([]);
  });
});

describe("pull ordering and locking", () => {
  it("pushes queued changes before fetching the snapshot", async () => {
    const SYNC = await load();
    store.set(LOG, JSON.stringify([entry("a", { sore: 2 })]));
    server.postOk = false;
    SYNC.queueUpsertSession(entry("a", { sore: 2 }));
    await SYNC.flush();
    calls.length = 0;
    server.postOk = true;
    await SYNC.pull();
    const order = calls.map((c) => `${c.method} ${c.url}`);
    expect(order.indexOf("POST /api/sessions")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("POST /api/sessions")).toBeLessThan(order.indexOf("GET /api/sessions"));
    expect(readQueue()).toEqual([]);
  });

  it("shares one run between concurrent pull() calls", async () => {
    const SYNC = await load();
    await Promise.all([SYNC.pull(), SYNC.pull(), SYNC.pull()]);
    expect(calls.filter((c) => c.url === "/api/sessions" && c.method === "GET")).toHaveLength(1);
  });

  it("raises data-syncing for the duration of a pull and clears it after", async () => {
    const SYNC = await load();
    let during = null;
    server.onGetSessions = async () => { during = attrs.has("data-syncing"); };
    await SYNC.pull();
    expect(during).toBe(true);
    expect(attrs.has("data-syncing")).toBe(false);
    expect(events.some((e) => e.type === "ssl:sync-state" && e.syncing)).toBe(true);
    expect(globalThis.document.status.textContent).toBe("Synced");
  });

  it("clears data-syncing even when the pull fails", async () => {
    const SYNC = await load();
    globalThis.fetch.mockImplementationOnce(async () => { throw new Error("network"); });
    await SYNC.pull();
    expect(attrs.has("data-syncing")).toBe(false);
  });
});

describe("stale snapshot", () => {
  it("discards a snapshot fetched before a local edit and pulls again", async () => {
    const SYNC = await load();
    store.set(LOG, JSON.stringify([entry("a", { sore: 1 })]));
    server.sessions = [entry("a", { sore: 1 })];
    server.onGetSessions = async () => {
      // user edits while the GET is in flight; the in-flight snapshot is now stale
      const edited = entry("a", { sore: 4 });
      store.set(LOG, JSON.stringify([edited]));
      server.sessions = [edited]; // what the server holds once the POST lands
      SYNC.queueUpsertSession(edited);
    };
    await SYNC.pull();
    expect(readLog()[0].sore).toBe(4);
    expect(calls.filter((c) => c.method === "GET" && c.url === "/api/sessions")).toHaveLength(2);
  });

  it("gives up after repeated stale snapshots without clobbering local data", async () => {
    const SYNC = await load();
    store.set(LOG, JSON.stringify([entry("a", { sore: 1 })]));
    server.sessions = [entry("a", { sore: 1 })];
    let n = 0;
    const bump = async () => {
      n++;
      store.set(LOG, JSON.stringify([entry("a", { sore: 5 })]));
      SYNC.queueUpsertSession(entry("a", { sore: 5 }));
      server.onGetSessions = bump;
    };
    server.onGetSessions = bump;
    await SYNC.pull();
    expect(n).toBe(3); // first try + 2 retries
    expect(readLog()[0].sore).toBe(5);
    expect(attrs.has("data-syncing")).toBe(false);
    expect(globalThis.document.status.textContent).toBe("Will retry sync");
  });
});

describe("flush queue", () => {
  it("does not drop an op queued while an earlier send is in flight", async () => {
    const SYNC = await load();
    let first = true;
    server.onPost = async () => {
      if (first) { first = false; SYNC.queueUpsertSession(entry("second")); }
    };
    SYNC.queueUpsertSession(entry("first"));
    await SYNC.flush();
    const sent = calls.filter((c) => c.method === "POST").map((c) => c.body.id);
    expect(sent).toEqual(["first", "second"]);
    expect(readQueue()).toEqual([]);
  });

  it("keeps ops queued, in order, when the server is unreachable", async () => {
    const SYNC = await load();
    server.postOk = false;
    SYNC.queueUpsertSession(entry("one"));
    SYNC.queueUpsertSession(entry("two"));
    await SYNC.flush();
    expect(readQueue().map((o) => o.entry.id)).toEqual(["one", "two"]);
  });
});

describe("sync error flag", () => {
  it("is raised when a push fails and cleared once the queue drains", async () => {
    const SYNC = await load();
    server.postOk = false;
    SYNC.queueUpsertSession(entry("a"));
    await SYNC.flush();
    expect(attrs.has("data-sync-error")).toBe(true);
    expect(events.some((e) => e.type === "ssl:sync-state")).toBe(true);
    server.postOk = true;
    await SYNC.flush();
    expect(attrs.has("data-sync-error")).toBe(false);
  });

  it("is raised by a pull the server rejects, and cleared by the next good one", async () => {
    const SYNC = await load();
    const real = globalThis.fetch.getMockImplementation();
    globalThis.fetch.mockImplementationOnce(async () => json({}, false, 500));
    await SYNC.pull();
    expect(attrs.has("data-sync-error")).toBe(true);
    globalThis.fetch.mockImplementation(real);
    await SYNC.pull();
    expect(attrs.has("data-sync-error")).toBe(false);
  });

  it("stays raised after a good pull while changes are still queued", async () => {
    const SYNC = await load();
    server.postOk = false;
    SYNC.queueUpsertSession(entry("a"));
    await SYNC.flush();
    await SYNC.pull(); // GET works, POST still can't drain
    expect(readQueue()).toHaveLength(1);
    expect(attrs.has("data-sync-error")).toBe(true);
  });
});
