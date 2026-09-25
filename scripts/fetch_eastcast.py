#!/usr/bin/env python3
"""Build the EastCast public weather snapshot from official, keyless sources.

This script intentionally does the expensive cross-origin aggregation in GitHub Actions
so phones only need one same-origin JSON request for the dashboard summary.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import os
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

USER_AGENT = "EastCast/2.0 (public weather dashboard; github.com/nycguy/saco-coast-watch)"
TIMEOUT = 16
EAST_STATES = [
    ("ME","Maine"),("NH","New Hampshire"),("MA","Massachusetts"),("RI","Rhode Island"),
    ("CT","Connecticut"),("NY","New York"),("NJ","New Jersey"),("PA","Pennsylvania"),
    ("DE","Delaware"),("MD","Maryland"),("DC","District of Columbia"),("VA","Virginia"),
    ("NC","North Carolina"),("SC","South Carolina"),("GA","Georgia"),("FL","Florida"),
]
STATE_CODES = {c for c,_ in EAST_STATES}
WPC_BASE = "https://www.wpc.ncep.noaa.gov/NationalForecastChart/mapdata"
NDFD_CAPS = "https://digital.weather.gov/ndfd/wms?service=WMS&request=GetCapabilities"
NHC_CURRENT = "https://www.nhc.noaa.gov/CurrentStorms.json"

WEBCAMS = [
    {"name":"Ferry Beach, Saco","state":"ME","lat":43.47,"lon":-70.38,"url":"https://webcoos.org/cameras/ferrybeach_north/","use":"Beach erosion + wave conditions"},
    {"name":"Westerly Town Beach","state":"RI","lat":41.31,"lon":-71.86,"url":"https://webcoos.org/cameras/westerly/","use":"Shoreline change + beach conditions"},
    {"name":"Hoboken Terminal","state":"NJ","lat":40.74,"lon":-74.03,"url":"https://webcoos.org/cameras/stevens_hoboken/","use":"Urban flooding + storm surge"},
    {"name":"Virginia Beach Oceanfront","state":"VA","lat":36.84,"lon":-75.97,"url":"https://webcoos.org/cameras/vabeach_hamptonos/","use":"Oceanfront conditions"},
    {"name":"Charleston Harbor","state":"SC","lat":32.78,"lon":-79.92,"url":"https://webcoos.org/cameras/nwlon_charleston/","use":"Harbor flooding + sea state"},
    {"name":"Folly Beach","state":"SC","lat":32.66,"lon":-79.94,"url":"https://webcoos.org/cameras/folly6thavenue/","use":"Beach + surf conditions"},
]

COASTAL_STATIONS = [
    {"name":"Portland","state":"ME","lat":43.658,"lon":-70.244,"coops":"8418150","buoy":"44007"},
    {"name":"Boston","state":"MA","lat":42.355,"lon":-71.052,"coops":"8443970","buoy":"44013"},
    {"name":"New York Harbor","state":"NY","lat":40.700,"lon":-74.014,"coops":"8518750","buoy":"44065"},
    {"name":"Atlantic City","state":"NJ","lat":39.355,"lon":-74.418,"coops":"8534720","buoy":"44091"},
    {"name":"Hampton Roads","state":"VA","lat":36.947,"lon":-76.330,"coops":"8638610","buoy":"44014"},
    {"name":"Outer Banks","state":"NC","lat":36.183,"lon":-75.747,"coops":"8651370","buoy":"41025"},
    {"name":"Charleston","state":"SC","lat":32.782,"lon":-79.925,"coops":"8665530","buoy":"41004"},
    {"name":"Northeast Florida","state":"FL","lat":30.398,"lon":-81.428,"coops":"8720218","buoy":"41009"},
]
COOPS_API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
NDBC_REALTIME = "https://www.ndbc.noaa.gov/data/realtime2/{station}.txt"

def utcnow_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z")

def fetch_bytes(url: str, timeout: int = TIMEOUT) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/geo+json, application/json, text/xml, application/xml, */*",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def fetch_json(url: str, timeout: int = TIMEOUT):
    return json.loads(fetch_bytes(url, timeout).decode("utf-8"))

def alert_event(feature):
    return str((feature.get("properties") or {}).get("event") or "Other")

def alert_type(feature):
    e = alert_event(feature).lower()
    if "warning" in e: return "warning"
    if "watch" in e: return "watch"
    if "advisory" in e: return "advisory"
    if "statement" in e: return "statement"
    return "other"

def severity_score(feature):
    p = feature.get("properties") or {}
    sev = {"Extreme":50,"Severe":40,"Moderate":30,"Minor":20,"Unknown":10}.get(p.get("severity"),10)
    event = alert_event(feature).lower()
    if "warning" in event: sev += 30
    elif "watch" in event: sev += 20
    elif "advisory" in event: sev += 10
    if any(k in event for k in ("hurricane","tornado","storm surge","blizzard","flash flood")): sev += 12
    return sev

def extract_states(feature):
    p = feature.get("properties") or {}
    found = set()
    geocode = p.get("geocode") or {}
    for code in geocode.get("UGC") or []:
        s = str(code)[:2]
        if s in STATE_CODES: found.add(s)
    if not found:
        area = str(p.get("areaDesc") or "")
        for code,name in EAST_STATES:
            if name in area: found.add(code)
        if "District of Columbia" in area: found.add("DC")
    return sorted(found)

def dedupe_features(features):
    out, seen = [], set()
    for f in features:
        p = f.get("properties") or {}
        key = f.get("id") or p.get("@id") or p.get("id") or (
            p.get("event"), p.get("headline"), p.get("sent"), p.get("areaDesc")
        )
        key = json.dumps(key, sort_keys=True, default=str)
        if key in seen: continue
        seen.add(key); out.append(f)
    return out

def summarize_alerts(features):
    by_state = defaultdict(list)
    event_counts = Counter()
    type_counts = Counter()
    for f in features:
        event_counts[alert_event(f)] += 1
        type_counts[alert_type(f)] += 1
        for s in extract_states(f): by_state[s].append(f)
    for s in by_state:
        by_state[s].sort(key=severity_score, reverse=True)
    top_states = sorted(
        ({"code":s,"count":len(v),"top_event":alert_event(v[0]),"score":severity_score(v[0])}
         for s,v in by_state.items()),
        key=lambda x:(x["score"],x["count"]), reverse=True
    )
    top_events = [{"event":k,"count":v} for k,v in event_counts.most_common(8)]
    most_urgent = max(features, key=severity_score, default=None)
    return {
        "active_alerts": len(features),
        "warnings": type_counts["warning"],
        "watches": type_counts["watch"],
        "advisories": type_counts["advisory"],
        "states_affected": len(by_state),
        "top_states": top_states[:6],
        "top_events": top_events,
        "most_urgent": compact_alert(most_urgent) if most_urgent else None,
        "state_counts": {k:len(v) for k,v in sorted(by_state.items())},
    }

def compact_alert(feature):
    if not feature: return None
    p = feature.get("properties") or {}
    return {
        "id": feature.get("id") or p.get("@id"),
        "event": p.get("event"),
        "severity": p.get("severity"),
        "urgency": p.get("urgency"),
        "certainty": p.get("certainty"),
        "headline": p.get("headline"),
        "areaDesc": p.get("areaDesc"),
        "onset": p.get("onset") or p.get("effective"),
        "ends": p.get("ends") or p.get("expires"),
        "senderName": p.get("senderName"),
        "states": extract_states(feature),
    }

def fetch_state_alerts(code):
    url = f"https://api.weather.gov/alerts/active?area={code}"
    data = fetch_json(url)
    return code, data.get("features") or []

def fetch_all_alerts():
    features, errors = [], {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futs = {pool.submit(fetch_state_alerts,code):code for code,_ in EAST_STATES}
        for fut in concurrent.futures.as_completed(futs):
            code = futs[fut]
            try:
                _, fs = fut.result(); features.extend(fs)
            except Exception as exc:
                errors[code] = str(exc)
    return dedupe_features(features), errors

def fetch_outlooks():
    result = {}
    errors = {}
    for prefix,label in (("ERO","excessive_rain"),("SWO","severe")):
        for day in (1,2,3):
            key = f"{label}_day{day}"
            url = f"{WPC_BASE}/{prefix}Day{day}.geojson"
            try:
                data = fetch_json(url)
                if data.get("type") != "FeatureCollection":
                    raise ValueError("not FeatureCollection")
                result[key] = data
            except Exception as exc:
                result[key] = {"type":"FeatureCollection","features":[]}
                errors[key] = str(exc)
    return result, errors

def fetch_tropical():
    try:
        data = fetch_json(NHC_CURRENT)
        storms = []
        for s in data.get("activeStorms") or []:
            if not str(s.get("id","")).lower().startswith("al"):
                continue
            storms.append({
                "id":s.get("id"),"name":s.get("name"),"classification":s.get("classification"),
                "intensity":s.get("intensity"),"pressure":s.get("pressure"),
                "lat":s.get("latitudeNumeric"),"lon":s.get("longitudeNumeric"),
                "movementDir":s.get("movementDir"),"movementSpeed":s.get("movementSpeed"),
                "lastUpdate":s.get("lastUpdate"),
                "advisoryUrl":(s.get("publicAdvisory") or {}).get("url"),
                "discussionUrl":(s.get("forecastDiscussion") or {}).get("url"),
                "graphicsUrl":(s.get("forecastGraphics") or {}).get("url"),
                "trackKmz":(s.get("forecastTrack") or {}).get("kmzFile"),
                "coneKmz":(s.get("trackCone") or {}).get("kmzFile"),
            })
        return storms, None
    except Exception as exc:
        return [], str(exc)

def parse_ndfd_times(xml_bytes, wanted=("ndfd.conus.qpf","ndfd.conus.wgust","ndfd.conus.waveh","ndfd.conus.pop12")):
    root = ET.fromstring(xml_bytes)
    out = {k:[] for k in wanted}
    for layer in root.iter():
        if not layer.tag.lower().endswith("layer"): continue
        name = None
        for ch in list(layer):
            if ch.tag.lower().endswith("name") and ch.text:
                name = ch.text.strip(); break
        if name not in out: continue
        vals = []
        for ch in layer.iter():
            tag = ch.tag.lower()
            attr_name = str(ch.attrib.get("name") or "").lower()
            if (tag.endswith("dimension") or tag.endswith("extent")) and attr_name == "vtit" and ch.text:
                text = ch.text.strip()
                # NDFD advertises comma-separated ISO valid times. Avoid intervals here.
                vals.extend(v.strip() for v in text.replace("\n","").split(",") if "T" in v)
        clean=[]
        for v in vals:
            if "/" in v: continue
            v=v.replace("Z","")
            if v not in clean: clean.append(v)
        out[name]=clean[:80]
    return out

def fetch_ndfd_times():
    try:
        return parse_ndfd_times(fetch_bytes(NDFD_CAPS, timeout=25)), None
    except Exception as exc:
        return {}, str(exc)


def _num(value):
    try:
        x = float(value)
        if not math.isfinite(x): return None
        return x
    except (TypeError, ValueError):
        return None

def _parse_coops_time(value):
    if not value: return None
    try:
        return dt.datetime.strptime(value, "%Y-%m-%d %H:%M").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None

def parse_ndbc_latest(text):
    """Parse the latest NDBC standard meteorological line and convert SI to public-facing units."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    header = next((ln for ln in lines if ln.startswith("#YY")), None)
    data_line = next((ln for ln in lines if not ln.startswith("#")), None)
    if not header or not data_line:
        raise ValueError("NDBC standard meteorological text missing header or observation")
    names = header.lstrip("#").split()
    vals = data_line.split()
    row = dict(zip(names, vals))
    def val(name):
        raw = row.get(name)
        return None if raw in (None, "MM", "999", "999.0") else _num(raw)
    year = int(row["YY"]); year += 2000 if year < 100 else 0
    observed = dt.datetime(
        year, int(row["MM"]), int(row["DD"]), int(row["hh"]), int(row["mm"]),
        tzinfo=dt.timezone.utc
    )
    wspd = val("WSPD"); gst = val("GST"); wvht = val("WVHT")
    return {
        "observed_at": observed.isoformat().replace("+00:00","Z"),
        "wind_dir_deg": val("WDIR"),
        "wind_kt": round(wspd * 1.94384, 1) if wspd is not None else None,
        "gust_kt": round(gst * 1.94384, 1) if gst is not None else None,
        "wave_ft": round(wvht * 3.28084, 1) if wvht is not None else None,
        "dominant_period_s": val("DPD"),
        "mean_wave_dir_deg": val("MWD"),
    }

