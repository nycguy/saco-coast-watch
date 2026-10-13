-- Delivery outbox for idempotent, retryable Web Push. Additive; leaves email rows untouched.
CREATE TABLE IF NOT EXISTS push_delivery_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  transition_kind TEXT NOT NULL CHECK (transition_kind IN ('start', 'end', 'change')),
  event_fingerprint TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error TEXT,
  FOREIGN KEY (device_id) REFERENCES push_devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS push_delivery_queue_pending_idx ON push_delivery_queue(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS push_delivery_queue_device_idx ON push_delivery_queue(device_id, created_at);
