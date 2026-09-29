#!/usr/bin/env python3
"""Capture and persist authoritative coastal-history snapshots for Saco Coast Watch."""
from __future__ import annotations
import argparse, datetime as dt, email.utils, json, math, re, urllib.parse, urllib.request, xml.etree.ElementTree as ET
from pathlib import Path
import history_core as hc
import fetch_hazards as fh

UA="SacoCoastWatch/2.0 (public coastal dashboard; github.com/nycguy/saco-coast-watch)"
TIMEOUT=24
NOAA="https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
STATION="8418150"
POINT="43.48,-70.38"
NDBC=("44007","WEXM1")
LOCAL_TERMS=("saco","camp ellis","ferry beach","biddeford","biddeford pool","old orchard beach","scarborough")
RELEVANT_ALERT=("coastal","surf","rip current","storm surge","flood","wind","gale","storm","small craft","winter","blizzard","snow","ice","hurricane","tropical","freeze","cold","rain")
WEATHER_TOPIC_PATTERNS=(r"\bcoastal\b",r"\bsurf\b",r"\bwaves?\b",r"\bswells?\b",r"\bflood(?:ing|ed|s)?\b",r"\beros(?:ion|ive|ing)\b",r"\bwinds?\b",r"\bgust(?:s|ing|ed)?\b",r"\brain(?:fall|ing|ed|s)?\b",r"\bstorm(?:s|y)?\b",r"\btides?\b",r"\bocean\b",r"\bshore(?:line)?\b",r"\brip currents?\b",r"\bweather\b",r"\bmarine\b",r"\bseawalls?\b",r"\bdunes?\b",r"\binundat(?:ion|ed|ing)\b",r"\bsplash[- ]?over\b",r"\boverwash\b",r"\bhigh water\b",r"\brough seas?\b",r"\bsnow(?:fall|ing|ed|s)?\b",r"\bblizzard\b",r"\bhurricane\b",r"\btropical storm\b",r"\bfreezing rain\b",r"\bice storm\b")
ROOT=Path(__file__).resolve().parents[1]
SEED=ROOT/"data"/"briefing-seed-history.json"

def now_utc(): return dt.datetime.now(dt.timezone.utc)
def fetch_bytes(url,accept="*/*"):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":accept})
    with urllib.request.urlopen(req,timeout=TIMEOUT) as r: return r.read()
def fetch_json(url): return json.loads(fetch_bytes(url,"application/json, application/geo+json").decode("utf-8"))
def safe_json(url):
    try: return fetch_json(url)
    except Exception: return None
def num(v):
    try:
        x=float(v); return x if math.isfinite(x) else None
    except Exception: return None
def noaa_url(product,**extra):
    q={"station":STATION,"product":product,"datum":"MLLW","units":"english","time_zone":"gmt","format":"json","application":"SacoCoastWatchHistory"}; q.update(extra)
    return NOAA+"?"+urllib.parse.urlencode(q)
def parse_noaa_time(v):
    if not v: return None
    for fmt in ("%Y-%m-%d %H:%M","%Y-%m-%d %H:%M:%S"):
        try: return dt.datetime.strptime(v,fmt).replace(tzinfo=dt.timezone.utc)
        except ValueError: pass
    return None
def decode_noaa(data):
    rows=[]
    if isinstance(data,dict):
        for key in ("data","predictions","ofs_water_level","forecast"):
            if isinstance(data.get(key),list): rows=data[key]; break
    out=[]
    for r in rows:
        t=parse_noaa_time(r.get("t") or r.get("time")); v=num(r.get("v") if "v" in r else r.get("value"))
        if t and v is not None: out.append((t,v))
    return sorted(out)
def peak(rows,start,end):
    pts=[p for p in rows if start<=p[0]<=end]; return max(pts,key=lambda x:x[1]) if pts else None
def nearest(rows,target,max_minutes=15):
    if not rows or not target: return None
    p=min(rows,key=lambda x:abs((x[0]-target).total_seconds()))
    return p if abs((p[0]-target).total_seconds())<=max_minutes*60 else None

