# End-to-end tests

Playwright tests against a real `wrangler pages dev` + local D1 — these drive
the actual browser and HTTP layer, unlike `test/*.test.js` (vitest), which
calls `functions/_lib/*.js` directly.

**Not run in CI.** Installing a browser and driving it through a live dev
server is the expensive part of this repo's testing, in both GitHub Actions
minutes and wall-clock time -- running it on every push risked burning
through the free-tier allotment. `.github/workflows/test.yml` only runs the
vitest suite. This suite is still fully maintained and the right one to run
locally (`npm run test:e2e`) before merging anything touching
session-logging, program upload/update, or sync -- that's exactly the real
browser/HTTP/service-worker layer vitest can't reach.

## Running

```
npm run test:e2e        # headless, once
npm run test:e2e:ui     # Playwright's interactive UI mode
```

Requires `.dev.vars` to exist locally (copy `.dev.vars.example`) with
`ENVIRONMENT=development`. `playwright.config.js`'s `webServer` starts the dev
server itself (`npm run d1:migrate:local && wrangler pages dev`), so you don't
need one already running — though if you do (`npm run dev`), Playwright
reuses it instead of starting a second one.

## Synthetic users

Every test gets its own throwaway identity — `pw-<uuid>@example.test` — via
the `X-Test-User-Email` header, which `functions/api/_middleware.js` honors
only when `ENVIRONMENT !== "production"` (the same guard `DEV_USER_EMAIL`
already uses, so this header is equally impossible to trigger against
production). See `fixtures.js`. This means:

- Tests never touch Eric's real dev identity or its data.
- Tests never collide with each other, so the whole suite runs fully
  parallel with no setup/teardown to reset shared D1 state.
- A test needing two identities (ownership/isolation checks) uses the
  `otherUserEmail`/`otherPage` fixtures for a second synthetic user.

`helpers.js`'s `minimalProgram()`/`createAndActivateProgram()` build and
install a program for a test's synthetic user without driving the upload UI,
for tests where the upload form itself isn't what's under test.
