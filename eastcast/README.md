# EastCast

**EastCast** is a live East Coast weather storytelling dashboard spanning Florida to Maine. It is designed as a public-facing, reusable weather site rather than a single-storm tracker.

## Core experience

- Interactive Leaflet map with OpenStreetMap basemap
- NOAA nowCOAST MRMS base-reflectivity WMS overlay
- National Weather Service watch/warning/advisory polygons
- Click-anywhere NWS point forecast inspector
- State-by-state coast narrative generated from active NWS alerts
- Official animated NWS RIDGE radar GIFs for the Northeast, Mid-Atlantic and Southeast
- Automatic data refresh at the top of every hour, plus manual refresh
- Mobile-first responsive layout and installable web-app manifest

## Data and technology

No paid API is required.

- NWS API: https://api.weather.gov
- NOAA nowCOAST: https://nowcoast.noaa.gov
- NWS RIDGE radar: https://radar.weather.gov
- NOAA/NWS GIS warning service: https://mapservices.weather.noaa.gov
- Leaflet: https://leafletjs.com
- OpenStreetMap: https://www.openstreetmap.org

## Hosting

This folder is intentionally static and GitHub Pages friendly. It can live under an existing Pages repository as `/eastcast/`, or be moved into a dedicated repository later with no application rewrite.