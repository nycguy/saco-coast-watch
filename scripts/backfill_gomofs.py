#!/usr/bin/env python3
"""Reconstruct run-specific historical GoMOFS station forecasts for Portland.

This reads NOAA CO-OPS archived station forecast NetCDF files. It never substitutes
later observations for historical model guidance. GoMOFS zeta is converted to MLLW
using Portland's published MSL-to-MLLW datum offset, consistent with NOAA's OFS FAQ.
"""
from __future__ import annotations
import argparse, datetime as dt, json, math, urllib.parse, urllib.request
from pathlib import Path
import history_core as hc

UA="SacoCoastWatch/2.0 (historical NOAA GoMOFS archive reader)"
STATION="8418150"; LAT=43.65806; LON=-70.24417
DODS="https://opendap.co-ops.nos.noaa.gov/thredds/dodsC/NOAA/GOMOFS/MODELS/{y}/{m}/{d}/gomofs.t{cycle:02d}z.{ymd}.stations.forecast.nc"
NOAA="https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
MDAPI=f"https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{STATION}/datums.json?units=english"
CYCLES=(0,6,12,18)

def fetch_json(url):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=30) as r: return json.load(r)
def datum_offset_ft():
    d=fetch_json(MDAPI); vals={}
    for x in d.get("datums") or []:
        name=(x.get("name") or x.get("datum") or "").upper()
        try: vals[name]=float(x.get("value"))
        except Exception: pass
    if "MSL" not in vals or "MLLW" not in vals: raise RuntimeError("Portland MSL/MLLW datums unavailable")
    return vals["MSL"]-vals["MLLW"]
def noaa_predictions(start,end):
    q={"station":STATION,"product":"predictions","datum":"MLLW","units":"english","time_zone":"gmt","format":"json","application":"SacoCoastWatchHistory","interval":"6","begin_date":start.strftime("%Y%m%d"),"end_date":end.strftime("%Y%m%d")}
    d=fetch_json(NOAA+"?"+urllib.parse.urlencode(q)); out=[]
    for r in d.get("predictions") or []:
        try:
            t=dt.datetime.strptime(r["t"],"%Y-%m-%d %H:%M").replace(tzinfo=dt.timezone.utc); out.append((t,float(r["v"])))
        except Exception: pass
    return out
def nearest(rows,target,max_minutes=15):
    if not rows: return None
    p=min(rows,key=lambda x:abs((x[0]-target).total_seconds()))
    return p if abs((p[0]-target).total_seconds())<=max_minutes*60 else None
def _coord_var(ds,names):
    for n in names:
        if n in ds.variables and getattr(ds.variables[n],"ndim",0)==1: return ds.variables[n]
    return None
def _time_var(ds,zeta):
    for n in zeta.dimensions:
        if "time" in n.lower() and n in ds.variables: return ds.variables[n],n
    for n in ("ocean_time","time"):
        if n in ds.variables: return ds.variables[n],n
    raise RuntimeError("No station forecast time variable")
def _as_float(v):
    try:
        x=float(v); return x if math.isfinite(x) else None
    except Exception: return None

