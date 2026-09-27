#!/usr/bin/env python3
"""Pure history and comparison logic for Saco Coast Watch."""
from __future__ import annotations
import datetime as dt
import re
from collections import defaultdict

UTC=dt.timezone.utc
THRESHOLDS_FT_MLLW={"minor":12.0,"moderate":13.0,"major":14.0}
SEVERITY_RANK={"statement":0,"advisory":1,"watch":2,"warning":3}


def parse_iso(value):
    if not value: return None
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z","+00:00")).astimezone(UTC)
    except (TypeError,ValueError):
        return None


def iso(value):
    if value is None: return None
    if value.tzinfo is None: value=value.replace(tzinfo=UTC)
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00","Z")


def threshold_margins(level_ft):
    """Signed distance to each threshold. Positive means below threshold; negative means above."""
    if level_ft is None: return {k:None for k in THRESHOLDS_FT_MLLW}
    return {k:round(v-float(level_ft),2) for k,v in THRESHOLDS_FT_MLLW.items()}


def hour_bucket(value):
    t=parse_iso(value) if not isinstance(value,dt.datetime) else value.astimezone(UTC)
    if not t: return None
    return t.replace(minute=0,second=0,microsecond=0)


def snapshot_key(row):
    t=parse_iso(row.get("snapshot_at") or row.get("generated_at"))
    if not t: return None
    kind=row.get("snapshot_kind") or "realtime"
    if kind=="realtime": return (kind, iso(hour_bucket(t)))
    return (kind, iso(t))


def merge_snapshots(existing, additions, now=None, detailed_days=30):
    now=now or dt.datetime.now(UTC)
    by_key={}
    for row in list(existing or [])+list(additions or []):
        key=snapshot_key(row)
        if not key: continue
        normalized=dict(row)
        normalized["snapshot_at"]=iso(parse_iso(row.get("snapshot_at") or row.get("generated_at")))
        normalized.pop("generated_at",None)
        by_key[key]=normalized
    cutoff=now-dt.timedelta(days=detailed_days)
    rows=[r for r in by_key.values() if (parse_iso(r.get("snapshot_at")) or now)>=cutoff]
    return sorted(rows,key=lambda r:parse_iso(r["snapshot_at"]))


def choose_baseline(snapshots, target, tolerance_hours=3.1, require_forecast=True):
    candidates=[]
    for row in snapshots or []:
        t=parse_iso(row.get("snapshot_at") or row.get("generated_at"))
        if not t: continue
        peak=((row.get("water") or {}).get("forecast_peak_72h_ft"))
        if peak is None: peak=row.get("model_peak_ft")
        if require_forecast and peak is None: continue
        candidates.append((abs((t-target).total_seconds()),t,row))
    if not candidates: return None
    diff,_,row=min(candidates,key=lambda x:x[0])
    if diff>tolerance_hours*3600: return None
    return row


def _forecast_value(row,key):
    water=row.get("water") or {}
    if key in water: return water.get(key)
    legacy={"forecast_peak_72h_ft":"model_peak_ft","forecast_peak_72h_time":"model_peak_time",
            "forecast_peak_24h_ft":"next24_peak_ft","forecast_peak_24h_time":"next24_peak_time"}
    return row.get(legacy.get(key,""))


def compare_forecast(current, baseline):
    if not current or not baseline: return None
    cur_ft=_forecast_value(current,"forecast_peak_72h_ft")
    old_ft=_forecast_value(baseline,"forecast_peak_72h_ft")
    if cur_ft is None or old_ft is None: return None
    cur_t=parse_iso(_forecast_value(current,"forecast_peak_72h_time"))
    old_t=parse_iso(_forecast_value(baseline,"forecast_peak_72h_time"))
    cur_m=threshold_margins(cur_ft); old_m=threshold_margins(old_ft)
    return {
        "baseline_at": baseline.get("snapshot_at") or baseline.get("generated_at"),
        "baseline_source": (baseline.get("provenance") or {}).get("forecast") or baseline.get("source"),
        "peak_delta_ft": round(float(cur_ft)-float(old_ft),2),
        "previous_peak_ft": round(float(old_ft),2),
        "current_peak_ft": round(float(cur_ft),2),
        "previous_peak_time": iso(old_t),
        "current_peak_time": iso(cur_t),
        "time_shift_minutes": round((cur_t-old_t).total_seconds()/60) if cur_t and old_t else None,
        "threshold_margin_delta_ft": {k:(round(cur_m[k]-old_m[k],2) if cur_m[k] is not None and old_m[k] is not None else None) for k in THRESHOLDS_FT_MLLW},
        "previous_threshold_margins_ft":old_m,
        "current_threshold_margins_ft":cur_m,
    }


