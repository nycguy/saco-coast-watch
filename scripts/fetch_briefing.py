#!/usr/bin/env python3
"""Build a fixed-window Saco Coast Watch coastal briefing.

The briefing never depends on a visitor's last app visit. It uses:
- rolling past 24 hours of observed Portland gauge data,
- current NOAA OFS guidance for the next 24/72 hours,
- a stored public snapshot history to compare today's forecast with ~24 hours ago,
- current NWS coastal alerts,
- public local-news and Reddit search feeds refreshed at most every 3 hours.

Facebook is intentionally not scraped because public indexing/access is unreliable.
"""
from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import json
import math
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

UA="SacoCoastWatch/1.0 (public coastal dashboard; github.com/nycguy/saco-coast-watch)"
TIMEOUT=18
NOAA="https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
STATION="8418150"
PUBLISHED="https://nycguy.github.io/saco-coast-watch/data/coastal-briefing.json"
POINT="43.48,-70.38"
MINOR=12.0
LOCAL_TERMS=("saco","biddeford","old orchard","scarborough","camp ellis","ferry beach")

def now_utc():
    return dt.datetime.now(dt.timezone.utc)

def iso(t):
    return t.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z")

def parse_iso(v):
    if not v: return None
    try: return dt.datetime.fromisoformat(str(v).replace("Z","+00:00")).astimezone(dt.timezone.utc)
    except Exception: return None

def fetch_bytes(url, accept="*/*"):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":accept})
    with urllib.request.urlopen(req,timeout=TIMEOUT) as r:
        return r.read()

def fetch_json(url):
    return json.loads(fetch_bytes(url,"application/json, application/geo+json").decode("utf-8"))

def safe_json(url):
    try: return fetch_json(url)
    except Exception: return None

def num(v):
    try:
        x=float(v)
        return x if math.isfinite(x) else None
    except Exception: return None

def noaa_url(product, **extra):
    q={"station":STATION,"product":product,"datum":"MLLW","units":"english","time_zone":"gmt",
       "format":"json","application":"SacoCoastWatchBriefing"}
    q.update(extra)
    return NOAA+"?"+urllib.parse.urlencode(q)

def parse_noaa_time(v):
    if not v: return None
    try:
        return dt.datetime.strptime(v,"%Y-%m-%d %H:%M").replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None

def decode_rows(data):
    rows=[]
    if isinstance(data,dict):
        for key in ("data","predictions","ofs_water_level","forecast"):
            if isinstance(data.get(key),list):
                rows=data[key]; break
    out=[]
    for r in rows:
        t=parse_noaa_time(r.get("t") or r.get("time"))
        v=num(r.get("v") if "v" in r else r.get("value"))
        if t and v is not None: out.append((t,v))
    return sorted(out)

def peak(rows, start, end):
    pts=[p for p in rows if start <= p[0] <= end]
    return max(pts,key=lambda x:x[1]) if pts else None

def fmt_ft(v):
    return f"{v:.2f}" if v is not None else "—"

def fmt_et(t):
    if not t: return "time unavailable"
    try:
        from zoneinfo import ZoneInfo
        z=t.astimezone(ZoneInfo("America/New_York"))
        return z.strftime("%a, %b %-d at %-I:%M %p ET")
    except Exception:
        return t.strftime("%a, %b %d at %I:%M %p UTC")

def parse_rss_time(v):
    if not v: return None
    try:
        t=email.utils.parsedate_to_datetime(v)
        if t.tzinfo is None: t=t.replace(tzinfo=dt.timezone.utc)
        return t.astimezone(dt.timezone.utc)
    except Exception: return None

def clean_title(v):
    return " ".join((v or "").replace("\n"," ").split())

def relevant(text):
    t=(text or "").lower()
    return any(term in t for term in LOCAL_TERMS)

def google_news():
    query='(Saco OR Biddeford OR "Old Orchard Beach" OR Scarborough OR "Camp Ellis" OR "Ferry Beach") Maine coastal when:1d'
    url="https://news.google.com/rss/search?"+urllib.parse.urlencode({
        "q":query,"hl":"en-US","gl":"US","ceid":"US:en"
    })
    root=ET.fromstring(fetch_bytes(url,"application/rss+xml, application/xml, text/xml"))
    out=[]
    cutoff=now_utc()-dt.timedelta(hours=30)
    for item in root.findall(".//item"):
        title=clean_title(item.findtext("title"))
        link=clean_title(item.findtext("link"))
        pub=parse_rss_time(item.findtext("pubDate"))
        source=clean_title(item.findtext("source")) or "Google News"
        if not title or not link or (pub and pub<cutoff): continue
        if not relevant(title): continue
        out.append({"type":"news","source":source,"title":title,"url":link,"published_at":iso(pub) if pub else None})
        if len(out)>=8: break
    return out