def tide_departure(observation, predictions):
    """Return observed minus astronomical prediction in feet at the nearest forecast timestamp."""
    obs_t = _parse_coops_time(observation.get("t") if observation else None)
    obs_v = _num(observation.get("v") if observation else None)
    if obs_t is None or obs_v is None or not predictions:
        return None
    candidates = []
    for p in predictions:
        t = _parse_coops_time(p.get("t"))
        v = _num(p.get("v"))
        if t is not None and v is not None:
            candidates.append((abs((t-obs_t).total_seconds()), v))
    if not candidates: return None
    predicted = min(candidates, key=lambda x:x[0])[1]
    return round(obs_v - predicted, 2)

def next_high_tide(predictions, now=None):
    """Find the first future local maximum in 6-minute NOAA tide predictions."""
    now = now or dt.datetime.now(dt.timezone.utc)
    pts = []
    for p in predictions or []:
        t = _parse_coops_time(p.get("t")); v = _num(p.get("v"))
        if t is not None and v is not None:
            pts.append((t,v))
    pts.sort(key=lambda x:x[0])
    for i in range(1, len(pts)-1):
        t,v = pts[i]
        if t > now and v > pts[i-1][1] and v >= pts[i+1][1]:
            return {"time":t.isoformat().replace("+00:00","Z"),"ft":round(v,2)}
    future = [(t,v) for t,v in pts if t > now]
    if future:
        t,v=max(future,key=lambda x:x[1])
        return {"time":t.isoformat().replace("+00:00","Z"),"ft":round(v,2)}
    return None

