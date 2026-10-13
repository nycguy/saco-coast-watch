# SacoCast

Public coastal storm dashboard centered on Saco Bay. Shows NOAA Portland water levels and astronomical tides, available model guidance, historic January 2024 water-level references, NWS observations and forecasts, and marine wind sensors 44007 and WEXM1. An optional Leaflet map displays webcam links and active NOAA/NWS coastal-flood and storm-surge alert areas. No personal street address is displayed.

## Source of truth and local checks
`nycguy/saco-coast-watch` is the only maintained SacoCast source of truth. Its public GitHub Actions publish Pages and preserve the existing coastal-history/data schedules. Worker/D1 deployment is a separate manual, preflight-gated public workflow. No private repository is checked out by release workflows. Run `bash scripts/validate-local.sh` before committing; it runs the deterministic Python/Node suites, builds and verifies the deployable artifact, and runs Chromium desktop/mobile browser smoke tests. Install the test-only browser dependencies with `python3 -m pip install playwright pillow && python3 -m playwright install chromium`. See [deployment](docs/DEPLOYMENT.md) and [architecture](docs/ARCHITECTURE.md).

## Front-end architecture
The GitHub Pages front end is framework-free and modular. `index.html` contains semantic markup, while shared styling lives in `css/app.css`. Browser behavior is split by responsibility across `js/config.js`, `marine.js`, `data.js`, `weather.js`, `water-levels.js`, `intelligence.js`, `alerts.js`, `chart.js`, `hazards.js`, `briefing.js`, `app.js`, `map.js`, `webcams.js`, and the opt-in `push-ui.mjs` / `push-subscriptions.mjs` modules. The scripts load in dependency order and preserve the existing browser-direct NOAA/NWS data flows.

The public Pages workflow assembles these static assets with generated JSON, verifies that the push service worker and UI modules are included, and deploys to GitHub Pages after validation.

## Publish
In GitHub repository Settings > Pages > Build and deployment, set Source to **GitHub Actions**. Then run the **Refresh marine winds and deploy dashboard** workflow under Actions or push an update to main. A successful deployment publishes to https://nycguy.github.io/saco-coast-watch/.

GitHub Actions refreshes marine wind and coastal-alert snapshots on a five-minute schedule, subject to GitHub scheduling delays. The browser checks for updated published data every 60 seconds. NOAA stations may publish less frequently. Missing/stale observations are marked as unavailable.

## Coastal intelligence
The dashboard derives a Portland water-level residual (observed level minus astronomical tide), shows captured NOAA forecast evolution, summarizes the next three high-water windows, and displays NDBC 44007 wave/pressure observations when reported. An automatic adaptive event layer separates hazard type, local impact level, lifecycle phase, and official alert status. It covers coastal flooding, high surf/wave impact, high rip-current beach hazards, marine hazards, land high wind, heavy rain, flooding, winter storms, extreme cold, and locally relevant tropical cyclones. Official NHC/WMO tropical cyclone identities are displayed when available. Winter guidance comes from the NWS forecast grid and hourly forecast. Tropical guidance comes from NHC CurrentStorms and GIS track/cone products. These interface modes are not official warnings.

During significant conditions, the history workflow can archive low-resolution Ferry Beach frames at approximately 15-minute intervals for a rolling 24-hour scrubber. The Abellona Inn feed remains live-only because no reliable public still-image archive source is used.

## Important limitations
The static map does not depict actual floodwater. Alert areas are official warning polygons, not inundation footprints. Portland tide-gauge levels are regional references and do not establish flood elevation at an individual Saco Bay property. Model guidance and astronomical tide predictions are not interchangeable, and wave runup is not included in gauge level comparisons. Verify local conditions with NWS Gray and NOAA.

Deployment note: GitHub Pages is built from the public `main` branch. The Worker is deployed only through the public repository’s manual release workflow.

## Adaptive storm intelligence
The dashboard keeps its normal coastal layout during routine weather. Events move through Outlook, Approaching, Ongoing, Improving, Recent, and Routine phases. Compound coastal-impact intelligence now time-aligns NOAA total-water guidance and astronomical high tides with NWS hourly wind, adds NWS surf context, calculates an onshore-wind component and a clearly labeled wave-power proxy from NDBC observations, and publishes confidence plus transparent rating drivers. The large event-focus panel is shown only for Outlook through Improving; noteworthy observations that exist only in the fixed past-24-hour window remain in the briefing as Recent impacts instead of keeping an active storm mode on screen. When NWS/NHC guidance indicates a meaningful current or near-term event, the app temporarily promotes event-specific metrics and a swipeable next-24-hour impact timeline. Durable 15-minute history snapshots also retain hazard guidance so fixed-window briefings can compare snow, rain, and wind guidance with the snapshot nearest 24 hours earlier without using a visitor's last-open time.


### Event retrospectives

Captured event states are grouped into recent event episodes with observed/model water peaks, residual, waves, gusts, surf context, official NWS products, lifecycle transitions, and available Ferry Beach event-camera frames. These summaries are built only from captured data and never reconstruct unavailable historical forecasts.
