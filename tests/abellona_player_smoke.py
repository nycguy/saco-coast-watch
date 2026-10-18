#!/usr/bin/env python3
"""Desktop and iPhone-sized browser regression for the Abellona player."""
from playwright.sync_api import sync_playwright
from browser_runtime import launch_chromium

BASE = "http://127.0.0.1:8765/"
PLAYER_STUB = r"""
(() => {
  const params = new URLSearchParams(location.search);
  window.__abellonaMode = params.get('playerMode') || 'playing';
  window.__abellonaCalls = [];
  window.YT = {
    Player: class {
      constructor(mount, config) {
        window.__abellonaConfig = config;
        window.__abellonaMount = mount;
        this.getIframe = () => mount;
        this.getPlayerState = () => -1;
        this.mute = () => window.__abellonaCalls.push('mute');
        this.setVolume = value => window.__abellonaCalls.push(`volume:${value}`);
        this.playVideo = () => {
          window.__abellonaCalls.push('play');
          const mode = window.__abellonaMode;
          if (mode === 'playing' || (mode === 'blockedThenGesture' && window.__abellonaCalls.filter(call => call === 'play').length > 1)) {
            config.events.onStateChange({data:1});
          } else if (mode === 'delayed') {
            setTimeout(() => config.events.onStateChange({data:1}), 1200);
          } else if (mode === 'blocked' || mode === 'blockedThenGesture') {
            config.events.onAutoplayBlocked();
          } else if (mode === 'error') {
            config.events.onError({data:150});
          }
        };
        const readyDelay = window.__abellonaMode === 'delayed' ? 900 : 20;
        setTimeout(() => config.events.onReady({target:this}), readyDelay);
      }
    }
  };
})();
"""


def open_player(browser, width, height, mode, mobile=False):
    page = browser.new_page(
        viewport={"width": width, "height": height},
        device_scale_factor=3 if mobile else 1,
        is_mobile=mobile,
        has_touch=mobile,
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(PLAYER_STUB)
    page.goto(f"{BASE}?playerMode={mode}", wait_until="domcontentloaded", timeout=45000)
    page.locator('[data-camera="abellona-camera"]').click()
    player = page.locator("#abellonaPlayer")
    player.scroll_into_view_if_needed()
    page.wait_for_function("""() => {const frame=document.querySelector('#abellonaPlayer'),camera=document.querySelector('.abellona-camera'),r=frame?.getBoundingClientRect();return Boolean(frame?.isConnected&&!camera?.hidden&&r?.width>0&&r?.height>0)}""", timeout=5000)
    page.wait_for_function("Boolean(window.__abellonaConfig)", timeout=15000)
    config = page.evaluate("window.__abellonaConfig && ({id:window.__abellonaMount.id,src:window.__abellonaMount.src})")
    assert config and config["id"] == "abellonaPlayer", config
    assert "/embed/HSQpqIWLViI?" in config["src"], config
    assert all(param in config["src"] for param in ("autoplay=1", "mute=1", "playsinline=1", "enablejsapi=1")), config
    page.wait_for_function("window.__abellonaCalls.includes('play')", timeout=15000)
    return page, errors


def main():
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright.chromium, "abellona-player")

        # Desktop: muted autoplay reaches actual PLAYING state.
        page, errors = open_player(browser, 1440, 1000, "playing")
        try:
            page.wait_for_function("document.querySelector('.abellona-camera')?.dataset.playbackState === 'playing'",timeout=10000)
        except Exception as error:
            diagnostic=page.evaluate("""() => {const frame=document.querySelector('#abellonaPlayer'),camera=document.querySelector('.abellona-camera'),r=frame?.getBoundingClientRect(),s=frame&&getComputedStyle(frame);return {state:camera?.dataset.playbackState,status:document.querySelector('#abellonaStatus')?.textContent,hidden:camera?.hidden,connected:frame?.isConnected,rect:r&&{width:r.width,height:r.height},display:s?.display,visibility:s?.visibility};}""")
            raise AssertionError(f"Abellona did not report playback with visible frame geometry: {diagnostic}") from error
        assert page.locator("#abellonaPlayerGate").is_hidden()
        assert "video is playing" in page.locator("#abellonaStatus").inner_text().lower()
        assert not errors, errors
        page.close()

        # iPhone-sized: delayed player initialization must not create a false failure.
        page, errors = open_player(browser, 390, 844, "delayed", mobile=True)
        assert page.locator("#abellonaPlayerGate").is_visible()
        assert page.locator("#abellonaWatchLive").is_visible()
        assert "did not start" not in page.locator("#abellonaStatus").inner_text().lower()
        try:
            page.wait_for_function("document.querySelector('.abellona-camera')?.dataset.playbackState === 'playing'", timeout=5000)
        except Exception as error:
            diagnostic=page.evaluate("""() => {const frame=document.querySelector('#abellonaPlayer'),camera=document.querySelector('.abellona-camera'),r=frame?.getBoundingClientRect(),s=frame&&getComputedStyle(frame);return {state:camera?.dataset.playbackState,status:document.querySelector('#abellonaStatus')?.textContent,hidden:camera?.hidden,connected:frame?.isConnected,rect:r&&{width:r.width,height:r.height},display:s?.display,visibility:s?.visibility};}""")
            raise AssertionError(f"Abellona mobile playback did not start despite visible frame geometry: {diagnostic}") from error
        assert page.locator("#abellonaPlayerGate").is_hidden()
        assert page.evaluate("window.__abellonaCalls.filter(call => call === 'play').length") == 1
        assert not errors, errors
        page.close()

        # iPhone-sized browser policy block: show fallback and keep playback in-frame after a gesture.
        page, errors = open_player(browser, 390, 844, "blockedThenGesture", mobile=True)
        page.locator("#abellonaWatchLive").wait_for(state="visible", timeout=3000)
        assert "automatic playback is blocked" in page.locator("#abellonaStatus").inner_text().lower()
        page.locator("#abellonaWatchLive").click()
        page.wait_for_function("document.querySelector('.abellona-camera')?.dataset.playbackState === 'playing'")
        assert page.locator("#abellonaPlayerGate").is_hidden()
        assert page.evaluate("window.__abellonaCalls.filter(call => call === 'play').length") == 2
        assert not errors, errors
        page.close()

        # Player errors have a clear fallback, without presenting the underlying poster as live.
        page, errors = open_player(browser, 1440, 1000, "error")
        page.locator("#abellonaWatchLive").wait_for(state="visible", timeout=3000)
        assert page.locator("#abellonaWatchLive").inner_text() == "Watch on YouTube"
        assert page.locator("#abellonaPlayerGate").is_visible()
        assert not errors, errors
        page.close()
        browser.close()
    print("PASS: Abellona desktop autoplay, delayed startup, iPhone-sized blocked-autoplay fallback and in-frame user playback, and player errors")


if __name__ == "__main__":
    main()
