# SacoCast Cloudflare alerts Worker

`src/worker.mjs` preserves the existing email confirmation, management, unsubscribe, threshold, data-freshness, Resend, Turnstile, and D1 flows. Web Push is separately opt-in after a direct browser tap. The Worker returns the public VAPID key only to the configured Pages origin, stores a hash of the device control token, encrypts deliveries using RFC 8291 `aes128gcm`, and keeps push delivery failures isolated from email checks.

Manage Alerts includes **Send Test Notification** for an enrolled device. Its request requires that device's bearer control token, the configured Pages origin, and an enabled D1 device row; it sends directly to that row's subscription and does not create a weather event or touch email subscribers. The Worker rate limits test sends by an HMAC of the source IP for five minutes. A successful response means the push provider accepted the request; the device still needs permission and connectivity to display it. An expired provider endpoint is removed from `push_devices`, and the UI asks the owner to enroll that browser again. Transient provider errors leave the device record intact so the owner can retry after the cooldown.

## Production deployment

The only source of truth is `nycguy/saco-coast-watch`. Production Worker/D1 releases use the public `Release coastal alerts Worker` workflow, which defaults to read-only preflight. The preflight verifies the current Worker/email state, expected base D1 tables and columns, additive migration state, existing VAPID secret names, and the subscriber-count baseline. Partial or unknown schema state fails closed.

An explicit `apply_migrations_and_deploy=true` is required for writes. The workflow applies additive migrations `0002_event_notifications.sql` through `0005_push_threshold_preferences.sql` when the schema is absent, or applies only 0005 when threshold preferences are pending. It skips migration if the full schema is already present and refuses partial state. Migration `0001_init.sql` is for a new, empty database only. Subscriber rows and existing email state are checked for preservation. Existing VAPID secrets are retained; a partial pair stops deployment. If neither key exists, the workflow creates the first pair only after confirming no push devices exist.

The deployment updates Worker code and applies the configured ten-minute cron. No synthetic hazard or real-subscriber test is sent. See [deployment](../docs/DEPLOYMENT.md) for the complete release and verification procedure.

## Event lifecycle and delivery

Every ten minutes, the Worker checks official NWS event changes and selected custom thresholds. The first successful NWS snapshot establishes a baseline without sending notifications for already-active alerts. Stale, malformed, unavailable, or unsuccessful data cannot fabricate event endings. Later successful reads can create start, meaningful-change, and end transitions. Custom threshold push is per-device opt-in and uses the same freshness-checked NOAA/NWS/NDBC readings as email checks; the feeds are fetched once when both channels are active. Each device/channel/metric has independent crossing state, so app-only settings do not require email opt-in. Failed provider sends remain retryable, expired endpoints are removed, and no more than 24 custom threshold sends are attempted per run. Email processing remains independent.

A real delivery smoke test sends one test notification to the owner-controlled, enrolled browser only and attempts to disable the temporary device on cleanup. Never run it against another person's subscription or use fabricated hazard events to test production.