def reddit_feed():
    q='"Saco" Maine OR Biddeford Maine OR "Old Orchard Beach" Maine OR "Camp Ellis" OR "Ferry Beach" Maine'
    url="https://www.reddit.com/search.rss?"+urllib.parse.urlencode({"q":q,"sort":"new","t":"day"})
    root=ET.fromstring(fetch_bytes(url,"application/atom+xml, application/xml, text/xml"))
    ns={"a":"http://www.w3.org/2005/Atom"}
    out=[]
    cutoff=now_utc()-dt.timedelta(hours=30)
    for e in root.findall("a:entry",ns):
        title=clean_title(e.findtext("a:title",default="",namespaces=ns))
        link_el=e.find("a:link",ns)
        link=(link_el.attrib.get("href") if link_el is not None else "") or ""
        pub_txt=e.findtext("a:updated",default="",namespaces=ns)
        pub=parse_iso(pub_txt)
        if not title or not link or (pub and pub<cutoff): continue
        if not relevant(title): continue
        out.append({"type":"reddit","source":"Reddit","title":title,"url":link,"published_at":iso(pub) if pub else None})
        if len(out)>=6: break
    return out

def dedupe(items):
    seen=set(); out=[]
    for x in items:
        key=(x.get("title") or "").lower()
        if not key or key in seen: continue
        seen.add(key); out.append(x)
    return out

def current_alerts():
    data=safe_json(f"https://api.weather.gov/alerts/active?point={POINT}") or {}
    rows=[]
    for f in data.get("features") or []:
        p=f.get("properties") or {}
        event=p.get("event") or "NWS alert"
        if not any(k in event.lower() for k in ("coastal","surf","rip current","storm surge","flood","wind")):
            continue
        rows.append({
            "event":event,"headline":p.get("headline"),"area":p.get("areaDesc"),
            "ends":p.get("ends") or p.get("expires"),
            "url":f.get("id") or p.get("@id")
        })
    return rows[:8]

def load_previous():
    return safe_json(PUBLISHED) or {}

