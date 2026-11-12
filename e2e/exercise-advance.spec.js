// "Done — next exercise" opens the next unfinished exercise below the one just
// finished (wrapping to the top only if nothing is left below). Exercises
// finished out of order stay closed.
import { test, expect } from "./fixtures.js";
import { createAndActivateProgram, isoDaysAgo, minimalProgram } from "./helpers.js";

const program = () =>
  minimalProgram({
    startDate: isoDaysAgo(0),
    sessionTemplates: [
      {
        key: "A",
        title: "Day A",
        scope: { type: "period", n: 1 },
        items: ["Squat", "Bench", "Row", "Press"].map((name) => ({ name, rx: "1×5" })),
      },
    ],
  });

const card = (page, i) => page.locator(".ex").nth(i);
const openCard = (page, i) => card(page, i).locator("summary").click();
async function finish(page, i) {
  await card(page, i).locator(".set[data-k='0'] .n").click(); // mark the single set done
  await card(page, i).locator('[data-act="next"]').click();
}
const openIndexes = (page) =>
  page.locator(".ex").evaluateAll((els) => els.map((e, i) => (e.open ? i : -1)).filter((i) => i >= 0));

test("finishing in order moves to the next exercise", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: program() });
  await page.goto("/");
  await openCard(page, 0);
  await finish(page, 0);
  expect(await openIndexes(page)).toEqual([1]);
});

test("skipping ahead, then finishing, opens the next unfinished exercise, never a done one", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: program() });
  await page.goto("/");

  await openCard(page, 0);
  await finish(page, 0); // Squat done -> Bench opens
  await openCard(page, 3); // jump ahead to Press
  await finish(page, 3); // Press done: Bench (above) is still open work, NOT Squat
  expect(await openIndexes(page)).toEqual([1]);

  await finish(page, 1); // Bench done: Row is the next gap; Press (done) is skipped
  expect(await openIndexes(page)).toEqual([2]);
});

test("when everything is done, the last Done closes the card and opens nothing", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: program() });
  await page.goto("/");
  await openCard(page, 0);
  for (const i of [0, 1, 2]) await finish(page, i);
  expect(await openIndexes(page)).toEqual([3]); // advanced here automatically
  await finish(page, 3);
  expect(await openIndexes(page)).toEqual([]);
});

test("the warm-up's Done button opens the first unfinished exercise, not always the first", async ({ page, request, userEmail }) => {
  const p = program();
  p.warmupTemplates = [{ key: "w1", mobility: "Ankle rocks" }];
  p.sessionTemplates[0].warmupTemplate = "w1";
  await createAndActivateProgram(request, userEmail, { content: p });
  await page.goto("/");
  await openCard(page, 0);
  await card(page, 0).locator(".set[data-k='0'] .n").click(); // Squat done, left unadvanced
  await openCard(page, 0); // collapse it again
  await page.locator("#warmDone").click();
  expect(await openIndexes(page)).toEqual([1]);
});

test("after finishing, opens the next unfinished one below, skipping ones finished out of order", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: program() });
  await page.goto("/");
  await openCard(page, 2);
  await finish(page, 2); // Row done first -> Press opens
  await openCard(page, 3); // collapse Press again
  await openCard(page, 0);
  await finish(page, 0); // Squat done -> Bench
  expect(await openIndexes(page)).toEqual([1]);
  await finish(page, 1); // Bench done -> Press, NOT the already-finished Row
  expect(await openIndexes(page)).toEqual([3]);
});

test("the warm-up stays collapsed after Done, including across a reload", async ({ page, request, userEmail }) => {
  const p = program();
  p.warmupTemplates = [{ key: "w1", mobility: "Ankle rocks" }];
  p.sessionTemplates[0].warmupTemplate = "w1";
  await createAndActivateProgram(request, userEmail, { content: p });
  await page.goto("/");
  await expect(page.locator("#warm")).toHaveJSProperty("open", true);
  await page.locator("#warmDone").click();
  await expect(page.locator("#warm")).toHaveJSProperty("open", false);
  await page.reload();
  await expect(page.locator("#warm")).toHaveJSProperty("open", false);
});
