#!/usr/bin/env python3
"""Archive Ferry Beach stills during significant coastal conditions."""
from __future__ import annotations
import argparse, datetime as dt, json, shutil, subprocess
from pathlib import Path
import capture_history as ch
import history_core as hc

FERRY_STREAM="https://stage-ams.srv.axds.co/stream/adaptive/neracoos/ferrybeach_north/hls.m3u8"
LIVE_URL="https://webcoos.org/cameras/ferrybeach_north/"
RETENTION_HOURS=24
MIN_CAPTURE_MINUTES=10

def looks_like_jpeg(data):
    return isinstance(data,(bytes,bytearray)) and len(data)>=4096 and data[:2]==b"\xff\xd8" and data[-2:]==b"\xff\xd9"

def capture_frame(dest,runner=subprocess.run,which=shutil.which):
    ffmpeg=which("ffmpeg")
    if not ffmpeg: raise RuntimeError("ffmpeg is not available")
    cmd=[ffmpeg,"-hide_banner","-loglevel","error","-y","-rw_timeout","15000000","-i",FERRY_STREAM,
         "-vf","scale=960:-2","-frames:v","1","-q:v","5",str(dest)]
    result=runner(cmd,capture_output=True,timeout=35)
    if result.returncode:
        detail=(result.stderr or b"").decode("utf-8","replace")[-500:]
        raise RuntimeError(detail or f"ffmpeg exited {result.returncode}")
    data=dest.read_bytes() if dest.exists() else b""
    if not looks_like_jpeg(data): raise RuntimeError("ffmpeg did not produce a usable JPEG")
    return dest

def latest_snapshot(path):
    try: doc=json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception: return None
    rows=[r for r in doc.get("snapshots") or [] if hc.parse_iso(r.get("snapshot_at"))]
    return max(rows,key=lambda r:hc.parse_iso(r["snapshot_at"])) if rows else None

def load_index(out):
    try: return json.loads((out/"index.json").read_text(encoding="utf-8"))
    except Exception: return {"schema_version":1,"camera":"ferry_beach","live_url":LIVE_URL,"frames":[]}

def _write_index(out,doc,now):
    doc["schema_version"]=1; doc["camera"]="ferry_beach"; doc["live_url"]=LIVE_URL
    doc["generated_at"]=hc.iso(now); doc["retention_hours"]=RETENTION_HOURS
    (out/"index.json").write_text(json.dumps(doc,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")

def prune(out,doc,now):
    cutoff=now-dt.timedelta(hours=RETENTION_HOURS)
    kept=[]
    for frame in doc.get("frames") or []:
        t=hc.parse_iso(frame.get("captured_at"))
        p=out/(frame.get("file") or "")
        if t and t>=cutoff and p.exists(): kept.append(frame)
        else:
            try: p.unlink(missing_ok=True)
            except Exception: pass
    doc["frames"]=kept
    return doc

def archive_event_state(snapshot,now):
    if not snapshot: return {}
    state=snapshot.get("event_state") or ((snapshot.get("hazards") or {}).get("event_state") or {})
    if not state:
        state=ch.fh.derive_event_state(snapshot.get("hazards") or {},water=snapshot.get("water") or {},marine=snapshot.get("marine") or {},alerts=snapshot.get("alerts") or [],now=now)
    return state

def archive_reasons(snapshot,now):
    state=archive_event_state(snapshot,now)
    if not state.get("show_focus"): return []
    reasons=[]
    display=state.get("primary_display")
    impact=(state.get("impact") or {}).get("label")
    phase=state.get("phase")
    if display: reasons.append(display)
    if impact and phase: reasons.append(f"{impact} · {phase}")
    reasons.extend(state.get("reasons") or [])
    return list(dict.fromkeys(reason for reason in reasons if reason))[:6]

def archive(history_path,output_dir,now=None,capture_fn=capture_frame):
    now=now or ch.now_utc(); out=Path(output_dir); out.mkdir(parents=True,exist_ok=True)
    doc=prune(out,load_index(out),now)
    snap=latest_snapshot(history_path)
    reasons=archive_reasons(snap or {},now) if snap else []
    result={"active":bool(reasons),"reasons":reasons,"captured":False}
    if reasons:
        recent=doc.get("frames")[-1] if doc.get("frames") else None
        recent_t=hc.parse_iso((recent or {}).get("captured_at"))
        if not recent_t or now-recent_t>=dt.timedelta(minutes=MIN_CAPTURE_MINUTES):
            filename=now.strftime("%Y%m%dT%H%M%SZ")+".jpg"; dest=out/filename
            try:
                capture_fn(dest)
                doc.setdefault("frames",[]).append({"captured_at":hc.iso(now),"file":filename,"source":"WebCOOS / NERACOOS Ferry Beach north HLS","reasons":reasons})
                result["captured"]=True; result["file"]=filename
            except Exception as exc:
                try: dest.unlink(missing_ok=True)
                except Exception: pass
                result["error"]=str(exc)[:300]
    _write_index(out,doc,now)
    result["frame_count"]=len(doc.get("frames") or [])
    print(json.dumps(result,indent=2))
    return result

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--history",required=True)
    ap.add_argument("--output-dir",required=True)
    args=ap.parse_args()
    archive(args.history,args.output_dir)

if __name__=="__main__": main()
