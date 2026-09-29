#!/usr/bin/env python3
"""Build the fixed-window Saco Coast Watch Coastal Briefing from durable history."""
from __future__ import annotations
import argparse, datetime as dt, json, urllib.request
from pathlib import Path
import history_core as hc
import capture_history as ch

PUBLISHED_HISTORY="https://nycguy.github.io/saco-coast-watch/data/coastal-history.json"

def _load_json(path):
    try: return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception: return {}
def _fetch_json(url):
    try:
        req=urllib.request.Request(url,headers={"User-Agent":ch.UA,"Accept":"application/json"})
        with urllib.request.urlopen(req,timeout=12) as r: return json.load(r)
    except Exception: return {}
def _legacy_snapshot(r):
    ft=r.get("model_peak_ft")
    return {"snapshot_at":r.get("generated_at"),"snapshot_kind":"reconstructed_dashboard_snapshot" if r.get("source")=="reconstructed_dashboard_snapshot" else "realtime","provenance":{"forecast":r.get("source")},"water":{"forecast_peak_72h_ft":ft,"forecast_peak_72h_time":r.get("model_peak_time"),"forecast_peak_24h_ft":r.get("next24_peak_ft"),"forecast_peak_24h_time":r.get("next24_peak_time"),"threshold_margins_ft":hc.threshold_margins(ft)},"alerts":[{"event":e} for e in r.get("alerts") or []]}
def normalize_history(doc,now=None):
    now=now or ch.now_utc()
    if doc.get("schema_version")==2 and isinstance(doc.get("snapshots"),list): return doc
    snaps=[_legacy_snapshot(r) for r in doc.get("forecast_snapshots") or doc.get("history") or []]
    return {"schema_version":2,"generated_at":doc.get("generated_at") or hc.iso(now),"window_basis":"Fixed rolling windows; never based on a visitor's last app visit.","station":ch.STATION,"thresholds_ft_mllw":hc.THRESHOLDS_FT_MLLW,"retention":{"detailed_snapshots_days":30,"older_history":"daily_rollups"},"snapshots":snaps,"daily_rollups":[],"alert_events":[],"event_events":[],"local_events":[],"backfill":{"water_observed_daily_peaks":doc.get("observed_daily_peaks") or []},"provenance_notes":{}}
def load_history(path=None,now=None):
    doc=_load_json(path) if path else {}
    if not doc: doc=_fetch_json(PUBLISHED_HISTORY)
    hist=normalize_history(doc,now)
    if not hist.get("snapshots"): hist["snapshots"]=ch.seed_snapshots()
    return hist
def fmt_ft(v): return f"{v:.2f}" if v is not None else "—"
def fmt_time(v):
    t=hc.parse_iso(v)
    if not t: return "time unavailable"
    try:
        from zoneinfo import ZoneInfo
        z=t.astimezone(ZoneInfo("America/New_York")); return z.strftime("%a, %b %-d at %-I:%M %p ET")
    except Exception: return t.strftime("%a, %b %d at %I:%M %p UTC")
def _baseline_name(row):
    source=((row.get("provenance") or {}).get("forecast") or row.get("source") or "stored forecast snapshot").lower()
    if "archived gomofs" in source or "archive" in source: return "archived NOAA GoMOFS model cycle"
    if "reconstructed" in source: return "reconstructed Saco Coast Watch dashboard snapshot"
    if "live_noaa" in source or "ofs" in source: return "captured NOAA OFS model snapshot"
    return "stored forecast snapshot"
def _recent(events,key,now,hours=24):
    cutoff=now-dt.timedelta(hours=hours); out=[]
    for e in events or []:
        t=hc.parse_iso(e.get(key))
        if t and t>=cutoff: out.append(e)
    return out
def _legacy_history(snaps):
    out=[]
    for s in snaps:
        w=s.get("water") or {}; p=s.get("provenance") or {}
        out.append({"generated_at":s.get("snapshot_at"),"model_peak_ft":w.get("forecast_peak_72h_ft"),"model_peak_time":w.get("forecast_peak_72h_time"),"next24_peak_ft":w.get("forecast_peak_24h_ft"),"next24_peak_time":w.get("forecast_peak_24h_time"),"alerts":sorted({a.get("event") for a in s.get("alerts") or [] if a.get("event")}),"source":p.get("forecast") or s.get("snapshot_kind")})
    return out


