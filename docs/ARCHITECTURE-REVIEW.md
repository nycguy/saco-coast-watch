# SacoCast architecture review and release notes

Review baseline: `main` commit `8f56a369165c0ccccd3831a0246c28706f5dd64c`, inspected on 2026-10-13. The latest successful Pages deployment before this change was commit `07bb6d67643ba6d5b449dac6cd84125bf1e8c415` (run [38385883816](https://github.com/nycguy/saco-coast-watch/actions/runs/38385883816)); deployments for `8f56a369` failed in test validation, so the deployed app version lagged `main`. The repository and deployed app use the architecture described in [ARCHITECTURE.md](ARCHITECTURE.md); this review did not find a reason to migrate frameworks, move hosting, or mirror the source repository.

## Findings and decisions

| Priority | Finding | Action |
| --- | --- | --- |
| High | The scheduled Pages workflow ran selected Python tests and the front-end, Worker, and EastCast suites on every five-minute data refresh. | Move the schedule to ten minutes. Keep data acquisition, schema/data guards, artifact assembly, and publication on schedule; run full suites on code pushes and manual refreshes. |
| High | Full Python discovery was absent from CI. The existing D1 snapshot contract test attempted to pass a multi-statement SQL script to `sqlite3.Connection.execute`, so enabling full discovery exposed a failure. | Run the full Python suite in push/manual CI. Execute each read-only schema query statement and assert the additive threshold table/columns. |
| High | Run `38385890569` failed in the named “Validate adaptive front-end syntax” step because that step also ran the new header-weather unit test. The failure was a clock-sensitive boundary assertion (`1 !== 2`): the test's observation aged beyond two hours between fixture setup and render. | Freeze `Date.now()` within the test VM and retain the production inclusive two-hour freshness rule. Add classification/provenance cases. |
| Medium | The alert graphic combined official NWS alerts and SacoCast-derived hazard modes under one ambiguous accessible source description. The same hurricane spiral was used for flood, surf, surge, and winter alerts. | Keep official alert labels and derived event labels distinct in accessible source text; use distinct wave, surf, surge, blizzard, nor'easter, and cyclone graphics. |
| Medium | CI only ran a selected subset of Python tests and header weather had no real-browser desktop/mobile regression. | Run Python discovery, all Node unit suites, all source syntax checks, and extend the existing desktop/mobile tide smoke to exercise header graphics, source labels, unavailable state, reduced motion, and overflow. |
| Low | A five-minute publication schedule doubled the runner time needed to publish public snapshots while recent measured runs finished well before the interval. | Use ten-minute publication while preserving 15-minute history capture. Direct NWS/NOAA browser requests and in-page refresh cadence are unchanged. |

## Retained architecture and safeguards

- GitHub Pages remains the only dashboard host. Browser-direct NOAA CO-OPS, NWS, NDBC, and NHC calls remain in use; public JSON collectors continue to produce wind, alerts, hazard, briefing, EastCast, and webcam snapshots.
- The dashboard remains framework-free and keeps the existing map, tide charts, EastCast, event intelligence, webcam integration, PWA, and notification interface.
- Portland flood thresholds remain 12.0/13.0/14.0 ft MLLW. Tide predictions, observed gauge values, NOAA total-water model guidance, NWS forecasts, official alerts, and application-derived impact ratings remain separately named.
- Captured history remains on the `coastal-history` branch at 15-minute intervals. Comparisons use fixed rolling windows, not a visitor's last-open time. No history backfill invents unavailable forecast evolution.
- The Cloudflare Worker and D1 stay separately deployed through the manual, read-only-by-default workflow. No Worker production deployment, D1 migration, subscriber write, VAPID change, or notification delivery was part of Pages validation.
- Email and per-device push identities, random device credentials, token hashing, additive migrations, rate limits, delivery deduplication, retry queue, and subscriber-preservation preflight remain unchanged.
- The public Pages release uses the existing single-runner workflow and concurrency group. It adds no API, hosting platform, secret, private repository, paid service, or larger runner.

## Workflow use estimate

Recent GitHub schedule runs were measured through the Actions API: 24 Pages runs averaged 151 seconds each and 24 history runs averaged 46 seconds each. The data are short-window estimates and include normal hosted-runner variance.

| Scheduled work | Before | After | Mean runtime used for estimate |
| --- | ---: | ---: | ---: |
| Pages data refresh/publication | 288/day (every 5 min) | 144/day (every 10 min) | 151 sec/run |
| Durable history capture | 96/day (every 15 min) | 96/day (unchanged) | 46 sec/run |
| Combined standard-runner time | ~13.3 hours/day | ~7.3 hours/day | ~45% lower |

The estimate counts runner wall time, not a charge. These are standard GitHub-hosted runners for a public repository; no paid runner or API is introduced. On routine Pages runs the full test suites, browser dependency installation, and browser sessions are skipped. The fetched-data guards, generated JSON schema checks, webcam snapshot handling, artifact assembly, artifact assertions, and Pages deployment remain. `Capture coastal history` similarly skips its deterministic unit suite on schedule but retains post-capture snapshot/schema validation and the existing continuity write.

The tradeoff is a nominal maximum ten-minute scheduled snapshot interval instead of five minutes. GitHub scheduling can delay both. The separately running page uses its existing 60-second data refresh and direct-source requests; the 15-minute historical capture cadence and 24-hour rolling archive are unchanged.

## Deployment failure investigation

- Requested run: [38385890569](https://github.com/nycguy/saco-coast-watch/actions/runs/38385890569), commit `8f56a369`.
- The earlier escaped-newline syntax failure had already been fixed in commit `77dc179`; the current `node --check js/header-weather.js` succeeds.
- The named syntax step then ran `node --test tests/header_weather_unit.mjs`. Its last test created a wind observation exactly two hours old using a real clock and rendered later; elapsed milliseconds made the observation stale. Production code correctly enforces a maximum age of two hours. The test now supplies a fixed clock, so the test validates the exact boundary without changing application behavior.
- The follow-up run [38387081364](https://github.com/nycguy/saco-coast-watch/actions/runs/38387081364) failed for the same test case. Both runs occurred before this fix.

## Remaining risks

1. **Scheduled source availability (medium):** NOAA/NWS/NHC publication or GitHub schedule delays may make a public snapshot stale. Collectors preserve errors/unavailable states; the UI retains official links. Browser-direct sources provide another path for the dashboard but cannot guarantee provider availability.
2. **Single Pages workflow (medium):** One workflow performs fetch, artifact assembly, and publication. Its concurrency guard prevents overlapping deployments; a prolonged failure delays the next published snapshot. Splitting the pipeline would add artifacts/coordination without a demonstrated cost or reliability benefit here.
3. **Public camera and map providers (low):** External streams and map tiles can fail independently. Cameras are marked unavailable when capture fails, and the dashboard does not substitute fabricated stills.
4. **Notification provider and Worker state (medium):** Cloudflare, D1, Resend, or a browser push provider may be unavailable. Delivery is best effort, with bounded retries for retryable push failures. These systems are not official emergency warning channels.
5. **Device-local identity (low):** Push management requires the device's stored random credential. Clearing browser storage can prevent that device from authenticating for management; the application deliberately does not enable insecure cross-device discovery.

For this Pages release, verify live Pages assets/data and perform read-only Worker health/configuration checks. A future Worker release must additionally pass its read-only schema and subscriber-preservation preflight before any explicitly authorized apply/deploy.
