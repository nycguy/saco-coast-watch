#!/usr/bin/env python3
"""Retrieve latest NDBC standard meteorological reports for the public site."""
import datetime as dt
import json, math
from pathlib import Path
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
MPS_TO_MPH=2.2369362921
M_TO_FT=3.280839895

class MalformedFeedError(ValueError):
    """The upstream body does not match the documented NDBC text format."""

class NoWindObservation(ValueError):
    """The feed was readable but contained no usable current wind value."""

def number(value,low=0,high=900):
    try:
        x=float(value)
        return x if math.isfinite(x) and low<=x<high else None
    except (TypeError,ValueError):
        return None

def signed_number(value,low=-900,high=900):
    return number(value,low,high)

def fahrenheit(c):
    return round(c*9/5+32,1) if c is not None else None

def parse(raw, station):
    header=None
    latest=None; latest_wave=None
    data_rows=0; timestamp_rows=0; malformed_rows=0
    for line in raw.splitlines():
        fields=line.split()
        if not fields: continue
        if line.startswith("#"):
            cols=[v.lstrip("#") for v in fields]
            if all(x in cols for x in ("WSPD","WDIR","GST")): header=cols
            continue
        if not fields: continue
        data_rows+=1
        if not header:
            malformed_rows+=1
            continue
        if len(fields)<len(header):
            malformed_rows+=1
            continue
        row=dict(zip(header,fields))
        try:
            year=int(row.get("YY",row.get("YYYY")))
            if year<100: year+=2000
            timestamp=dt.datetime(year,int(row["MM"]),int(row["DD"]),int(row["hh"]),int(row["mm"]),tzinfo=dt.timezone.utc)
        except (TypeError,ValueError,KeyError):
            malformed_rows+=1
            continue
        timestamp_rows+=1
        speed=number(row.get("WSPD"),0,90)
        if speed is None: continue
        gust=number(row.get("GST"),0,90)
        direction=number(row.get("WDIR"),0,361)
        wave_m=number(row.get("WVHT"),0,40)
        dominant_period=number(row.get("DPD"),0,60)
        average_period=number(row.get("APD"),0,60)
        wave_direction=number(row.get("MWD"),0,361)
        pressure=number(row.get("PRES"),800,1100)
        pressure_tendency=signed_number(row.get("PTDY"),-50,50)
        water_temp_c=signed_number(row.get("WTMP"),-5,45)
        air_temp_c=signed_number(row.get("ATMP"),-80,60)
        parsed={
            "id":station,
            "observed_at":timestamp.isoformat().replace("+00:00","Z"),
            "speed_mph":round(speed*MPS_TO_MPH,1),
            "gust_mph":round(gust*MPS_TO_MPH,1) if gust is not None else None,
            "direction_deg":round(direction) if direction is not None else None,
            "wave_height_ft":round(wave_m*M_TO_FT,1) if wave_m is not None else None,
            "wave_height_supported":"WVHT" in header,
            "dominant_period_sec":round(dominant_period,1) if dominant_period is not None else None,
            "average_period_sec":round(average_period,1) if average_period is not None else None,
            "wave_direction_deg":round(wave_direction) if wave_direction is not None else None,
            "pressure_mb":round(pressure,1) if pressure is not None else None,
            "pressure_tendency_mb":round(pressure_tendency,1) if pressure_tendency is not None else None,
            "water_temp_f":fahrenheit(water_temp_c),
            "air_temp_f":fahrenheit(air_temp_c),
            "source":f"https://www.ndbc.noaa.gov/data/realtime2/{station}.txt",
        }
        if latest is None: latest=parsed
        if parsed["wave_height_ft"] is not None and latest_wave is None: latest_wave=parsed
        if latest is not None and latest_wave is not None: break
    if header is None:
        raise MalformedFeedError("NDBC response is missing the expected observation columns")
    if latest is None:
        if data_rows and (timestamp_rows == 0 or malformed_rows == data_rows):
            raise MalformedFeedError("NDBC rows do not match the expected observation format")
        raise NoWindObservation("NDBC feed contained no usable wind observation")
    if latest_wave:
        for field in ("wave_height_ft","wave_height_supported","dominant_period_sec","average_period_sec","wave_direction_deg"):
            latest[field]=latest_wave[field]
        latest["wave_observed_at"]=latest_wave["observed_at"]
    else:
        latest["wave_observed_at"]=None
    return latest

def main():
    result={"generated_at":dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00","Z"),"stations":{},"source_health":{}}
    for station in ("44007","WEXM1"):
        checked_at=dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00","Z")
        try:
            request=Request(f"https://www.ndbc.noaa.gov/data/realtime2/{station}.txt",headers={"User-Agent":"SacoCoastWatch/2.0 (public coastal dashboard)","Accept":"text/plain"})
            with urlopen(request,timeout=22) as response:
                raw=response.read(2200000).decode("utf-8",errors="replace")
            result["stations"][station]=parse(raw,station)
            result["source_health"][station]={"status":"available","checked_at":checked_at,"observed_at":result["stations"][station]["observed_at"],"error_type":None}
            print(f"{station}: {result['stations'][station]['observed_at']}")
        except NoWindObservation as exc:
            result["stations"][station]=None
            result["source_health"][station]={"status":"missing","checked_at":checked_at,"observed_at":None,"error_type":type(exc).__name__}
            print(f"{station}: no usable observation was reported")
        except MalformedFeedError as exc:
            result["stations"][station]=None
            result["source_health"][station]={"status":"malformed","checked_at":checked_at,"observed_at":None,"error_type":type(exc).__name__}
            print(f"{station}: response did not match expected NDBC format")
        except Exception as exc:
            result["stations"][station]=None
            result["source_health"][station]={"status":"unavailable","checked_at":checked_at,"observed_at":None,"error_type":type(exc).__name__}
            print(f"{station}: request unavailable ({type(exc).__name__})")
    output=ROOT/"data"/"wind.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")

if __name__=="__main__":
    main()
