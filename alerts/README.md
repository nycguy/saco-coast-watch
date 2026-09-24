# Saco Coast Watch Alerts: owner-only email test

**Current state:** The live Cloudflare Worker was last verified as a staging health checker. The owner completed the owner-only email confirmation pilot and verified an email address in D1. The newest Worker source adds a **read-only NOAA/NDBC/NWS weather-feed diagnostic** at `/pilot/data`, but it is not live until the owner copies the updated code from GitHub into the Cloudflare editor and deploys it. The root GitHub Pages dashboard has no public alert signup. Email threshold alerts, Web Push, and scheduled notifications remain disabled.

## Owner-only email pilot: required steps

1. In Cloudflare Turnstile, open the existing **Saco Coast Watch Alerts** widget → Settings → Hostname Management → Add Hostnames. Add `saco-coastal-alerts.mikewiley-nyc.workers.dev` while retaining `nycguy.github.io`. The pilot form is served from the Worker hostname; the Turnstile widget must authorize that exact hostname.
2. Open [the complete standalone Worker source](https://github.com/nycguy/saco-coast-watch/blob/main/alerts/src/worker.mjs), copy its raw file, replace all old code in Cloudflare Workers & Pages → `saco-coastal-alerts` → Edit code, and deploy. Existing D1 binding and Cloudflare-stored variables/secrets should remain.
3. Visit `https://saco-coastal-alerts.mikewiley-nyc.workers.dev/health` and verify `configurationReady=true`.
4. Open `https://saco-coastal-alerts.mikewiley-nyc.workers.dev/pilot`. Only the address matching the Worker setting `SUPPORT_EMAIL` is accepted. Complete Turnstile and submit. Check the mailbox for a one-time verification link; click the final confirmation button on that page.
5. The owner verified the page showed `Email test complete`. This records the owner's verified email in D1 but **does not enable real coastal alerts**.
6. Deploy the latest standalone Worker source and visit `https://saco-coastal-alerts.mikewiley-nyc.workers.dev/pilot/data` to inspect read-only weather-feed diagnostics for NOAA Portland observations and forecast model guidance, NDBC 44007 wind, and NWS KPWM air temperature. A source can be unavailable or stale; this diagnostic does not send emails or activate alerts.

## Infrastructure

- Worker: `https://saco-coastal-alerts.mikewiley-nyc.workers.dev`.
- D1 binding: `DB`, database `saco-coastal-alerts`; owner manually created `subscribers`, `push_subscriptions`, `tokens`, `alert_state`, `request_limits`, `push_subscriber_idx` and `tokens_expiry`.
- Resend: verified `mainebeachrental.com`; Worker variables `FROM_EMAIL=ferrybeach@mainebeachrental.com`, `SUPPORT_EMAIL=mikewiley.nyc@gmail.com`; secret `RESEND_API_KEY`.
- Turnstile: Worker variables `TURNSTILE_SITE_KEY` and secret `TURNSTILE_SECRET`.
- Worker variables `PUBLIC_SITE`, `ALLOWED_ORIGIN`, `WORKER_PUBLIC_URL`; secret `TOKEN_SECRET` was privately rotated.
- Do not paste any private credentials into GitHub, this README, screenshots, public scripts, or chat.

## Later work before public release

Build and test the subscription preference UI, management and unsubscribe, NOAA/NDBC data checks and freshness limits, scheduled threshold evaluation, Web Push encryption, browser service worker and permission UX, error handling and operational monitoring. Confirm quota limits and free-plan restrictions. Public signup, Web Push and scheduled notification delivery are **not currently implemented or enabled**.

The owner-only email pilot is not an emergency warning system. Rely on official NWS alerts for safety decisions.
