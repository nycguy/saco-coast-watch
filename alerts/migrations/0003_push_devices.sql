-- Standalone browser push devices: no email address is required to opt in.
-- Additive only; existing email subscribers and their preferences are untouched.
-- Do not apply to production until the push API, delivery, and rollback are tested.
CREATE TABLE IF NOT EXISTS push_devices (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  event_prefs_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_devices_enabled_idx ON push_devices(enabled, updated_at);

CREATE TABLE IF NOT EXISTS push_device_deliveries (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  transition_kind TEXT NOT NULL CHECK (transition_kind IN ('start', 'end', 'change')),
  event_fingerprint TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  FOREIGN KEY (device_id) REFERENCES push_devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS push_device_deliveries_pending_idx ON push_device_deliveries(status, created_at);
