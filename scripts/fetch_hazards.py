#!/usr/bin/env python3
"""Build adaptive weather-hazard guidance for Saco Coast Watch.

Uses only free authoritative public sources:
- NWS point, hourly, forecast-grid, active-alert, marine-alert, and Surf Zone Forecast APIs
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
NWS_SURF_LATEST = "https://api.weather.gov/products/types/SRF/locations/GYX/latest"
MARINE_ZONE = "ANZ154"
NWS_MARINE_ALERTS = "https://api.weather.gov/alerts/active?zone=" + MARINE_ZONE


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


def classification_name(code):
    names = {
        "TD": "Tropical Depression",
        "TS": "Tropical Storm",
        "HU": "Hurricane",
        "SS": "Subtropical Storm",
        "SD": "Subtropical Depression",
        "PT": "Post-Tropical Cyclone",
        "PTC": "Potential Tropical Cyclone",
    }
    return names.get(code, code or "Tropical Cyclone")


def storm_label(code, name):
    base = classification_name(code)
    return (base + " " + str(name or "").strip()).strip()


def surf_zone_snapshot(doc):
    """Parse NWS Gray's latest Surf Zone Forecast for Coastal York."""
    text = str((doc or {}).get("productText") or "")
    match = re.search(
        r"MEZ023-\d+-\s*\nCoastal York-([\s\S]*?)(?=\n(?:MEZ|NHZ)\d{3}-\d+-|\n\$\$|\Z)",
        text,
        re.I,
    )
    block = match.group(1) if match else ""
    heights = []
    risks = []
    lines = block.splitlines()
    for index, line in enumerate(lines):
        if re.search(r"Surf Height", line, re.I):
            segment = line
            for continuation in lines[index + 1:index + 3]:
                if re.match(r"\s*[A-Za-z][A-Za-z *]+\.{3,}", continuation) or re.match(r"\s*\.[A-Z]", continuation):
                    break
                segment += " " + continuation.strip()
            heights.extend(float(v) for v in re.findall(r"(\d+(?:\.\d+)?)\s*(?:foot|feet)\b", segment, re.I))
        if re.search(r"Rip Current Risk", line, re.I):
            lower = line.lower()
            if "high" in lower:
                risks.append("High")
            elif "moderate" in lower:
                risks.append("Moderate")
            elif "low" in lower:
                risks.append("Low")
    order = {"Low": 1, "Moderate": 2, "High": 3}
    risk = max(risks, key=lambda item: order[item]) if risks else None
    return {
        "available": bool(block),
        "zone": "Coastal York",
        "max_surf_height_ft": round(max(heights), 1) if heights else None,
        "rip_current_risk": risk,
        "issued_at": (doc or {}).get("issuanceTime"),
        "product_id": (doc or {}).get("id"),
        "source": NWS_SURF_LATEST,
    }


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


def compass_degrees(value):
    if value is None:
        return None
    numeric=num(value)
    if numeric is not None:
        return numeric%360
    token=str(value).strip().upper()
    points={"N":0,"NNE":22.5,"NE":45,"ENE":67.5,"E":90,"ESE":112.5,"SE":135,"SSE":157.5,"S":180,"SSW":202.5,"SW":225,"WSW":247.5,"W":270,"WNW":292.5,"NW":315,"NNW":337.5}
    return points.get(token)

SACO_ONSHORE_FROM_DEG=120.0

def onshore_component(speed_mph,direction,shore_normal_from_deg=SACO_ONSHORE_FROM_DEG):
    speed=num(speed_mph); direction_deg=compass_degrees(direction)
    if speed is None or direction_deg is None: return None
    delta=math.radians(((direction_deg-shore_normal_from_deg+180)%360)-180)
    return round(max(0.0,speed*math.cos(delta)),1)

def wave_power_proxy_kw_m(height_ft,dominant_period_sec):
    height=num(height_ft); period=num(dominant_period_sec)
    if height is None or period is None or height<=0 or period<=0: return None
    height_m=height*0.3048
    return round(0.49*height_m*height_m*period,1)

def _nearest_hourly(rows,target,max_hours=4):
    target=parse_iso(target) if not isinstance(target,dt.datetime) else target
    if not target: return None
    candidates=[]
    for row in rows or []:
        when=parse_iso(row.get("start"))
        if when: candidates.append((abs((when-target).total_seconds()),row))
    if not candidates: return None
    distance,row=min(candidates,key=lambda item:item[0])
    return row if distance<=max_hours*3600 else None

