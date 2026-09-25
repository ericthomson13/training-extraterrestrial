-- Phase A of the multi-season/multi-user program plan (see PLANNING.md).
-- Purely additive: new tables, nullable columns on existing tables. No
-- existing data is touched, and the client doesn't read any of this yet.

CREATE TABLE program (
	id TEXT PRIMARY KEY,
	user_email TEXT NOT NULL REFERENCES app_user(email),
	name TEXT NOT NULL, -- "2026-27 Ski Season"
	sport TEXT, -- freeform, nullable
	status TEXT NOT NULL CHECK (status IN ('draft', 'current', 'archived')) DEFAULT 'draft',
	start_date TEXT, -- denormalized from content, for sorting a season-history list without parsing JSON
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_program_one_current_per_user ON program(user_email) WHERE status = 'current';

CREATE TABLE program_version (
	id TEXT PRIMARY KEY,
	program_id TEXT NOT NULL REFERENCES program(id),
	version_no INTEGER NOT NULL,
	content TEXT NOT NULL, -- JSON, full generalized program document (see PLANNING.md)
	change_summary TEXT, -- nullable, human-readable, for the history view
	source TEXT NOT NULL DEFAULT 'manual',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE (program_id, version_no)
);

CREATE INDEX idx_program_version_program ON program_version(program_id);

-- session_log: the real "what was I following when I logged this" pointer.
-- test_result: pure provenance only -- test results stay user-scoped (not
-- program-owned), since a lift max must carry forward across seasons.
ALTER TABLE session_log ADD COLUMN program_version_id TEXT REFERENCES program_version(id);
ALTER TABLE test_result ADD COLUMN program_version_id TEXT REFERENCES program_version(id);
