import { test, expect } from "./fixtures.js";
import { createAndActivateProgram, lockableProgram } from "./helpers.js";

test("updating the current program applies a future-period change and shows it after reload", async ({ page, request, userEmail }) => {
  const programId = await createAndActivateProgram(request, userEmail, { name: "Updatable Plan", content: lockableProgram() });

  await page.goto("/");
  await page.locator('.nav button[data-view="start"]').click();
  await page.locator(`#update-${programId}`).click();

  const updated = lockableProgram();
  updated.sessionTemplates[1].items[0].rx = { 2: "3x5", 3: "5x5" }; // period 3 is still open
  await page.locator(`#updPaste-${programId}`).fill(JSON.stringify(updated));
  await page.locator(`#updSubmit-${programId}`).click();
  await page.waitForEvent("load");

  const list = await (await request.get("/api/programs", { headers: { "X-Test-User-Email": userEmail } })).json();
  expect(list.programs.find((p) => p.id === programId).versionCount).toBe(2);
});

test("updating with a change to an already-happened period is rejected, no new version created", async ({ page, request, userEmail }) => {
  const programId = await createAndActivateProgram(request, userEmail, { name: "Locked Plan", content: lockableProgram() });

  await page.goto("/");
  await page.locator('.nav button[data-view="start"]').click();
  await page.locator(`#update-${programId}`).click();

  const updated = lockableProgram();
  updated.sessionTemplates[0].items[0].rx = "5x5"; // period 1 already happened
  await page.locator(`#updPaste-${programId}`).fill(JSON.stringify(updated));
  await page.locator(`#updSubmit-${programId}`).click();

  await expect(page.locator(`#updErrors-${programId}`)).toContainText("already happened");

  const list = await (await request.get("/api/programs", { headers: { "X-Test-User-Email": userEmail } })).json();
  expect(list.programs.find((p) => p.id === programId).versionCount).toBe(1);
});