def read_cycle(url,cycle_at,offset_ft,predictions):
    import numpy as np
    from netCDF4 import Dataset,num2date
    ds=Dataset(url)
    try:
        z=ds.variables.get("zeta")
        if z is None: raise RuntimeError("zeta variable missing")
        lonv=_coord_var(ds,("lon","longitude","station_lon","lon_station","Xpos","xpos")); latv=_coord_var(ds,("lat","latitude","station_lat","lat_station","Ypos","ypos"))
        if lonv is None or latv is None: raise RuntimeError("station lon/lat variables missing; variables=" + ",".join(ds.variables.keys()))
        lons=np.asarray(lonv[:],dtype=float).reshape(-1); lats=np.asarray(latv[:],dtype=float).reshape(-1)
        if len(lons)!=len(lats): raise RuntimeError("station coordinate lengths differ")
        idx=int(np.nanargmin((lats-LAT)**2+((lons-LON)*math.cos(math.radians(LAT)))**2))
        distance=((lats[idx]-LAT)**2+((lons[idx]-LON)*math.cos(math.radians(LAT)))**2)**0.5
        if distance>0.2: raise RuntimeError(f"nearest GoMOFS station is too far away ({distance:.3f} degrees)")
        tv,tdim=_time_var(ds,z)
        times=num2date(tv[:],units=tv.units,calendar=getattr(tv,"calendar","standard"),only_use_cftime_datetimes=False,only_use_python_datetimes=True)
        station_dim=None
        for dim in z.dimensions:
            if dim!=tdim and ds.dimensions[dim].size==len(lons): station_dim=dim; break
        if station_dim is None: raise RuntimeError("unable to identify station dimension for zeta")
        ti=z.dimensions.index(tdim); si=z.dimensions.index(station_dim)
        if z.ndim!=2: raise RuntimeError(f"unexpected zeta dimensions: {z.dimensions}")
        vals=np.asarray(z[:,idx] if (ti,si)==(0,1) else z[idx,:],dtype=float).reshape(-1)
        units=(getattr(z,"units","") or "").lower(); factor=3.280839895 if ("meter" in units or units in ("m","meters")) else 1.0
        rows=[]
        for t,v in zip(times,vals):
            if not isinstance(t,dt.datetime): t=dt.datetime(t.year,t.month,t.day,t.hour,t.minute,t.second,tzinfo=dt.timezone.utc)
            elif t.tzinfo is None: t=t.replace(tzinfo=dt.timezone.utc)
            else: t=t.astimezone(dt.timezone.utc)
            x=_as_float(v)
            if x is not None: rows.append((t,x*factor+offset_ft))
        f72=[p for p in rows if cycle_at<=p[0]<=cycle_at+dt.timedelta(hours=72)]
        f24=[p for p in f72 if p[0]<=cycle_at+dt.timedelta(hours=24)]
        if not f72: raise RuntimeError("no forecast values in cycle window")
        p72=max(f72,key=lambda p:p[1]); p24=max(f24,key=lambda p:p[1]) if f24 else None; astro=nearest(predictions,p72[0])
        ft=round(p72[1],2); astroft=round(astro[1],2) if astro else None
        return {"snapshot_at":hc.iso(cycle_at),"snapshot_kind":"backfill_model_cycle","model_cycle_at":hc.iso(cycle_at),"provenance":{"forecast":"NOAA CO-OPS archived GoMOFS station forecast NetCDF","archive_url":url,"datum_conversion":"GoMOFS zeta converted from model MSL reference to MLLW with Portland MSL-to-MLLW datum offset.","station_selection":{"target_station":STATION,"target_lat":LAT,"target_lon":LON,"model_station_lat":round(float(lats[idx]),6),"model_station_lon":round(float(lons[idx]),6)}},"water":{"forecast_peak_24h_ft":round(p24[1],2) if p24 else None,"forecast_peak_24h_time":hc.iso(p24[0]) if p24 else None,"forecast_peak_72h_ft":ft,"forecast_peak_72h_time":hc.iso(p72[0]),"astronomical_tide_at_peak_ft":astroft,"model_uplift_ft":round(ft-astroft,2) if astroft is not None else None,"threshold_margins_ft":hc.threshold_margins(ft)}}
    finally:
        ds.close()

def cycle_times(now,days):
    start=(now-dt.timedelta(days=days)).replace(minute=0,second=0,microsecond=0); day=start.date(); out=[]
    while day<=now.date():
        for h in CYCLES:
            t=dt.datetime(day.year,day.month,day.day,h,tzinfo=dt.timezone.utc)
            if start<=t<=now: out.append(t)
        day+=dt.timedelta(days=1)
    return out
def build(days=7,now=None):
    now=now or dt.datetime.now(dt.timezone.utc); cycles=cycle_times(now,days); errors=[]; snaps=[]
    offset=datum_offset_ft(); preds=noaa_predictions(now-dt.timedelta(days=days+1),now+dt.timedelta(days=4))
    for c in cycles:
        ymd=c.strftime("%Y%m%d"); url=DODS.format(y=c.strftime("%Y"),m=c.strftime("%m"),d=c.strftime("%d"),cycle=c.hour,ymd=ymd)
        try:
            snaps.append(read_cycle(url,c,offset,preds)); print("OK",hc.iso(c),snaps[-1]["water"]["forecast_peak_72h_ft"])
        except Exception as exc:
            errors.append({"model_cycle_at":hc.iso(c),"url":url,"error":str(exc)[:300]}); print("MISS",hc.iso(c),str(exc)[:160])
    return {"schema_version":1,"attempted_at":hc.iso(now),"period_start":hc.iso(now-dt.timedelta(days=days)),"period_end":hc.iso(now),"source":"NOAA CO-OPS GoMOFS run-specific station forecast archive","datum_offset_ft_msl_to_mllw":round(offset,4),"forecast_snapshots":snaps,"errors":errors,"summary":{"cycles_attempted":len(cycles),"cycles_reconstructed":len(snaps),"cycles_unavailable":len(errors)}}
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--days",type=int,default=7); ap.add_argument("--output",required=True); args=ap.parse_args()
    now=dt.datetime.now(dt.timezone.utc)
    try:
        d=build(args.days,now)
    except Exception as exc:
        d={"schema_version":1,"attempted_at":hc.iso(now),"period_start":hc.iso(now-dt.timedelta(days=args.days)),"period_end":hc.iso(now),"source":"NOAA CO-OPS GoMOFS run-specific station forecast archive","forecast_snapshots":[],"errors":[{"error":"archive backfill failed before cycle retrieval: "+str(exc)[:500]}],"summary":{"cycles_attempted":0,"cycles_reconstructed":0,"cycles_unavailable":0,"status":"unavailable"}}
    p=Path(args.output); p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(d,indent=2)+"\n",encoding="utf-8"); print(json.dumps(d.get("summary")))
if __name__=="__main__": main()
