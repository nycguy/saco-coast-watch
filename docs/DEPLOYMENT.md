# SacoCast deployment

`nycguy/saco-coast-watch` (`main`) is the only maintained source of truth. GitHub Pages serves `https://nycguy.github.io/saco-coast-watch/`.

## Static site and data

The public `Refresh marine winds and deploy dashboard` workflow retains the existing five-minute wind/coastal-alert refresh and Pages publication, plus its current NOAA/NWS/NHC, EastCast, webcam, fixed-window briefing, and durable-history behavior. The `Capture coastal history` workflow continues to write captured history to the dedicated `coastal-history` branch. Both workflows run standard public GitHub-hosted Ubuntu runners. The Pages job assembles `dist`, verifies all runtime assets/data, runs deterministic tests and Chromium browser smoke tests on push, and then deploys Pages. No private repository is checked out or invoked.

Run `bash scripts/validate-local.sh` before committing. It runs Python and JavaScript tests/syntax, builds `dist`, verifies the artifact, and runs Chromium desktop/mobile browser checks. Install its browser-only dependencies with `python3 -m pip install playwright pillow && python3 -m playwright install chromium`.

## Cloudflare Worker and D1

The Worker source is `alerts/src/worker.mjs`; migrations are under `alerts/migrations/`. A production release is separate from Pages and only starts through the public `Release coastal alerts Worker` workflow. Its default dispatch is read-only. The read-only preflight confirms current Worker/email health, checks the base email schema, classifies the push schema as wholly absent or complete, captures an aggregate subscriber count, and confirms the existing VAPID secret *names* without reading key values. Partial/unknown schemas, a partial VAPID pair, failed health, or changed subscriber counts stop the release.

Only an explicit dispatch with `apply_migrations_and_deploy=true` can run migrations or deploy. It applies migrations 0002–0004 only when the complete additive push schema is absent; otherwise it verifies that schema and indexes are already present. It never applies 0001 to production. If a complete VAPID pair already exists, the workflow preserves it. If neither VAPID key exists, the workflow may create the first pair only after confirming there are zero existing push devices; a partial pair always stops the release to avoid identity rotation. The post-deploy gate retries briefly for Worker propagation, then verifies email state, D1 schema, push configuration, and the existing health endpoint. It does not send a test notification or synthetic hazard. Cloudflare credentials are GitHub Actions secrets named `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; values must never be printed or committed.

Deploying the Worker applies its configured ten-minute cron. That starts the existing live email-check path and, after the push feature flags are set, the official coastal-event lifecycle path. The event worker establishes a baseline first and does not send a notification for the already-active initial state. Do not lower thresholds or manufacture a hazard to test delivery.

## Production verification

After Pages deployment, verify the live URL and critical static assets/data, desktop and iPhone-sized layouts, EastCast, webcam state, and browser console. Verify Worker `/health` and `/push/config` using the allowed Pages origin. Keep D1 migration state and subscriber-count evidence from the release action. After an initial push rollout, run the default read-only Worker workflow once more and require `complete` push schema, a complete VAPID pair, and `webPushEnabled=true` before declaring the release complete. A real push delivery test is optional and requires an owner-controlled browser subscription; it sends one test notification only to that device, then disables and removes the test subscription. Never use actual subscribers for synthetic tests.

No paid/larger runners, external paid service/API, or private-source mirror may be introduced without explicit approval. Production secrets, D1 rows, and Worker state must never be copied into repository files or logs.