def _event_state(snapshot):
    state=(snapshot or {}).get("event_state") or (((snapshot or {}).get("hazards") or {}).get("event_state") or {})
    if state: return state
    hazards=(snapshot or {}).get("hazards") or {}; modes=hazards.get("active_modes") or []
    return {"phase":"Approaching" if modes else "Routine","show_focus":bool(modes),"primary_display":modes[0].get("label") if modes else "Routine Coastal Conditions","impact":hazards.get("severity") or {"level":"green","label":"Routine","rank":0},"recent_impact":{"level":"green","label":"Routine","rank":0},"active_hazards":modes,"official_alerts":hazards.get("alerts") or [],"recent_impacts":[],"reasons":[]}

def _event_transition_text(current,baseline):
    now_state=_event_state(current); old_state=_event_state(baseline) if baseline else {}
    if not old_state: return ""
    pieces=[]
    if old_state.get("phase")!=now_state.get("phase"): pieces.append(f"event phase changed from {old_state.get('phase','Unknown')} to {now_state.get('phase','Unknown')}")
    old_impact=(old_state.get("impact") or {}).get("label"); new_impact=(now_state.get("impact") or {}).get("label")
    if old_impact and new_impact and old_impact!=new_impact: pieces.append(f"local impact level changed from {old_impact} to {new_impact}")
    return ("Compared with the stored state nearest 24 hours ago, "+"; ".join(pieces)+".") if pieces else ""

def _recent_event(current):
    state=_event_state(current)
    if state.get("phase")!="Recent": return {"active":False,"summary":"","items":[],"impact":state.get("recent_impact") or {}}
    items=state.get("recent_impacts") or []; labels=[item.get("label") for item in items if item.get("label")]; detail=", ".join(labels[:3]) if labels else "notable coastal observations"
    return {"active":True,"summary":"Recent coastal event: "+detail+". Current and forward-looking conditions have returned to Routine.","items":items,"impact":state.get("recent_impact") or {}}

