-- Additive custom-threshold delivery preferences for enrolled push devices.
-- Existing event-push devices and email subscribers remain unchanged.
CREATE TABLE IF NOT EXISTS push_threshold_preferences (
  device_id TEXT PRIMARY KEY,
  linked_subscriber_id TEXT,
  prefs_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES push_devices(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_subscriber_id) REFERENCES subscribers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS push_threshold_preferences_subscriber_idx
  ON push_threshold_preferences(linked_subscriber_id, updated_at);