def _water_points(value):
    value=num(value)
    if value is None: return 0
    if value>=14: return 35
    if value>=13: return 30
    if value>=12: return 24
    if value>=11.5: return 16
    if value>=11: return 8
    return 0

def _surf_points(value):
    value=num(value)
    if value is None: return 0
    if value>=15: return 25
    if value>=10: return 20
    if value>=7: return 15
    if value>=5: return 8
    return 0

def _onshore_points(value):
    value=num(value)
    if value is None: return 0
    if value>=50: return 20
    if value>=35: return 15
    if value>=25: return 10
    if value>=15: return 5
    return 0

def _impact_from_score(score):
    score=max(0,min(100,int(round(score or 0))))
    rank=3 if score>=75 else 2 if score>=55 else 1 if score>=35 else 0
    return {"score":score,"rank":rank,"level":["green","yellow","orange","red"][rank],"label":["Routine","Elevated","Significant","High Impact"][rank]}

def _coastal_alert_points(alerts):
    points=0; labels=[]
    for alert in alerts or []:
        event=alert.get("event") or ""; lower=event.lower()
        if not re.search(r"coastal flood|storm surge|high surf",lower): continue
        if "warning" in lower: points=max(points,15)
        elif "watch" in lower or "advisory" in lower or "statement" in lower: points=max(points,8)
        labels.append(event)
    return points,list(dict.fromkeys(labels))

