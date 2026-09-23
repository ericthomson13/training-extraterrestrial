import { listSessions, upsertSession } from "../../_lib/db.js";

export async function onRequestGet(context) {
  const since = new URL(context.request.url).searchParams.get("since");
  const sessions = await listSessions(context.env.DB, context.data.userEmail, since);
  return Response.json({ sessions });
}

// Body is a single entry, or { entries: [...] } for the one-time local
// migration bulk import. Upsert is idempotent on the entry's own id.
export async function onRequestPost(context) {
  const body = await context.request.json();
  const entries = Array.isArray(body.entries) ? body.entries : [body];
  for (const entry of entries) {
    await upsertSession(context.env.DB, context.data.userEmail, entry);
  }
  return Response.json({ ok: true, count: entries.length });
}
