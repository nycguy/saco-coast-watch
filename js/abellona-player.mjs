export const ABELLONA_VIDEO_ID = 'HSQpqIWLViI';
const YOUTUBE_WATCH_URL = `https://www.youtube.com/watch?v=${ABELLONA_VIDEO_ID}`;
const API_URL = 'https://www.youtube.com/iframe_api';
const PLAYING = 1;
const DEFAULT_FALLBACK_MS = 9000;

let sharedApiLoad;

function loadYouTubeApi(win, doc) {
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (sharedApiLoad) return sharedApiLoad;
  sharedApiLoad = new Promise((resolve, reject) => {
    let settled = false;
    const timeout = win.setTimeout(() => fail(new Error('YouTube player API timed out')), 12000);
    function fail(error) {
      if (settled) return;
      settled = true;
      win.clearTimeout(timeout);
      sharedApiLoad = null;
      reject(error);
    }
    const previousReady = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      try { previousReady?.(); } catch (_) { /* Keep SacoCast independent of other page callbacks. */ }
      if (settled) return;
      if (win.YT?.Player) {
        settled = true;
        win.clearTimeout(timeout);
        resolve(win.YT);
      } else fail(new Error('YouTube player API did not initialize'));
    };
    const script = doc.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => fail(new Error('YouTube player API could not load'));
    (doc.head || doc.body).appendChild(script);
  });
  return sharedApiLoad;
}

export function createAbellonaPlayer({
  win = globalThis.window,
  doc = globalThis.document,
  fallbackMs = DEFAULT_FALLBACK_MS,
  apiLoader = loadYouTubeApi,
} = {}) {
  const mount = doc?.getElementById('abellonaPlayer');
  const gate = doc?.getElementById('abellonaPlayerGate');
  const gateMessage = doc?.getElementById('abellonaGateMessage');
  const watchButton = doc?.getElementById('abellonaWatchLive');
  const status = doc?.getElementById('abellonaStatus');
  const camera = doc?.querySelector('.abellona-camera');
  if (!mount || !gate || !gateMessage || !watchButton || !status) return null;

  let player = null;
  let playback = 'waiting';
  let hasPlayed = false;
  let fallbackTimer = null;
  let started = false;
  let watchOnYouTube = false;

  function setStatus(message) {
    status.textContent = message;
  }

  function clearFallbackTimer() {
    if (fallbackTimer !== null) win.clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  function showFallback(message, { external = false } = {}) {
    playback = 'fallback';
    watchOnYouTube = external;
    if (camera) camera.dataset.playbackState = playback;
    gate.hidden = false;
    gateMessage.textContent = message;
    watchButton.hidden = false;
    watchButton.disabled = false;
    watchButton.textContent = external ? 'Watch on YouTube' : 'Watch Live';
    setStatus(external
      ? message + ' Select Watch on YouTube to watch the official stream.'
      : message + ' Select Watch Live to try again, or open the camera on YouTube.');
  }

  function waitForPlayback(message = 'Starting muted live video…') {
    clearFallbackTimer();
    playback = 'starting';
    if (camera) camera.dataset.playbackState = playback;
    gate.hidden = false;
    gateMessage.textContent = message;
    watchButton.hidden = true;
    watchButton.disabled = false;
    setStatus(message);
    fallbackTimer = win.setTimeout(() => {
      if (!hasPlayed) showFallback('Autoplay did not start.');
    }, fallbackMs);
  }

  function onPlayerState(event) {
    const state = event?.data;
    if (state === PLAYING) {
      hasPlayed = true;
      playback = 'playing';
      clearFallbackTimer();
      if (camera) camera.dataset.playbackState = playback;
      gate.hidden = true;
      watchButton.hidden = true;
      setStatus('The Abellona live video is playing.');
      return;
    }
    if (state === 0 && !hasPlayed) {
      clearFallbackTimer();
      showFallback('The embedded live video has ended or is unavailable.');
    } else if (state === 3 && !hasPlayed) {
      gateMessage.textContent = 'Connecting to the live video…';
      setStatus('Connecting to the Abellona live video…');
    } else if (state === 2 && hasPlayed) {
      playback = 'paused';
      if (camera) camera.dataset.playbackState = playback;
      setStatus('The Abellona video is paused. Use the video controls to resume it.');
    }
  }

  function onPlayerError(event) {
    // Keep YouTube's numeric diagnostic out of user-facing copy, but retain it
    // for production smoke tests and browser debugging.
    if (camera) camera.dataset.playerErrorCode = String(event?.data ?? 'unknown');
    clearFallbackTimer();
    const embedDenied = event?.data === 101 || event?.data === 150;
    showFallback(
      embedDenied
        ? 'YouTube is not allowing this stream to play inside SacoCast right now.'
        : 'The embedded live video is unavailable in this browser.',
      { external: embedDenied },
    );
  }

  function requestPlayback(fromGesture = false) {
    if (!player) return;
    waitForPlayback(fromGesture ? 'Trying to start muted live video…' : 'Starting muted live video…');
    try {
      player.mute();
      player.setVolume?.(0);
      player.playVideo();
    } catch (_) {
      showFallback('The embedded live video could not start.');
    }
  }

  async function initialize() {
    if (started) return;
    started = true;
    playback = 'loading';
    if (camera) camera.dataset.playbackState = playback;
    gate.hidden = false;
    gateMessage.textContent = 'Loading the live video…';
    setStatus('Loading the Abellona live video…');
    try {
      const yt = await apiLoader(win, doc);
      player = new yt.Player(mount, {
        videoId: ABELLONA_VIDEO_ID,
        playerVars: {
          autoplay: 1,
          mute: 1,
          playsinline: 1,
          controls: 1,
          rel: 0,
          enablejsapi: 1,
          origin: win.location?.origin || 'https://nycguy.github.io',
        },
        events: {
          onReady: (event) => {
            event?.target?.getIframe?.()?.setAttribute('title', 'Abellona Inn Old Orchard Beach live camera');
            requestPlayback(false);
          },
          onStateChange: onPlayerState,
          onError: onPlayerError,
        },
      });
    } catch (_) {
      showFallback('The embedded live video could not load.');
    }
  }

  watchButton.addEventListener('click', () => {
    if (watchOnYouTube) {
      win.open?.(YOUTUBE_WATCH_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!player) {
      started = false;
      initialize();
      return;
    }
    requestPlayback(true);
  });

  if (typeof win.IntersectionObserver === 'function') {
    const observer = new win.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        initialize();
      }
    }, { rootMargin: '240px 0px' });
    observer.observe(mount);
  } else {
    initialize();
  }

  return {
    initialize,
    getPlaybackState: () => playback,
    getVideoId: () => ABELLONA_VIDEO_ID,
    handlePlayerState: onPlayerState,
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  createAbellonaPlayer();
}
