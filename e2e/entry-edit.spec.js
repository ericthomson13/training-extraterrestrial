// Editing a saved entry's weight/soreness/notes after the fact, the
// duplicate-save warning + repeat count, and the sync loading state that
// guards those edits against racing a background pull. See renderLog's
// ".editbox", saveSession's armed-button check, and sync.js's runPull.
import { test, expect } from "./fixtures.js";
import { createAndActivateProgram, isoDaysAgo, minimalProgram } from "./helpers.js";

const program = () => minimalProgram({ startDate: isoDaysAgo(0) });

const seed = (over = {}) => ({
  id: "seed-a", date: isoDaysAgo(2), sessionId: "w1-A", week: 1, key: "A", title: "Day A",
  bw: "", sore: null, notes: "", items: [{ name: "Back squat", rx: "3x5", u: "", t: null, target: null, sets: [{ load: "185", reps: "5", rpe: "" }], note: "" }],
  ...over,
});

async function seedEntry(request, userEmail, over) {
  const res = await request.post("/api/sessions", { headers: { "X-Test-User-Email": userEmail }, data: seed(over) });
  expect(res.ok()).toBeTruthy();
}
const serverSessions = async (request, userEmail) =>
  (await (await request.get("/api/sessions", { headers: { "X-Test-User-Email": userEmail } })).json()).sessions;
// Waits out startup's own migrate + first pull, so a test's held/slow pull
// can't be confused with (or merged into) that one.
const synced = async (page) => {
  await page.evaluate(() => window.SYNC.ready);
  await expect(page.locator("#syncStatus")).toHaveText("Synced");
};

async function fillFirstSet(page) {
  await page.locator(".ex").first().locator("summary").click();
  await page.locator("#l-w1-A-0-0").fill("185");
  await page.locator("#r-w1-A-0-0").fill("5");
}
const clickSave = (page) =>
  Promise.all([page.waitForResponse((r) => r.url().includes("/api/sessions") && r.request().method() === "POST"), page.locator("#saveBtn").click()]);

test.describe("editing a saved entry", () => {
  test("adds weight, soreness and notes later, keeping the original date, and syncs them", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await seedEntry(request, userEmail);
    await page.goto("/");
    await synced(page);

    await page.locator('.nav button[data-view="log"]').click();
    const entry = page.locator("details.entry").first();
    await entry.locator("summary").click();
    await entry.locator("[data-edit]").click();
    await entry.locator(".e-bw").fill("201.5");
    await entry.locator('.e-sore button[data-s="3"]').click();
    await entry.locator(".e-notes").fill("added after the fact");

    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/sessions") && r.request().method() === "POST"),
      entry.locator(".e-save").click(),
    ]);
    expect(res.ok()).toBeTruthy();

    const sessions = await serverSessions(request, userEmail);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: "seed-a", date: isoDaysAgo(2), bw: "201.5", sore: 3, notes: "added after the fact" });
    expect(sessions[0].items[0].sets[0].load).toBe("185"); // sets untouched

    // and it's what History shows after a reload
    await page.reload();
    await page.locator('.nav button[data-view="log"]').click();
    await page.locator("details.entry").first().locator("summary").click();
    await expect(page.locator("details.entry").first()).toContainText("BW 201.5");
    await expect(page.locator("details.entry").first()).toContainText("Soreness 3/5");
  });

  test("an edit doesn't create a second entry or change the week's completion", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await seedEntry(request, userEmail);
    await page.goto("/");
    await synced(page);
    await page.locator('.nav button[data-view="log"]').click();
    const entry = page.locator("details.entry").first();
    await entry.locator("summary").click();
    await entry.locator("[data-edit]").click();
    await entry.locator(".e-bw").fill("200");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/sessions")), entry.locator(".e-save").click()]);

    await expect(page.locator("details.entry")).toHaveCount(1);
    await page.locator('.nav button[data-view="session"]').click();
    await expect(page.locator(".seg .tick")).toHaveText("●"); // still logged once, no count
  });
});

