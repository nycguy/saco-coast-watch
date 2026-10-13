# SacoCast repository guidance

`nycguy/saco-coast-watch` is the single source of truth for SacoCast application, Worker, migration, test, and deployment code. Do not develop in or mirror from `nycguy-apps/SacoCast-source`.

## Cost and CI guardrail

SacoCast should remain operable with $0 recurring development, CI, deployment, and API cost unless the user explicitly approves otherwise. This public repository may use standard GitHub-hosted runners. Do not use paid or larger runners, unnecessary fan-out, duplicate test runs, paid services, or paid APIs. Do not recreate a private-source mirror for deployment or testing. Any production Worker/D1 release must be manually dispatched after local validation and pass its read-only live preflight. Keep public data refresh schedules that the product relies on. No production release may print or commit secret values.

## Local validation

Run `bash scripts/validate-local.sh` before committing. It runs all Python and Node tests, syntax checks, assembles and verifies the deployable site artifact, then runs Playwright's bundled headless Chromium desktop/mobile map, tide/briefing/header-weather, EastCast, and mocked Web Push enrollment browser suites sequentially. Install pinned browser dependencies with `python3 -m pip install -r tests/requirements-browser.txt` and `python3 -m playwright install chromium`. Do not substitute a machine-installed browser by searching PATH; the shared launcher records browser version/path and enforces a bounded startup timeout.

Never run the production delivery smoke test without an explicit owner-controlled browser/session; it sends a single test notification to that enrolled device and removes its temporary subscription on cleanup.
