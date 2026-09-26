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