def refresh_local_pulse(prev):
    now=now_utc()
    previous=(prev.get("local_pulse") or {})
    updated=parse_iso(previous.get("updated_at"))
    if updated and now-updated < dt.timedelta(hours=3) and isinstance(previous.get("items"),list):
        return previous
    items=[]; errors=[]
    try: items.extend(google_news())
    except Exception as exc: errors.append("news: "+str(exc))
    try: items.extend(reddit_feed())
    except Exception as exc: errors.append("reddit: "+str(exc))
    items=dedupe(items)
    items.sort(key=lambda x: parse_iso(x.get("published_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc),reverse=True)
    return {
        "updated_at":iso(now),
        "items":items[:10],
        "errors":errors,
        "facebook_note":"Public Facebook posts are not included because reliable public indexing and access are inconsistent."
    }

def build():
    now=now_utc()
    prev=load_previous()

    # NOAA observed water levels for the past 24h.
    observed=decode_rows(safe_json(noaa_url("water_level",date="recent")) or {})
    obs24=[p for p in observed if p[0]>=now-dt.timedelta(hours=24)]
    observed_peak=max(obs24,key=lambda x:x[1]) if obs24 else None

    # Current NOAA OFS guidance. Date window mirrors the dashboard.
    begin=(now-dt.timedelta(days=1)).strftime("%Y%m%d")
    end=(now+dt.timedelta(days=4)).strftime("%Y%m%d")
    model=decode_rows(safe_json(noaa_url("ofs_water_level",begin_date=begin,end_date=end)) or {})
    future=[p for p in model if p[0]>=now-dt.timedelta(minutes=10) and p[0]<=now+dt.timedelta(hours=72)]
    p24=peak(future,now-dt.timedelta(minutes=10),now+dt.timedelta(hours=24))
    p72=peak(future,now-dt.timedelta(minutes=10),now+dt.timedelta(hours=72))

    alerts=current_alerts()
    local=refresh_local_pulse(prev)

    current_record={
        "generated_at":iso(now),
        "model_peak_ft":round(p72[1],2) if p72 else None,
        "model_peak_time":iso(p72[0]) if p72 else None,
        "next24_peak_ft":round(p24[1],2) if p24 else None,
        "next24_peak_time":iso(p24[0]) if p24 else None,
    }
    history=[]
    for r in prev.get("history") or []:
        t=parse_iso(r.get("generated_at"))
        if t and now-t <= dt.timedelta(hours=54):
            history.append(r)
    history.sort(key=lambda x: parse_iso(x.get("generated_at")) or now)

    if not history:
        history=[current_record]
    else:
        last_t=parse_iso(history[-1].get("generated_at"))
        if last_t and now-last_t<dt.timedelta(minutes=45):
            history[-1]=current_record
        else:
            history.append(current_record)
    history=history[-80:]

    target=now-dt.timedelta(hours=24)
    prior=None
    if history:
        candidates=[r for r in history if parse_iso(r.get("generated_at"))]
        if candidates:
            prior=min(candidates,key=lambda r:abs((parse_iso(r["generated_at"])-target).total_seconds()))
            if abs((parse_iso(prior["generated_at"])-target).total_seconds())>7*3600:
                prior=None

    change=None
    if prior and p72 and prior.get("model_peak_ft") is not None:
        old=float(prior["model_peak_ft"])
        old_t=parse_iso(prior.get("model_peak_time"))
        change={
            "baseline_at":prior["generated_at"],
            "peak_delta_ft":round(p72[1]-old,2),
            "previous_peak_ft":round(old,2),
            "current_peak_ft":round(p72[1],2),
            "previous_peak_time":iso(old_t) if old_t else None,
            "current_peak_time":iso(p72[0]),
            "time_shift_minutes":round((p72[0]-old_t).total_seconds()/60) if old_t else None,
        }

    news_items=[x for x in local.get("items",[]) if x.get("type")=="news"]
    reddit_items=[x for x in local.get("items",[]) if x.get("type")=="reddit"]

    if observed_peak:
        gap=MINOR-observed_peak[1]
        past=f"Over the past 24 hours, the Portland gauge reached {fmt_ft(observed_peak[1])} ft MLLW"
        past+=f", {abs(gap):.2f} ft {'below' if gap>=0 else 'above'} the 12.0 ft Minor Flood threshold."
    else:
        past="Past-24-hour Portland gauge observations are temporarily unavailable."
    if news_items:
        past+=" Public local reporting includes: "+news_items[0]["title"].rstrip(".")+"." 

    if change:
        d=change["peak_delta_ft"]
        direction="increased" if d>0 else "decreased" if d<0 else "held steady"
        forecast_change=f"Compared with the NOAA model snapshot about 24 hours ago, the 72-hour peak has {direction}"
        if d: forecast_change+=f" by {abs(d):.2f} ft"
        forecast_change+=f", from {change['previous_peak_ft']:.2f} to {change['current_peak_ft']:.2f} ft MLLW."
        if change.get("time_shift_minutes"):
            mins=change["time_shift_minutes"]; hours=abs(mins)/60
            forecast_change+=f" Peak timing shifted about {hours:.1f} hours {'later' if mins>0 else 'earlier'}."
    else:
        forecast_change="A 24-hour forecast-change baseline is still being established from stored NOAA model snapshots."

    if p24:
        gap=MINOR-p24[1]
        next24=f"The highest NOAA modeled total-water level in the next 24 hours is {fmt_ft(p24[1])} ft MLLW around {fmt_et(p24[0])}, {abs(gap):.2f} ft {'below' if gap>=0 else 'above'} Minor Flood."
    else:
        next24="NOAA total-water guidance for the next 24 hours is temporarily unavailable."

    if p72:
        gap=MINOR-p72[1]
        next72=f"The highest modeled level in the next 72 hours is {fmt_ft(p72[1])} ft MLLW around {fmt_et(p72[0])}, {abs(gap):.2f} ft {'below' if gap>=0 else 'above'} Minor Flood."
        if alerts: next72+=f" NWS currently lists {len(alerts)} relevant coastal/weather alert{'s' if len(alerts)!=1 else ''} for the Saco-area point."
    else:
        next72="NOAA total-water guidance for the next 72 hours is temporarily unavailable."

    pulse_count=len(news_items)+len(reddit_items)
    local_summary=f"{pulse_count} public local item{'s' if pulse_count!=1 else ''} found in the rolling public scan"
    if news_items or reddit_items:
        parts=[]
        if news_items: parts.append(f"{len(news_items)} news")
        if reddit_items: parts.append(f"{len(reddit_items)} Reddit")
        local_summary+=" ("+", ".join(parts)+")"
    local_summary+=". Facebook is not included because reliable public indexing is inconsistent."

    return {
        "schema_version":1,
        "generated_at":iso(now),
        "window_basis":"Fixed rolling windows; never based on a visitor's last app visit.",
        "past_24h":{"text":past,"observed_peak_ft":round(observed_peak[1],2) if observed_peak else None,"observed_peak_time":iso(observed_peak[0]) if observed_peak else None},
        "forecast_change_24h":{"text":forecast_change,"comparison":change},
        "next_24h":{"text":next24,"peak_ft":round(p24[1],2) if p24 else None,"peak_time":iso(p24[0]) if p24 else None},
        "next_72h":{"text":next72,"peak_ft":round(p72[1],2) if p72 else None,"peak_time":iso(p72[0]) if p72 else None},
        "local_pulse":{"summary":local_summary,**local},
        "alerts":alerts,
        "history":history,
        "sources":{
            "noaa":"NOAA CO-OPS Portland 8418150 / OFS total-water guidance",
            "nws":"National Weather Service active alerts",
            "news":"Google News public RSS search",
            "reddit":"Reddit public search RSS",
            "facebook":"Not collected because reliable public indexing/access is inconsistent."
        }
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--output",default="data/coastal-briefing.json")
    args=ap.parse_args()
    data=build()
    out=Path(args.output); out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(data,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(f"Wrote {out}: {data['generated_at']} / {len(data['local_pulse'].get('items',[]))} public local items")

if __name__=="__main__":
    main()
