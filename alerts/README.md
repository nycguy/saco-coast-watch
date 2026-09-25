# Saco Coast Watch: email-alert production release

**Release prepared, NOT YET live.** `alerts/src/worker.mjs` now includes public email signup and confirmation, per-metric thresholds, management via verified email, one-click unsubscribe, data freshness checks, duplicate/cooldown state in D1, and the scheduled email checker. The Worker currently running in Cloudflare still has the owner-only pilot until the operator deploys this new source. **Web Push and SMS are not implemented.**

## One-time cutover, no additional accounts or SQL

1. Keep the current production dashboard signup hidden while configuring the Worker.
2. Open the [complete current Worker source](https://raw.githubusercontent.com/nycguy/saco-coast-watch/main/alerts/src/worker.mjs), confirm the string `email-release-v2`, copy all text, replace `worker.js` in Cloudflare Workers & Pages → `saco-coastal-alerts` → Edit code, and click Deploy.
3. Open `https://saco-coastal-alerts.mikewiley-nyc.workers.dev/health`. Confirm `pilotBuild=email-release-v2`, `configurationReady=true` and `webPushEnabled=false`. With `LIVE_ALERTS` unset, public signup and real alert delivery remain off.
4. In Cloudflare Worker Settings → Triggers → Cron Triggers, add **every 10 minutes** (cron `*/10 * * * *`). This must be added to the actual dashboard-managed Worker; changing `wrangler.toml` in GitHub alone does not create a scheduled trigger. Cloudflare may take up to 15 minutes to propagate the trigger.
5. In Worker Settings → Runtime variables and secrets, add a *plain-text Production variable* `LIVE_ALERTS` with value `true`, then click Add variable and deploy. Existing keys, D1 binding, and secrets must remain untouched. Unset or any other value keeps signups and scheduled emails off.
6. Revisit `/health` and `/alerts`; sign up through `/alerts` with the owner address. The previous owner-only pilot did **not** opt the owner in to automatic notifications. Confirm the new `Confirm your Saco Coast Watch coastal email alerts` link.
7. Confirm the Cron Trigger exists and view Cloudflare Worker Logs / Cron Events for errors. No threshold email is expected unless a selected live reading is over the threshold. Do not lower real alert thresholds to force a test. Subscribe/confirmation/management emails count against the Resend free allowance. Verify unsubscribe through the signed link in a real alert email or the emailed management link.
8. Only after verifying signup and schedule should the GitHub Pages homepage be updated to link to `https://saco-coastal-alerts.mikewiley-nyc.workers.dev/alerts`.

## Functional limits and caution

- Production release is **EMAIL ONLY**. Standard Web Push requires a browser service worker, explicit permission and encrypted VAPID delivery; no claim is made that it is working.
- The daily email-alert limiter is 60 attempted alert messages per UTC day, in addition to confirmation and management emails. Per-run delivery cap is 8; checks run every 10 minutes; the Worker scans at most 1,000 confirmed subscribers per run. These are limits, not a promise that all subscribers can be notified during a widespread storm. Account/provider quotas can still block sends.
- Uses NOAA Portland gauge 8418150 (ft MLLW), NOAA forecast model guidance for the next 72 hours, NDBC buoy 44007 winds and KPWM airport air temperature. The forecast is model guidance, not an observed property water depth. Missing/stale feeds skip that metric rather than substituting an estimate.
- Sends on a first available over-threshold reading or a newly crossed threshold; continued exceedance is suppressed; resetting below and recrossing after a 60-minute cooldown permits another email. Per-subscriber email state stored in `alert_state`. On failed Resend send, the record is not marked delivered, so a later check may retry.
- It is an independent, best-effort notification service, **not** an official emergency warning system. Users must rely on official NWS and local public safety communications.
- Existing D1 tables and indexes already support this release. **Do not rerun the initial SQL migration on the populated D1 database.** Do not share or commit secrets.