def fetch_coastal_station(station):
    result = dict(station)
    result.update({
        "water_level_ft":None,"water_level_time":None,"departure_ft":None,
        "next_high_ft":None,"next_high_time":None,
        "wave_ft":None,"wind_kt":None,"gust_kt":None,"wave_period_s":None,
        "marine_time":None,"errors":[]
    })
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")
    common = (
        f"&station={station['coops']}&datum=MLLW&units=english&time_zone=gmt"
        f"&application=EastCast&format=json"
    )
    predictions = []
    try:
        obs = fetch_json(COOPS_API + "?product=water_level&date=latest" + common)
        row = (obs.get("data") or [None])[0]
        if row:
            result["water_level_ft"] = _num(row.get("v"))
            t = _parse_coops_time(row.get("t"))
            result["water_level_time"] = t.isoformat().replace("+00:00","Z") if t else None
    except Exception as exc:
        result["errors"].append("CO-OPS water level: "+str(exc))
    try:
        pred = fetch_json(
            COOPS_API + f"?product=predictions&begin_date={today}&range=48&interval=6" + common
        )
        predictions = pred.get("predictions") or []
        obs_for_delta = None
        if result["water_level_time"] and result["water_level_ft"] is not None:
            obs_for_delta = {
                "t": dt.datetime.fromisoformat(result["water_level_time"].replace("Z","+00:00")).strftime("%Y-%m-%d %H:%M"),
                "v": result["water_level_ft"],
            }
        result["departure_ft"] = tide_departure(obs_for_delta, predictions)
        high = next_high_tide(predictions)
        if high:
            result["next_high_ft"] = high["ft"]; result["next_high_time"] = high["time"]
    except Exception as exc:
        result["errors"].append("CO-OPS prediction: "+str(exc))
    try:
        raw = fetch_bytes(NDBC_REALTIME.format(station=station["buoy"])).decode("utf-8","replace")
        marine = parse_ndbc_latest(raw)
        result["wave_ft"] = marine["wave_ft"]
        result["wind_kt"] = marine["wind_kt"]
        result["gust_kt"] = marine["gust_kt"]
        result["wave_period_s"] = marine["dominant_period_s"]
        result["marine_time"] = marine["observed_at"]
    except Exception as exc:
        result["errors"].append("NDBC: "+str(exc))
    return result