def _event_briefing(current,baseline,now):
    hazards=current.get("hazards") or {}; state=_event_state(current); modes=state.get("active_hazards") or []; codes=[mode.get("code") for mode in modes if mode.get("code")]
    if not state.get("show_focus"): return {"active":False,"title":"Coastal Briefing","modes":modes,"severity":state.get("impact") or {},"phase":state.get("phase"),"summary":"","change_text":_event_transition_text(current,baseline),"next24_text":"","next72_text":""}
    title=(state.get("primary_display") or "Event")+" Briefing"; impact=(state.get("impact") or {}).get("label") or "Elevated"; summary=f"{state.get('primary_display') or 'Weather event'}: {impact} · {state.get('phase') or 'Active'}."
    official=[a.get("event") for a in state.get("official_alerts") or [] if a.get("event")]
    if official: summary+=" Active NWS products: "+", ".join(list(dict.fromkeys(official))[:3])+"."
    next24=[]; next72=[]; winter=hazards.get("winter") or {}; rain=hazards.get("rain") or {}; wind=hazards.get("wind") or {}; cold=hazards.get("cold") or {}; tropical=hazards.get("tropical") or {}; surf=hazards.get("surf") or {}
    if "winter" in codes:
        if winter.get("snowfall_24h_in") is not None: next24.append(f"NWS grid snowfall guidance totals {winter['snowfall_24h_in']:.1f} in in the next 24 hours")
        if winter.get("snowfall_72h_in") is not None: next72.append(f"NWS grid snowfall guidance totals {winter['snowfall_72h_in']:.1f} in in the next 72 hours")
        if winter.get("precip_transition_24h"): next24.append("precipitation type: "+winter["precip_transition_24h"])
    if "heavy_rain" in codes or "flooding" in codes:
        if rain.get("qpf_24h_in") is not None: next24.append(f"NWS grid precipitation guidance totals {rain['qpf_24h_in']:.1f} in in the next 24 hours")
        if rain.get("qpf_72h_in") is not None: next72.append(f"NWS grid precipitation guidance totals {rain['qpf_72h_in']:.1f} in in the next 72 hours")
    if "high_wind" in codes or "winter" in codes or "tropical" in codes:
        if wind.get("max_gust_24h_mph") is not None: next24.append(f"peak NWS hourly gust guidance is {wind['max_gust_24h_mph']:.0f} mph")
        if wind.get("max_gust_72h_mph") is not None: next72.append(f"peak NWS hourly gust guidance is {wind['max_gust_72h_mph']:.0f} mph")
    if "high_surf" in codes and surf.get("max_surf_height_ft") is not None: next72.append(f"NWS Coastal York Surf Zone Forecast reaches about {surf['max_surf_height_ft']:.0f} ft surf")
    if "beach_hazard" in codes and surf.get("rip_current_risk"): next24.append(f"NWS Surf Zone Forecast lists {surf['rip_current_risk']} rip-current risk")
    if "extreme_cold" in codes and cold.get("min_temp_24h_f") is not None: next24.append(f"minimum NWS hourly temperature guidance is {cold['min_temp_24h_f']:.0f}°F")
    if "tropical" in codes and tropical.get("storms"):
        storm=tropical["storms"][0]; summary+=f" NHC is tracking {storm.get('label') or storm.get('name') or 'a tropical cyclone'}"
        if storm.get("min_forecast_track_distance_mi") is not None: summary+=f", with the nearest current NHC forecast-track point about {storm['min_forecast_track_distance_mi']:.0f} miles from Saco Bay."
        else: summary+="."
    changes=[]; previous=(baseline or {}).get("hazards") or {}
    def add_delta(label,current_value,previous_value,unit,minimum=.05):
        if current_value is None or previous_value is None: return
        delta=float(current_value)-float(previous_value)
        if abs(delta)<minimum: return
        changes.append(f"{label} {'increased' if delta>0 else 'decreased'} by {abs(delta):.1f} {unit}, from {float(previous_value):.1f} to {float(current_value):.1f} {unit}")
    add_delta("NWS 72-hour snowfall guidance",winter.get("snowfall_72h_in"),(previous.get("winter") or {}).get("snowfall_72h_in"),"in"); add_delta("NWS 72-hour precipitation guidance",rain.get("qpf_72h_in"),(previous.get("rain") or {}).get("qpf_72h_in"),"in"); add_delta("Peak NWS 72-hour gust guidance",wind.get("max_gust_72h_mph"),(previous.get("wind") or {}).get("max_gust_72h_mph"),"mph",1)
    transition=_event_transition_text(current,baseline); change_text=("Compared with the stored guidance nearest 24 hours ago, "+"; ".join(changes)+".") if changes else transition
    if changes and transition: change_text+=" "+transition
    return {"active":True,"title":title,"modes":modes,"severity":state.get("impact") or {},"phase":state.get("phase"),"summary":summary,"change_text":change_text,"next24_text":(". ".join(next24)+".") if next24 else "No additional event-specific 24-hour metric is available.","next72_text":(". ".join(next72)+".") if next72 else "No additional event-specific 72-hour metric is available."}

def _forecast_evolution(snaps,current,now):
    rows=hc.merge_snapshots(snaps or [],[current],now,30)
    points=[]
    seen=set()
    for hours,label,tolerance in ((24,"24h ago",3.1),(12,"12h ago",2.1),(6,"6h ago",1.6)):
        row=hc.choose_baseline(rows,now-dt.timedelta(hours=hours),tolerance)
        if not row: continue
        at=row.get("snapshot_at") or row.get("generated_at")
        if not at or at in seen: continue
        seen.add(at); w=row.get("water") or {}; ft=w.get("forecast_peak_72h_ft")
        if ft is None: continue
        points.append({"label":label,"target_hours_ago":hours,"snapshot_at":at,"peak_ft":ft,"peak_time":w.get("forecast_peak_72h_time"),"minor_margin_ft":hc.threshold_margins(ft).get("minor"),"source":_baseline_name(row)})
    w=current.get("water") or {}; ft=w.get("forecast_peak_72h_ft")
    if ft is not None:
        points.append({"label":"Now","target_hours_ago":0,"snapshot_at":current.get("snapshot_at"),"peak_ft":ft,"peak_time":w.get("forecast_peak_72h_time"),"minor_margin_ft":hc.threshold_margins(ft).get("minor"),"source":_baseline_name(current)})
    points.sort(key=lambda x:x.get("target_hours_ago",0),reverse=True)
    return {"items":points,"basis":"Captured forecast snapshots nearest 24, 12 and 6 hours ago plus the current snapshot. Retrieval time is not NOAA model issuance time."}

