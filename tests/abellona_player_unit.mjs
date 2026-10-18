import test from 'node:test';
import assert from 'node:assert/strict';
import { ABELLONA_VIDEO_ID, createAbellonaPlayer } from '../js/abellona-player.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(apiLoaderOverride) {
  const elements = new Map();
  for (const id of ['abellonaPlayer','abellonaPlayerGate','abellonaGateMessage','abellonaWatchLive','abellonaStatus']) {
    elements.set(id, {
      id, hidden: id === 'abellonaWatchLive', disabled: false, textContent: '', dataset: {},
      src: '',
      isConnected: true,
      getBoundingClientRect() { return { width: 640, height: 360 }; },
      dataset: id === 'abellonaPlayer' ? { src: 'https://www.youtube.com/embed/HSQpqIWLViI?autoplay=1&mute=1&playsinline=1&enablejsapi=1&origin=https%3A%2F%2Fnycguy.github.io' } : {},
      listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; },
      click() { this.listeners.click?.({ type: 'click' }); },
    });
  }
  const camera = { dataset: {} };
  const documentListeners = {};
  let constructors = 0;
  let playerConfig;
  let playerElement;
  const calls = [];
  const win = {
    location: { origin: 'https://nycguy.github.io' },
    opened: [],
    open(...args) { this.opened.push(args); },
    // A playback watchdog would incorrectly turn delayed startup into failure.
    setTimeout() { throw new Error('unexpected autoplay watchdog'); },
    clearTimeout() {},
  };
  const doc = {
    getElementById(id) { return elements.get(id); },
    querySelector() { return camera; },
    addEventListener(name, callback) { documentListeners[name] = callback; },
  };
  const apiLoader = async () => ({
    Player: class {
      constructor(element, config) { constructors += 1; playerElement = element; playerConfig = config; }
      mute() { calls.push('mute'); }
      setVolume(value) { calls.push(`volume:${value}`); }
      playVideo() { calls.push('play'); }
      pauseVideo() { calls.push('pause'); }
      getPlayerState() { return -1; }
    },
  });
  const controller = createAbellonaPlayer({ win, doc, apiLoader: apiLoaderOverride || apiLoader });
  return {
    controller, elements, camera, calls, win,
    get playerConfig() { return playerConfig; },
    set playerConfig(value) { playerConfig = value; },
    get playerElement() { return playerElement; },
    get constructors() { return constructors; },
    async enterViewport() {
      documentListeners['sacocast:camera-selected']({ detail: { camera: 'abellona-camera' } });
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('selecting Abellona initializes muted inline autoplay and confirms actual PLAYING state', async () => {
  const f = fixture();
  assert.equal(f.controller.getPlaybackState(), 'waiting');
  assert.equal(f.elements.get('abellonaPlayer').src, '');
  await f.enterViewport();
  assert.equal(f.playerElement, f.elements.get('abellonaPlayer'));
  assert.equal(f.elements.get('abellonaPlayer').src.includes(`/embed/${ABELLONA_VIDEO_ID}?`), true);
  for (const param of ['autoplay=1','mute=1','playsinline=1','enablejsapi=1','origin=https%3A%2F%2Fnycguy.github.io']) {
    assert.equal(f.elements.get('abellonaPlayer').src.includes(param), true, param);
  }
  f.playerConfig.events.onReady({});
  assert.deepEqual(f.calls, ['mute','volume:0','play']);
  assert.equal(f.elements.get('abellonaPlayerGate').hidden, false);
  assert.match(f.elements.get('abellonaGateMessage').textContent, /Starting muted/);
  assert.equal(f.elements.get('abellonaWatchLive').hidden, false);
  f.playerConfig.events.onStateChange({ data: 1 });
  assert.equal(f.controller.getPlaybackState(), 'playing');
  assert.equal(f.camera.dataset.playbackState, 'playing');
  assert.equal(f.elements.get('abellonaPlayerGate').hidden, true);
  assert.match(f.elements.get('abellonaStatus').textContent, /YouTube reports playback/);
});

test('delayed API/player initialization stays in a loading state and later playback is accepted', async () => {
  const api = deferred();
  const f = fixture(() => api.promise);
  await f.enterViewport();
  assert.equal(f.controller.getPlaybackState(), 'loading');
  assert.equal(f.elements.get('abellonaWatchLive').hidden, true);
  assert.doesNotMatch(f.elements.get('abellonaStatus').textContent, /did not start|blocked/i);
  api.resolve({ Player: class {
    constructor(_element, config) { f.playerConfig = config; }
    mute() {}
    setVolume() {}
    playVideo() {}
  } });
  await new Promise((resolve) => setImmediate(resolve));
  f.playerConfig.events.onReady({});
  assert.equal(f.controller.getPlaybackState(), 'starting');
  assert.equal(f.elements.get('abellonaWatchLive').hidden, false);
  assert.doesNotMatch(f.elements.get('abellonaGateMessage').textContent, /did not start|blocked/i);
  f.playerConfig.events.onStateChange({ data: 1 });
  assert.equal(f.controller.getPlaybackState(), 'playing');
});

test('documented autoplay-block event shows the in-frame Watch Live fallback', async () => {
  const f = fixture();
  await f.enterViewport();
  f.playerConfig.events.onReady({});
  f.playerConfig.events.onAutoplayBlocked();
  assert.equal(f.controller.getPlaybackState(), 'fallback');
  assert.equal(f.elements.get('abellonaWatchLive').hidden, false);
  assert.equal(f.elements.get('abellonaWatchLive').textContent, 'Watch Live');
  assert.match(f.elements.get('abellonaGateMessage').textContent, /Automatic playback is blocked/);
  assert.match(f.elements.get('abellonaStatus').textContent, /Watch Live/);
});

test('PLAYING event does not claim playback when the iframe has no visible dimensions', async () => {
  const f = fixture();
  await f.enterViewport();
  f.playerConfig.events.onReady({});
  f.elements.get('abellonaPlayer').getBoundingClientRect = () => ({ width: 0, height: 0 });
  f.playerConfig.events.onStateChange({ data: 1 });
  assert.equal(f.controller.getPlaybackState(), 'ready');
  assert.equal(f.elements.get('abellonaPlayerGate').hidden, false);
  assert.equal(f.elements.get('abellonaWatchLive').textContent, 'Watch on YouTube');
  assert.match(f.elements.get('abellonaStatus').textContent, /cannot confirm a visible video frame/);
});

test('user-initiated playback uses the existing player and closes fallback only after PLAYING', async () => {
  const f = fixture();
  await f.enterViewport();
  f.playerConfig.events.onReady({});
  f.playerConfig.events.onAutoplayBlocked();
  f.elements.get('abellonaWatchLive').click();
  assert.equal(f.controller.getPlaybackState(), 'starting');
  assert.equal(f.elements.get('abellonaWatchLive').hidden, false);
  assert.deepEqual(f.calls, ['mute','volume:0','play','mute','volume:0','play']);
  f.playerConfig.events.onStateChange({ data: 1 });
  assert.equal(f.controller.getPlaybackState(), 'playing');
  assert.equal(f.elements.get('abellonaPlayerGate').hidden, true);
  assert.equal(f.constructors, 1);
});

test('player errors reveal a clear fallback and embed-denied errors link to the official stream', async () => {
  const f = fixture();
  await f.enterViewport();
  f.playerConfig.events.onError({ data: 150 });
  assert.equal(f.controller.getPlaybackState(), 'fallback');
  assert.equal(f.camera.dataset.playerErrorCode, '150');
  assert.equal(f.elements.get('abellonaWatchLive').hidden, false);
  assert.equal(f.elements.get('abellonaWatchLive').textContent, 'Watch on YouTube');
  assert.match(f.elements.get('abellonaGateMessage').textContent, /not allowing this stream/);
  f.elements.get('abellonaWatchLive').click();
  assert.deepEqual(f.win.opened, [['https://www.youtube.com/watch?v=HSQpqIWLViI','_blank','noopener,noreferrer']]);
});

test('late blocked/error events cannot cover video after playback has begun', async () => {
  const f = fixture();
  await f.enterViewport();
  f.playerConfig.events.onReady({});
  f.playerConfig.events.onStateChange({ data: 1 });
  f.playerConfig.events.onAutoplayBlocked();
  f.playerConfig.events.onError({ data: 150 });
  assert.equal(f.controller.getPlaybackState(), 'playing');
  assert.equal(f.elements.get('abellonaPlayerGate').hidden, true);
});

test('Abellona stays unloaded until selected and switching away pauses rather than playing the hidden stream', async () => {
  const f = fixture();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.controller.getPlaybackState(), 'waiting');
  assert.equal(f.constructors, 0);
  await f.enterViewport();
  f.playerConfig.events.onReady({});
  f.playerConfig.events.onStateChange({ data: 1 });
  f.controller.selectCamera(false);
  assert.equal(f.constructors, 1);
  assert.equal(f.calls.includes('pause'), true);
  assert.equal(f.elements.get('abellonaPlayer').src,'about:blank');
  f.controller.selectCamera(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.constructors,2);
  assert.equal(f.elements.get('abellonaPlayer').src.includes('/embed/'),true);
});

test('YouTube API load failures show a safe Watch Live fallback without exposing error details', async () => {
  const f = fixture(async () => { throw new Error('network detail stays private'); });
  await f.enterViewport();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.controller.getPlaybackState(), 'fallback');
  assert.equal(f.elements.get('abellonaWatchLive').hidden, false);
  assert.match(f.elements.get('abellonaGateMessage').textContent, /could not load/);
  assert.doesNotMatch(f.elements.get('abellonaStatus').textContent, /network detail/);
});
