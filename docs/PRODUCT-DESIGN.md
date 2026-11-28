# SacoCast product design

The product keeps its existing static dashboard, authoritative data collectors, independent data delivery, durable history, and separately released notification Worker. No service, subscription, threshold, production path, or recurring cost is added by this presentation update.

## Identity and copy

- Product name: **SacoCast**. Tagline: **Coastal conditions · Clearer decisions**.
- Retain the lighthouse, waves, and sunset illustration in the dashboard and Apple icon. The existing simplified lighthouse SVG is the scalable favicon/platform variant; the new 512 px and maskable derivatives come from that maintained vector.
- Use Proper Case for navigation, section headings, and action labels. Use normal sentences in explanations; preserve official NWS product names.
- Identify observations, tide-only predictions, NOAA model guidance, official alerts, and SacoCast assessments separately.
- Say Portland whenever a gauge or gauge threshold could be confused with a Saco property measurement. MLLW means Mean Lower Low Water, the gauge reference, not flood depth.
- Prefer “Highest Forecast Water Level,” “Difference From Predicted Tide,” “Key Change,” and “Older Event / Newer Event.”
- Keep source, valid/measurement time, missing coverage, and consequential limitations visible. Put repeated methods and full evidence in details.
- A forecast comparison remains a fixed-window comparison with captured evidence, never a comparison with a visitor's last visit.

## Shared presentation rules

`css/product.css` owns the current design tokens and component treatments; existing domain and Leaflet CSS remain in `css/app.css`. The new layer changes presentation without replacing domain logic.

| Role | Rule |
| --- | --- |
| Background | Navy `#081824`; related navy card surfaces |
| Text | Main `#f1f8fc`, secondary `#bed0da` |
| Action | Turquoise `#23e6cb` with dark text |
| Observed/model/tide | Preserve labeled, distinct chart styles and source badges |
| Hazards | Yellow/orange/red, explicitly scoped and always accompanied by text |
| Below threshold | Restrained green in the Portland water-level component; no overall all-clear check |
| Body/metadata | 16 px body; generally 13–15 px useful supporting information; large readable values |
| Controls | 44 px minimum primary/disclosure target goal; visible keyboard focus |
| Disclosure | Stable descriptive label and adjacent local SVG chevron; full row toggles; accessible expanded state |
| Dialog | One scroll container; persistent close control; focus returns to opener |
| Motion | Stable weather symbols; disable animation/transitions for reduced motion |
| iPhone shell | Explicit safe-area padding with viewport-fit; dialogs respect available device height |

The W3C AA target-size minimum and the 44 px product target are distinct. Final rendered contrast, keyboard access, and physical iPhone behavior require testing, not assumptions from tokens.

## Structure

Official alerts and material source failures precede current conditions. The overview and scoped water assessment lead into current metrics, briefing, water chart/threshold reference, upcoming conditions, cameras, weather, event history, and named tools. Section links open the relevant parent disclosures. Tides/calendar, map, historical comparison, and source status own their actual child panels.

The dashboard ID helper takes a raw ID, not a CSS selector. Layout assertions verify actual containment and chart width. Do not restore the former implicit grid column or an empty tools disclosure.

## Data display contracts

- Gauge freshness uses the measurement timestamp. “Checked” describes retrieval, not a new forecast or successful refresh of every source.
- A water-status conclusion states whether it uses a recent observation or available NOAA guidance. Without model guidance it explicitly describes an observation only.
- Day-by-day model values include coverage. Truncated or gapped days have starred partial-coverage markers and no connecting forecast line through them. They are not full-day peaks.
- Short-range charts explain that values below 8 ft are hidden. Longer horizons are tide outlooks, with NOAA guidance limited to its actual coverage.
- Touch/keyboard chart inspection reports each source's actual sample timestamp.
- Camera archive display applies its rolling window against current time, excludes invalid/future timestamps and unsafe filenames, and recounts qualifying images. This does not delete durable historical evidence.
- Local reports require actual weather relevance, defensible local geography, valid dates within seven days, public source links, and deduplication. Publisher nationality alone does not disqualify a genuine local report. Search results are reports, not verified observations.
- NWS message expiration is labeled separately from `ends`, when provided. Preserve official headline, description, and instructions inside alert details.
- The same official alert's full headline is not repeated as upcoming context; active duplicate products link to the official alert above.

## Brand assets and delivery

`manifest.webmanifest` provides ordinary 192/512 px icons and dedicated 192/512 px maskable variants. Maskable artwork sits within a generous navy surround. Dashboard, favicon, Apple icon, notification icon, email forms, and supporting pages retain SacoCast identity. Privacy and terms describe current public email and app notifications, including custom thresholds; public signup does not offer SMS.

Dashboard JS/CSS and the manifest share an explicit release cache key, so returning browsers fetch a coherent version rather than mixing a new shell with previously cached scripts.

The pinned Leaflet 1.9.4 JavaScript is packaged locally, with its license. Its bytes were checked against the previously configured SHA-256 integrity value. A blocked CDN can no longer stall dashboard startup before app scripts execute. Map tiles remain supplied by their existing free providers.

## Release gates

Run `bash scripts/validate-local.sh` on the candidate checkout with pinned Playwright dependencies. It exercises deterministic Python/Node tests, syntax, the assembled artifact, map, tide/briefing/weather, responsive accessibility, official alerts, EastCast, and mocked notification settings. Source-specific regressions cover archive boundaries, partial model days and DST, relevance/deduplication, disclosure containment, keyboard chart values, text sizes, overflow, reduced motion, and modal focus.

Use standard runners in the public repository. Pages and Worker remain separate release workflows. The Worker release retains its read-only preflight and subscriber-preservation gates; this work makes no migration, credential, delivery logic, or schedule change.

A release is accepted only after deployment and live asset/rendered checks. Real iPhone Safari and installed-PWA safe-area/notification-opening behavior require a physical device; Chromium mobile emulation alone does not establish that result. Never send a production notification test without an explicitly controlled owner device.
