import test from 'node:test';
import assert from 'node:assert/strict';
import { ABELLONA_VIDEO_ID, createAbellonaPlayer } from '../js/abellona-player.mjs';

function fixture(apiLoaderOverride) {
  const elements = new Map();
  for (const id of ['abellonaPlayer','abellonaPlayerGate','abellonaGateMessage','abellonaWatchLive','abellonaStatus']) {
    elements.set(id, {
      id, hidden: id === 'abellonaWatchLive', disabled: false, textContent: '', dataset: {},
      listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; },
      click() { this.listeners.click?.({ type: 'click' }); },
    });
  }
  const camera = { dataset: {} };
  const timers = [];
  let observed;
  const win = {
    location: { origin: 'https://nycguy.github.io' },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (id) timers[id - 1].cleared = true; },
    IntersectionObserver: class {
      constructor(callback, options) { observed = { callback, options, disconnected: false }; }
      observe(target) { observed.target = target; }
      disconnect() { observed.disconnected = true; }
    },
  };
  const doc = {
    getElementById(id) { return elements.get(id); },
    querySelector() { return camera; },
  };
  let playerConfig;
  const calls = [];
  let playPublishesState = false;
  const apiLoader = async () => ({
    Player: class {
      constructor(_mount, config) { playerConfig = config; }
      mute() { calls.push('mute'); }
      setVolume(value) { calls.push(`volume:${value}`); }
      playVideo() {
        calls.push('play');
        if (playPublishesState) playerConfig.events.onStateChange({ data: 1 });
      }
    },
  });
  const controller = createAbellonaPlayer({ win, doc, fallbackMs: 9000, apiLoader: apiLoaderOverride || apiLoader });
  return {
    controller, elements, camera, timers, calls, win,
    get playerConfig() { return playerConfig; },
    get observed() { return observed; },
    set playPublishesState(value) { playPublishesState = value; },
    async enterViewport() {
      observed.callback([{ isIntersecting: true }]);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('visible Abellona player initializes the official live ID muted and inline, then confirms real PLAYING state', async () => {
  const f = fixture();
  assert.equal(f.controller.getPlaybackState(), 'waiting');
  assert.equal(f.observed.options.rootMargin, '240px 0px');
  await f.enterViewport();
  assert.equal(f.observed.disconnected, true);
  assert.equal(f.playerConfig.videoId, ABELLONA_VIDEO_ID);
  assert.deepEqual(f.playerConfig.playerVars, {
    autoplay: 1, mute: 1, playsinline: 1, controls: 1, rel: 0, enablejsapi: 1,
    origin: 'https://nycguy.github.io',
  });
  f.playerConfig.events.onReady({});
  assert.deepEqual(f.calls, ['mute','volume:0','play']);
  assert.equal(f.elements.get('abellonaPlayerGate').hidden, false);
  f.playerConfig.events.onStateChange({ data: 1 });
  assert.equal(f.controller.getPlaybackState(), 'playing');
  assert.equal(f.camera.dataset.playbackState, 'playing');
  assert.equal(f.elements.get('abellonaPlayerGate').hidden, true);
  assert.match(f.elements.get('abellonaStatus').textContent, /video is playing/);
});

test('autoplay timeout covers the poster and offers a user-gesture Watch Live retry', async () => {
  const f = fixture();
  await f.enterViewport();
  f.playerConfig.events.onReady({});
  const timer = f.timers.at(-1);
  assert.equal(timer.ms, 9000);
  timer.fn();
  assert.equal(f.controller.getPlaybackState(), 'fallback');
  assert.equal(f.elements.get('abellonaPlayerGate').hidden, false);
  assert.equal(f.elements.get('abellonaWatchLive').hidden, false);
  assert.match(f.elements.get('abellonaGateMessage').textContent, /Autoplay did not start/);
  f.playPublishesState = true;
  f.elements.get('abellonaWatchLive').click();
  assert.deepEqual(f.calls.slice(-3), ['mute','volume:0','play']);
  assert.equal(f.controller.getPlaybackState(), 'playing');
  assert.equal(f.elements.get('abellonaWatchLive').hidden, true);
});

test('YouTube embed errors show an explicit fallback instead of presenting the poster as live', async () => {
  const f = fixture();
  await f.enterViewport();
  f.playerConfig.events.onError({ data: 150 });
  assert.equal(f.controller.getPlaybackState(), 'fallback');
  assert.equal(f.elements.get('abellonaWatchLive').hidden, false);
  assert.match(f.elements.get('abellonaGateMessage').textContent, /unavailable in this browser/);
  assert.match(f.elements.get('abellonaStatus').textContent, /open the camera on YouTube/);
});

test('IFrame API load failures also reveal the Watch Live fallback', async () => {
  const f = fixture(async () => { throw new Error('network detail stays private'); });
  await f.enterViewport();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.controller.getPlaybackState(), 'fallback');
  assert.equal(f.elements.get('abellonaWatchLive').hidden, false);
  assert.match(f.elements.get('abellonaGateMessage').textContent, /could not load/);
  assert.doesNotMatch(f.elements.get('abellonaStatus').textContent, /network detail/);
});
