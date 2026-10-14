# SacoCast operations

## Source health

The dashboard combines independent sources. A failure in one source should not block the rest of the site.

| Source | Meaningful health evidence | User-facing fallback |
| --- | --- | --- |
| NOAA/NWS/NDBC coastal inputs | `data_coverage.sources` and `observations` in the briefing; each is available, missing, stale, malformed, unavailable, unsupported, or not checked | Keep unaffected inputs visible; label missing/stale information and state that incomplete data are not an all-clear |
| Local news and public community feeds | `source_health.feeds` in captured history, copied to `local_pulse.sources`; a reachable feed with zero matching items is still available | Show an empty scan separately from a failed or unreadable feed; community posts remain anecdotal |
| Ferry Beach camera preview | `data/webcams/webcams.json` reports `ok` or `unavailable` and a fetch time | Hide a broken still, show preview unavailability, retain the official live-camera link |
| Ferry Beach event archive | `data/webcams/ferry-history/index.json` and referenced image files | Explain an empty retention window separately from a manifest/network failure; never fabricate a frame |
| Abellona live camera | `js/abellona-player.mjs` uses YouTube's IFrame Player API and reports the explicit `PLAYING` state; iframe load alone does not count as playback | The frame remains covered until playback is confirmed. Autoplay timeout/API errors expose a Watch Live retry and the direct YouTube link. Browser policy and operator availability can still prevent playback. |

For a scheduled refresh failure, inspect the public workflow run and its generated-data/artifact validation steps. A later run can refresh transient upstream failures; do not manually replace a missing upstream value with a prior measurement. Compare source issuance/observation timestamps before deciding whether a feed is stale or the provider is delayed.

## Coastal Briefing

The compact “Watch next” list prioritizes a compatible captured forecast change and the highest-impact upcoming Portland high-water window. The forecast comparison is omitted if a matching prior product is unavailable. High tide-only entries are explicitly astronomical tide predictions and do not imply storm surge. Portland thresholds remain 12.0, 13.0, and 14.0 ft MLLW.

Historical event records describe the period SacoCast captured, not necessarily the full storm lifetime. NHC storm IDs keep distinct named systems from being merged. No unrecorded historical forecast or camera frame is reconstructed.

## Notification history and privacy

The authenticated device history endpoint returns at most 20 event-delivery rows from its 30-day queue plus the latest successful custom-threshold send per metric/channel from `alert_state.last_sent`. Email threshold history is available only through an explicitly linked, verified device. These D1 state fields represent successful sends only; failed threshold attempts and a full per-attempt email log are not retained. The endpoint never returns email addresses, subscriber IDs, push endpoints, credentials, or raw provider errors. Do not use another device's token or real subscriber data for testing.

No D1 migration was required for the current history enhancement. Any future persistent attempt log requires an additive schema proposal, retention limits, ownership tests, and the manually gated Worker release described in [DEPLOYMENT.md](DEPLOYMENT.md).

## Browser and accessibility verification

The public Pages push workflow runs deterministic Playwright/Chromium desktop and 390×844 mobile checks, including briefing priority, flood-threshold chart labels/contrast, modal keyboard close/focus restoration, archive failure messaging, map, and notification settings. This Intel Mac has a confirmed macOS HIServices startup crash for Node-launched local browsers; run browser coverage in the existing public Ubuntu runner rather than retrying the failing local launch. Device-specific VoiceOver and iPhone notification interaction still require a physical device.
