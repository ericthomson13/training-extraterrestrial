import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deleteSession, getCurrentProgram, listSessions, listTests, upsertSession, upsertTest } from "../functions/_lib/db.js";

const EMAIL = "eric@example.com";

function makeEntry(overrides = {}) {
  return {
    id: "2026-09-29-w1-A-abc123",
    date: "2026-09-29",
    sessionId: "w1-A",
    week: 1,
    key: "A",
    title: "Normalization",
    bw: "205",
    sore: 2,
    notes: "felt good",
    items: [{ name: "Back squat", rx: "2x5 RPE 6", u: "", t: null, target: null, sets: [{ load: "135", reps: "5", rpe: "6" }], note: "" }],
    ...overrides,
  };
}

describe("session_log upserts", () => {
  it("upsert then list round-trips the entry", async () => {
    const entry = makeEntry({ id: "test-round-trip-1" });
    await upsertSession(env.DB, EMAIL, entry);
    const sessions = await listSessions(env.DB, EMAIL);
    const found = sessions.find((s) => s.id === "test-round-trip-1");
    expect(found).toBeTruthy();
    expect(found.title).toBe("Normalization");
    expect(found.week).toBe(1); // numeric week round-trips as a number, not "1"
    expect(found.items[0].sets[0].load).toBe("135");
  });

  it('keeps an in-season "S" week as a string', async () => {
    await upsertSession(env.DB, EMAIL, makeEntry({ id: "test-inseason-1", week: "S", key: "M1" }));
    const sessions = await listSessions(env.DB, EMAIL);
    expect(sessions.find((s) => s.id === "test-inseason-1").week).toBe("S");
  });

  it("upserting the same id twice updates in place rather than duplicating", async () => {
    const id = "test-idempotent-1";
    await upsertSession(env.DB, EMAIL, makeEntry({ id, notes: "first" }));
    await upsertSession(env.DB, EMAIL, makeEntry({ id, notes: "second" }));
    const sessions = await listSessions(env.DB, EMAIL);
    const matches = sessions.filter((s) => s.id === id);
    expect(matches.length).toBe(1);
    expect(matches[0].notes).toBe("second");
  });

  it("scopes sessions by user_email — one user never sees another's rows", async () => {
    const id = "test-scope-1";
    await upsertSession(env.DB, EMAIL, makeEntry({ id }));
    const otherUsersSessions = await listSessions(env.DB, "someone-else@example.com");
    expect(otherUsersSessions.find((s) => s.id === id)).toBeUndefined();
  });

  it("deleteSession removes only that id for that user", async () => {
    const id = "test-delete-1";
    const keep = "test-delete-keep-1";
    await upsertSession(env.DB, EMAIL, makeEntry({ id }));
    await upsertSession(env.DB, EMAIL, makeEntry({ id: keep }));
    await deleteSession(env.DB, EMAIL, id);
    const sessions = await listSessions(env.DB, EMAIL);
    expect(sessions.find((s) => s.id === id)).toBeUndefined();
    expect(sessions.find((s) => s.id === keep)).toBeTruthy();
  });
});

describe("test_result merge-upserts", () => {
  it("upsertTest merges values for the same date rather than overwriting the whole record", async () => {
    const date = "2026-09-29";
    await upsertTest(env.DB, EMAIL, date, { squat: { load: 225, reps: 5, e1rm: 262 } });
    await upsertTest(env.DB, EMAIL, date, { bw: 205 });
    const tests = await listTests(env.DB, EMAIL);
    const rec = tests.find((t) => t.date === date);
    expect(rec.v.squat.e1rm).toBe(262);
    expect(rec.v.bw).toBe(205);
  });

  it("a later write for the same field on the same date overwrites just that field", async () => {
    const date = "2026-09-30";
    await upsertTest(env.DB, EMAIL, date, { bw: 200 });
    await upsertTest(env.DB, EMAIL, date, { bw: 202 });
    const tests = await listTests(env.DB, EMAIL);
    expect(tests.find((t) => t.date === date).v.bw).toBe(202);
  });

  it("scopes test results by user_email", async () => {
    const date = "2026-10-05";
    await upsertTest(env.DB, EMAIL, date, { bw: 199 });
    const otherUsersTests = await listTests(env.DB, "someone-else@example.com");
    expect(otherUsersTests.find((t) => t.date === date)).toBeUndefined();
  });
});

describe("getCurrentProgram", () => {
  it("returns null for a user with no programs (the normal new-user state, not an error)", async () => {
    const result = await getCurrentProgram(env.DB, "brand-new-user@example.com");
    expect(result).toBeNull();
  });

  it("returns the current program's latest version content", async () => {
    const email = "program-user@example.com";
    await env.DB.prepare(`INSERT INTO app_user (email) VALUES (?)`).bind(email).run();
    await env.DB
      .prepare(`INSERT INTO program (id, user_email, name, status, start_date) VALUES ('prog-1', ?, 'Test Program', 'current', '2026-01-01')`)
      .bind(email)
      .run();
    await env.DB
      .prepare(`INSERT INTO program_version (id, program_id, version_no, content) VALUES ('v1', 'prog-1', 1, ?)`)
      .bind(JSON.stringify({ displayName: "V1" }))
      .run();
    await env.DB
      .prepare(`INSERT INTO program_version (id, program_id, version_no, content) VALUES ('v2', 'prog-1', 2, ?)`)
      .bind(JSON.stringify({ displayName: "V2" }))
      .run();

    const result = await getCurrentProgram(env.DB, email);
    expect(result.programId).toBe("prog-1");
    expect(result.versionNo).toBe(2);
    expect(result.content.displayName).toBe("V2");
  });

  it("only returns a program with status='current', never a draft or archived one", async () => {
    const email = "draft-only-user@example.com";
    await env.DB.prepare(`INSERT INTO app_user (email) VALUES (?)`).bind(email).run();
    await env.DB
      .prepare(`INSERT INTO program (id, user_email, name, status) VALUES ('prog-draft', ?, 'Draft Program', 'draft')`)
      .bind(email)
      .run();
    await env.DB
      .prepare(`INSERT INTO program_version (id, program_id, version_no, content) VALUES ('v-draft', 'prog-draft', 1, ?)`)
      .bind(JSON.stringify({ displayName: "Draft" }))
      .run();

    const result = await getCurrentProgram(env.DB, email);
    expect(result).toBeNull();
  });

  it("scopes programs by user_email", async () => {
    const owner = "program-owner@example.com";
    await env.DB.prepare(`INSERT INTO app_user (email) VALUES (?)`).bind(owner).run();
    await env.DB
      .prepare(`INSERT INTO program (id, user_email, name, status) VALUES ('prog-owner', ?, 'Owner Program', 'current')`)
      .bind(owner)
      .run();
    await env.DB
      .prepare(`INSERT INTO program_version (id, program_id, version_no, content) VALUES ('v-owner', 'prog-owner', 1, ?)`)
      .bind(JSON.stringify({ displayName: "Owner's" }))
      .run();

    const result = await getCurrentProgram(env.DB, "someone-else@example.com");
    expect(result).toBeNull();
  });
});
