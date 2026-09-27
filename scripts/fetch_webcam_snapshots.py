#!/usr/bin/env python3
"""Build same-origin still previews from the two public Saco Bay webcam feeds."""
from __future__ import annotations
import argparse, datetime as dt, json, shutil, subprocess, urllib.request
from pathlib import Path

UA="SacoCoastWatch/2.0 (public coastal dashboard; github.com/nycguy/saco-coast-watch)"
FERRY_STREAM="https://stage-ams.srv.axds.co/stream/adaptive/neracoos/ferrybeach_north/hls.m3u8"
FERRY_LIVE="https://webcoos.org/cameras/ferrybeach_north/"
ABELLONA_VIDEO_ID="HSQpqIWLViI"
ABELLONA_LIVE=f"https://www.youtube.com/watch?v={ABELLONA_VIDEO_ID}"
ABELLONA_THUMBNAILS=(
    f"https://i.ytimg.com/vi/{ABELLONA_VIDEO_ID}/maxresdefault_live.jpg",
    f"https://i.ytimg.com/vi/{ABELLONA_VIDEO_ID}/hqdefault_live.jpg",
)

def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z")

def looks_like_jpeg(data):
    return isinstance(data,(bytes,bytearray)) and len(data)>=4096 and data[:2]==b"\xff\xd8" and data[-2:]==b"\xff\xd9"

def fetch_bytes(url):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"image/jpeg,image/*;q=0.8,*/*;q=0.5"})
    with urllib.request.urlopen(req,timeout=15) as response:
        return response.read()

def fetch_abellona(dest,fetcher=fetch_bytes):
    errors=[]
    for url in ABELLONA_THUMBNAILS:
        try:
            data=fetcher(url)
            if not looks_like_jpeg(data):
                raise ValueError("response was not a usable JPEG")
            dest.write_bytes(data)
            return url
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    raise RuntimeError("; ".join(errors))

def capture_ferry(dest,runner=subprocess.run,which=shutil.which):
    executable=which("ffmpeg")
    if not executable:
        raise RuntimeError("ffmpeg is not available")
    cmd=[executable,"-hide_banner","-loglevel","error","-y","-rw_timeout","15000000","-i",FERRY_STREAM,"-frames:v","1","-q:v","3",str(dest)]
    result=runner(cmd,capture_output=True,timeout=30)
    if result.returncode:
        detail=(result.stderr or b"").decode("utf-8","replace")[-500:]
        raise RuntimeError(detail or f"ffmpeg exited {result.returncode}")
    data=dest.read_bytes() if dest.exists() else b""
    if not looks_like_jpeg(data):
        raise RuntimeError("ffmpeg did not produce a usable JPEG")
    return FERRY_STREAM

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
        "ferry_beach":camera_entry("Ferry Beach","WebCOOS / NERACOOS live HLS",FERRY_LIVE,"data/webcams/ferry-beach.jpg",out/"ferry-beach.jpg",capture_ferry,stamp),
        "abellona":camera_entry("Abellona Inn / Old Orchard Beach","Abellona Inn / YouTube Live thumbnail",ABELLONA_LIVE,"data/webcams/abellona.jpg",out/"abellona.jpg",fetch_abellona,stamp),
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
