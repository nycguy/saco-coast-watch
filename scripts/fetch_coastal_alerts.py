#!/usr/bin/env python3
"""Retrieve current NWS coastal-flood and storm-surge warning polygons."""
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request,urlopen
BASE="https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query"
EVENTS=("Storm Surge Watch","Storm Surge Warning","Coastal Flood Watch","Coastal Flood Warning","Coastal Flood Advisory")
OUT=Path(__file__).resolve().parents[1]/"data"/"coastal-alerts.json"
def fetch():
    params={"where":"prod_type IN ("+",".join("'"+s+"'" for s in EVENTS)+")","geometry":"-71.15,42.55,-69.35,44.25","geometryType":"esriGeometryEnvelope","inSR":"4326","spatialRel":"esriSpatialRelIntersects","outFields":"prod_type,url,expiration,onset,ends,issuance","returnGeometry":"true","outSR":"4326","f":"geojson","resultRecordCount":"250"}
    request=Request(BASE+"?"+urlencode(params),headers={"User-Agent":"SacoCoastWatch/1.0","Accept":"application/geo+json,application/json"})
    with urlopen(request,timeout=22) as response: doc=json.load(response)
    if doc.get("error"): raise RuntimeError(str(doc["error"]))
    if doc.get("type")!="FeatureCollection" or not isinstance(doc.get("features"),list): raise RuntimeError("Invalid NWS response")
    if doc.get("exceededTransferLimit"): raise RuntimeError("Truncated NWS response")
    return [f for f in doc["features"] if (f.get("properties") or {}).get("prod_type") in EVENTS and f.get("geometry")]
def main():
    now=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
    try: data={"generatedAt":now,"source":"NOAA/NWS active Watch-Warning-Advisory GIS","features":fetch(),"error":None}
    except Exception as exc: data={"generatedAt":now,"source":"NOAA/NWS active Watch-Warning-Advisory GIS","features":[],"error":"Official coastal alert polygons could not be retrieved: "+str(exc)[:250]}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data,separators=(",",":")),encoding="utf-8")
    print("Alerts:",len(data["features"]),"Error:",data["error"])
if __name__=="__main__": main()
