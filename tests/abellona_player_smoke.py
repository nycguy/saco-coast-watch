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
    # IntersectionObserver initialization is asynchronous. On the fallback path
    # wait for the API player to exist before simulating its error state.
    page.wait_for_function("Boolean(window.__abellonaConfig)", timeout=15000)
    page.wait_for_function("document.querySelector('.abellona-camera')?.dataset.playbackState === 'playing'", timeout=15000) if not fallback else None
    config = page.evaluate("window.__abellonaConfig && ({id:window.__abellonaMount.id,src:window.__abellonaMount.src})")
    assert config and config["id"] == "abellonaPlayer", config
    assert "/embed/HSQpqIWLViI?" in config["src"], config
    assert all(param in config["src"] for param in ("autoplay=1","mute=1","playsinline=1","enablejsapi=1")), config
    if fallback:
        page.evaluate("window.__abellonaMode='error'; window.__abellonaConfig.events.onError({data:150})")
        page.locator("#abellonaWatchLive").wait_for(state="visible", timeout=3000)
        assert page.locator("#abellonaWatchLive").inner_text() == "Watch on YouTube"
        assert "not allowing this stream" in page.locator("#abellonaStatus").inner_text().lower()
        page.evaluate("window.open = (url, target, features) => window.__openedWatchUrl = {url,target,features}")
        page.locator("#abellonaWatchLive").click()
        assert page.evaluate("window.__openedWatchUrl?.url") == "https://www.youtube.com/watch?v=HSQpqIWLViI"
        assert page.locator("#abellonaPlayerGate").is_visible()
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
