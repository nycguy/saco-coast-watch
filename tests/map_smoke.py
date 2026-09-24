#!/usr/bin/env python3
"""Browser regression for continuous Leaflet map tiles. Run before publishing."""
import json, os, shutil, time
from playwright.sync_api import sync_playwright

def main():
    binary=next((shutil.which(s) for s in ("google-chrome","google-chrome-stable","chromium","chromium-browser") if shutil.which(s)),None)
    print("BROWSER_EXECUTABLE",binary,flush=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=binary,args=["--no-sandbox"]) if binary else p.chromium.launch(headless=True,args=["--no-sandbox"])
        page=browser.new_page(viewport={"width":1600,"height":1000},device_scale_factor=1)
        errors=[]
        page.on("pageerror",lambda err: errors.append(str(err)))
        page.goto("http://127.0.0.1:8765/index.html",wait_until="domcontentloaded",timeout=45000)
        page.locator("#coastalMap").scroll_into_view_if_needed()
        page.wait_for_timeout(8000)
        def measure():
            return page.evaluate("""() => {
              const root=document.getElementById('coastalMap');
              const box=root.getBoundingClientRect();
              const imgs=[...root.querySelectorAll('.leaflet-tile')];
              const loaded=imgs.filter(im=>im.complete&&im.naturalWidth>0&&getComputedStyle(im).opacity!=='0');
              const overlay=root.querySelector('.leaflet-control-zoom');
              const markers=root.querySelectorAll('.leaflet-marker-icon').length;
              const sample=[];
              for(let ry=.12;ry<=.88;ry+=.19)for(let rx=.12;rx<=.88;rx+=.19){
                const px=box.x+box.width*rx,py=box.y+box.height*ry;
                sample.push(loaded.some(im=>{const b=im.getBoundingClientRect();return px>=b.x+2&&px<=b.right-2&&py>=b.y+2&&py<=b.bottom-2}));
              }
              return {width:Math.round(box.width),height:Math.round(box.height),tileCount:imgs.length,loadedCount:loaded.length,
                loadedFraction:sample.filter(Boolean).length/sample.length,
                tilePosition:imgs.length?getComputedStyle(imgs[0]).position:null,
                leafletMapPosition:getComputedStyle(root.querySelector('.leaflet-map-pane')||root).position,
                zoomControl:!!overlay&&getComputedStyle(overlay).display!=='none',
                cameraMarkers:markers,cssRules:[...document.styleSheets].reduce((n,s)=>{try{return n+s.cssRules.length}catch(e){return n}},0)};
            }""")
        first=measure()
        print("MAP_INITIAL",json.dumps(first),flush=True)
        page.locator("#coastalMap").screenshot(path="map-smoke.png",timeout=30000)
        assert not errors, "Browser JS errors: "+repr(errors)
        assert first["width"]>700 and first["height"]>350, "Map not sized"
        assert first["tilePosition"]=="absolute", "Leaflet tile CSS not applied"
        assert first["loadedCount"]>=8, "Insufficient fetched map tiles"
        assert first["loadedFraction"]>=.92, "Map has blank gaps among loaded tiles"
        assert first["zoomControl"] and first["cameraMarkers"]>=3, "Map controls/cameras not rendered"
        page.locator("#coastalBasemap").select_option("imagery")
        page.wait_for_timeout(6000)
        aerial=measure()
        print("MAP_AERIAL",json.dumps(aerial),flush=True)
        assert aerial["loadedFraction"]>=.90, "Aerial map has missing tiles or fails fallback"
        page.locator("#coastalBasemap").select_option("streets")
        page.wait_for_timeout(5000)
        streets=measure()
        print("MAP_RETURN",json.dumps(streets),flush=True)
        assert streets["loadedFraction"]>=.92, "Street map did not recover after switching"
        browser.close()
        print("PASS: complete street + aerial + return, active map controls and camera markers",flush=True)
if __name__=="__main__":main()