def compare_wind(current, baseline):
    if not current or not baseline: return None
    out={}
    for station in ("44007","WEXM1"):
        c=((current.get("marine") or {}).get("stations") or {}).get(station) or {}
        b=((baseline.get("marine") or {}).get("stations") or {}).get(station) or {}
        if c.get("speed_mph") is None or b.get("speed_mph") is None: continue
        out[station]={
            "speed_delta_mph":round(float(c["speed_mph"])-float(b["speed_mph"]),1),
            "gust_delta_mph":round(float(c["gust_mph"])-float(b["gust_mph"]),1) if c.get("gust_mph") is not None and b.get("gust_mph") is not None else None,
            "current_direction_deg":c.get("direction_deg"),
            "previous_direction_deg":b.get("direction_deg"),
        }
    return out or None


def alert_family(event):
    value=(event or "").lower().strip()
    value=re.sub(r"\b(advisory|watch|warning|statement)\b","",value)
    value=re.sub(r"\s+"," ",value).strip()
    return value


def alert_rank(event):
    e=(event or "").lower()
    for key,rank in SEVERITY_RANK.items():
        if key in e: return rank
    return 0


def _alert_identity(a):
    return a.get("id") or a.get("url")


def _area_key(a):
    return re.sub(r"\s+"," ",(a.get("area") or a.get("areaDesc") or "").lower()).strip()


def diff_alerts(previous, current, at_time=None):
    """Detect issue/extend/upgrade/downgrade/expire changes between alert snapshots."""
    at_time=at_time or dt.datetime.now(UTC)
    previous=list(previous or []); current=list(current or [])
    used_prev=set(); events=[]
    by_id={_alert_identity(a):i for i,a in enumerate(previous) if _alert_identity(a)}
    for cur in current:
        match_idx=None
        ident=_alert_identity(cur)
        if ident and ident in by_id:
            match_idx=by_id[ident]
        else:
            fam=alert_family(cur.get("event")); area=_area_key(cur)
            cand=[(i,p) for i,p in enumerate(previous) if i not in used_prev and alert_family(p.get("event"))==fam and (not area or not _area_key(p) or area==_area_key(p))]
            if cand: match_idx=cand[0][0]
        if match_idx is None:
            events.append({"change_type":"issued","event":cur.get("event"),"alert_id":ident,"at":cur.get("sent") or cur.get("effective") or iso(at_time)})
            continue
        used_prev.add(match_idx); old=previous[match_idx]
        old_rank=alert_rank(old.get("event")); new_rank=alert_rank(cur.get("event"))
        if new_rank>old_rank:
            change="upgraded"
        elif new_rank<old_rank:
            change="downgraded"
        else:
            old_exp=parse_iso(old.get("expires") or old.get("ends")); new_exp=parse_iso(cur.get("expires") or cur.get("ends"))
            change="extended" if old_exp and new_exp and new_exp>old_exp+dt.timedelta(minutes=5) else None
        if change:
            events.append({"change_type":change,"event":cur.get("event"),"previous_event":old.get("event"),"alert_id":ident,"at":cur.get("sent") or cur.get("effective") or iso(at_time)})
    for i,old in enumerate(previous):
        if i in used_prev: continue
        exp=parse_iso(old.get("expires") or old.get("ends"))
        if exp and exp<=at_time+dt.timedelta(minutes=5):
            events.append({"change_type":"expired","event":old.get("event"),"alert_id":_alert_identity(old),"at":iso(exp)})
        else:
            events.append({"change_type":"ended","event":old.get("event"),"alert_id":_alert_identity(old),"at":iso(at_time)})
    return events


def merge_events(existing, additions, max_items=1000):
    by_key={}
    for e in list(existing or [])+list(additions or []):
        key=(e.get("url") or e.get("alert_id") or e.get("id") or e.get("headline") or e.get("title"), e.get("published_at") or e.get("at") or "")
        if not key[0]: continue
        by_key[key]=e
    def stamp(e): return parse_iso(e.get("published_at") or e.get("at")) or dt.datetime.min.replace(tzinfo=UTC)
    return sorted(by_key.values(),key=stamp)[-max_items:]


def daily_rollups(snapshots, existing=None):
    """Create compact daily summaries, suitable for long-term retention."""
    days=defaultdict(list)
    for s in snapshots or []:
        t=parse_iso(s.get("snapshot_at"))
        if t: days[t.date().isoformat()].append(s)
    out={r.get("date"):dict(r) for r in (existing or []) if r.get("date")}
    for day,rows in days.items():
        obs=[]; fcast=[]; gust=[]
        for r in rows:
            w=r.get("water") or {}
            if w.get("observed_24h_max_ft") is not None: obs.append(float(w["observed_24h_max_ft"]))
            if w.get("forecast_peak_72h_ft") is not None: fcast.append(float(w["forecast_peak_72h_ft"]))
            for st in (((r.get("marine") or {}).get("stations") or {}).values()):
                if st and st.get("gust_mph") is not None: gust.append(float(st["gust_mph"]))
        out[day]={"date":day,"snapshot_count":len(rows),"max_observed_ft":round(max(obs),2) if obs else None,"max_forecast_peak_ft":round(max(fcast),2) if fcast else None,"max_gust_mph":round(max(gust),1) if gust else None}
    return [out[k] for k in sorted(out)]
