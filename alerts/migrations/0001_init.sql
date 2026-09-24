CREATE TABLE IF NOT EXISTS subscribers (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, phone TEXT,
 email_confirmed INTEGER NOT NULL DEFAULT 0, sms_confirmed INTEGER NOT NULL DEFAULT 0,
 sms_consent_at INTEGER, prefs_json TEXT NOT NULL, unsubscribed INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
 hash TEXT PRIMARY KEY, subscriber_id TEXT, email TEXT, purpose TEXT NOT NULL,
 payload_json TEXT, expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE INDEX IF NOT EXISTS tokens_expiry ON tokens(expires_at);
CREATE TABLE IF NOT EXISTS alert_state (
 subscriber_id TEXT NOT NULL, channel TEXT NOT NULL, metric TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 0, last_sent INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(subscriber_id,channel,metric)
);
CREATE TABLE IF NOT EXISTS request_limits (
 ip_hash TEXT PRIMARY KEY, until_ts INTEGER NOT NULL
);