def _impact_timeline(current,alert_changes,local24,now):
    events=[]; w=current.get("water") or {}
    def add(at,kind,title,source,source_type,url=None,anecdotal=False):
        if not hc.parse_iso(at): return
        events.append({"at":at,"type":kind,"title":title,"source":source,"source_type":source_type,"url":url,"anecdotal":anecdotal})
    if w.get("observed_24h_max_ft") is not None:
        add(w.get("observed_24h_max_time"),"water","Portland observed water level reached %.2f ft MLLW"%w["observed_24h_max_ft"],"NOAA CO-OPS station 8418150","official_observation")
    if w.get("residual_24h_max_ft") is not None:
        add(w.get("residual_24h_max_time"),"residual","Portland water-level residual reached %+.2f ft versus astronomical tide"%w["residual_24h_max_ft"],"NOAA CO-OPS observation minus astronomical prediction","derived_official_data")
    buoy=(((current.get("marine") or {}).get("stations") or {}).get("44007") or {})
    if buoy.get("max_24h_wave_height_ft") is not None:
        add(buoy.get("max_24h_wave_at"),"waves","Buoy 44007 significant wave height reached %.1f ft"%buoy["max_24h_wave_height_ft"],"NOAA/NDBC buoy 44007","official_observation")
    if buoy.get("max_24h_gust_mph") is not None and buoy["max_24h_gust_mph"]>=20:
        add(buoy.get("max_24h_gust_at"),"wind","Buoy 44007 gust reached %.1f mph"%buoy["max_24h_gust_mph"],"NOAA/NDBC buoy 44007","official_observation")
    for e in alert_changes or []:
        event=e.get("event") or "Coastal alert"; change=e.get("change_type") or "changed"
        add(e.get("at"),"alert",f"{event} {change}",e.get("source") or "National Weather Service","official_alert")
    for e in local24 or []:
        add(e.get("published_at"),"community" if e.get("anecdotal") else "report",e.get("headline") or e.get("summary") or "Coastal report",e.get("source") or "Public report",e.get("source_type") or ("community" if e.get("anecdotal") else "news"),e.get("url"),bool(e.get("anecdotal")))
    cutoff=now-dt.timedelta(hours=24)
    events=[e for e in events if (hc.parse_iso(e.get("at")) or now)>=cutoff]
    events.sort(key=lambda e:hc.parse_iso(e["at"]))
    return events[-24:]

