import { env } from "cloudflare:test";
import schemaSql from "../migrations/0001_init.sql?raw";

// Setup files run outside per-test-file storage isolation and may run more
// than once; migrations/0001_init.sql has no IF NOT EXISTS guards, so guard
// here instead by ignoring "already exists" from a repeat run. Strip line
// comments before splitting on ";" — D1 rejects a "statement" that turns out
// to be comment-only once whitespace is trimmed.
const statements = schemaSql
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