def coastal_impact_state(hazards,water,buoy,alerts,now):
    surf=hazards.get("surf") or {}; hourly=hazards.get("hourly_full") or hazards.get("hourly") or []
    high_tides=list((water or {}).get("high_tides") or [])
    alert_points,alert_labels=_coastal_alert_points(alerts)
    surf_ft=num(surf.get("max_surf_height_ft")); wave_ft=num((buoy or {}).get("wave_height_ft")); wave_period=num((buoy or {}).get("dominant_period_sec"))
    wave_power=wave_power_proxy_kw_m(wave_ft,wave_period)
    buoy_onshore=onshore_component((buoy or {}).get("gust_mph") or (buoy or {}).get("speed_mph"),(buoy or {}).get("direction_deg"))
    windows=[]
    for item in high_tides[:6]:
        at=parse_iso(item.get("time"))
        if not at or at<now-dt.timedelta(minutes=30) or at>now+dt.timedelta(hours=72): continue
        row=_nearest_hourly(hourly,at)
        gust=num((row or {}).get("gust_mph")) or num((row or {}).get("wind_mph"))
        onshore=onshore_component(gust,(row or {}).get("wind_direction"))
        total=num(item.get("modeled_total_ft"))
        water_points=_water_points(total); surf_points=_surf_points(surf_ft); onshore_points=_onshore_points(onshore)
        factor_count=sum(1 for value in (water_points,surf_points,onshore_points,alert_points) if value>0)
        compound_bonus=10 if factor_count>=3 else 5 if factor_count>=2 else 0
        impact=_impact_from_score(water_points+surf_points+onshore_points+alert_points+compound_bonus)
        drivers=[]
        if total is not None: drivers.append({"label":"NOAA forecast water level","value":f"{total:.2f} ft MLLW","source":"NOAA OFS"})
        if num(item.get("astronomical_ft")) is not None: drivers.append({"label":"Predicted high tide","value":f"{float(item['astronomical_ft']):.2f} ft MLLW","source":"NOAA CO-OPS tide prediction"})
        if surf_ft is not None: drivers.append({"label":"NWS surf forecast","value":f"{surf_ft:.0f} ft max in the current Coastal York forecast","source":"NWS Surf Zone Forecast"})
        if onshore is not None: drivers.append({"label":"Wind pushing toward shore","value":f"{onshore:.0f} mph","source":"Calculated from NWS hourly wind direction and speed"})
        for event in alert_labels[:2]: drivers.append({"label":"Official coastal product","value":event,"source":"National Weather Service"})
        windows.append({"high_tide_at":iso(at),"window_start":iso(at-dt.timedelta(minutes=90)),"window_end":iso(at+dt.timedelta(minutes=90)),"astronomical_ft":num(item.get("astronomical_ft")),"modeled_total_ft":total,"modeled_time":item.get("modeled_time"),"modeled_uplift_ft":num(item.get("modeled_uplift_ft")),"forecast_wind_mph":gust,"forecast_wind_direction":(row or {}).get("wind_direction"),"onshore_component_mph":onshore,"surf_context_ft":surf_ft,"impact":impact,"drivers":drivers})
    peak=max(windows,key=lambda item:(item["impact"]["score"],-(parse_iso(item["high_tide_at"])-now).total_seconds())) if windows else None
    peak_at=parse_iso((peak or {}).get("high_tide_at")); hours_until=round((peak_at-now).total_seconds()/3600,1) if peak_at else None
    checks={"NOAA forecast water level":any(num(item.get("modeled_total_ft")) is not None for item in high_tides),"NOAA tide predictions":bool(high_tides),"NWS surf forecast":surf_ft is not None,"NWS wind forecast":bool(hourly),"NDBC 44007 wave observation":wave_ft is not None}
    weights={"NOAA forecast water level":0.25,"NOAA tide predictions":0.20,"NWS surf forecast":0.20,"NWS wind forecast":0.20,"NDBC 44007 wave observation":0.15}
    confidence_score=round(sum(weights[name] for name,ok in checks.items() if ok),2)
    confidence_label="High" if confidence_score>=0.90 else "Moderate" if confidence_score>=0.60 else "Low"
    impact=(peak or {}).get("impact") or _impact_from_score(0)
    drivers=list((peak or {}).get("drivers") or [])
    if wave_ft is not None:
        detail=f"{wave_ft:.1f} ft"+(f" at {wave_period:.1f} sec dominant period" if wave_period is not None else "")
        drivers.append({"label":"Latest offshore wave observation","value":detail,"source":"NDBC 44007"})
    if wave_power is not None: drivers.append({"label":"Wave energy estimate","value":f"{wave_power:.1f} kW/m estimate","source":"Estimated from NDBC wave height and dominant period"})
    if buoy_onshore is not None: drivers.append({"label":"Latest buoy onshore-wind component","value":f"{buoy_onshore:.0f} mph","source":"Derived from NDBC 44007"})
    return {"method":"Saco Coast Watch combines official forecasts and observations into this local coastal-impact rating. The rating itself is not an official NOAA/NWS forecast.","impact":impact,"windows":windows,"peak_window":peak,"hours_until_peak":hours_until,"confidence":{"label":confidence_label,"score":confidence_score,"missing":[name for name,ok in checks.items() if not ok]},"drivers":drivers[:8],"wave_context":{"height_ft":wave_ft,"dominant_period_sec":wave_period,"direction_deg":num((buoy or {}).get("wave_direction_deg")),"power_proxy_kw_m":wave_power},"onshore_reference":{"shore_normal_from_deg":SACO_ONSHORE_FROM_DEG,"note":"Approximate Saco Bay coastal-exposure proxy using meteorological wind-from direction."}}
