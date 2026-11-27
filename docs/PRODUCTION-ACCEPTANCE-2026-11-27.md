# SacoCast Production Acceptance Record

Acceptance date: 2026-11-27 UTC

## Accepted changes

- Added a bounded GitHub Actions artifact-registration wait before `deploy-pages`.
- Added regression coverage for the artifact race contract.
- Pinned Pages, history, and Worker workflows to the standard Ubuntu 24.04 runner.
- Corrected the responsive smoke test so dynamic event-specific briefing titles are validated by their rendered accessible name.
- Added the measured baseline, free-tier register, and architecture decision register.

## Evidence

| Evidence | Result |
|---|---|
| Stabilization commit | `a713298f0c7b6637c6042cc94ca912cc97a8007d` |
| Runner compatibility commit | `797900ef95d8924e1af8ca043de0b5b755553748` |
| Final production commit | `151ed9e5995a8d9b613435200594dd22c3112f31` |
| Pages run | https://github.com/nycguy/saco-coast-watch/actions/runs/45929804017 |
| History run | https://github.com/nycguy/saco-coast-watch/actions/runs/45929424458 |
| Local Python suite | 140 tests passed |
| Local Node suite | 101 tests passed |
| Final browser suite | Map, tide/briefing, EastCast, alerts, Abellona, and responsive/accessibility checks passed |
| Final Pages artifact | Finalized successfully; artifact registration wait passed |
| Live Pages verification | Passed, including critical assets, live alert UI, player outcomes, and responsive checks |
| Live Worker health | HTTP 200; D1 connected; Web Push and threshold push enabled; all three cron channels healthy |

## Preserved contracts

- Production URL and branding remain unchanged.
- SacoCast and EastCast remain in the Pages artifact.
- Portland thresholds remain Minor 12.0, Moderate 13.0, and Major 14.0 ft MLLW.
- Durable history and existing notification records were not modified by this change.
- No test notification was sent to real subscribers.
- No paid service, larger runner, billing-enabled service, or automatic paid overage was introduced.

## Scope limitation

This acceptance record covers Phase 1 stabilization and the deployment reliability fixes implemented in this change set. Independent high-frequency data delivery, removal of routine scheduled Pages publication, account-wide cost telemetry, and adaptive source polling remain subsequent modernization work. The current system continues to use best-effort GitHub scheduling, and the repository cannot independently verify owner-account billing or quota dashboards.