def parse_ndbc(raw,station):
    header=None; out=[]
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
            year=int(row.get("YY",row.get("YYYY"))); year=year+2000 if year<100 else year
            t=dt.datetime(year,int(row["MM"]),int(row["DD"]),int(row["hh"]),int(row["mm"]),tzinfo=dt.timezone.utc)
        except Exception: continue
        wspd=num(row.get("WSPD")); gust=num(row.get("GST")); direction=num(row.get("WDIR"))
        if wspd is None or not 0<=wspd<90: continue
        wave=num(row.get("WVHT")); dpd=num(row.get("DPD")); apd=num(row.get("APD")); mwd=num(row.get("MWD"))
        pres=num(row.get("PRES")); ptdy=num(row.get("PTDY")); wtmp=num(row.get("WTMP")); atmp=num(row.get("ATMP"))
        if ptdy is not None and not -50<ptdy<50: ptdy=None
        if wtmp is not None and not -5<wtmp<45: wtmp=None
        if atmp is not None and not -80<atmp<60: atmp=None
        out.append({
            "observed_at":hc.iso(t),
            "speed_mph":round(wspd*2.2369362921,1),
            "gust_mph":round(gust*2.2369362921,1) if gust is not None and 0<=gust<90 else None,
            "direction_deg":round(direction) if direction is not None and 0<=direction<=360 else None,
            "wave_height_ft":round(wave*3.280839895,1) if wave is not None and 0<=wave<40 else None,
            "dominant_period_sec":round(dpd,1) if dpd is not None and 0<=dpd<60 else None,
            "average_period_sec":round(apd,1) if apd is not None and 0<=apd<60 else None,
            "wave_direction_deg":round(mwd) if mwd is not None and 0<=mwd<=360 else None,
            "pressure_mb":round(pres,1) if pres is not None and 800<pres<1100 else None,
            "pressure_tendency_mb":round(ptdy,1) if ptdy is not None else None,
            "water_temp_f":round(wtmp*9/5+32,1) if wtmp is not None else None,
            "air_temp_f":round(atmp*9/5+32,1) if atmp is not None else None,
        })
    return sorted(out,key=lambda r:hc.parse_iso(r["observed_at"]))
def ndbc_rows(station):
    url=f"https://www.ndbc.noaa.gov/data/realtime2/{station}.txt"
    raw=fetch_bytes(url,"text/plain").decode("utf-8",errors="replace")
    return parse_ndbc(raw,station),url
def parse_speed(value):
    vals=[float(x) for x in re.findall(r"\d+(?:\.\d+)?",value or "")]
    return max(vals) if vals else None

def nws_hourly_forecast():
    point=fetch_json(f"https://api.weather.gov/points/{POINT}")
    url=((point.get("properties") or {}).get("forecastHourly"))
    if not url: return {"source":None,"periods":[]}
    data=fetch_json(url); out=[]
    for p in ((data.get("properties") or {}).get("periods") or [])[:72]:
        pop=((p.get("probabilityOfPrecipitation") or {}).get("value"))
        out.append({"start":p.get("startTime"),"temperature_f":p.get("temperature") if p.get("temperatureUnit")=="F" else None,"wind_mph":parse_speed(p.get("windSpeed")),"wind_direction":p.get("windDirection"),"precip_probability_pct":pop,"summary":p.get("shortForecast")})
    return {"source":url,"periods":out}
def summarize_forecast(doc,now):
    periods=[]
    for p in doc.get("periods") or []:
        t=hc.parse_iso(p.get("start"))
        if t and now<=t<=now+dt.timedelta(hours=72): periods.append(p)
    p24=[p for p in periods if hc.parse_iso(p["start"])<=now+dt.timedelta(hours=24)]
    def mx(rows,key):
        vals=[p.get(key) for p in rows if p.get(key) is not None]; return max(vals) if vals else None
    summaries=[]
    for p in p24:
        s=p.get("summary")
        if s and s not in summaries: summaries.append(s)
        if len(summaries)>=4: break
    return {"source":doc.get("source"),"next24_max_sustained_wind_mph":mx(p24,"wind_mph"),"next72_max_sustained_wind_mph":mx(periods,"wind_mph"),"next24_max_precip_probability_pct":mx(p24,"precip_probability_pct"),"next72_max_precip_probability_pct":mx(periods,"precip_probability_pct"),"next24_summaries":summaries}

