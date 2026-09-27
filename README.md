# Saco Coast Watch

Public coastal storm dashboard centered on Saco Bay. Shows NOAA Portland water levels and astronomical tides, available model guidance, historic January 2024 water-level references, NWS observations and forecasts, and marine wind sensors 44007 and WEXM1. An optional Leaflet map displays webcam links and active NOAA/NWS coastal-flood and storm-surge alert areas. No personal street address is displayed.

## Front-end architecture
The GitHub Pages front end is framework-free and modular. `index.html` contains semantic markup, while shared styling lives in `css/app.css`. Browser behavior is split by responsibility across `js/config.js`, `marine.js`, `data.js`, `weather.js`, `water-levels.js`, `alerts.js`, `chart.js`, `briefing.js`, `app.js`, `map.js`, and `webcams.js`. The scripts load in dependency order and preserve the existing browser-direct NOAA/NWS data flows.

The scheduled GitHub Actions publish job assembles these static assets with generated JSON, then runs deterministic unit tests and Playwright browser smoke tests before deploying to GitHub Pages.

## Publish
In GitHub repository Settings > Pages > Build and deployment, set Source to **GitHub Actions**. Then run the **Refresh marine winds and deploy dashboard** workflow under Actions or push an update to main. A successful deployment publishes to https://nycguy.github.io/saco-coast-watch/.

GitHub Actions refreshes marine wind and coastal-alert snapshots on a five-minute schedule, subject to GitHub scheduling delays. The browser checks for updated published data every 60 seconds. NOAA stations may publish less frequently. Missing/stale observations are marked as unavailable.

## Important limitations
The static map does not depict actual floodwater. Alert areas are official warning polygons, not inundation footprints. Portland tide-gauge levels are regional references and do not establish flood elevation at an individual Saco Bay property. Model guidance and astronomical tide predictions are not interchangeable, and wave runup is not included in gauge level comparisons. Verify local conditions with NWS Gray and NOAA.

Deployment note: GitHub Pages is built from the main branch by the scheduled and push-triggered GitHub Actions workflow.