def detect_modes(alerts, winter, wind, rain, cold, tropical, surf=None, marine_alerts=None):
    surf = surf or {}
    marine_alerts = marine_alerts or []
    events = [alert.get("event") or "" for alert in alerts]
    marine_events = [alert.get("event") or "" for alert in marine_alerts]
    modes = []

    def add(code, label, basis):
        if not any(mode["code"] == code for mode in modes):
            modes.append({"code": code, "label": label, "basis": basis})

    if tropical.get("active") or any(re.search(r"hurricane|tropical storm|storm surge", event, re.I) for event in events):
        add("tropical", "Tropical Cyclone", "NHC track/advisory or local NWS tropical alert")
    if ((winter.get("snowfall_72h_in") is not None and winter["snowfall_72h_in"] >= 1)
        or (winter.get("ice_72h_in") or 0) >= 0.05
        or any(re.search(r"winter|blizzard|snow|ice storm|freezing rain", event, re.I) for event in events)):
        add("winter", "Winter Storm", "NWS snowfall/ice guidance or winter weather alert")
    if any(re.search(r"coastal flood|storm surge", event, re.I) for event in events):
        add("coastal_flood", "Coastal Flood", "Active NWS coastal flood or storm surge alert")
    if any(re.search(r"high surf", event, re.I) for event in events) or (surf.get("max_surf_height_ft") or 0) >= 7:
        add("high_surf", "High Surf / Wave Impact", "NWS High Surf product or Coastal York Surf Zone Forecast")
    if any(re.search(r"rip current", event, re.I) for event in events) or str(surf.get("rip_current_risk") or "").lower() == "high":
        add("beach_hazard", "Beach Hazard / Rip Current", "NWS rip-current product or High Surf Zone Forecast risk")
    if any(re.search(r"gale warning|storm warning|hurricane force wind warning|hazardous seas warning", event, re.I) for event in marine_events):
        add("marine_hazard", "Marine Hazard", "NWS marine warning for coastal waters")
    if ((wind.get("max_gust_72h_mph") or 0) >= 40
        or (wind.get("max_sustained_72h_mph") or 0) >= 30
        or any(re.search(r"high wind|wind advisory", event, re.I) for event in events)):
        add("high_wind", "High Wind", "NWS land-wind guidance or land-wind alert")
    if ((rain.get("qpf_72h_in") or 0) >= 1.5
        or any(re.search(r"excessive rain|heavy rain", event, re.I) for event in events)):
        add("heavy_rain", "Heavy Rain", "NWS precipitation guidance or excessive-rain product")
    if any(re.search(r"flash flood|flood watch|flood warning|flood advisory", event, re.I) and not re.search(r"coastal", event, re.I) for event in events):
        add("flooding", "Flooding", "Active NWS inland or flash-flood product")
    if ((cold.get("min_temp_24h_f") is not None and cold["min_temp_24h_f"] <= 10)
        or any(re.search(r"extreme cold|wind chill|freeze warning", event, re.I) for event in events)):
        add("extreme_cold", "Extreme Cold", "NWS temperature guidance or cold alert")
    return modes


def _rank(value, yellow, orange, red):
    value = num(value)
    if value is None:
        return 0
    return 3 if value >= red else 2 if value >= orange else 1 if value >= yellow else 0


def _alert_rank(code, event):
    text = (event or "").lower()
    if code == "coastal_flood":
        if "storm surge warning" in text: return 3
        if "coastal flood warning" in text: return 2
        if "coastal flood watch" in text or "coastal flood advisory" in text or "storm surge watch" in text: return 1
    elif code == "high_surf":
        if "high surf warning" in text: return 2
        if "high surf advisory" in text: return 1
    elif code == "beach_hazard":
        if "rip current" in text: return 1
    elif code == "marine_hazard":
        if "hurricane force wind warning" in text or "storm warning" in text: return 3
        if "gale warning" in text or "hazardous seas warning" in text: return 2
    elif code == "high_wind":
        if "high wind warning" in text: return 2
        if "wind advisory" in text or "high wind watch" in text: return 1
    elif code == "flooding":
        if "flash flood warning" in text: return 3
        if "flood warning" in text: return 2
        if "flood watch" in text or "flood advisory" in text: return 1
    elif code == "winter":
        if "blizzard warning" in text: return 3
        if "winter storm warning" in text or "ice storm warning" in text: return 2
        if "winter storm watch" in text or "winter weather advisory" in text: return 1
    elif code == "tropical":
        if "hurricane warning" in text or "storm surge warning" in text: return 3
        if "tropical storm warning" in text: return 2
        if "hurricane watch" in text or "tropical storm watch" in text or "storm surge watch" in text: return 1
    elif code == "extreme_cold":
        if "extreme cold warning" in text or "wind chill warning" in text: return 2
        if "extreme cold watch" in text or "wind chill advisory" in text or "freeze warning" in text: return 1
    return 0


def _alert_matches(code, event):
    text = (event or "").lower()
    patterns = {
        "coastal_flood": r"coastal flood|storm surge",
        "high_surf": r"high surf",
        "beach_hazard": r"rip current",
        "marine_hazard": r"gale warning|storm warning|hurricane force wind warning|hazardous seas warning",
        "high_wind": r"high wind|wind advisory",
        "heavy_rain": r"excessive rain|heavy rain",
        "flooding": r"flash flood|flood watch|flood warning|flood advisory",
        "winter": r"winter|blizzard|snow|ice storm|freezing rain",
        "tropical": r"hurricane|tropical storm|storm surge",
        "extreme_cold": r"extreme cold|wind chill|freeze warning",
    }
    return bool(re.search(patterns.get(code, r"$^"), text, re.I))


