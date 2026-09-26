import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-schema.js"],
    // e2e/*.spec.js are Playwright tests (see playwright.config.js), run via
    // `npm run test:e2e` -- vitest's default glob would otherwise also match
    // and try to execute them, which fails since they use @playwright/test's
    // APIs, not vitest's.
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
