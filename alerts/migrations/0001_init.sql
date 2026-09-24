-- Initial schema for email and standards-based Web Push. No SMS data is stored.
-- This migration is intended for a new, empty D1 database.
CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_confirmed INTEGER NOT NULL DEFAULT 0,
  prefs_json TEXT NOT NULL,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS push_subscriber_idx ON push_subscriptions(subscriber_id);

CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  subscriber_id TEXT,
  email TEXT,
  purpose TEXT NOT NULL,
  payload_json TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS tokens_expiry ON tokens(expires_at);

CREATE TABLE IF NOT EXISTS alert_state (
  subscriber_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'push')),
  metric TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  last_sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subscriber_id, channel, metric)
);

CREATE TABLE IF NOT EXISTS request_limits (
  ip_hash TEXT PRIMARY KEY,
  until_ts INTEGER NOT NULL
);
