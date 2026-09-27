#!/usr/bin/env python3
"""Build lightweight webcam preview data for Saco Coast Watch."""
from __future__ import annotations
import argparse, datetime as dt, json, shutil, subprocess
from pathlib import Path

FERRY_STREAM="https://stage-ams.srv.axds.co/stream/adaptive/neracoos/ferrybeach_north/hls.m3u8"
FERRY_LIVE="https://webcoos.org/cameras/ferrybeach_north/"
ABELLONA_VIDEO_ID="HSQpqIWLViI"
ABELLONA_LIVE=f"https://www.youtube.com/watch?v={ABELLONA_VIDEO_ID}"

def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z")

def looks_like_jpeg(data):
    return isinstance(data,(bytes,bytearray)) and len(data)>=4096 and data[:2]==b"\xff\xd8" and data[-2:]==b"\xff\xd9"

def capture_frame(stream_url,dest,runner=subprocess.run,which=shutil.which):
    executable=which("ffmpeg")
    if not executable:
        raise RuntimeError("ffmpeg is not available")
    cmd=[executable,"-hide_banner","-loglevel","error","-y","-rw_timeout","15000000","-i",stream_url,"-frames:v","1","-q:v","3",str(dest)]
    result=runner(cmd,capture_output=True,timeout=35)
    if result.returncode:
        detail=(result.stderr or b"").decode("utf-8","replace")[-500:]
        raise RuntimeError(detail or f"ffmpeg exited {result.returncode}")
    data=dest.read_bytes() if dest.exists() else b""
    if not looks_like_jpeg(data):
        raise RuntimeError("ffmpeg did not produce a usable JPEG")
    return stream_url

def capture_ferry(dest):
    return capture_frame(FERRY_STREAM,dest)

def camera_entry(name,source,live_url,image_rel,dest,fetch_fn,stamp):
    try:
        fetch_fn(dest)
        return {"name":name,"status":"ok","image":image_rel,"fetched_at":stamp,"source":source,"live_url":live_url}
    except Exception as exc:
        try:
            dest.unlink(missing_ok=True)
        except Exception:
            pass
        return {"name":name,"status":"unavailable","image":None,"fetched_at":None,"source":source,"live_url":live_url,"error":str(exc)[:500]}

def build(output_dir):
    out=Path(output_dir)
    out.mkdir(parents=True,exist_ok=True)
    stamp=now_iso()
    cameras={
        "ferry_beach":camera_entry("Ferry Beach","WebCOOS / NERACOOS live HLS frame",FERRY_LIVE,"data/webcams/ferry-beach.jpg",out/"ferry-beach.jpg",capture_ferry,stamp),
        "abellona":{
            "name":"Abellona Inn / Old Orchard Beach",
            "status":"live_embed",
            "image":None,
            "fetched_at":None,
            "source":"Abellona Inn / YouTube Live player",
            "live_url":ABELLONA_LIVE,
            "note":"The app displays the actual muted live player. YouTube's static poster thumbnail is not used as current-condition imagery.",
        },
    }
    doc={"schema_version":1,"generated_at":stamp,"refresh_target_minutes":5,"cameras":cameras}
    (out/"webcams.json").write_text(json.dumps(doc,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps({"generated_at":stamp,"status":{key:value["status"] for key,value in cameras.items()}},indent=2))
    return doc

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output-dir",default="dist/data/webcams")
    args=parser.parse_args()
    build(args.output_dir)

if __name__=="__main__":
    main()
