-- Additive schema for lifecycle notification delivery. DO NOT apply automatically to production.
-- No existing email subscribers or alert_state rows are altered.
CREATE TABLE IF NOT EXISTS coastal_event_snapshots (
  event_key TEXT PRIMARY KEY,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  fingerprint TEXT,
  source_observed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coastal_event_deliveries (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  transition_kind TEXT NOT NULL CHECK (transition_kind IN ('start', 'end', 'change')),
  event_fingerprint TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS coastal_event_deliveries_subscriber_idx ON coastal_event_deliveries(subscriber_id, created_at);
CREATE INDEX IF NOT EXISTS coastal_event_deliveries_pending_idx ON coastal_event_deliveries(status, created_at);
