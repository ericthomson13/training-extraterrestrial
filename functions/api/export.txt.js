import { getCurrentProgram, listSessions, listTests } from "../_lib/db.js";
import { formatExportText } from "../_lib/format.js";

export async function onRequestGet(context) {
  const email = context.data.userEmail;
  const [sessions, tests, program] = await Promise.all([
    listSessions(context.env.DB, email),
    listTests(context.env.DB, email),
    getCurrentProgram(context.env.DB, email),
  ]);
  const testDefinitions = program?.content?.testDefinitions;
  const text = testDefinitions ? formatExportText(sessions, tests, testDefinitions) : formatExportText(sessions, tests);
  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
