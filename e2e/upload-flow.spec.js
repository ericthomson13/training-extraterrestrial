import { test, expect } from "./fixtures.js";
import { minimalProgram } from "./helpers.js";

test("uploading a valid program creates a draft, and activating it renders its content", async ({ page }) => {
  await page.goto("/");
  await page.locator("summary", { hasText: "Upload a program" }).click();
  await page.locator("#progName").fill("E2E Off-season");
  await page.locator("#progPaste").fill(JSON.stringify(minimalProgram()));
  await page.locator("#progUpload").click();

  const row = page.locator("#progListBody .entry", { hasText: "E2E Off-season" });
  await expect(row).toContainText("draft");
  await expect(row).toContainText("v1");

  await row.getByRole("button", { name: "Activate" }).click();
  await page.waitForEvent("load"); // location.reload() after a successful activate

  await expect(page.locator('.nav button[data-view="session"]')).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("Back squat")).toBeVisible();
  await expect(page).toHaveTitle("E2E Test Program");
});

test("uploading with no name shows a client-side error and creates nothing", async ({ page }) => {
  await page.goto("/");
  await page.locator("summary", { hasText: "Upload a program" }).click();
  await page.locator("#progPaste").fill(JSON.stringify(minimalProgram()));
  await page.locator("#progUpload").click();
  await expect(page.locator("#uploadErrors")).toContainText("Name is required");
  await expect(page.getByText("No programs yet")).toBeVisible();
});

test("pasting text that isn't valid JSON shows a client-side error and creates nothing", async ({ page }) => {
  await page.goto("/");
  await page.locator("summary", { hasText: "Upload a program" }).click();
  await page.locator("#progName").fill("Broken JSON");
  await page.locator("#progPaste").fill("{ this is not json");
  await page.locator("#progUpload").click();
  await expect(page.locator("#uploadErrors")).toContainText("doesn't look like valid JSON");
});

test("a malicious payload is rejected server-side with specific errors, no draft created", async ({ page }) => {
  await page.goto("/");
  await page.locator("summary", { hasText: "Upload a program" }).click();
  await page.locator("#progName").fill("Malicious Test");
  const malicious = minimalProgram({
    videos: { evil: "javascript:alert(document.cookie)" },
    sessionTemplates: [
      {
        key: 'A" onmouseover="alert(1)',
        title: "Day A",
        scope: { type: "period", n: 1 },
        items: [{ name: "Back squat", rx: "3x5", options: { v: "evil" } }],
      },
    ],
  });
  await page.locator("#progPaste").fill(JSON.stringify(malicious));
  await page.locator("#progUpload").click();

  const errors = page.locator("#uploadErrors");
  await expect(errors).toContainText("http:// or https://");
  await expect(errors).toContainText("short identifier");
  await expect(page.getByText("No programs yet")).toBeVisible();
});

test("upload errors are visually flagged: red banner (role=alert) plus a red toast", async ({ page }) => {
  await page.goto("/");
  await page.locator("summary", { hasText: "Upload a program" }).click();
  await page.locator("#progName").fill("Bad upload");
  await page.locator("#progPaste").fill(JSON.stringify(minimalProgram({ units: "stone" })));
  await page.locator("#progUpload").click();

  const box = page.locator("#uploadErrors");
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("role", "alert");
  await expect(box).toContainText("units");
  // red-hued border + tinted background, not the default muted text style
  const { border, bg } = await box.evaluate((el) => {
    const c = getComputedStyle(el);
    return { border: c.borderLeftColor, bg: c.backgroundColor };
  });
  const [r, g, b] = border.match(/\d+/g).map(Number);
  expect(r).toBeGreaterThan(g + 60);
  expect(r).toBeGreaterThan(b + 60);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");

  const toast = page.locator("#toast");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveClass(/err/);
  await expect(toast).toContainText(/Validation failed: \d+ issue/);
});
