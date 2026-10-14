#!/usr/bin/env python3
"""Deterministic desktop/mobile regression for the Abellona YouTube player."""
from playwright.sync_api import sync_playwright
from browser_runtime import launch_chromium

BASE = "http://127.0.0.1:8765/"
PLAYER_STUB = r"""
(() => {
  window.__abellonaMode = 'playing';
  window.__abellonaCalls = [];
  window.YT = {
    Player: class {
      constructor(mount, config) {
        window.__abellonaConfig = config;
        window.__abellonaMount = mount;
        this.mute = () => window.__abellonaCalls.push('mute');
        this.setVolume = value => window.__abellonaCalls.push(`volume:${value}`);
        this.playVideo = () => {
          window.__abellonaCalls.push('play');
          if (window.__abellonaMode === 'playing') config.events.onStateChange({data:1});
          else if (window.__abellonaMode === 'error') config.events.onError({data:150});
        };
        setTimeout(() => {
          if (window.__abellonaMode === 'error') config.events.onError({data:150});
          else config.events.onReady({target:this});
        }, 0);
      }
    }
  };
})();
"""


def check_viewport(browser, width, height, fallback=False):
    page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=2 if width < 500 else 1)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(PLAYER_STUB)
    page.goto(BASE, wait_until="domcontentloaded", timeout=45000)
    player = page.locator("#abellonaPlayer")
    player.scroll_into_view_if_needed()
    page.wait_for_function("document.querySelector('.abellona-camera')?.dataset.playbackState === 'playing'", timeout=15000) if not fallback else None
    config = page.evaluate("window.__abellonaConfig && ({videoId:window.__abellonaConfig.videoId,vars:window.__abellonaConfig.playerVars})")
    assert config and config["videoId"] == "HSQpqIWLViI", config
    assert config["vars"]["autoplay"] == 1 and config["vars"]["mute"] == 1 and config["vars"]["playsinline"] == 1, config
    if fallback:
        page.evaluate("window.__abellonaMode='error'; window.__abellonaConfig.events.onError({data:150})")
        page.locator("#abellonaWatchLive").wait_for(state="visible", timeout=3000)
        assert "unavailable" in page.locator("#abellonaStatus").inner_text().lower()
        page.evaluate("window.__abellonaMode='playing'")
        page.locator("#abellonaWatchLive").click()
        page.wait_for_function("document.querySelector('.abellona-camera')?.dataset.playbackState === 'playing'", timeout=5000)
        assert page.locator("#abellonaPlayerGate").is_hidden()
    else:
        assert page.locator("#abellonaPlayerGate").is_hidden()
        assert "video is playing" in page.locator("#abellonaStatus").inner_text().lower()
    assert page.evaluate("document.documentElement.scrollWidth-window.innerWidth") <= 3
    assert not errors, errors
    page.close()


def main():
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright.chromium, "abellona-player")
        check_viewport(browser, 1440, 1000)
        check_viewport(browser, 390, 844, fallback=True)
        browser.close()
    print("PASS: Abellona autoplay configuration, confirmed PLAYING state, muted inline mode, mobile fallback and retry")


if __name__ == "__main__":
    main()
