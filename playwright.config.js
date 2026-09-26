// End-to-end suite against a real `wrangler pages dev` + local D1, exercising
// the app the way a browser actually would -- unlike test/*.test.js (vitest),
// which calls functions/_lib/*.js directly. Requires .dev.vars to exist
// locally (see .dev.vars.example) with ENVIRONMENT=development; each test
// authenticates as its own throwaway synthetic user via the X-Test-User-Email
// header (see functions/api/_middleware.js), never Eric's real DEV_USER_EMAIL
// identity, so tests can't collide with each other or with real local data.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8788",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run d1:migrate:local && npx wrangler pages dev public --port=8788",
    url: "http://localhost:8788",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
