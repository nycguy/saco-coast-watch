-- Additive operational telemetry only: no subscriber IDs, addresses, payloads or secrets.
CREATE TABLE IF NOT EXISTS worker_cron_health (
 channel TEXT PRIMARY KEY CHECK(channel IN ('email','threshold_push','event_push')),
 state TEXT NOT NULL CHECK(state IN ('running','healthy','failed','disabled')),
 started_at INTEGER NOT NULL,
 completed_at INTEGER
);
