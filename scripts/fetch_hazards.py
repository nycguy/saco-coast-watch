#!/usr/bin/env python3
"""Build adaptive weather-hazard guidance for Saco Coast Watch.

Uses only free authoritative public sources:
- NWS point, hourly, forecast-grid, and active-alert APIs
- NHC CurrentStorms JSON and forecast-track/cone GIS products

Missing upstream data remain unavailable. This module never fabricates observations
or historical forecasts.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import math
import re
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

UA = "SacoCoastWatch/3.0 (public weather dashboard; github.com/nycguy/saco-coast-watch)"
TIMEOUT = 15
POINT = "43.472,-70.385"
SITE_LAT = 43.472
SITE_LON = -70.385
NHC_CURRENT = "https://www.nhc.noaa.gov/CurrentStorms.json"


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def iso(value):
    if not value:
        return None
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso(value):
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None


def fetch_bytes(url, accept="*/*"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
        return response.read()


def fetch_json(url):
    return json.loads(fetch_bytes(url, "application/json, application/geo+json").decode("utf-8"))


def safe_json(url):
    try:
        return fetch_json(url), None
    except Exception as exc:
        return None, str(exc)[:220]


def num(value):
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except Exception:
        return None


def duration_seconds(text):
    match = re.fullmatch(
        r"P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?",
        text or "",
    )
    if not match:
        return None
    days, hours, minutes, seconds = (float(x or 0) for x in match.groups())
    return days * 86400 + hours * 3600 + minutes * 60 + seconds


def valid_interval(text):
    try:
        start_raw, duration = (text or "").split("/", 1)
    except ValueError:
        return None, None
    start = parse_iso(start_raw)
    seconds = duration_seconds(duration)
    if not start or seconds is None:
        return None, None
    return start, start + dt.timedelta(seconds=seconds)


def overlap_fraction(start, end, window_start, window_end):
    if not start or not end or end <= start:
        return 0.0
    lo = max(start, window_start)
    hi = min(end, window_end)
    if hi <= lo:
        return 0.0
    return (hi - lo).total_seconds() / (end - start).total_seconds()


def inches(value, uom):
    value = num(value)
    if value is None:
        return None
    unit = str(uom or "").lower()
    if "mm" in unit:
        return value / 25.4
    if "cm" in unit:
        return value / 2.54
    if unit.endswith(":m") or unit == "m":
        return value * 39.37007874
    if "in_i" in unit or unit.endswith(":in"):
        return value
    return None


def miles(value, uom):
    value = num(value)
    if value is None:
        return None
    unit = str(uom or "").lower()
    if "km" in unit:
        return value / 1.609344
    if unit.endswith(":m") or unit == "m":
        return value / 1609.344
    if "mi" in unit:
        return value
    return None


def grid_total_inches(prop, window_start, window_end):
    if not isinstance(prop, dict):
        return None
    total = 0.0
    used = False
    uom = prop.get("uom")
    for row in prop.get("values") or []:
        start, end = valid_interval(row.get("validTime"))
        fraction = overlap_fraction(start, end, window_start, window_end)
        value = inches(row.get("value"), uom)
        if fraction > 0 and value is not None:
            total += value * fraction
            used = True
    return round(total, 2) if used else None


def grid_max_average_rate(prop, window_start, window_end):
    """Return largest average accumulation rate across an NWS grid valid period."""
    if not isinstance(prop, dict):
        return None
    best = None
    uom = prop.get("uom")
    for row in prop.get("values") or []:
        start, end = valid_interval(row.get("validTime"))
        value = inches(row.get("value"), uom)
        if value is None or not start or not end:
            continue
        if end <= window_start or start >= window_end:
            continue
        hours = (end - start).total_seconds() / 3600
        if hours <= 0 or hours > 12:
            continue
        rate = value / hours
        best = rate if best is None else max(best, rate)
    return round(best, 2) if best is not None else None


def grid_min_visibility(prop, window_start, window_end):
    if not isinstance(prop, dict):
        return None
    best = None
    uom = prop.get("uom")
    for row in prop.get("values") or []:
        start, end = valid_interval(row.get("validTime"))
        value = miles(row.get("value"), uom)
        if value is None or not start or not end:
            continue
        if end <= window_start or start >= window_end:
            continue
        best = value if best is None else min(best, value)
    return round(best, 1) if best is not None else None


def parse_speed(value):
    if isinstance(value, dict):
        speed = num(value.get("value"))
        unit = str(value.get("unitCode") or "").lower()
        if speed is None:
            return None
        if "km_h" in unit:
            return speed * 0.621371
        if "m_s" in unit:
            return speed * 2.236936
        return speed
    values = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", str(value or ""))]
    return max(values) if values else None


def precip_category(summary):
    text = (summary or "").lower()
    if re.search(r"thunder|t-storm", text):
        return "Thunderstorms"
    if re.search(r"freezing rain|sleet|wintry|ice pellets|mixed", text):
        return "Wintry Mix"
    if re.search(r"snow|flurr", text):
        return "Snow"
    if re.search(r"rain|shower|drizzle", text):
        return "Rain"
    return "Dry / Clouds"


def normalize_alert(feature):
    props = (feature or {}).get("properties") or {}
    return {
        "id": feature.get("id") or props.get("@id"),
        "event": props.get("event"),
        "severity": props.get("severity"),
        "urgency": props.get("urgency"),
        "certainty": props.get("certainty"),
        "headline": props.get("headline"),
        "onset": props.get("onset"),
        "ends": props.get("ends"),
        "expires": props.get("expires"),
        "area": props.get("areaDesc"),
        "url": props.get("@id") or feature.get("id"),
    }


def haversine_miles(lat1, lon1, lat2, lon2):
    radius = 3958.7613
    lat1r, lat2r = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1r) * math.cos(lat2r) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(min(1, math.sqrt(a)))


def parse_coords(text):
    out = []
    for token in re.split(r"\s+", (text or "").strip()):
        parts = token.split(",")
        if len(parts) < 2:
            continue
        lon = num(parts[0])
        lat = num(parts[1])
        if lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
            out.append([round(lat, 4), round(lon, 4)])
    return out


def kmz_geometry(url):
    """Extract the largest point/line/ring geometry from an NHC KMZ file."""
    data = fetch_bytes(url, "application/vnd.google-earth.kmz, application/zip")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".kml")]
        if not names:
            return {"track": [], "cone": []}
        root = ET.fromstring(archive.read(names[0]))
    lines, points, rings = [], [], []
    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag not in ("LineString", "Point", "LinearRing"):
            continue
        coords = []
        for child in element.iter():
            if child.tag.rsplit("}", 1)[-1] == "coordinates":
                coords.extend(parse_coords(child.text))
        if not coords:
            continue
        if tag == "LineString":
            lines.append(coords)
        elif tag == "LinearRing":
            rings.append(coords)
        else:
            points.extend(coords)
    return {
        "track": max(lines, key=len) if lines else points,
        "cone": max(rings, key=len) if rings else [],
    }


def storm_label(code, name):
    names = {
        "TD": "Tropical Depression",
        "TS": "Tropical Storm",
        "HU": "Hurricane",
        "SS": "Subtropical Storm",
        "SD": "Subtropical Depression",
        "PT": "Post-Tropical Cyclone",
        "PTC": "Potential Tropical Cyclone",
    }
    base = names.get(code, code or "Tropical Cyclone")
    return (base + " " + str(name or "").strip()).strip()


def tropical_snapshot(nhc_doc, alerts):
    local_tropical = any(
        re.search(r"hurricane|tropical storm|storm surge", alert.get("event") or "", re.I)
        for alert in alerts
    )
    relevant = []
    atlantic_count = 0
    errors = []
    for raw in (nhc_doc or {}).get("activeStorms") or []:
        storm_id = str(raw.get("id") or "").lower()
        if not storm_id.startswith("al"):
            continue
        atlantic_count += 1
        lat = num(raw.get("latitudeNumeric"))
        lon = num(raw.get("longitudeNumeric"))
        if lat is None or lon is None:
            continue
        current_distance = haversine_miles(SITE_LAT, SITE_LON, lat, lon)
        track = []
        cone = []
        track_url = (raw.get("forecastTrack") or {}).get("kmzFile")
        cone_url = (raw.get("trackCone") or {}).get("kmzFile")
        # Retrieve GIS only for Atlantic systems plausibly relevant to the Northeast.
        if current_distance <= 2200:
            if track_url:
                try:
                    track = kmz_geometry(track_url).get("track") or []
                except Exception as exc:
                    errors.append(f"{storm_id} track: {str(exc)[:120]}")
            if cone_url:
                try:
                    cone = kmz_geometry(cone_url).get("cone") or []
                except Exception as exc:
                    errors.append(f"{storm_id} cone: {str(exc)[:120]}")
        distances = [current_distance]
        distances.extend(haversine_miles(SITE_LAT, SITE_LON, point[0], point[1]) for point in track)
        min_distance = min(distances)
        is_relevant = min_distance <= 900 or (local_tropical and min_distance <= 1600)
        if not is_relevant:
            continue
        relevant.append(
            {
                "id": raw.get("id"),
                "name": raw.get("name"),
                "classification": raw.get("classification"),
                "label": storm_label(raw.get("classification"), raw.get("name")),
                "intensity_kt": num(raw.get("intensity")),
                "pressure_mb": num(raw.get("pressure")),
                "latitude": lat,
                "longitude": lon,
                "movement_dir_deg": num(raw.get("movementDir")),
                "movement_speed_kt": num(raw.get("movementSpeed")),
                "last_update": raw.get("lastUpdate"),
                "current_distance_mi": round(current_distance),
                "min_forecast_track_distance_mi": round(min_distance),
                "track": track,
                "cone": cone,
                "public_advisory_url": (raw.get("publicAdvisory") or {}).get("url"),
                "forecast_discussion_url": (raw.get("forecastDiscussion") or {}).get("url"),
                "forecast_graphics_url": (raw.get("forecastGraphics") or {}).get("url"),
                "earliest_arrival_guidance_url": (raw.get("earliestArrivalTimeTSWindsGIS") or {}).get("kmzFile"),
                "most_likely_arrival_guidance_url": (raw.get("mostLikelyTimeTSWindsGIS") or {}).get("kmzFile"),
                "wind_watch_warning_url": (raw.get("windWatchesWarnings") or {}).get("kmzFile"),
                "local_alert": local_tropical,
            }
        )
    relevant.sort(key=lambda storm: storm.get("min_forecast_track_distance_mi") or 99999)
    return {
        "active": bool(relevant or local_tropical),
        "atlantic_active_count": atlantic_count,
        "storms": relevant,
        "errors": errors,
    }


def hourly_rows(doc, now):
    rows = []
    for period in ((doc or {}).get("properties") or {}).get("periods") or []:
        start = parse_iso(period.get("startTime"))
        end = parse_iso(period.get("endTime"))
        if not start or not end or end <= now or start > now + dt.timedelta(hours=72):
            continue
        temperature = num(period.get("temperature"))
        if temperature is not None and period.get("temperatureUnit") == "C":
            temperature = temperature * 9 / 5 + 32
        pop = num((period.get("probabilityOfPrecipitation") or {}).get("value"))
        gust = parse_speed(period.get("windGust"))
        wind = parse_speed(period.get("windSpeed"))
        rows.append(
            {
                "start": iso(start),
                "end": iso(end),
                "temperature_f": round(temperature, 1) if temperature is not None else None,
                "wind_mph": round(wind, 1) if wind is not None else None,
                "gust_mph": round(gust, 1) if gust is not None else None,
                "wind_direction": period.get("windDirection"),
                "precip_probability_pct": round(pop) if pop is not None else None,
                "summary": period.get("shortForecast") or "",
                "precip_type": precip_category(period.get("shortForecast")),
            }
        )
    return rows


def max_field(rows, key, hours, now):
    end = now + dt.timedelta(hours=hours)
    values = []
    for row in rows:
        when = parse_iso(row.get("start"))
        value = num(row.get(key))
        if when and when <= end and value is not None:
            values.append((value, row))
    return max(values, key=lambda item: item[0]) if values else (None, None)


def min_field(rows, key, hours, now):
    end = now + dt.timedelta(hours=hours)
    values = []
    for row in rows:
        when = parse_iso(row.get("start"))
        value = num(row.get(key))
        if when and when <= end and value is not None:
            values.append((value, row))
    return min(values, key=lambda item: item[0]) if values else (None, None)


def transition(rows, hours, now):
    end = now + dt.timedelta(hours=hours)
    categories = []
    for row in rows:
        when = parse_iso(row.get("start"))
        category = row.get("precip_type")
        if not when or when > end or category == "Dry / Clouds":
            continue
        if not categories or categories[-1] != category:
            categories.append(category)
    return " to ".join(categories[:4]) if categories else "No wintry or rainy precipitation signal in hourly guidance"


def timeline(rows, now):
    selected = []
    last_category = None
    for index, row in enumerate(rows):
        when = parse_iso(row.get("start"))
        if not when or when > now + dt.timedelta(hours=24):
            continue
        category = row.get("precip_type")
        if index % 3 == 0 or (category != last_category and category != "Dry / Clouds"):
            selected.append(row)
        last_category = category
    out = []
    seen = set()
    for row in selected:
        if row["start"] in seen:
            continue
        seen.add(row["start"])
        out.append(row)
        if len(out) >= 10:
            break
    return out


def detect_modes(alerts, winter, wind, rain, cold, tropical):
    events = [alert.get("event") or "" for alert in alerts]
    modes = []

    def add(code, label, basis):
        if not any(mode["code"] == code for mode in modes):
            modes.append({"code": code, "label": label, "basis": basis})

    if tropical.get("active") or any(re.search(r"hurricane|tropical storm|storm surge", event, re.I) for event in events):
        add("tropical", "Tropical Cyclone", "NHC track/advisory or local NWS tropical alert")
    if (
        winter.get("snowfall_72h_in") is not None
        and winter["snowfall_72h_in"] >= 1
    ) or any(re.search(r"winter|blizzard|snow|ice storm|freezing rain", event, re.I) for event in events):
        add("winter", "Winter Storm", "NWS snowfall guidance or winter weather alert")
    if any(re.search(r"coastal flood|storm surge|high surf", event, re.I) for event in events):
        add("coastal_flood", "Coastal Flood", "Active NWS coastal water or surf alert")
    if (
        (wind.get("max_gust_72h_mph") or 0) >= 40
        or (wind.get("max_sustained_72h_mph") or 0) >= 30
        or any(re.search(r"high wind|wind advisory|gale|storm warning", event, re.I) for event in events)
    ):
        add("high_wind", "High Wind", "NWS wind guidance or wind alert")
    if (
        (rain.get("qpf_72h_in") or 0) >= 1.5
        or any(
            re.search(r"flash flood|flood watch|flood warning|flood advisory|excessive rain", event, re.I)
            and not re.search(r"coastal", event, re.I)
            for event in events
        )
    ):
        add("heavy_rain", "Heavy Rain", "NWS precipitation guidance or inland flood alert")
    if (
        cold.get("min_temp_24h_f") is not None
        and cold["min_temp_24h_f"] <= 10
    ) or any(re.search(r"extreme cold|wind chill|freeze warning", event, re.I) for event in events):
        add("extreme_cold", "Extreme Cold", "NWS temperature guidance or cold alert")
    return modes


def severity(alerts, winter, wind, rain, tropical, modes):
    rank = 0
    reasons = []
    for alert in alerts:
        event = alert.get("event") or ""
        alert_severity = (alert.get("severity") or "").lower()
        if "warning" in event.lower() or alert_severity in ("extreme", "severe"):
            current = 3
        elif "watch" in event.lower() or alert_severity == "moderate":
            current = 2
        else:
            current = 1 if event else 0
        rank = max(rank, current)
        if current >= 2 and event:
            reasons.append("NWS " + event)
    snow = winter.get("snowfall_72h_in")
    if snow is not None:
        current = 3 if snow >= 12 else 2 if snow >= 6 else 1 if snow >= 2 else 0
        rank = max(rank, current)
        if current:
            reasons.append(f"NWS 72h snowfall guidance {snow:.1f} in")
    gust = wind.get("max_gust_72h_mph")
    if gust is not None:
        current = 3 if gust >= 58 else 2 if gust >= 40 else 1 if gust >= 25 else 0
        rank = max(rank, current)
        if current >= 2:
            reasons.append(f"NWS peak gust guidance {gust:.0f} mph")
    qpf = rain.get("qpf_72h_in")
    if qpf is not None:
        current = 3 if qpf >= 4 else 2 if qpf >= 2 else 1 if qpf >= 1 else 0
        rank = max(rank, current)
        if current >= 2:
            reasons.append(f"NWS 72h precipitation guidance {qpf:.1f} in")
    storms = tropical.get("storms") or []
    if storms:
        distance = storms[0].get("min_forecast_track_distance_mi")
        if distance is not None and distance <= 250:
            rank = max(rank, 2)
            reasons.append(f"NHC forecast track approaches within about {distance:.0f} mi")
    if modes and rank == 0:
        rank = 1
    levels = ["green", "yellow", "orange", "red"]
    labels = ["Routine", "Elevated", "Significant", "High Impact"]
    return {"level": levels[rank], "label": labels[rank], "rank": rank, "reasons": reasons[:6]}


def build_snapshot(now=None):
    now = now or now_utc()
    errors = {}

    point, error = safe_json("https://api.weather.gov/points/" + POINT)
    if error:
        errors["nws_point"] = error
    point_props = (point or {}).get("properties") or {}
    hourly_url = point_props.get("forecastHourly")
    grid_url = point_props.get("forecastGridData")

    hourly_doc, error = safe_json(hourly_url) if hourly_url else (None, "NWS point did not provide hourly forecast URL")
    if error:
        errors["nws_hourly"] = error

    grid_doc, error = safe_json(grid_url) if grid_url else (None, "NWS point did not provide grid forecast URL")
    if error:
        errors["nws_grid"] = error

    alert_doc, error = safe_json("https://api.weather.gov/alerts/active?point=" + POINT)
    if error:
        errors["nws_alerts"] = error
    alerts = [normalize_alert(feature) for feature in ((alert_doc or {}).get("features") or [])]

    rows = hourly_rows(hourly_doc, now)
    grid = (grid_doc or {}).get("properties") or {}
    end24 = now + dt.timedelta(hours=24)
    end72 = now + dt.timedelta(hours=72)

    snow24 = grid_total_inches(grid.get("snowfallAmount"), now, end24)
    snow72 = grid_total_inches(grid.get("snowfallAmount"), now, end72)
    ice72 = grid_total_inches(grid.get("iceAccumulation"), now, end72)
    qpf24 = grid_total_inches(grid.get("quantitativePrecipitation"), now, end24)
    qpf72 = grid_total_inches(grid.get("quantitativePrecipitation"), now, end72)

    gust24, gust24_row = max_field(rows, "gust_mph", 24, now)
    gust72, gust72_row = max_field(rows, "gust_mph", 72, now)
    wind24, wind24_row = max_field(rows, "wind_mph", 24, now)
    wind72, _ = max_field(rows, "wind_mph", 72, now)
    min24, min24_row = min_field(rows, "temperature_f", 24, now)

    winter = {
        "active": False,
        "snowfall_24h_in": snow24,
        "snowfall_72h_in": snow72,
        "ice_72h_in": ice72,
        "max_average_snow_rate_24h_in_hr": grid_max_average_rate(grid.get("snowfallAmount"), now, end24),
        "min_visibility_24h_mi": grid_min_visibility(grid.get("visibility"), now, end24),
        "precip_transition_24h": transition(rows, 24, now),
    }
    rain = {"qpf_24h_in": qpf24, "qpf_72h_in": qpf72}
    wind = {
        "max_sustained_24h_mph": round(wind24, 1) if wind24 is not None else None,
        "max_sustained_24h_time": wind24_row.get("start") if wind24_row else None,
        "max_sustained_72h_mph": round(wind72, 1) if wind72 is not None else None,
        "max_gust_24h_mph": round(gust24, 1) if gust24 is not None else None,
        "max_gust_24h_time": gust24_row.get("start") if gust24_row else None,
        "max_gust_72h_mph": round(gust72, 1) if gust72 is not None else None,
        "max_gust_72h_time": gust72_row.get("start") if gust72_row else None,
    }
    cold = {
        "min_temp_24h_f": round(min24, 1) if min24 is not None else None,
        "min_temp_24h_time": min24_row.get("start") if min24_row else None,
    }

    nhc_doc, error = safe_json(NHC_CURRENT)
    if error:
        errors["nhc"] = error
    tropical = (
        tropical_snapshot(nhc_doc, alerts)
        if nhc_doc
        else {"active": False, "atlantic_active_count": 0, "storms": [], "errors": [error] if error else []}
    )

    modes = detect_modes(alerts, winter, wind, rain, cold, tropical)
    winter["active"] = any(mode["code"] == "winter" for mode in modes)
    level = severity(alerts, winter, wind, rain, tropical, modes)

    return {
        "schema_version": 1,
        "generated_at": iso(now),
        "location": {"name": "Saco Bay coastal reference", "lat": SITE_LAT, "lon": SITE_LON},
        "active_modes": modes,
        "severity": level,
        "alerts": alerts,
        "winter": winter,
        "rain": rain,
        "wind": wind,
        "cold": cold,
        "tropical": tropical,
        "hourly": timeline(rows, now),
        "errors": errors,
        "sources": {
            "nws_point": "https://api.weather.gov/points/" + POINT,
            "nws_hourly": hourly_url,
            "nws_grid": grid_url,
            "nws_alerts": "https://api.weather.gov/alerts/active?point=" + POINT,
            "nhc": NHC_CURRENT,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/hazards.json")
    args = parser.parse_args()
    data = build_snapshot()
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "generated_at": data["generated_at"],
                "active_modes": [mode["code"] for mode in data["active_modes"]],
                "severity": data["severity"]["level"],
                "errors": data["errors"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
