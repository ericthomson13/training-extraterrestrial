// Shared fixtures for the e2e suite. Every test gets its own throwaway
// synthetic identity via the X-Test-User-Email header the dev-only auth
// middleware honors (see functions/api/_middleware.js) -- never
// DEV_USER_EMAIL's real dev identity, and never two tests sharing an email,
// so tests can run fully parallel with no shared D1 state to reset between
// runs.
import { test as base, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

function freshUserEmail() {
  return `pw-${randomUUID()}@example.test`;
}

export const test = base.extend({
  userEmail: async ({}, use) => {
    await use(freshUserEmail());
  },
  // Overrides the built-in `page` fixture so every page load from it carries
  // this test's synthetic identity.
  page: async ({ browser, userEmail }, use) => {
    const context = await browser.newContext({ extraHTTPHeaders: { "X-Test-User-Email": userEmail } });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  // A second, distinct synthetic identity + authenticated page, for tests
  // that need two different users (ownership/isolation checks).
  otherUserEmail: async ({}, use) => {
    await use(freshUserEmail());
  },
  otherPage: async ({ browser, otherUserEmail }, use) => {
    const context = await browser.newContext({ extraHTTPHeaders: { "X-Test-User-Email": otherUserEmail } });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