test.describe("saving a session twice", () => {
  test("first save has no warning; a repeat needs a second tap and is counted on the session button", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await page.goto("/");
    await synced(page);
    await fillFirstSet(page);

    await expect(page.locator("#saveBtn")).toHaveText("Save to log");
    await clickSave(page); // first save goes straight through
    await expect(page.locator(".seg .tick")).toHaveText("●");

    // revisiting shows the recorded values; saving again warns first
    const posts = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/sessions")) posts.push(r); });
    await page.locator("#saveBtn").click();
    await expect(page.locator("#saveBtn")).toContainText("Already logged");
    await expect(page.locator("#saveBtn")).toContainText("Tap again to save a repeat");
    expect(posts).toHaveLength(0);
    expect(await serverSessions(request, userEmail)).toHaveLength(1);

    await clickSave(page); // second tap commits the repeat
    const sessions = await serverSessions(request, userEmail);
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((s) => s.id)).size).toBe(2);
    await expect(page.locator(".seg .tick")).toHaveText("●2");
  });

  test("the warning resets if you navigate away instead of confirming", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await seedEntry(request, userEmail);
    await page.goto("/");
    await synced(page);

    await page.locator("#saveBtn").click();
    await expect(page.locator("#saveBtn")).toContainText("Already logged");
    await page.locator('.nav button[data-view="log"]').click();
    await page.locator('.nav button[data-view="session"]').click();
    await expect(page.locator("#saveBtn")).toHaveText("Save to log");
  });
});

test.describe("sync loading state", () => {
  test("shows Syncing… and locks the save buttons while a pull is in flight, then releases", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await page.goto("/");
    await synced(page);
    await expect(page.locator("#saveBtn")).toBeEnabled();

    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route("**/api/sessions", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await gate;
      await route.continue();
    });

    await page.evaluate(() => { window.__pull = window.SYNC.pull(); });
    await expect(page.locator("#syncStatus")).toHaveText("Syncing…");
    await expect(page.locator("#saveBtn")).toBeDisabled();
    await expect(page.locator("html")).toHaveAttribute("data-syncing", "");

    release();
    await page.evaluate(() => window.__pull);
    await synced(page);
    await expect(page.locator("#saveBtn")).toBeEnabled();
    await expect(page.locator("html")).not.toHaveAttribute("data-syncing", "");
  });

  test("locks the History edit button too, and re-locks it after a render mid-pull", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await seedEntry(request, userEmail);
    await page.goto("/");
    await synced(page);
    await page.locator('.nav button[data-view="log"]').click();
    await page.locator("details.entry").first().locator("summary").click();
    await page.locator("[data-edit]").click();
    await expect(page.locator(".e-save")).toBeEnabled();

    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route("**/api/sessions", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await gate;
      await route.continue();
    });
    await page.evaluate(() => { window.__pull = window.SYNC.pull(); });
    await expect(page.locator(".e-save")).toBeDisabled();

    release();
    await page.evaluate(() => window.__pull);
    await expect(page.locator(".e-save")).toBeEnabled();
  });

  test("a failed pull (server error) doesn't leave the buttons locked", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await page.goto("/");
    await synced(page);
    await page.route("**/api/sessions", (route) => (route.request().method() === "GET" ? route.fulfill({ status: 500, body: "boom" }) : route.continue()));
    await page.evaluate(() => window.SYNC.pull());
    await expect(page.locator("#saveBtn")).toBeEnabled();
    await expect(page.locator("#syncStatus")).toHaveText(/Sync error|Offline/);
  });
});