def normalize_alert(f):
    p=f.get("properties") or f
    return {"id":f.get("id") or p.get("id") or p.get("@id"),"event":p.get("event"),"severity":p.get("severity"),"certainty":p.get("certainty"),"urgency":p.get("urgency"),"sent":p.get("sent"),"effective":p.get("effective"),"onset":p.get("onset"),"expires":p.get("expires"),"ends":p.get("ends"),"headline":p.get("headline"),"area":p.get("areaDesc"),"message_type":p.get("messageType"),"references":p.get("references")}
def alert_relevant(a): return any(k in (a.get("event") or "").lower() for k in RELEVANT_ALERT)
def active_alerts():
    d=safe_json(f"https://api.weather.gov/alerts/active?point={POINT}") or {}
    return [a for a in (normalize_alert(f) for f in d.get("features") or []) if alert_relevant(a)]
def historical_alerts(now,days=7):
    q=urllib.parse.urlencode({"point":POINT,"start":hc.iso(now-dt.timedelta(days=days)),"end":hc.iso(now),"limit":500})
    d=fetch_json("https://api.weather.gov/alerts?"+q)
    rows=[a for a in (normalize_alert(f) for f in d.get("features") or []) if alert_relevant(a)]
    rows.sort(key=lambda a:hc.parse_iso(a.get("sent") or a.get("effective")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc))
    return rows

def parse_rss_time(v):
    if not v: return None
    try:
        t=email.utils.parsedate_to_datetime(v); return (t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)).astimezone(dt.timezone.utc)
    except Exception: return None
def clean(v): return " ".join((v or "").replace("\n"," ").split())
def relevant_local(text): return any(x in (text or "").lower() for x in LOCAL_TERMS)
def coastal_topic(text):
    t=(text or "").lower()
    for loc in sorted(LOCAL_TERMS,key=len,reverse=True): t=t.replace(loc," ")
    return any(re.search(pattern,t) for pattern in WEATHER_TOPIC_PATTERNS)
def event_location(text):
    t=(text or "").lower()
    for name in ("Camp Ellis","Ferry Beach","Biddeford Pool","Old Orchard Beach","Scarborough","Biddeford","Saco"):
        if name.lower() in t: return name
    return "Saco Bay / York County Coast"
def event_category(text):
    t=(text or "").lower()
    for cat,words in (("flooding",("flood","inundat","water over")),("erosion",("erosion","dune","beach loss")),("surf",("surf","wave","rip current","swell")),("road impacts",("road","street","route","closure","closed")),("power",("power","outage")),("wind",("wind","gust")),("rain",("rain","precip"))):
        if any(w in t for w in words): return cat
    return "coastal conditions"
def google_news(days=7):
    q='(Saco OR Biddeford OR "Biddeford Pool" OR "Old Orchard Beach" OR Scarborough OR "Camp Ellis" OR "Ferry Beach") Maine (coastal OR surf OR flood OR flooding OR wind OR erosion OR storm OR tide OR waves OR rain OR weather OR marine OR overwash) when:%dd'%days
    url="https://news.google.com/rss/search?"+urllib.parse.urlencode({"q":q,"hl":"en-US","gl":"US","ceid":"US:en"})
    root=ET.fromstring(fetch_bytes(url,"application/rss+xml, application/xml, text/xml")); out=[]
    for item in root.findall(".//item"):
        title=clean(item.findtext("title")); link=clean(item.findtext("link")); pub=parse_rss_time(item.findtext("pubDate")); source=clean(item.findtext("source")) or "Google News"
        if not title or not link or not relevant_local(title) or not coastal_topic(title): continue
        out.append({"published_at":hc.iso(pub),"source":source,"source_type":"news","location":event_location(title),"headline":title,"summary":title,"url":link,"event_category":event_category(title),"anecdotal":False})
    return out[:40]
