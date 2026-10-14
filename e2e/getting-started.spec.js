import { test, expect } from "./fixtures.js";

test.describe("brand-new user (no program yet)", () => {
  test("shows generic branding and the empty getting-started state, auto-routed", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Training Log");
    await expect(page.locator(".brand")).toContainText("Training Log");
    await expect(page.locator('.nav button[data-view="start"]')).toHaveAttribute("aria-current", "true");
    await expect(page.getByText("You don't have a training program yet.")).toBeVisible();
    await expect(page.getByText("No programs yet")).toBeVisible();
  });

  test("starter-content links point at the servable copies in public/", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Program-building guide" })).toHaveAttribute("href", "build-your-training-plan.md");
    await expect(page.getByRole("link", { name: "Program schema (for Claude to follow)" })).toHaveAttribute("href", "program.schema.json");
    await expect(page.getByRole("link", { name: "Example program" })).toHaveAttribute("href", "example-program.json");
  });
});

test.describe("program-building guide", () => {
  test("is served as plain text so browsers show it instead of downloading it", async ({ page }) => {
    const res = await page.request.get("/build-your-training-plan.md");
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["content-type"]).toContain("text/plain");
    expect(await res.text()).toContain("Build Your Training Plan");
  });

  test("the Copy the prompt button copies the whole guide", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.locator("#copyGuide").click();
    await expect(page.locator("#toast")).toContainText("Prompt copied");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("Build Your Training Plan");
    expect(clip).toContain("Instructions for the AI assistant");
  });
});