test.describe("sync races", () => {
  test("an edit made while a pull is in flight isn't overwritten by that pull's stale snapshot", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await seedEntry(request, userEmail, { sore: 1 });
    await page.goto("/");
    await synced(page);

    // Hold the first GET after it has captured the server's current (sore:1) snapshot.
    let release, held = false;
    const gate = new Promise((r) => { release = r; });
    await page.route("**/api/sessions", async (route) => {
      if (route.request().method() !== "GET" || held) return route.continue();
      held = true;
      const stale = await route.fetch();
      await gate;
      await route.fulfill({ response: stale });
    });

    await page.evaluate(() => { window.__pull = window.SYNC.pull(); });
    await expect(page.locator("#syncStatus")).toHaveText("Syncing…");

    // The user's edit lands (as the UI would write it) before the stale response is delivered.
    await page.evaluate(() => {
      const log = JSON.parse(localStorage.getItem("ssl:log"));
      log[0] = { ...log[0], sore: 4, bw: "199" };
      localStorage.setItem("ssl:log", JSON.stringify(log));
      window.SYNC.queueUpsertSession(log[0]);
    });
    release();
    await page.evaluate(() => window.__pull);

    const local = await page.evaluate(() => JSON.parse(localStorage.getItem("ssl:log"))[0]);
    expect(local).toMatchObject({ sore: 4, bw: "199" });
    await expect.poll(async () => (await serverSessions(request, userEmail))[0].sore).toBe(4);
  });

  test("a delete made while a pull is in flight isn't resurrected by that pull", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await seedEntry(request, userEmail);
    await page.goto("/");
    await synced(page);

    let release, held = false;
    const gate = new Promise((r) => { release = r; });
    await page.route("**/api/sessions", async (route) => {
      if (route.request().method() !== "GET" || held) return route.continue();
      held = true;
      const stale = await route.fetch();
      await gate;
      await route.fulfill({ response: stale });
    });
    await page.evaluate(() => { window.__pull = window.SYNC.pull(); });
    await expect(page.locator("#syncStatus")).toHaveText("Syncing…");

    await page.evaluate(() => {
      localStorage.setItem("ssl:log", "[]");
      window.SYNC.queueDeleteSession("seed-a");
    });
    release();
    await page.evaluate(() => window.__pull);

    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ssl:log")))).toEqual([]);
    await expect.poll(async () => (await serverSessions(request, userEmail)).length).toBe(0);
  });
});

test.describe("sync failure on save", () => {
  test("the save button says the change will retry, and Retry now clears it once the server is back", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await page.goto("/");
    await synced(page);

    // server rejects writes
    await page.route("**/api/sessions", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, body: "boom" }) : route.continue()));
    await fillFirstSet(page);
    await page.locator("#saveBtn").click();

    // saved on this device, flagged on the button, and nothing reached the server
    await expect(page.locator("#saveBtn")).toContainText("sync failing, will retry");
    await expect(page.locator("#retrySync")).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ssl:log")).length)).toBe(1);
    expect(await serverSessions(request, userEmail)).toHaveLength(0);

    // server recovers; retrying delivers the same entry (no duplicate)
    await page.unroute("**/api/sessions");
    await page.locator("#retrySync").click();
    await expect(page.locator("#saveBtn")).toHaveText("Save to log");
    await expect(page.locator("#retrySync")).toBeHidden();
    await expect.poll(async () => (await serverSessions(request, userEmail)).length).toBe(1);
  });

  test("the duplicate-save prompt still takes priority over the failure label", async ({ page, request, userEmail }) => {
    await createAndActivateProgram(request, userEmail, { content: program() });
    await seedEntry(request, userEmail);
    await page.goto("/");
    await synced(page);
    await page.route("**/api/sessions", (route) => (route.request().method() === "GET" ? route.fulfill({ status: 500, body: "boom" }) : route.continue()));
    await page.evaluate(() => window.SYNC.pull());
    await expect(page.locator("#saveBtn")).toContainText("sync failing");
    await page.locator("#saveBtn").click();
    await expect(page.locator("#saveBtn")).toContainText("Already logged");
    await expect(page.locator("#saveBtn")).not.toContainText("sync failing");
  });
});
