// D1 access, scoped by user_email throughout — this is the multi-tenancy
// boundary paired with the JWT verification in access.js. Plain functions
// (not tied to the Pages Functions request/context shape) so they're easy to
// unit test directly against a D1 binding.

export async function upsertUser(db, email) {
  await db
    .prepare(`INSERT INTO app_user (email) VALUES (?) ON CONFLICT(email) DO UPDATE SET last_seen_at = datetime('now')`)
    .bind(email)
    .run();
}

export async function upsertSession(db, userEmail, entry) {
  await upsertUser(db, userEmail);
  const { id, date, week, key, title, ...rest } = entry;
  await db
    .prepare(
      `INSERT INTO session_log (id, user_email, date, week, session_key, title, body, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_email, id) DO UPDATE SET
         date = excluded.date, week = excluded.week, session_key = excluded.session_key,
         title = excluded.title, body = excluded.body, updated_at = excluded.updated_at`,
    )
    .bind(id, userEmail, date, String(week), key, title, JSON.stringify(rest))
    .run();
}

function rowToEntry(row) {
  const week = /^\d+$/.test(row.week) ? Number(row.week) : row.week;
  return { id: row.id, date: row.date, week, key: row.session_key, title: row.title, ...JSON.parse(row.body), updatedAt: row.updated_at };
}

export async function listSessions(db, userEmail, since) {
  const stmt = since
    ? db.prepare(`SELECT * FROM session_log WHERE user_email = ? AND updated_at > ? ORDER BY date ASC`).bind(userEmail, since)
    : db.prepare(`SELECT * FROM session_log WHERE user_email = ? ORDER BY date ASC`).bind(userEmail);
  const { results } = await stmt.all();
  return results.map(rowToEntry);
}

export async function deleteSession(db, userEmail, id) {
  await db.prepare(`DELETE FROM session_log WHERE user_email = ? AND id = ?`).bind(userEmail, id).run();
}

export async function upsertTest(db, userEmail, date, values) {
  await upsertUser(db, userEmail);
  const existing = await db.prepare(`SELECT values_json FROM test_result WHERE user_email = ? AND date = ?`).bind(userEmail, date).first();
  const merged = existing ? { ...JSON.parse(existing.values_json), ...values } : values;
  await db
    .prepare(
      `INSERT INTO test_result (user_email, date, values_json, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_email, date) DO UPDATE SET values_json = excluded.values_json, updated_at = excluded.updated_at`,
    )
    .bind(userEmail, date, JSON.stringify(merged))
    .run();
}

export async function listTests(db, userEmail) {
  const { results } = await db
    .prepare(`SELECT date, values_json, updated_at FROM test_result WHERE user_email = ? ORDER BY date ASC`)
    .bind(userEmail)
    .all();
  return results.map((r) => ({ date: r.date, v: JSON.parse(r.values_json), updatedAt: r.updated_at }));
}

// The current program's latest version -- "latest" is automatic (no separate
// "activate a version" step exists, only "activate a program"), so this is
// always just the highest version_no for whichever program is status='current'.
export async function getCurrentProgram(db, userEmail) {
  const row = await db
    .prepare(
      `SELECT p.id as program_id, p.name as program_name, pv.id as version_id, pv.version_no, pv.content
       FROM program p JOIN program_version pv ON pv.program_id = p.id
       WHERE p.user_email = ? AND p.status = 'current'
       ORDER BY pv.version_no DESC LIMIT 1`,
    )
    .bind(userEmail)
    .first();
  if (!row) return null;
  return {
    programId: row.program_id,
    programName: row.program_name,
    versionId: row.version_id,
    versionNo: row.version_no,
    content: JSON.parse(row.content),
  };
}
