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

def build_snapshot():
    generated = utcnow_iso()
    alerts, alert_errors = fetch_all_alerts()
    outlooks, outlook_errors = fetch_outlooks()
    tropical, tropical_error = fetch_tropical()
    ndfd_times, ndfd_error = fetch_ndfd_times()
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
