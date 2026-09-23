import { listTests, upsertTest } from "../../_lib/db.js";

export async function onRequestGet(context) {
  const tests = await listTests(context.env.DB, context.data.userEmail);
  return Response.json({ tests });
}

// Body is { date, v }, or { records: [...] } for the migration bulk import.
// Merge-by-date semantics match the client's mergeTest().
export async function onRequestPost(context) {
  const body = await context.request.json();
  const records = Array.isArray(body.records) ? body.records : [body];
  for (const rec of records) {
    await upsertTest(context.env.DB, context.data.userEmail, rec.date, rec.v);
  }
  return Response.json({ ok: true, count: records.length });
}
