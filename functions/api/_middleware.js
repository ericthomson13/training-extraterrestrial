import { verifyAccessJWT } from "../_lib/access.js";

// Guards every /api/* request. Verifies the Cloudflare Access JWT and sets
// context.data.userEmail — the value every route scopes its D1 queries to.
// This is the multi-tenancy boundary: trust the verified JWT, not the
// convenience Cf-Access-Authenticated-User-Email header alone.
export async function onRequest(context) {
  const { request, env } = context;

  // Local dev only: Access doesn't front localhost, so `wrangler pages dev`
  // needs a stand-in identity. DEV_USER_EMAIL only ever comes from a
  // gitignored .dev.vars file — it is never set in production. The
  // X-Test-User-Email header lets the Playwright e2e suite act as different
  // synthetic users against one running dev server without restarting it
  // (see e2e/README or PLANNING.md) -- gated by the exact same
  // ENVIRONMENT !== "production" check as DEV_USER_EMAIL, so it's equally
  // impossible to trigger in production.
  if (env.ENVIRONMENT !== "production") {
    const testUserEmail = request.headers.get("X-Test-User-Email");
    if (testUserEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testUserEmail)) {
      context.data.userEmail = testUserEmail;
      return context.next();
    }
    if (env.DEV_USER_EMAIL) {
      context.data.userEmail = env.DEV_USER_EMAIL;
      return context.next();
    }
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return new Response("Unauthorized", { status: 401 });

  try {
    context.data.userEmail = await verifyAccessJWT(token, {
      teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
      aud: env.CF_ACCESS_AUD,
    });
  } catch (err) {
    return new Response("Unauthorized", { status: 401 });
  }

  return context.next();
}
