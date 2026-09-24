# Saco Coast Watch Alerts: current deployment status

**Staging only.** The live Cloudflare Worker currently runs a Hello World starter until its owner pastes and deploys the standalone `alerts/src/worker.mjs` from this repository. This staging Worker checks configuration and the five D1 tables at `/health`. It does not accept public signups, send email or push notifications, or run alert checks. Public signup is intentionally hidden from the GitHub Pages site.

The retired SMS/Twilio Worker implementation has been removed from `alerts/src/worker.mjs`. Free email through Resend and standards-based Web Push are the planned notification channels; **Web Push is not implemented yet**. Do not advertise this service as active.

## Current infrastructure

- Cloudflare Worker: `saco-coastal-alerts.mikewiley-nyc.workers.dev`.
- D1 database binding: `DB`, database `saco-coastal-alerts`. The owner created tables `subscribers`, `push_subscriptions`, `tokens`, `alert_state`, and `request_limits` manually, along with indexes `push_subscriber_idx` and `tokens_expiry`. **Do not rerun the initial schema against populated databases.**
- Resend: verified domain `mainebeachrental.com`; `FROM_EMAIL=ferrybeach@mainebeachrental.com`; `SUPPORT_EMAIL=mikewiley.nyc@gmail.com`; `RESEND_API_KEY` stored only as a Cloudflare secret.
- Turnstile: widget for `nycguy.github.io`, with `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` configured in Cloudflare.
- Worker settings: `WORKER_PUBLIC_URL`, `PUBLIC_SITE`, `ALLOWED_ORIGIN`, and privately rotated `TOKEN_SECRET`.
- Do not commit secret values, show them in screenshots, or put them in GitHub Pages files.

## Safe initial deployment

1. Open the Cloudflare Worker `saco-coastal-alerts` and choose **Edit code**.
2. Open [the standalone Worker source](https://github.com/nycguy/saco-coast-watch/blob/main/alerts/src/worker.mjs), copy its entire raw content, replace the Hello World code in Cloudflare, and **Deploy**.
3. Visit `https://saco-coastal-alerts.mikewiley-nyc.workers.dev/health`. Check `configurationReady`, `databaseConnected`, `missingSettings` and `missingTables`. This status reports missing key names but never secret values.
4. Continue implementation and testing of email delivery, authentication and consent, Web Push encryption and service worker, data-feed verification, scheduled alerts, unsubscribe and management. Keep signup disabled until those tests pass.

This Worker is a staging health check, not an operational alert service.
