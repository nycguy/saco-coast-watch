#!/usr/bin/env python3
"""Retrieve latest NDBC standard meteorological reports for public site."""
import datetime as dt
import json
from pathlib import Path
from urllib.request import Request, urlopen
ROOT=Path(__file__).resolve().parents[1]
def number(value):
    try:
        x=float(value)
        return x if 0<=x<900 else None
    except (TypeError,ValueError):
        return None
def parse(raw, station):
    header=None
    for line in raw.splitlines():
        fields=line.split()
        if not fields: continue
        if line.startswith("#"):
            cols=[v.lstrip("#") for v in fields]
            if all(x in cols for x in ("WSPD","WDIR","GST")): header=cols
            continue
        if not header or len(fields)<len(header): continue
        row=dict(zip(header,fields))
        try:
            year=int(row.get("YY",row.get("YYYY")))
            if year<100: year+=2000
            timestamp=dt.datetime(year,int(row["MM"]),int(row["DD"]),int(row["hh"]),int(row["mm"]),tzinfo=dt.timezone.utc)
        except (TypeError,ValueError,KeyError): continue
        speed=number(row.get("WSPD"))
        if speed is None: continue
        gust=number(row.get("GST")); direction=number(row.get("WDIR"))
        return {"id":station,"observed_at":timestamp.isoformat().replace("+00:00","Z"),"speed_mph":round(speed*2.2369362921,1),"gust_mph":round(gust*2.2369362921,1) if gust is not None else None,"direction_deg":round(direction) if direction is not None and direction<=360 else None,"source":f"https://www.ndbc.noaa.gov/data/realtime2/{station}.txt"}
    raise ValueError("No valid wind observations")
def main():
    result={"generated_at":dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00","Z"),"stations":{}}
    for station in ("44007","WEXM1"):
        try:
            request=Request(f"https://www.ndbc.noaa.gov/data/realtime2/{station}.txt",headers={"User-Agent":"SacoCoastWatch/1.0 (public weather dashboard)","Accept":"text/plain"})
            with urlopen(request,timeout=22) as response: raw=response.read(2200000).decode("utf-8",errors="replace")
            result["stations"][station]=parse(raw,station)
            print(f"{station}: {result['stations'][station]['observed_at']}")
        except Exception as exc:
            result["stations"][station]=None
            print(f"{station}: unavailable ({exc})")
    output=ROOT/"data"/"wind.json";output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
if __name__=="__main__": main()
