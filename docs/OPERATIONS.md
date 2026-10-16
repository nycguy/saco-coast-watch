# SacoCast operations

## Source health

The dashboard combines independent sources. A failure in one source should not block the rest of the site.

| Source | Meaningful health evidence | User-facing fallback |
| --- | --- | --- |
| NOAA/NWS/NDBC coastal inputs | `data_coverage.sources` and `observations` in the briefing; each is available, missing, stale, malformed, unavailable, unsupported, or not checked | Keep unaffected inputs visible; label missing/stale information and state that incomplete data are not an all-clear |
| Local news and public community feeds | `source_health.feeds` in captured history, copied to `local_pulse.sources`; a reachable feed with zero matching items is still available | Show an empty scan separately from a failed or unreadable feed; community posts remain anecdotal |
| Ferry Beach camera preview | `data/webcams/webcams.json` reports `ok` or `unavailable` and a fetch time | Hide a broken still, show preview unavailability, retain the official live-camera link |
| Ferry Beach event archive | `data/webcams/ferry-history/index.json` and referenced image files | Explain an empty retention window separately from a manifest/network failure; never fabricate a frame |
| Abellona live camera | `js/abellona-player.mjs` uses YouTube's IFrame Player API and reports the explicit `PLAYING` state; iframe load alone does not count as playback. The owner confirmed muted inline autoplay on a physical iPhone on October 15, 2026. | Keep the poster covered until playback is confirmed. During startup, retain Watch Live as the user-initiated fallback. Player errors or an explicit browser autoplay-block event expose that fallback. Automated browser checks cannot prove iPhone Safari playback, and SacoCast cannot inspect each visitor's cross-origin player state. Do not replace the stream or claim a static poster is live. |

For a scheduled refresh failure, inspect the public workflow run and its generated-data/artifact validation steps. A later run can refresh transient upstream failures; do not manually replace a missing upstream value with a prior measurement. Compare source issuance/observation timestamps before deciding whether a feed is stale or the provider is delayed.

The Pages refresh job writes a **SacoCast production data health** section to the GitHub Actions step summary. It checks JSON shape and source timestamps after collectors finish, then checks the durable `coastal-history` checkout. Missing and stale readings, upstream request failures, and history gaps appear as warnings; the workflow does not fail merely because a provider has no current observation or is reporting late. Malformed JSON, invalid critical shapes, timestamps more than ten minutes in the future, impossible metric ranges, missing history timestamps, or a changed Portland threshold/datum contract fail artifact validation before publication. Collector-generated files older than 45 minutes, Portland observations older than 90 minutes, NDBC wind older than three hours, and NDBC wave readings older than four hours are called out. These are operational thresholds, not claims about provider service-level agreements.

The capture job checks the durable branch on each existing 15-minute run. It warns when the newest captured snapshot is over 60 minutes old or when snapshots in the most recent 48 hours are more than 90 minutes apart. Older event/backfill history can be intentionally sparse and is excluded from the capture-gap alarm. It never fills gaps or creates replacement observations. A delayed GitHub schedule can therefore be distinguished from a malformed record without publishing fabricated history.

## Recovery procedures

### NOAA, NWS, NDBC, or NHC source failure

