#!/usr/bin/env python3
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE="http://127.0.0.1:8765/eastcast/"

def main():
    errors=[]
    with sync_playwright() as p:
        browser=p.chromium.launch()
        page=browser.new_page(viewport={"width":390,"height":844},device_scale_factor=2)
        page.on("pageerror",lambda exc: errors.append("pageerror: "+str(exc)))
        page.goto(BASE,wait_until="domcontentloaded",timeout=30000)
        page.wait_for_function("document.querySelector('#metricAlerts') && document.querySelector('#metricAlerts').textContent.trim() !== '…'",timeout=25000)

        headline=page.locator("#nowHeadline").inner_text()
        assert "Loading" not in headline, headline
        assert page.locator("#changesList").count()==1
        assert page.locator("#watchList .watch-card").count()>=1
        assert page.locator("#impactTimeline .timeline-card").count()==5
        assert page.locator("#stateStory .state-row").count()>=10
        assert page.locator("#outlookCards .outlook-card").count()>=4
        assert page.locator("#coastalPulse .coastal-card").count()>=4
        coastal_text=page.locator("#coastal-section").inner_text()
        assert "Departure" in coastal_text
        assert "not a storm-surge estimate" in coastal_text

        page.wait_for_function("document.querySelector('#eastMap .leaflet-pane') !== null",timeout=20000)
        assert page.locator("#eastMap .leaflet-pane").count()>=1
        assert page.locator("#mapLayerStatus").inner_text().strip()

        page.locator('.map-mode[data-mode="rain"]').click()
        assert "active" in (page.locator('.map-mode[data-mode="rain"]').get_attribute("class") or "")
        page.locator('#forecastHorizon button[data-horizon="12"]').click()
        assert "active" in (page.locator('#forecastHorizon button[data-horizon="12"]').get_attribute("class") or "")

        page.locator('.map-mode[data-mode="cameras"]').click()
        assert "WebCOOS" in page.locator("#mapLayerStatus").inner_text()

        page.locator('#radar-section').scroll_into_view_if_needed()
        page.wait_for_timeout(1200)
        radar_ok=page.eval_on_selector("#radarGif","el => el.complete && el.naturalWidth > 0")
        fallback_visible=page.locator("#radarFallback").is_visible()
        assert radar_ok or fallback_visible

        overflow=page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 3, f"mobile horizontal overflow: {overflow}px"

        Path("eastcast-smoke-mobile.png").unlink(missing_ok=True)
        page.screenshot(path="eastcast-smoke-mobile.png",full_page=True)

        # Desktop layout and key hierarchy.
        desktop=browser.new_page(viewport={"width":1440,"height":1000})
        desktop.goto(BASE,wait_until="domcontentloaded",timeout=30000)
        desktop.wait_for_function("document.querySelector('#metricAlerts').textContent.trim() !== '…'",timeout=25000)
        desktop.wait_for_function("document.querySelector('#eastMap .leaflet-pane') !== null",timeout=20000)
        assert desktop.locator(".now-grid").bounding_box()["y"] < desktop.locator("#map-section").bounding_box()["y"]
        desktop.screenshot(path="eastcast-smoke-desktop.png",full_page=False)
        desktop.close()

        browser.close()

    if errors:
        raise AssertionError("\n".join(errors))
    print("EastCast browser smoke test passed")

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        print("EastCast smoke test failed:",exc,file=sys.stderr)
        raise
