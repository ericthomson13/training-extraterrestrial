// The app opens on the present (calendar) week's next workout. A skipped
// earlier week stays marked missed in the week strip but must never be the
// default view -- that was the bug: scanning from week 1 landed on it.
import { test, expect } from "./fixtures.js";
import { createAndActivateProgram, lockableProgram } from "./helpers.js";

test("opens on the current week even when earlier weeks were never logged", async ({ page, request, userEmail }) => {
  await createAndActivateProgram(request, userEmail, { content: lockableProgram() });
  await page.goto("/");
  await expect(page.locator('.chip[aria-pressed="true"]')).toHaveText(/Wk 3/);
  await expect(page.locator('.chip[data-week="1"]')).toHaveClass(/status-miss/);
});