1. Open the failed or latest [Pages refresh run](https://github.com/nycguy/saco-coast-watch/actions/workflows/update-wind-and-publish.yml) and read its source-health summary and collector step output.
2. Separate an upstream HTTP/timeout/parse failure from a successful empty response. An empty coastal-alert feature list with no request error means no active matching polygons were returned; it is not a failed request. Missing observations are not zero readings.
3. If the report says stale, compare the source observation/issuance time with the collector time and provider's normal update cadence. NOAA/NWS publication delays are reported as degraded coverage rather than causing an all-clear or automatically blocking the otherwise valid dashboard.
4. Allow the next scheduled refresh to retry transient errors. If the same source remains unavailable across several refreshes, investigate the named endpoint and its schema before changing parsing; do not substitute a different station, model, datum, or old measurement without a compatibility review.

### Stalled or malformed durable history

1. Open the latest [history capture run](https://github.com/nycguy/saco-coast-watch/actions/workflows/capture-history.yml); review capture, archive, health-summary, and Git push steps.
2. Confirm `coastal-history` still exists and its newest `data/history/coastal-history.json` snapshot timestamp advances. A warning describes the oldest recent gap; a validation error identifies malformed or unordered snapshots and threshold-contract changes.
3. Retry with **Run workflow** only after correcting the cause. Re-running capture collects current source data and never reconstructs a missing timestamp. Do not force-push or replace the durable branch; preserve its commits and archive files.

### Broken GitHub Pages deployment

1. Find the Pages refresh run for the commit and identify whether collection, artifact validation, browser smoke tests, upload, deployment, or live verification failed.
2. If artifact validation fails, use the listed asset/data contract and repair the source assembly or collector output before rerunning. The deploy step occurs only after validation.
3. For propagation failures, check the deployed run URL and retry the existing workflow after Pages has settled. A successful workflow-dispatch Pages run performs live asset/data checks; scheduled refreshes intentionally skip browser and production smoke tests to conserve runner time.
4. If the current site is broken, revert the last application change in a normal commit and let the same Pages workflow publish the previous known-good behavior. Data history remains on its separate branch.

### Cloudflare Worker and notification failures

The public Worker `/health` endpoint checks configuration, D1 connectivity/schema, and whether email, threshold-push, and event-push features are enabled. It does not claim that a scheduled run or provider accepted delivery. The Worker cron remains every ten minutes. Inspect Cloudflare's existing Worker invocation/error logs for `Coastal email check`, `App threshold push check`, `Web Push event check`, and `Threshold push check failed` records; status 404/410 removes only the expired device subscription, transient push-provider errors use bounded retry, and successful provider acceptance is not proof of device display. Use the authenticated Manage Alerts test action only for the requesting owner's enrolled device; never use production subscribers for synthetic checks. To release Worker changes, follow the read-only preflight and exact-state checks in [DEPLOYMENT.md](DEPLOYMENT.md), then use the existing manually gated workflow. Never rotate VAPID keys or perform a destructive schema change as a recovery shortcut.

Worker health does not currently retain a durable cron heartbeat or failed email attempt history. Adding that observability would require an additive D1 design and the manually gated Worker release; until then, invocation logs are the source for execution failures, and `/health` is configuration/database evidence only.

## Workflow and storage impact

This monitoring runs inside existing jobs: Pages refresh remains scheduled every ten minutes, history capture every fifteen minutes, and Worker cron every ten minutes. No new recurring workflow, external monitor, paid service, or Actions runner was added. Freshness checks emit a concise run summary and do not create routine notifications. The successful Pages artifact is still required for publishing and keeps its existing short retention. Browser screenshots are retained for one day only when a non-scheduled browser job fails (previously seven days), reducing the temporary footprint of the largest diagnostic artifacts. No success screenshots or new artifacts are uploaded.

## Coastal Briefing

The compact “Watch next” list ranks threshold crossings and consequential forecast changes ahead of routine high tides. A higher-impact upcoming Portland high-water window leads smaller forecast movement; routine tides are labeled “Next high tide.” The 24-hour text describes a forecast as essentially unchanged when its peak shift is under 0.15 ft, except when it crosses a Portland threshold. Captured NOAA/NDBC marine changes appear only when both same-station observations are fresh at their respective capture times. Offshore buoy waves are not described as local surf. The forecast comparison is omitted if a matching prior product is unavailable. High tide-only entries are explicitly astronomical tide predictions and do not imply storm surge. Portland thresholds remain 12.0, 13.0, and 14.0 ft MLLW.

Historical event records describe the period SacoCast captured, not necessarily the full storm lifetime. NHC storm IDs keep distinct named systems from being merged. No unrecorded historical forecast or camera frame is reconstructed.

## Notification history and privacy

The authenticated device history endpoint returns at most 20 event-delivery rows from its 30-day queue plus the latest successful custom-threshold send per metric/channel from `alert_state.last_sent`. Email threshold history is available only through an explicitly linked, verified device. These D1 state fields represent successful sends only; failed threshold attempts and a full per-attempt email log are not retained. The endpoint never returns email addresses, subscriber IDs, push endpoints, credentials, or raw provider errors. Do not use another device's token or real subscriber data for testing.

No D1 migration was required for the current history enhancement. Any future persistent attempt log requires an additive schema proposal, retention limits, ownership tests, and the manually gated Worker release described in [DEPLOYMENT.md](DEPLOYMENT.md).

## Browser and accessibility verification

The public Pages push workflow runs deterministic Playwright/Chromium desktop and 390×844 mobile checks, including briefing priority, flood-threshold chart labels/contrast, modal keyboard close/focus restoration, archive failure messaging, map, and notification settings. This Intel Mac has a confirmed macOS HIServices startup crash for Node-launched local browsers; run browser coverage in the existing public Ubuntu runner rather than retrying the failing local launch. Device-specific VoiceOver and iPhone notification interaction still require a physical device.
