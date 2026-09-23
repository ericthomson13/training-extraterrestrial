-- Phase 1 schema. Multi-tenant by Access-authenticated email; every table is
-- scoped by user_email. Phase 2/3 (garmin_activity, wellness_daily, ...) add
-- new tables in later migrations without touching these.

CREATE TABLE app_user (
	email TEXT PRIMARY KEY,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	last_seen_at TEXT
);

CREATE TABLE session_log (
	id TEXT NOT NULL, -- client-generated id (date-sessionId-timestamp), already unique
	user_email TEXT NOT NULL REFERENCES app_user(email),
	date TEXT NOT NULL,
	week TEXT NOT NULL, -- number or "S", stored as text
	session_key TEXT NOT NULL, -- A/B/C/D1/M1/... ("key" avoided as a column name)
	title TEXT NOT NULL,
	body TEXT NOT NULL, -- JSON: {sessionId, bw, sore, notes, items:[...]}
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (user_email, id)
);

CREATE INDEX idx_session_log_user_date ON session_log(user_email, date);

CREATE TABLE test_result (
	user_email TEXT NOT NULL REFERENCES app_user(email),
	date TEXT NOT NULL,
	values_json TEXT NOT NULL, -- merged `v` object, same semantics as the client's mergeTest()
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (user_email, date)
);
