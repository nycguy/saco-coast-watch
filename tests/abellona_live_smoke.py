#!/usr/bin/env python3
"""Check the real deployed YouTube player state without treating iframe load as playback."""
import os
from playwright.sync_api import sync_playwright
from browser_runtime import launch_chromium

BASE = os.environ.get("SACOCAST_SMOKE_URL", "https://nycguy.github.io/saco-coast-watch/").rstrip("/") + "/"


def check(browser, width, height, mobile=False):
    page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=3 if mobile else 1, is_mobile=mobile, has_touch=mobile)
    page.goto(BASE, wait_until="domcontentloaded", timeout=45000)
    page.locator("#abellonaPlayer").scroll_into_view_if_needed(timeout=15000)
    page.wait_for_function(
        "['playing','fallback'].includes(document.querySelector('.abellona-camera')?.dataset.playbackState)",
        timeout=30000,
    )
    result = page.evaluate("""() => ({
      state:document.querySelector('.abellona-camera')?.dataset.playbackState,
      status:document.querySelector('#abellonaStatus')?.textContent,
      fallbackVisible:!document.querySelector('#abellonaWatchLive')?.hidden,
      gateVisible:!document.querySelector('#abellonaPlayerGate')?.hidden,
      playerErrorCode:document.querySelector('.abellona-camera')?.dataset.playerErrorCode || null,
      iframeSrc:document.querySelector('#abellonaPlayer iframe')?.src || null
    })""")
    if result["state"] == "playing":
        assert result["gateVisible"] is False, result
        assert "video is playing" in result["status"].lower(), result
    else:
        assert result["gateVisible"] and result["fallbackVisible"], result
        assert "did not start" in result["status"].lower() or "unavailable" in result["status"].lower(), result
    print(f"ABELLONA_LIVE_STATE viewport={width}x{height} mobile={mobile} result={result}", flush=True)
    page.close()
    return result["state"]


def main():
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright.chromium, "abellona-live-production")
        desktop = check(browser, 1440, 1000)
        mobile = check(browser, 390, 844, mobile=True)
        browser.close()
    print(f"PASS: production player state checked after startup; desktop={desktop}, iPhone-sized Chromium emulation={mobile}")


if __name__ == "__main__":
    main()
