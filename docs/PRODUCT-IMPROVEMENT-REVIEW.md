# SacoCast product improvement review

Reviewed against `main` at `3b529df8dc84897b08dc5912d5a6dd15b0f2ded4` and the deployed GitHub Pages assets before changes. The current architecture already includes NOAA/NWS/NDBC/NHC data, a modular static dashboard, fixed-window briefing and history, maps and cameras, EastCast, and a unified email/push alert interface. This review keeps those capabilities and makes targeted presentation and payload changes.

| Classification | Current implementation | Intended change | Affected components | Risk | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Keep | Portland MLLW thresholds, source collectors, official alerts, NOAA tide/model distinction | Preserve thresholds and authoritative sources | `scripts/`, `js/`, `data/` | Low | Existing deterministic boundary/source tests and production smoke | Done; no threshold changes |
| Keep | Maps, live camera links, event history, EastCast, PWA, email and push alerts | Preserve existing workflows | `index.html`, `js/`, `eastcast/`, `alerts/` | Medium | Artifact validation and public browser workflow | Done; no notification or Worker changes |
| Simplify | Long, technical freshness paragraph in the source section | Describe independent source timing plainly and use a shorter heading | `index.html` | Low | Artifact and desktop/mobile browser smoke | Implemented |
| Move | Coastal Briefing appeared after the detailed tide chart | Place summary directly after current coastal status/intelligence and before detailed conditions | `index.html` | Low | Desktop/mobile browser smoke checks briefing visibility and layout | Implemented |
| Remove | Duplicate `history` and `history_compact` payloads inside browser briefing | Keep durable snapshots in the separate history asset and omit duplicate arrays from browser response | `scripts/fetch_briefing.py` | Low | Unit test and artifact key/size guard | Implemented |
| Enhance | Derived source-availability score shown as “Confidence” | Report available source count and missing source names, without implying predictive confidence | `scripts/fetch_hazards.py`, `js/hazards.js` | Low | Unit and Playwright smoke tests | Implemented |
| Enhance | Difference from tide used “residual” and “surge signal” in primary UI | Explain observed-minus-predicted tide and its limits | `index.html`, `js/intelligence.js`, `README.md` | Low | Browser text regression and existing water-level tests | Implemented |
| Add | No artifact-level ceiling for the browser briefing or check for duplicate history arrays | Reject payloads over 1 MB or carrying durable history arrays | `scripts/verify_site_artifact.py`, `tests/test_verify_site_artifact.py` | Low | Deterministic artifact tests | Implemented |
| Repair | Browser briefing was about 3.9 MB in the reviewed deployed payload, with unused historical arrays | Publish compact summary and retain history in its existing separate asset | `scripts/fetch_briefing.py`, Pages workflow artifact | Low | Build output size check and live asset verification | Released and live at `e4fb07b` |

## Risks and limits

- The local Mac has a known browser process startup crash in macOS HIServices. The local deterministic suite can run there; Playwright browser coverage must run in the existing public Ubuntu Pages workflow and be monitored after release.
- A 1 MB briefing size limit intentionally fails artifact assembly if future fields cause the summary payload to grow without review.
- Actual weather coverage and historical comparisons depend on NOAA/NWS/NDBC availability and captured snapshots. SacoCast does not fabricate missing history.
- The request received for this work ended during the hazard-intelligence requirements, after the heading “Separate four concepts”. This implementation follows all complete requirements delivered before that cutoff and does not guess the missing continuation.

## Release verification

Pages deployment and post-deployment smoke tests passed in [run 38596351430](https://github.com/nycguy/saco-coast-watch/actions/runs/38596351430). The live briefing was 103,843 bytes, down from approximately 3.86 MB in the baseline (about 97% smaller), and retained current summary fields while historical snapshots remained in the separate history asset. Public Ubuntu Playwright checks passed for desktop/mobile coastal map, tide outlook and briefing, EastCast, and alert management.
