// Regression test for a real production incident: a direct DB correction to
// an existing session_log row never reached a device that already had the
// old value cached locally, because mergeSessions() only added remote
// entries it didn't already have -- it never overwrote a stale local one
// under the same id. See public/sync.js's mergeSessions.
import { test, expect } from "./fixtures.js";
import { createAndActivateProgram, minimalProgram } from "./helpers.js";

test("a server-side correction to an existing session overwrites a stale local cache entry on the next pull", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: minimalProgram() });

  const serverEntry = {
    id: "fixed-test-id",
    date: "2026-09-28",
    sessionId: "w1-A",
    week: 1,
    key: "A",
    title: "Day A",
    bw: "",
    sore: null,
    notes: "corrected",
    items: [],
  };
  const res = await request.post("/api/sessions", { headers: { "X-Test-User-Email": userEmail }, data: serverEntry });
  expect(res.ok()).toBeTruthy();

  await page.goto("/");
  await page.evaluate(() => {
    const stale = { id: "fixed-test-id", date: "2026-01-01", sessionId: "w1-A", week: 1, key: "A", title: "Day A", bw: "", sore: null, notes: "stale", items: [] };
    localStorage.setItem("ssl:log", JSON.stringify([stale]));
  });

  await page.evaluate(() => window.SYNC.pull());
  await page.waitForFunction(() => {
    const log = JSON.parse(localStorage.getItem("ssl:log") || "[]");
    const e = log.find((x) => x.id === "fixed-test-id");
    return e && e.date === "2026-09-28" && e.notes === "corrected";
  });
});
