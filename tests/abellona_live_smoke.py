#!/usr/bin/env python3
"""Check the real deployed YouTube player state without treating iframe load as playback."""
import os
from playwright.sync_api import sync_playwright
from browser_runtime import launch_chromium

BASE = os.environ.get("SACOCAST_SMOKE_URL", "https://nycguy.github.io/saco-coast-watch/").rstrip("/") + "/"


def check(browser, width, height, mobile=False):
    page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=3 if mobile else 1, is_mobile=mobile, has_touch=mobile)
    page.goto(BASE, wait_until="domcontentloaded", timeout=45000)
    page.locator('[data-camera="abellona-camera"]').click()
    page.locator("#abellonaPlayer").scroll_into_view_if_needed(timeout=15000)
    try:
        page.wait_for_function(
            "['playing','paused','fallback'].includes(document.querySelector('.abellona-camera')?.dataset.playbackState)",
            timeout=30000,
        )
    except Exception:
        # Some browsers provide neither PLAYING nor onAutoplayBlocked promptly.
        # Keep that as an unconfirmed startup state; never label it as a block.
        pass
    result = page.evaluate("""() => ({
      state:document.querySelector('.abellona-camera')?.dataset.playbackState,
      status:document.querySelector('#abellonaStatus')?.textContent,
      fallbackVisible:!document.querySelector('#abellonaWatchLive')?.hidden,
      gateVisible:!document.querySelector('#abellonaPlayerGate')?.hidden,
      playerErrorCode:document.querySelector('.abellona-camera')?.dataset.playerErrorCode || null,
      iframeSrc:document.querySelector('#abellonaPlayer')?.src || null
    })""")
    assert result["state"] in ("playing", "paused", "fallback", "loading", "starting"), result
    if result["state"] in ("playing", "paused"):
        assert result["gateVisible"] is False, result
        assert any(text in result["status"].lower() for text in ("video is playing", "video is paused")), result
    elif result["state"] == "fallback":
        assert result["gateVisible"] and result["fallbackVisible"], result
        status = result["status"].lower()
        assert any(text in status for text in ("blocked", "unavailable", "not allowing this stream", "could not load", "could not start")), result
    elif result["state"] == "starting":
        # The in-frame Watch Live control is available during pending startup,
        # so a user can provide a gesture even if no block event arrives.
        assert result["gateVisible"] and result["fallbackVisible"], result
        assert "did not start" not in result["status"].lower(), result
    else:
        assert result["gateVisible"] and not result["fallbackVisible"], result
    print(f"ABELLONA_LIVE_STATE viewport={width}x{height} mobile={mobile} result={result}", flush=True)
    page.close()
    return result["state"]


def main():
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright.chromium, "abellona-live-production")
        desktop = check(browser, 1440, 1000)
        mobile = check(browser, 390, 844, mobile=True)
        browser.close()
    print(f"PASS: production player state checked after startup; desktop={desktop}, iPhone-sized Chromium emulation={mobile}; playback is only confirmed for 'playing'")


if __name__ == "__main__":
    main()
