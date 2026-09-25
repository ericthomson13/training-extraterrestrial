import { env } from "cloudflare:test";

// Setup files run outside per-test-file storage isolation and may run more
// than once; the migrations have no IF NOT EXISTS guards, so guard here
// instead by ignoring "already exists" from a repeat run. Strip line comments
// before splitting on ";" -- D1 rejects a "statement" that turns out to be
// comment-only once whitespace is trimmed.
//
// Loads every migrations/*.sql file automatically (sorted by filename) so a
// future migration never requires touching this file again.
const migrations = import.meta.glob("../migrations/*.sql", { query: "?raw", import: "default", eager: true });
const sortedPaths = Object.keys(migrations).sort();

for (const path of sortedPaths) {
  const statements = migrations[path]
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e) {
      if (!/already exists/i.test(String(e))) throw e;
    }
  }
}