def _official_identity(tropical):
    storms = tropical.get("storms") or []
    if not storms:
        return None
    storm = storms[0]
    return {
        "official_name": storm.get("name"),
        "official_type": classification_name(storm.get("classification")),
        "label": storm.get("label") or storm_label(storm.get("classification"), storm.get("name")),
        "storm_id": storm.get("id"),
        "naming_authority": "National Hurricane Center / WMO",
        "advisory_url": storm.get("public_advisory_url"),
        "last_authoritative_update": storm.get("last_update"),
    }


def _primary_display(codes, identity=None):
    if "tropical" in codes and identity and identity.get("label"): return identity["label"]
    if "winter" in codes and ({"coastal_flood", "high_surf"} & codes): return "Winter Coastal Storm"
    if "coastal_flood" in codes and ({"high_surf", "high_wind", "marine_hazard"} & codes): return "Coastal Storm"
    if "high_surf" in codes and ({"high_wind", "marine_hazard", "coastal_impact"} & codes): return "Coastal Storm"
    if "coastal_impact" in codes and ({"coastal_flood","high_surf","high_wind","marine_hazard"} & codes): return "Coastal Storm"
    labels = [("coastal_impact","Coastal Impact"),("coastal_flood","Coastal Flood"),("high_surf","High Surf / Wave Impact"),("beach_hazard","Beach Hazard / Rip Current"),("marine_hazard","Marine Hazard"),("flooding","Flooding"),("heavy_rain","Heavy Rain"),("high_wind","High Wind"),("winter","Winter Storm"),("extreme_cold","Extreme Cold")]
    for code, label in labels:
        if code in codes: return label
    return "Routine Coastal Conditions"


