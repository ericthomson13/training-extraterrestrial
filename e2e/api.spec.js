// HTTP-contract tests against functions/api/programs/* directly, bypassing
// the UI -- these lock in the ownership/auth boundary and the raw validation
// response shape independent of how app.js happens to render them.
import { test, expect } from "./fixtures.js";
import { minimalProgram } from "./helpers.js";

test("GET /api/programs/current returns null (not an error) for a brand-new user", async ({ request, userEmail }) => {
  const res = await request.get("/api/programs/current", { headers: { "X-Test-User-Email": userEmail } });
  expect(res.status()).toBe(200);
  const { program } = await res.json();
  expect(program).toBeNull();
});

test("POST /api/programs rejects a malicious payload with 422 and structured errors", async ({ request, userEmail }) => {
  const res = await request.post("/api/programs", {
    headers: { "X-Test-User-Email": userEmail },
    data: {
      name: "Malicious",
      content: minimalProgram({
        videos: { evil: "javascript:alert(document.cookie)" },
        sessionTemplates: [
          {
            key: 'A" onmouseover="alert(1)',
            title: "Day A",
            scope: { type: "period", n: 1 },
            items: [{ name: "Back squat", rx: "3x5", options: { v: "evil" } }],
          },
        ],
      }),
    },
  });
  expect(res.status()).toBe(422);
  const body = await res.json();
  expect(body.details.some((e) => e.includes("http:// or https://"))).toBe(true);
  expect(body.details.some((e) => e.includes("short identifier"))).toBe(true);

  const list = await (await request.get("/api/programs", { headers: { "X-Test-User-Email": userEmail } })).json();
  expect(list.programs.length).toBe(0);
});

test("a user cannot version or activate another user's program (404, not found)", async ({ request, userEmail, otherUserEmail }) => {
  const createRes = await request.post("/api/programs", {
    headers: { "X-Test-User-Email": userEmail },
    data: { name: "Owner's Program", sport: null, content: minimalProgram() },
  });
  expect(createRes.ok()).toBeTruthy();
  const { programId } = await createRes.json();

  const activateAsOther = await request.post(`/api/programs/${programId}/activate`, {
    headers: { "X-Test-User-Email": otherUserEmail },
  });
  expect(activateAsOther.status()).toBe(404);

  const versionAsOther = await request.post(`/api/programs/${programId}/versions`, {
    headers: { "X-Test-User-Email": otherUserEmail },
    data: { content: minimalProgram({ displayName: "Hijacked" }) },
  });
  expect(versionAsOther.status()).toBe(404);

  // The 404s above are the ownership check, not a broken endpoint -- confirm
  // the real owner's own activate still succeeds against the same program id.
  const activateAsOwner = await request.post(`/api/programs/${programId}/activate`, {
    headers: { "X-Test-User-Email": userEmail },
  });
  expect(activateAsOwner.ok()).toBeTruthy();

  const listAsOther = await request.get("/api/programs", { headers: { "X-Test-User-Email": otherUserEmail } });
  const { programs } = await listAsOther.json();
  expect(programs.find((p) => p.id === programId)).toBeUndefined();
});

test("addProgramVersion assigns sequential version numbers via the real HTTP endpoint", async ({ request, userEmail }) => {
  const createRes = await request.post("/api/programs", {
    headers: { "X-Test-User-Email": userEmail },
    data: { name: "Versioned Program", content: minimalProgram() },
  });
  const { programId } = await createRes.json();

  const v2Res = await request.post(`/api/programs/${programId}/versions`, {
    headers: { "X-Test-User-Email": userEmail },
    data: { content: minimalProgram({ displayName: "v2" }), changeSummary: "tweak" },
  });
  expect(v2Res.ok()).toBeTruthy();
  const { versionNo } = await v2Res.json();
  expect(versionNo).toBe(2);
});