def fetch_coastal_pulse():
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(fetch_coastal_station, s) for s in COASTAL_STATIONS]
        for fut in futures:
            try:
                rows.append(fut.result())
            except Exception as exc:
                rows.append({"name":"Unavailable station","errors":[str(exc)]})
    order = {s["name"]:i for i,s in enumerate(COASTAL_STATIONS)}
    rows.sort(key=lambda x:order.get(x.get("name"),999))
    usable = sum(
        1 for x in rows
        if any(x.get(k) is not None for k in ("water_level_ft","departure_ft","wave_ft","wind_kt"))
    )
    return rows, {"ok":usable >= max(4, len(COASTAL_STATIONS)//2), "usable":usable, "total":len(rows)}

def build_snapshot():
    generated = utcnow_iso()
    alerts, alert_errors = fetch_all_alerts()
    outlooks, outlook_errors = fetch_outlooks()
    tropical, tropical_error = fetch_tropical()
    ndfd_times, ndfd_error = fetch_ndfd_times()
    coastal_pulse, coastal_status = fetch_coastal_pulse()
    alerts.sort(key=severity_score, reverse=True)
    summary = summarize_alerts(alerts)
    state_features = defaultdict(list)
    for f in alerts:
        for s in extract_states(f): state_features[s].append(compact_alert(f))
    source_status = {
        "nws_alerts":{"ok":len(alerts)>0 or len(alert_errors)<len(EAST_STATES),"errors":alert_errors},
        "wpc_outlooks":{"ok":any(v.get("features") for v in outlooks.values()),"errors":outlook_errors},
        "nhc":{"ok":tropical_error is None,"error":tropical_error},
        "ndfd":{"ok":bool(ndfd_times),"error":ndfd_error},
        "coastal_pulse":coastal_status,
    }
    return {
        "schema_version":2,
        "generated_at":generated,
        "summary":summary,
        "alerts":{"type":"FeatureCollection","features":alerts},
        "state_alerts":dict(state_features),
        "outlooks":outlooks,
        "tropical":tropical,
        "ndfd_times":ndfd_times,
        "coastal_pulse":coastal_pulse,
        "webcams":WEBCAMS,
        "sources":source_status,
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--output",default="eastcast/data/snapshot.json")
    args=ap.parse_args()
    snapshot=build_snapshot()
    out=Path(args.output)
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(snapshot,separators=(",",":"),ensure_ascii=False),encoding="utf-8")
    print(f"EastCast snapshot: {snapshot['summary']['active_alerts']} alerts, {snapshot['summary']['warnings']} warnings, {len(snapshot['tropical'])} Atlantic tropical systems -> {out}")
    if not snapshot["sources"]["nws_alerts"]["ok"]:
        raise SystemExit("NWS alert aggregation failed")

if __name__=="__main__":
    main()