def derive_event_state(hazards, water=None, marine=None, alerts=None, now=None):
    now=now or now_utc(); hazards=hazards or {}; water=water or {}
    alerts=alerts if alerts is not None else hazards.get("alerts") or []
    marine_alerts=hazards.get("marine_alerts") or []
    stations=(marine or {}).get("stations") if isinstance(marine,dict) and "stations" in marine else (marine or {})
    buoy=(stations or {}).get("44007") or {}; surf=hazards.get("surf") or {}; winter=hazards.get("winter") or {}; rain=hazards.get("rain") or {}; wind=hazards.get("wind") or {}; cold=hazards.get("cold") or {}; tropical=hazards.get("tropical") or {}
    modes=[dict(mode) for mode in hazards.get("active_modes") or []]
    def add(code,label,basis):
        if not any(mode.get("code")==code for mode in modes): modes.append({"code":code,"label":label,"basis":basis})
    forecast72=num(water.get("forecast_peak_72h_ft")); forecast24=num(water.get("forecast_peak_24h_ft")); observed=num(water.get("latest_observed_ft"))
    if max([v for v in (forecast72,forecast24,observed) if v is not None],default=-999)>=12: add("coastal_flood","Coastal Flood","Portland observed or NOAA forecast water reaches Minor Flood")
    if (num(buoy.get("wave_height_ft")) or 0)>=8 or (num(buoy.get("gust_mph")) or 0)>=35 or (num(buoy.get("speed_mph")) or 0)>=25: add("marine_hazard","Marine Hazard","NDBC 44007 measured offshore conditions are elevated")
    all_alerts=list(alerts)+list(marine_alerts)
    coastal_impact=coastal_impact_state(hazards,water,buoy,all_alerts,now)
    if (coastal_impact.get("impact") or {}).get("rank",0)>=1: add("coastal_impact","Coastal Impact","Saco Coast Watch combines high tide, NOAA water forecast, surf and wind signals")
    active_hazards=[]
    for mode in modes:
        code=mode.get("code"); rank=0; raw_basis=mode.get("basis"); basis=list(raw_basis) if isinstance(raw_basis,list) else ([raw_basis] if raw_basis else [])
        if code=="coastal_impact": rank=max(rank,(coastal_impact.get("impact") or {}).get("rank",0))
        elif code=="coastal_flood": rank=max(rank,_rank(max([v for v in (forecast72,observed) if v is not None],default=None),12,13,14))
        elif code=="high_surf": rank=max(rank,_rank(surf.get("max_surf_height_ft"),7,10,15))
        elif code=="beach_hazard": rank=max(rank,1 if str(surf.get("rip_current_risk") or "").lower()=="high" else 0)
        elif code=="marine_hazard": rank=max(rank,_rank(buoy.get("wave_height_ft"),8,12,18),_rank(buoy.get("gust_mph"),35,50,65),_rank(buoy.get("speed_mph"),25,40,55))
        elif code=="high_wind": rank=max(rank,_rank(wind.get("max_gust_72h_mph"),25,40,58))
        elif code=="heavy_rain": rank=max(rank,_rank(rain.get("qpf_72h_in"),1,2,4))
        elif code=="winter": rank=max(rank,_rank(winter.get("snowfall_72h_in"),2,6,12),_rank(winter.get("ice_72h_in"),0.05,0.10,0.25))
        elif code=="tropical":
            storms=tropical.get("storms") or []
            if storms:
                distance=num(storms[0].get("min_forecast_track_distance_mi"))
                if distance is not None: rank=max(rank,2 if distance<=250 else 1 if distance<=500 else 0)
        elif code=="extreme_cold":
            temp=num(cold.get("min_temp_24h_f"))
            if temp is not None: rank=max(rank,3 if temp<=-10 else 2 if temp<=0 else 1 if temp<=10 else 0)
        for alert in all_alerts:
            event=alert.get("event") or ""
            if _alert_matches(code,event):
                rank=max(rank,_alert_rank(code,event))
                if event: basis.append("NWS "+event)
        if rank==0: rank=1
        active_hazards.append({**mode,"impact_rank":rank,"basis":list(dict.fromkeys(basis))})
    recent_impacts=[]
    def recent(code,label,at,value,unit,rank):
        when=parse_iso(at)
        if when and when>=now-dt.timedelta(hours=24): recent_impacts.append({"code":code,"label":label,"at":iso(when),"value":value,"unit":unit,"impact_rank":rank})
    obs24=num(water.get("observed_24h_max_ft"))
    if obs24 is not None and obs24>=12: recent("coastal_flood","Portland observed high water",water.get("observed_24h_max_time"),round(obs24,2),"ft MLLW",_rank(obs24,12,13,14))
    residual24=num(water.get("residual_24h_max_ft"))
    if residual24 is not None and residual24>=1: recent("residual","Portland water-level residual",water.get("residual_24h_max_time"),round(residual24,2),"ft",1 if residual24<1.5 else 2)
    wave24=num(buoy.get("max_24h_wave_height_ft"))
    if wave24 is not None and wave24>=6: recent("waves","Buoy 44007 significant wave height",buoy.get("max_24h_wave_at"),round(wave24,1),"ft",_rank(wave24,6,10,15))
    gust24=num(buoy.get("max_24h_gust_mph"))
    if gust24 is not None and gust24>=35: recent("marine_wind","Buoy 44007 gust",buoy.get("max_24h_gust_at"),round(gust24,1),"mph",_rank(gust24,35,50,65))
    recent_impacts.sort(key=lambda item:parse_iso(item["at"]) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)); recent_rank=max((item["impact_rank"] for item in recent_impacts),default=0)
    warning_now=False
    for alert in all_alerts:
        event=alert.get("event") or ""
        if "warning" not in event.lower(): continue
        onset=parse_iso(alert.get("onset")); ends=parse_iso(alert.get("ends") or alert.get("expires"))
        if (not onset or onset<=now) and (not ends or ends>=now): warning_now=True; break
    peak_window=coastal_impact.get("peak_window") or {}; peak_start=parse_iso(peak_window.get("window_start")); peak_end=parse_iso(peak_window.get("window_end"))
    compound_now=bool((coastal_impact.get("impact") or {}).get("rank",0)>=1 and peak_start and peak_end and peak_start<=now<=peak_end)
    compound_24=bool((coastal_impact.get("impact") or {}).get("rank",0)>=1 and coastal_impact.get("hours_until_peak") is not None and coastal_impact["hours_until_peak"]<=24)
    current_signal=((observed is not None and observed>=12) or (num(buoy.get("wave_height_ft")) or 0)>=8 or (num(buoy.get("gust_mph")) or 0)>=35 or (num(buoy.get("speed_mph")) or 0)>=25 or compound_now)
    near24=((forecast24 is not None and forecast24>=12) or (num(winter.get("snowfall_24h_in")) or 0)>=2 or (num(rain.get("qpf_24h_in")) or 0)>=1 or (num(wind.get("max_gust_24h_mph")) or 0)>=25 or compound_24 or any(re.search(r"watch|advisory|warning|statement",alert.get("event") or "",re.I) for alert in all_alerts) or any(mode.get("code") in ("high_surf","beach_hazard") for mode in active_hazards))
    if active_hazards: phase="Ongoing" if (current_signal or warning_now) else "Approaching" if near24 else "Outlook"
    elif recent_impacts:
        freshest=max(parse_iso(item["at"]) for item in recent_impacts if parse_iso(item["at"])); phase="Improving" if freshest>=now-dt.timedelta(hours=6) else "Recent"
    else: phase="Routine"
    impact_rank=max((item.get("impact_rank",0) for item in active_hazards),default=0)
    if phase=="Improving": impact_rank=max(1,recent_rank)
    if phase in ("Routine","Recent"): impact_rank=0
    levels=["green","yellow","orange","red"]; labels=["Routine","Elevated","Significant","High Impact"]
    impact={"rank":impact_rank,"level":levels[impact_rank],"label":labels[impact_rank]}; recent_impact={"rank":recent_rank,"level":levels[recent_rank],"label":labels[recent_rank]}
    identity=_official_identity(tropical); codes={mode.get("code") for mode in active_hazards}; display=_primary_display(codes,identity); show_focus=phase in ("Outlook","Approaching","Ongoing","Improving")
    reasons=[]
    for mode in active_hazards: reasons.extend(mode.get("basis") or [])
    reasons=list(dict.fromkeys(reason for reason in reasons if reason))[:8]
    event_timing=None
    if peak_window and (coastal_impact.get("impact") or {}).get("rank",0)>=1:
        event_timing={"peak_at":peak_window.get("high_tide_at"),"window_start":peak_window.get("window_start"),"window_end":peak_window.get("window_end"),"hours_until_peak":coastal_impact.get("hours_until_peak"),"basis":"Highest Saco Coast Watch compound coastal-impact window"}
    elif water.get("forecast_peak_72h_time") and forecast72 is not None:
        target=parse_iso(water.get("forecast_peak_72h_time")); event_timing={"peak_at":water.get("forecast_peak_72h_time"),"window_start":None,"window_end":None,"hours_until_peak":round((target-now).total_seconds()/3600,1) if target else None,"basis":"NOAA OFS modeled total-water peak"}
    if phase=="Recent": summary="Recent coastal impacts remain in the fixed past-24-hour window; current and forward-looking conditions are Routine."
    elif phase=="Routine": summary="No meaningful active or near-term adaptive hazard is detected."
    elif phase=="Improving": summary=f"{display} impacts are improving; recent observations remain relevant."
    else: summary=f"{display} is {phase.lower()} with {impact['label'].lower()} local impact potential."
    return {"phase":phase,"show_focus":show_focus,"primary_display":display,"impact":impact,"recent_impact":recent_impact,"event_identity":identity,"active_hazards":active_hazards,"official_alerts":all_alerts,"recent_impacts":recent_impacts,"reasons":reasons,"summary":summary,"event_timing":event_timing,"coastal_impact":coastal_impact}

