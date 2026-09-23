import { listSessions, listTests } from "../_lib/db.js";
import { formatExportText } from "../_lib/format.js";

export async function onRequestGet(context) {
  const email = context.data.userEmail;
  const [sessions, tests] = await Promise.all([listSessions(context.env.DB, email), listTests(context.env.DB, email)]);
  return new Response(formatExportText(sessions, tests), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
