# SacoCast architecture

- `index.html`, `css/`, and `js/` implement the static, framework-free GitHub Pages dashboard. `eastcast/` is the regional companion view.
- `data/` and the public Python collectors under `scripts/` provide wind, hazards, coastal briefings, webcam metadata, and fixed-window captured history. `coastal-history` is a separate public data branch.
- `alerts/src/worker.mjs` is the Cloudflare Worker. Existing email flows remain separate from opt-in browser push. Push UI is in `js/push-ui.mjs` and `js/push-subscriptions.mjs`; `push-sw.js` receives notifications without intercepting dashboard fetches.
- D1 migration `0001_init.sql` is for an empty database. Production uses only additive migrations `0002`–`0004`, gated by the manually dispatched Worker release workflow and schema/data-preservation checks.
- GitHub Pages workflows are public and operate only on this repository. Private `nycguy-apps/SacoCast-source` is not a build dependency or deployment source.