def severity(alerts, winter, wind, rain, tropical, modes, surf=None, marine_alerts=None, cold=None):
    hazards={"active_modes":modes,"alerts":alerts,"marine_alerts":marine_alerts or [],"winter":winter,"wind":wind,"rain":rain,"tropical":tropical,"surf":surf or {},"cold":cold or {}}
    return derive_event_state(hazards)["impact"]


def build_snapshot(now=None):
    now = now or now_utc()
    errors = {}
    point, error = safe_json("https://api.weather.gov/points/" + POINT)
    if error: errors["nws_point"] = error
    point_props = (point or {}).get("properties") or {}
    hourly_url = point_props.get("forecastHourly"); grid_url = point_props.get("forecastGridData")
    hourly_doc, error = safe_json(hourly_url) if hourly_url else (None, "NWS point did not provide hourly forecast URL")
    if error: errors["nws_hourly"] = error
    grid_doc, error = safe_json(grid_url) if grid_url else (None, "NWS point did not provide grid forecast URL")
    if error: errors["nws_grid"] = error
    alert_doc, error = safe_json("https://api.weather.gov/alerts/active?point=" + POINT)
    if error: errors["nws_alerts"] = error
    alerts = [normalize_alert(feature) for feature in ((alert_doc or {}).get("features") or [])]
    marine_alert_doc, error = safe_json(NWS_MARINE_ALERTS)
    if error: errors["nws_marine_alerts"] = error
    marine_alerts = [normalize_alert(feature) for feature in ((marine_alert_doc or {}).get("features") or [])]
    surf_doc, error = safe_json(NWS_SURF_LATEST)
    if error: errors["nws_surf_zone"] = error
    surf = surf_zone_snapshot(surf_doc)
    rows = hourly_rows(hourly_doc, now); grid = (grid_doc or {}).get("properties") or {}
    end24 = now + dt.timedelta(hours=24); end72 = now + dt.timedelta(hours=72)
    snow24 = grid_total_inches(grid.get("snowfallAmount"), now, end24); snow72 = grid_total_inches(grid.get("snowfallAmount"), now, end72)
    ice72 = grid_total_inches(grid.get("iceAccumulation"), now, end72); qpf24 = grid_total_inches(grid.get("quantitativePrecipitation"), now, end24); qpf72 = grid_total_inches(grid.get("quantitativePrecipitation"), now, end72)
    gust24, gust24_row = max_field(rows, "gust_mph", 24, now); gust72, gust72_row = max_field(rows, "gust_mph", 72, now)
    wind24, wind24_row = max_field(rows, "wind_mph", 24, now); wind72, _ = max_field(rows, "wind_mph", 72, now); min24, min24_row = min_field(rows, "temperature_f", 24, now)
    winter={"active":False,"snowfall_24h_in":snow24,"snowfall_72h_in":snow72,"ice_72h_in":ice72,"max_average_snow_rate_24h_in_hr":grid_max_average_rate(grid.get("snowfallAmount"),now,end24),"min_visibility_24h_mi":grid_min_visibility(grid.get("visibility"),now,end24),"precip_transition_24h":transition(rows,24,now)}
    rain={"qpf_24h_in":qpf24,"qpf_72h_in":qpf72}
    wind={"max_sustained_24h_mph":round(wind24,1) if wind24 is not None else None,"max_sustained_24h_time":wind24_row.get("start") if wind24_row else None,"max_sustained_72h_mph":round(wind72,1) if wind72 is not None else None,"max_gust_24h_mph":round(gust24,1) if gust24 is not None else None,"max_gust_24h_time":gust24_row.get("start") if gust24_row else None,"max_gust_72h_mph":round(gust72,1) if gust72 is not None else None,"max_gust_72h_time":gust72_row.get("start") if gust72_row else None}
    cold={"min_temp_24h_f":round(min24,1) if min24 is not None else None,"min_temp_24h_time":min24_row.get("start") if min24_row else None}
    nhc_doc, error = safe_json(NHC_CURRENT)
    if error: errors["nhc"] = error
    tropical=tropical_snapshot(nhc_doc,alerts) if nhc_doc else {"active":False,"atlantic_active_count":0,"storms":[],"errors":[error] if error else []}
    modes=detect_modes(alerts,winter,wind,rain,cold,tropical,surf,marine_alerts); winter["active"]=any(mode["code"]=="winter" for mode in modes)
    snapshot={"schema_version":1,"generated_at":iso(now),"location":{"name":"Saco Bay coastal reference","lat":SITE_LAT,"lon":SITE_LON},"active_modes":modes,"severity":{"level":"green","label":"Routine","rank":0},"event_state":{},"alerts":alerts,"marine_alerts":marine_alerts,"surf":surf,"winter":winter,"rain":rain,"wind":wind,"cold":cold,"tropical":tropical,"hourly":timeline(rows,now),"hourly_full":rows,"errors":errors,"sources":{"nws_point":"https://api.weather.gov/points/"+POINT,"nws_hourly":hourly_url,"nws_grid":grid_url,"nws_alerts":"https://api.weather.gov/alerts/active?point="+POINT,"nws_marine_alerts":NWS_MARINE_ALERTS,"nws_surf_zone":NWS_SURF_LATEST,"nhc":NHC_CURRENT}}
    event_state=derive_event_state(snapshot,alerts=alerts,now=now); snapshot["event_state"]=event_state; snapshot["severity"]=event_state["impact"]; snapshot["active_modes"]=event_state["active_hazards"]
    return snapshot


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