def build_payload(current,hist,now=None):
    now=now or hc.parse_iso(current.get("snapshot_at")) or ch.now_utc()
    stored=hist.get("snapshots") or []
    snaps=hc.merge_snapshots(stored,[current],now,30)
    baseline=hc.choose_baseline(snaps,now-dt.timedelta(hours=24),3.1)
    baseline48=hc.choose_baseline(snaps,now-dt.timedelta(hours=48),3.1)
    change=hc.compare_forecast(current,baseline); change48=hc.compare_forecast(current,baseline48)
    wind_change=hc.compare_wind(current,baseline)
    w=current.get("water") or {}; peak24=w.get("forecast_peak_24h_ft"); peak72=w.get("forecast_peak_72h_ft")

    obs=w.get("observed_24h_max_ft"); obs_t=w.get("observed_24h_max_time")
    if obs is not None:
        gap=hc.THRESHOLDS_FT_MLLW["minor"]-float(obs)
        past=f"Over the past 24 hours, the Portland gauge reached {fmt_ft(obs)} ft MLLW around {fmt_time(obs_t)}, {abs(gap):.2f} ft {'below' if gap>=0 else 'above'} the 12.0 ft Minor Flood threshold."
    else:
        past="Past-24-hour Portland gauge observations are temporarily unavailable."
    station_bits=[]
    for sid,s in (((current.get("marine") or {}).get("stations") or {}).items()):
        if not s or s.get("error"): continue
        if s.get("max_24h_gust_mph") is not None: station_bits.append(f"{sid} gusted to {s['max_24h_gust_mph']:.1f} mph")
        elif s.get("max_24h_speed_mph") is not None: station_bits.append(f"{sid} reached {s['max_24h_speed_mph']:.1f} mph sustained")
    if station_bits: past+=" Marine observations: "+"; ".join(station_bits)+"."
    if w.get("residual_24h_max_ft") is not None:
        past+=f" The highest Portland water-level residual was {w['residual_24h_max_ft']:+.2f} ft versus astronomical tide around {fmt_time(w.get('residual_24h_max_time'))}."

    latest_stored=max((s for s in stored if hc.parse_iso(s.get("snapshot_at"))),key=lambda s:hc.parse_iso(s["snapshot_at"]),default=None)
    live_alert_changes=hc.diff_alerts((latest_stored or {}).get("alerts") or [],current.get("alerts") or [],now) if latest_stored else []
    alert_changes=hc.merge_events(_recent(hist.get("alert_events"),"at",now,24),live_alert_changes,100)
    local24=[e for e in _recent(hist.get("local_events"),"published_at",now,24) if ch.coastal_topic((e.get("headline") or "")+" "+(e.get("summary") or ""))]
    evolution=_forecast_evolution(snaps,current,now)
    timeline=_impact_timeline(current,alert_changes,local24,now)
    event_state=_event_state(current); event_briefing=_event_briefing(current,baseline,now); recent_event=_recent_event(current); event_transitions=_recent(hist.get("event_events"),"at",now,72)

    if alert_changes:
        labels=[f"{e.get('event') or 'Alert'} {e.get('change_type','changed')}" for e in alert_changes[-4:]]
        past+=" NWS alert changes: "+"; ".join(labels)+"."
    if local24:
        first=local24[-1]; qualifier="A public community report" if first.get("anecdotal") else "Local reporting"
        past+=f" {qualifier} noted: {first.get('headline') or first.get('summary')}."
    if recent_event.get("active"): past+=" "+recent_event.get("summary","")

    if change:
        d=change["peak_delta_ft"]; direction="increased" if d>0 else "decreased" if d<0 else "held steady"
        forecast_change=f"Compared with the {_baseline_name(baseline)} nearest 24 hours ago, the 72-hour peak has {direction}"
        if d: forecast_change+=f" by {abs(d):.2f} ft"
        forecast_change+=f", from {change['previous_peak_ft']:.2f} to {change['current_peak_ft']:.2f} ft MLLW."
        mins=change.get("time_shift_minutes")
        if mins: forecast_change+=f" Peak timing shifted about {abs(mins)/60:.1f} hours {'later' if mins>0 else 'earlier'}."
        margin_delta=(change.get("threshold_margin_delta_ft") or {}).get("minor")
        if margin_delta is not None and margin_delta!=0:
            forecast_change+=f" The margin to Minor Flood {'grew' if margin_delta>0 else 'shrank'} by {abs(margin_delta):.2f} ft."
        forecast_change+=f" Risk is {'increasing' if d>0 else 'decreasing' if d<0 else 'little changed'} on this water-level measure."
    else:
        forecast_change="An authentic forecast snapshot close enough to 24 hours ago is not available yet; no forecast-change value is being inferred from later observations."
    transition_text=_event_transition_text(current,baseline)
    if event_briefing.get("change_text"): forecast_change+=" "+event_briefing["change_text"]
    elif transition_text: forecast_change+=" "+transition_text

    if peak24 is not None:
        m=hc.THRESHOLDS_FT_MLLW["minor"]-float(peak24)
        next24=f"The highest NOAA modeled total-water level in the next 24 hours is {fmt_ft(peak24)} ft MLLW around {fmt_time(w.get('forecast_peak_24h_time'))}, {abs(m):.2f} ft {'below' if m>=0 else 'above'} Minor Flood."
    else:
        next24="NOAA total-water guidance for the next 24 hours is temporarily unavailable."
    if peak72 is not None:
        m=hc.THRESHOLDS_FT_MLLW["minor"]-float(peak72)
        next72=f"The highest modeled total-water level in the next 72 hours is {fmt_ft(peak72)} ft MLLW around {fmt_time(w.get('forecast_peak_72h_time'))}, {abs(m):.2f} ft {'below' if m>=0 else 'above'} Minor Flood."
        if w.get("astronomical_tide_at_peak_ft") is not None:
            next72+=f" The astronomical tide at that time is {w['astronomical_tide_at_peak_ft']:.2f} ft MLLW, implying {w.get('model_uplift_ft',0):+.2f} ft of modeled uplift/departure."
    else:
        next72="NOAA total-water guidance for the next 72 hours is temporarily unavailable."
    fc=current.get("forecast_conditions") or {}
    if fc.get("next24_max_sustained_wind_mph") is not None: next24+=f" NWS hourly guidance reaches about {fc['next24_max_sustained_wind_mph']:.0f} mph sustained wind in this period."
    if fc.get("next72_max_precip_probability_pct") is not None: next72+=f" Maximum hourly precipitation probability in the 72-hour guidance is {fc['next72_max_precip_probability_pct']:.0f}%."
    if event_briefing.get("active"):
        next24+=" "+event_briefing.get("next24_text","")
        next72+=" "+event_briefing.get("next72_text","")

    local_items=[]
    candidates=sorted(hist.get("local_events") or [],key=lambda x:hc.parse_iso(x.get("published_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc),reverse=True)
    for e in candidates:
        if not ch.coastal_topic((e.get("headline") or "")+" "+(e.get("summary") or "")): continue
        local_items.append({"type":"reddit" if e.get("source")=="Reddit" else "news","source":e.get("source"),"title":e.get("headline") or e.get("summary"),"url":e.get("url"),"published_at":e.get("published_at"),"location":e.get("location"),"event_category":e.get("event_category"),"anecdotal":e.get("anecdotal",False)})
        if len(local_items)>=12: break
    community=sum(1 for e in local_items if e.get("anecdotal")); officialish=len(local_items)-community
    if local_items:
        local_summary=f"{len(local_items)} weather/coastal public report{'s' if len(local_items)!=1 else ''} retained in the recent scan ({officialish} news/other public, {community} community)."
    else:
        local_summary="No weather-related local reports were retained in the recent coastal scan."
    local_summary+=" Community reports are labeled anecdotal. Public Facebook coverage is not assumed comprehensive because indexing and access are inconsistent."

    backfill=hist.get("backfill") or {}; daily=backfill.get("water_observed_daily_peaks") or []
    merged_hist={**hist,"generated_at":hc.iso(now),"snapshots":snaps}
    compact=ch.compact_history(merged_hist,7)
    return {
        "schema_version":2,"generated_at":hc.iso(now),"window_basis":"Fixed rolling windows; never based on a visitor's last app visit.",
        "past_24h":{"text":past,"observed_peak_ft":obs,"observed_peak_time":obs_t,"strongest_marine":station_bits,"alert_changes":alert_changes,"local_impacts":local24},
        "forecast_change_24h":{"text":forecast_change,"comparison":change,"wind_comparison":wind_change},
        "forecast_change_48h":{"comparison":change48},
        "forecast_evolution":evolution,
        "event_state":event_state,
        "event_briefing":event_briefing,
        "recent_event":recent_event,
        "event_transitions":event_transitions,
        "impact_timeline":timeline,
        "impact_timeline_next24":((current.get("hazards") or {}).get("hourly") or []),
        "observed_daily_peaks":daily,
        "next_24h":{"text":next24,"peak_ft":peak24,"peak_time":w.get("forecast_peak_24h_time")},
        "next_72h":{"text":next72,"peak_ft":peak72,"peak_time":w.get("forecast_peak_72h_time")},
        "local_pulse":{"summary":local_summary,"updated_at":hist.get("generated_at"),"items":local_items,"errors":[],"facebook_note":"Public Facebook posts are included only when verifiable; coverage is not assumed comprehensive."},
        "alerts":current.get("alerts") or [],
        "current_snapshot":current,
        "history":_legacy_history(snaps),
        "history_compact":compact,
        "sources":{"noaa":"NOAA CO-OPS Portland 8418150 observations, predictions and OFS guidance","nws":"National Weather Service alerts, hourly forecast, forecast grid, marine alerts and Coastal York Surf Zone Forecast","nhc":"National Hurricane Center CurrentStorms and GIS products","ndbc":"NDBC 44007 and WEXM1 observations","news":"Weather/coastal public news RSS/search retained with source metadata","reddit":"Public Reddit search; treated as anecdotal community reporting","facebook":"Not treated as comprehensive when public indexing/access is unavailable."}
    }

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--output",default="data/coastal-briefing.json"); ap.add_argument("--history-output",default="data/coastal-history.json"); ap.add_argument("--history-input"); args=ap.parse_args()
    now=ch.now_utc(); hist=load_history(args.history_input,now); current=ch.current_snapshot(now); data=build_payload(current,hist,now)
    out=Path(args.output); out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(data,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    hout=Path(args.history_output); hout.parent.mkdir(parents=True,exist_ok=True); hout.write_text(json.dumps(data["history_compact"],indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(f"Wrote {out} and {hout}: {data['generated_at']} / {len(data['history_compact'].get('snapshots',[]))} recent snapshots")
if __name__=="__main__": main()
