// Optional program sections: a program can omit testDefinitions/videos/
// circuits/activation/warmupTemplates, and a warm-up template needs only a
// key. The app must still render and log without "undefined" leaking in.
import { test, expect } from "./fixtures.js";
import { createAndActivateProgram, isoDaysAgo, minimalProgram } from "./helpers.js";

function sparse(warmup) {
  const p = minimalProgram({ startDate: isoDaysAgo(0) });
  for (const k of ["testDefinitions", "videos", "circuits", "activation", "warmupTemplates"]) delete p[k];
  if (warmup) {
    p.warmupTemplates = [warmup];
    p.sessionTemplates[0].warmupTemplate = warmup.key;
  }
  return p;
}

test("a program with no optional sections renders and saves a session", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: sparse() });
  await page.goto("/");
  await expect(page.locator("#saveBtn")).toBeVisible();
  await expect(page.locator("#warm")).toHaveCount(0);
  await page.locator(".ex").first().locator("summary").click();
  await page.locator("#l-w1-A-0-0").fill("100");
  await page.locator("#r-w1-A-0-0").fill("5");
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/api/sessions") && r.request().method() === "POST"), page.locator("#saveBtn").click()]);
  expect(res.ok()).toBeTruthy();
});

test("a key-only warm-up template renders just the panel, with no undefined text", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: sparse({ key: "w1" }) });
  await page.goto("/");
  await expect(page.locator("#warm")).toBeVisible();
  await expect(page.locator("#warm")).not.toContainText("undefined");
  await expect(page.locator("#warm table.erg")).toHaveCount(0);
  await expect(page.locator("#warm .kv b", { hasText: "Mobility" })).toHaveCount(0);
});

test("a mobility-only warm-up shows mobility but no erg table or activation", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: sparse({ key: "w1", mobility: "Ankle rocks 10/side" }) });
  await page.goto("/");
  await expect(page.locator("#warm")).toContainText("Ankle rocks 10/side");
  await expect(page.locator("#warm table.erg")).toHaveCount(0);
  await expect(page.locator("#warm .kv b", { hasText: "Activation" })).toHaveCount(0);
  await expect(page.locator("#warm")).not.toContainText("undefined");
});

test("a bare-minimum program (no units, titles, phases, rx, tests) renders every tab without undefined", async ({ page, request, userEmail }) => {
  const bare = {
    startDate: isoDaysAgo(0),
    periods: [{ n: 1, lengthDays: 7 }],
    sessionTemplates: [{ key: "A", scope: { type: "period", n: 1 }, items: [{ name: "Back squat" }] }],
  };
  await createAndActivateProgram(request, userEmail, { content: bare });
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("A");
  for (const view of ["session", "log", "tests", "progress", "start"]) {
    await page.locator(`.nav button[data-view="${view}"]`).click();
    await expect(page.locator("#app")).not.toContainText("undefined");
    await expect(page.locator("#app")).not.toContainText("NaN");
  }
});