def reddit_events():
    q='"Saco" Maine OR "Camp Ellis" OR "Ferry Beach" Maine OR "Biddeford Pool" OR "Old Orchard Beach" Maine OR Scarborough Maine'
    url="https://www.reddit.com/search.rss?"+urllib.parse.urlencode({"q":q,"sort":"new","t":"week"})
    root=ET.fromstring(fetch_bytes(url,"application/atom+xml, application/xml, text/xml")); ns={"a":"http://www.w3.org/2005/Atom"}; out=[]
    for e in root.findall("a:entry",ns):
        title=clean(e.findtext("a:title",default="",namespaces=ns)); le=e.find("a:link",ns); link=(le.attrib.get("href") if le is not None else "") or ""; pub=hc.parse_iso(e.findtext("a:updated",default="",namespaces=ns))
        if not title or not link or not relevant_local(title) or not coastal_topic(title): continue
        out.append({"published_at":hc.iso(pub),"source":"Reddit","source_type":"community","location":event_location(title),"headline":title,"summary":title,"url":link,"event_category":event_category(title),"anecdotal":True,"verification_note":"Public community report; not an official observation."})
    return out[:30]

def _max_recent(rows,field):
    valid=[r for r in rows if r.get(field) is not None]
    if not valid: return (None,None)
    row=max(valid,key=lambda r:r[field])
    return row[field],row.get("observed_at")

def recent_coastal_signals(snapshot):
    state=(snapshot or {}).get("event_state") or ((snapshot or {}).get("hazards") or {}).get("event_state") or {}
    return list(state.get("recent_impacts") or [])

def event_transition(previous,current,now=None):
    now=now or now_utc()
    old=(previous or {}).get("event_state") or (((previous or {}).get("hazards") or {}).get("event_state") or {})
    new=(current or {}).get("event_state") or (((current or {}).get("hazards") or {}).get("event_state") or {})
    if not new: return None
    old_phase=old.get("phase") or "Unknown"; new_phase=new.get("phase") or "Unknown"; old_impact=((old.get("impact") or {}).get("label") or "Unknown"); new_impact=((new.get("impact") or {}).get("label") or "Unknown"); old_display=old.get("primary_display") or "Coastal Conditions"; new_display=new.get("primary_display") or "Coastal Conditions"
    if (old_phase,old_impact,old_display)==(new_phase,new_impact,new_display): return None
    return {"at":(current or {}).get("snapshot_at") or hc.iso(now),"type":"event_state_transition","from_phase":old_phase,"to_phase":new_phase,"from_impact":old_impact,"to_impact":new_impact,"from_display":old_display,"to_display":new_display}

