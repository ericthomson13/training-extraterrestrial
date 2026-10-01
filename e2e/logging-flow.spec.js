// Exercises the actual session-logging UI (not just program management) --
// added after a real mix-up where an already-finished week got logged a
// second time because nothing on screen distinguished it from a fresh one.
import { test, expect } from "./fixtures.js";
import { createAndActivateProgram, isoDaysAgo, minimalProgram } from "./helpers.js";

// startDate must be "today" (not a fixed literal) so a session logged during
// the test actually falls inside period 1's real date range -- isWeekHit()
// matches a logged entry to a period by its real calendar date, same as the
// live app does for a real user.
function twoWeekProgram() {
  return minimalProgram({
    startDate: isoDaysAgo(0),
    periods: [
      { n: 1, phase: "Intro", lengthDays: 7 },
      { n: 2, phase: "Build", lengthDays: 7 },
    ],
    sessionTemplates: [
      { key: "A", title: "Day A", scope: { type: "period", n: 1 }, items: [{ name: "Back squat", rx: "3×5" }] },
      { key: "A", title: "Day A", scope: { type: "period", n: 2 }, items: [{ name: "Back squat", rx: "3×5" }] },
    ],
  });
}

// Exercises render as collapsed <details> accordions -- their set inputs
// aren't visible/interactable until opened.
async function openExercise(page, nth = 0) {
  await page.locator(".ex").nth(nth).locator("summary").click();
}

async function saveSession(page) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/sessions") && r.request().method() === "POST"),
    page.locator("#saveBtn").click(),
  ]);
  expect(res.ok()).toBeTruthy();
}

test("filling in a set's load/reps without tapping its done toggle still saves the full readout", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: twoWeekProgram() });
  await page.goto("/");
  await openExercise(page);

  await page.locator("#l-w1-A-0-0").fill("185");
  await page.locator("#r-w1-A-0-0").fill("5");
  await page.locator("#p-w1-A-0-0").fill("7");
  // deliberately never tap the set's own done toggle (the "1" button)
  await saveSession(page);

  const { sessions } = await (await request.get("/api/sessions", { headers: { "X-Test-User-Email": userEmail } })).json();
  expect(sessions.length).toBe(1);
  const loggedSet = sessions[0].items[0].sets[0];
  expect(loggedSet.load).toBe("185");
  expect(loggedSet.reps).toBe("5");
  expect(loggedSet.rpe).toBe("7");
});

test("'next up' advances past a completed week instead of landing back on it", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: twoWeekProgram() });
  await page.goto("/");
  await openExercise(page);

  await page.locator("#l-w1-A-0-0").fill("185");
  await page.locator("#r-w1-A-0-0").fill("5");
  await saveSession(page);

  await page.reload();
  await expect(page.locator('.chip[aria-pressed="true"]')).toHaveText(/Wk 2/);
});

test("revisiting an already-logged session shows what was recorded and a banner, not a blank form", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: twoWeekProgram() });
  await page.goto("/");
  await openExercise(page);

  await page.locator("#l-w1-A-0-0").fill("185");
  await page.locator("#r-w1-A-0-0").fill("5");
  await saveSession(page);
  await page.reload(); // now defaults to week 2

  await page.locator('.chip[data-week="1"]').click();
  await expect(page.getByText(/Already logged/)).toBeVisible();
  await openExercise(page);
  await expect(page.locator("#l-w1-A-0-0")).toHaveValue("185");
  await expect(page.locator("#r-w1-A-0-0")).toHaveValue("5");
});

test("the remove-set button undoes an accidental add, and can't go below one set", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: twoWeekProgram() });
  await page.goto("/");
  await openExercise(page);

  const exercise = page.locator(".ex").first();
  await expect(exercise.locator(".set[data-k]")).toHaveCount(3);

  await exercise.getByRole("button", { name: "+ Set" }).click();
  await expect(exercise.locator(".set[data-k]")).toHaveCount(4);

  await exercise.getByRole("button", { name: "− Set" }).click();
  await expect(exercise.locator(".set[data-k]")).toHaveCount(3);

  for (let i = 0; i < 2; i++) await exercise.getByRole("button", { name: "− Set" }).click(); // 3 -> 2 -> 1
  await expect(exercise.locator(".set[data-k]")).toHaveCount(1);
  await expect(exercise.getByRole("button", { name: "− Set" })).toBeDisabled();
});