def merge_event_transitions(existing, additions, limit=500):
    rows=[]; seen=set()
    for item in list(existing or [])+list(additions or []):
        key=(item.get("at"),item.get("from_phase"),item.get("to_phase"),item.get("from_impact"),item.get("to_impact"),item.get("to_display"))
        if key in seen: continue
        seen.add(key); rows.append(item)
    rows.sort(key=lambda item:hc.parse_iso(item.get("at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc))
    return rows[-limit:]

def current_snapshot(now=None):
    now=now or now_utc()
    obs=decode_noaa(safe_json(noaa_url("water_level",begin_date=(now-dt.timedelta(days=2)).strftime("%Y%m%d"),end_date=now.strftime("%Y%m%d"))) or {})
    latest=max(obs,key=lambda x:x[0]) if obs else None; obs24=peak(obs,now-dt.timedelta(hours=24),now)
    model=decode_noaa(safe_json(noaa_url("ofs_water_level",begin_date=(now-dt.timedelta(days=1)).strftime("%Y%m%d"),end_date=(now+dt.timedelta(days=4)).strftime("%Y%m%d"))) or {})
    p24=peak(model,now-dt.timedelta(minutes=10),now+dt.timedelta(hours=24)); p72=peak(model,now-dt.timedelta(minutes=10),now+dt.timedelta(hours=72))
    preds=decode_noaa(safe_json(noaa_url("predictions",begin_date=(now-dt.timedelta(days=2)).strftime("%Y%m%d"),end_date=(now+dt.timedelta(days=4)).strftime("%Y%m%d"),interval="6")) or {})
    astro=nearest(preds,p72[0],15) if p72 else None
    residuals=[]
    for ot,ov in obs:
        tide=nearest(preds,ot,15)
        if tide: residuals.append((ot,ov-tide[1]))
    residual_latest=nearest(residuals,latest[0],15) if latest else None
    residual24=peak(residuals,now-dt.timedelta(hours=24),now)
    alerts=active_alerts(); marine={}
    for station in NDBC:
        try:
            rows,url=ndbc_rows(station); recent=[r for r in rows if (hc.parse_iso(r["observed_at"]) or now)>=now-dt.timedelta(hours=24)]; last=rows[-1] if rows else None
            if last:
                max_speed,max_speed_at=_max_recent(recent,"speed_mph")
                max_gust,max_gust_at=_max_recent(recent,"gust_mph")
                max_wave,max_wave_at=_max_recent(recent,"wave_height_ft")
                marine[station]={**last,"source":url,"max_24h_speed_mph":max_speed,"max_24h_speed_at":max_speed_at,"max_24h_gust_mph":max_gust,"max_24h_gust_at":max_gust_at,"max_24h_wave_height_ft":max_wave,"max_24h_wave_at":max_wave_at}
            else: marine[station]=None
        except Exception as exc: marine[station]={"error":str(exc)[:200]}
    try: forecast=summarize_forecast(nws_hourly_forecast(),now)
    except Exception as exc: forecast={"source":None,"error":str(exc)[:200]}
    try: hazards=fh.build_snapshot(now)
    except Exception as exc: hazards={"schema_version":1,"generated_at":hc.iso(now),"active_modes":[],"error":str(exc)[:220]}
    p72ft=round(p72[1],2) if p72 else None; astroft=round(astro[1],2) if astro else None
    snapshot={"snapshot_at":hc.iso(now),"snapshot_kind":"realtime","provenance":{"forecast":"live_noaa_ofs_capture","observations":"NOAA CO-OPS station 8418150","astronomical_tide":"NOAA CO-OPS predictions","marine":"NDBC realtime2","alerts":"NWS API active alerts","weather_forecast":"NWS hourly point forecast","hazards":"NWS forecast grid + Surf Zone Forecast + marine alerts + NHC CurrentStorms and GIS products"},"water":{"station":STATION,"latest_observed_ft":round(latest[1],2) if latest else None,"latest_observed_at":hc.iso(latest[0]) if latest else None,"observed_24h_max_ft":round(obs24[1],2) if obs24 else None,"observed_24h_max_time":hc.iso(obs24[0]) if obs24 else None,"residual_current_ft":round(residual_latest[1],2) if residual_latest else None,"residual_current_at":hc.iso(residual_latest[0]) if residual_latest else None,"residual_24h_max_ft":round(residual24[1],2) if residual24 else None,"residual_24h_max_time":hc.iso(residual24[0]) if residual24 else None,"forecast_peak_24h_ft":round(p24[1],2) if p24 else None,"forecast_peak_24h_time":hc.iso(p24[0]) if p24 else None,"forecast_peak_72h_ft":p72ft,"forecast_peak_72h_time":hc.iso(p72[0]) if p72 else None,"astronomical_tide_at_peak_ft":astroft,"model_uplift_ft":round(p72ft-astroft,2) if p72ft is not None and astroft is not None else None,"threshold_margins_ft":hc.threshold_margins(p72ft)},"forecast_conditions":forecast,"hazards":hazards,"marine":{"stations":marine},"alerts":alerts}
    event_state=fh.derive_event_state(hazards,water=snapshot["water"],marine=snapshot["marine"],alerts=alerts,now=now); hazards["event_state"]=event_state; hazards["severity"]=event_state["impact"]; hazards["active_modes"]=event_state["active_hazards"]; snapshot["event_state"]=event_state
    return snapshot

def hourly_sample(rows,start,end):
    by={}
    for t,v in rows:
        if not start<=t<=end: continue
        b=t.replace(minute=0,second=0,microsecond=0); old=by.get(b)
        if old is None or abs((t-b-dt.timedelta(minutes=30)).total_seconds())<abs((old[0]-b-dt.timedelta(minutes=30)).total_seconds()): by[b]=(t,v)
    return [{"observed_at":hc.iso(t),"water_level_ft":round(v,3)} for _,(t,v) in sorted(by.items())]
def daily_peaks(rows):
    days={}
    for t,v in rows:
        key=t.date().isoformat(); old=days.get(key)
        if old is None or v>old[1]: days[key]=(t,v)
    return [{"date":k,"peak_ft":round(v,3),"peak_time":hc.iso(t)} for k,(t,v) in sorted(days.items())]
def ndbc_backfill(rows,start,end):
    filt=[r for r in rows if start<=hc.parse_iso(r["observed_at"])<=end]; by={}
    for r in filt:
        t=hc.parse_iso(r["observed_at"]); by[t.replace(minute=0,second=0,microsecond=0)]=r
    hourly=[by[k] for k in sorted(by)]; days={}
    for r in filt:
        k=hc.parse_iso(r["observed_at"]).date().isoformat(); d=days.setdefault(k,{"date":k,"max_speed_mph":None,"max_gust_mph":None})
        d["max_speed_mph"]=max(x for x in (d["max_speed_mph"],r.get("speed_mph")) if x is not None)
        vals=[x for x in (d["max_gust_mph"],r.get("gust_mph")) if x is not None]; d["max_gust_mph"]=max(vals) if vals else None
    return hourly,[days[k] for k in sorted(days)]
def seed_snapshots():
    try: d=json.loads(SEED.read_text(encoding="utf-8"))
    except Exception: return []
    out=[]
    for r in d.get("forecast_snapshots") or []:
        ft=r.get("model_peak_ft")
        out.append({"snapshot_at":r.get("generated_at"),"snapshot_kind":"reconstructed_dashboard_snapshot","provenance":{"forecast":"reconstructed_dashboard_snapshot","note":"Recovered from a Saco Coast Watch dashboard capture; not a NOAA forecast archive record."},"water":{"forecast_peak_72h_ft":ft,"forecast_peak_72h_time":r.get("model_peak_time"),"threshold_margins_ft":hc.threshold_margins(ft)},"alerts":[{"event":e} for e in r.get("alerts") or []],"confidence":r.get("confidence")})
    return out
def initial_backfill(now,days=7):
    start=now-dt.timedelta(days=days); out={"period_start":hc.iso(start),"period_end":hc.iso(now),"water_observations_hourly":[],"water_observed_daily_peaks":[],"marine_hourly":{},"marine_daily":{},"nws_alert_products":[],"attempts":{}}
    try:
        rows=decode_noaa(fetch_json(noaa_url("water_level",begin_date=start.strftime("%Y%m%d"),end_date=now.strftime("%Y%m%d"))))
        out["water_observations_hourly"]=hourly_sample(rows,start,now); out["water_observed_daily_peaks"]=daily_peaks(rows); out["attempts"]["water"]="success"
    except Exception as exc: out["attempts"]["water"]="unavailable: "+str(exc)[:180]
    for station in NDBC:
        try:
            rows,_=ndbc_rows(station); hourly,daily=ndbc_backfill(rows,start,now); out["marine_hourly"][station]=hourly; out["marine_daily"][station]=daily; out["attempts"]["marine_"+station]="success"
        except Exception as exc: out["attempts"]["marine_"+station]="unavailable: "+str(exc)[:180]
    try: out["nws_alert_products"]=historical_alerts(now,days); out["attempts"]["nws_alerts"]="success"
    except Exception as exc: out["attempts"]["nws_alerts"]="unavailable: "+str(exc)[:180]
    return out

def load(path):
    try: return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception: return {}
def model_rows(doc): return (doc or {}).get("forecast_snapshots") or []
def update_history(path,model_backfill=None,now=None):
    now=now or now_utc(); existing=load(path); first=not existing
    current=current_snapshot(now); additions=[]
    if first: additions.extend(seed_snapshots())
    model_doc=load(model_backfill) if model_backfill else {}
    if model_doc: additions.extend(model_rows(model_doc))
    additions.append(current)
    snapshots=hc.merge_snapshots(existing.get("snapshots") or [],additions,now,30)
    previous=[s for s in snapshots if hc.parse_iso(s.get("snapshot_at")) and hc.parse_iso(s["snapshot_at"])<hc.parse_iso(current["snapshot_at"])]
    prev=previous[-1] if previous else None
    alert_changes=hc.diff_alerts((prev or {}).get("alerts") or [],current.get("alerts") or [],now) if prev else []
    for e in alert_changes: e["source"]="NWS snapshot comparison"; e["source_type"]="official_alert"
    transition=event_transition(prev,current,now); event_events=merge_event_transitions(existing.get("event_events") or [],[transition] if transition else [])
    local=[]
    try: local.extend(google_news(7))
    except Exception: pass
    try: local.extend(reddit_events())
    except Exception: pass
    backfill=existing.get("backfill") or initial_backfill(now,7)
    historical_alert_changes=hc.alert_events_from_products(backfill.get("nws_alert_products") or [])
    alert_changes=hc.merge_events(historical_alert_changes,alert_changes)
    if model_doc:
        backfill["model_archive"]={"attempted_at":model_doc.get("attempted_at"),"period_start":model_doc.get("period_start"),"period_end":model_doc.get("period_end"),"source":model_doc.get("source"),"summary":model_doc.get("summary"),"errors":model_doc.get("errors") or []}
    local=hc.merge_events(existing.get("local_events") or [],local)
    local=[e for e in local if coastal_topic((e.get("headline") or "")+" "+(e.get("summary") or ""))]
    hist={"schema_version":2,"generated_at":hc.iso(now),"window_basis":"Fixed rolling windows; never based on a visitor's last app visit.","station":STATION,"thresholds_ft_mllw":hc.THRESHOLDS_FT_MLLW,"retention":{"detailed_snapshots_days":30,"older_history":"daily_rollups"},"snapshots":snapshots,"daily_rollups":hc.daily_rollups(snapshots,existing.get("daily_rollups") or []),"alert_events":hc.merge_events(existing.get("alert_events") or [],alert_changes),"event_events":event_events,"local_events":local,"backfill":backfill,"provenance_notes":{"realtime":"Snapshots are captures of official source data at the listed snapshot time.","model_archive":"Only run-specific archived GoMOFS forecasts are eligible for historical forecast comparisons.","reconstructed_dashboard_snapshot":"Dashboard-capture reconstructions are marked explicitly and are not treated as an official NOAA forecast archive.","observations":"Historical observations describe what happened, not what a model forecast beforehand.","community":"Reddit and other community reports are anecdotal unless independently verified.","facebook":"Public Facebook coverage is not assumed comprehensive; inaccessible or unindexed posts are not fabricated."}}
    Path(path).parent.mkdir(parents=True,exist_ok=True); Path(path).write_text(json.dumps(hist,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    return hist
def compact_history(hist,days=7):
    now=hc.parse_iso(hist.get("generated_at")) or now_utc(); cutoff=now-dt.timedelta(days=days)
    snaps=[s for s in hist.get("snapshots") or [] if (hc.parse_iso(s.get("snapshot_at")) or now)>=cutoff]
    events=[e for e in hist.get("local_events") or [] if not (hc.parse_iso(e.get("published_at")) and hc.parse_iso(e.get("published_at"))<cutoff)]
    alerts=[e for e in hist.get("alert_events") or [] if not (hc.parse_iso(e.get("at")) and hc.parse_iso(e.get("at"))<cutoff)]
    return {"schema_version":2,"generated_at":hist.get("generated_at"),"window_basis":hist.get("window_basis"),"station":hist.get("station"),"thresholds_ft_mllw":hist.get("thresholds_ft_mllw"),"snapshots":snaps,"daily_rollups":[r for r in hist.get("daily_rollups") or [] if r.get("date","")>=cutoff.date().isoformat()],"alert_events":alerts,"event_events":[e for e in hist.get("event_events") or [] if not (hc.parse_iso(e.get("at")) and hc.parse_iso(e.get("at"))<cutoff)],"local_events":events,"backfill":hist.get("backfill"),"provenance_notes":hist.get("provenance_notes")}
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--history",required=True); ap.add_argument("--model-backfill"); ap.add_argument("--recent-output"); args=ap.parse_args()
    hist=update_history(args.history,args.model_backfill)
    if args.recent_output:
        p=Path(args.recent_output); p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(compact_history(hist),indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps({"generated_at":hist["generated_at"],"snapshots":len(hist["snapshots"]),"alert_events":len(hist["alert_events"]),"local_events":len(hist["local_events"]),"backfill_attempts":hist["backfill"].get("attempts")},indent=2))
if __name__=="__main__": main()
