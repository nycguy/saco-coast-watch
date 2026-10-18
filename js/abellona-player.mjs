export const ABELLONA_VIDEO_ID = 'HSQpqIWLViI';
const YOUTUBE_WATCH_URL = `https://www.youtube.com/watch?v=${ABELLONA_VIDEO_ID}`;
const API_URL = 'https://www.youtube.com/iframe_api';
const PLAYING = 1;

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
  apiLoader = loadYouTubeApi,
} = {}) {
  const iframe = doc?.getElementById('abellonaPlayer');
  const gate = doc?.getElementById('abellonaPlayerGate');
  const gateMessage = doc?.getElementById('abellonaGateMessage');
  const watchButton = doc?.getElementById('abellonaWatchLive');
  const status = doc?.getElementById('abellonaStatus');
  const camera = doc?.querySelector('.abellona-camera');
  if (!iframe || !gate || !gateMessage || !watchButton || !status) return null;

  let player = null;
  let playback = 'waiting';
  let hasPlayed = false;
  let started = false;
  let watchOnYouTube = false;
  let userRequestedPlayback = false;
  let initialPlaybackRequested = false;
  let selected = false;

  function setStatus(message) {
    status.textContent = message;
  }

  function frameIsVisible() {
    if (iframe.isConnected === false || iframe.hidden || camera?.hidden) return false;
    const rect = iframe.getBoundingClientRect?.();
    if (!rect) return false;
    const style = win.getComputedStyle?.(iframe);
    return rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
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
    playback = 'starting';
    if (camera) camera.dataset.playbackState = playback;
    gate.hidden = false;
    gateMessage.textContent = message;
    watchButton.hidden = false;
    watchButton.disabled = false;
    watchButton.textContent = 'Watch Live';
    setStatus(message + ' If the video does not start, select Watch Live.');
  }

  function onPlayerState(event) {
    const state = event?.data;
    if (state === PLAYING) {
      if (!selected || !frameIsVisible()) {
        playback = 'ready';
        if (camera) camera.dataset.playbackState = playback;
        gate.hidden = false;
        gateMessage.textContent = 'The player started, but its video frame is not visible. Select Watch Live or open the official stream.';
        watchButton.hidden = false;
        watchButton.disabled = false;
        watchButton.textContent = 'Watch on YouTube';
        watchOnYouTube = true;
        setStatus('YouTube reported playback, but SacoCast cannot confirm a visible video frame. Open the official stream on YouTube.');
        return;
      }
      hasPlayed = true;
      playback = 'playing';
      if (camera) camera.dataset.playbackState = playback;
      gate.hidden = true;
      watchButton.hidden = true;
      setStatus('YouTube reports playback in the visible Abellona player. If the picture is blank, open the official stream on YouTube.');
      return;
    }
    if (state === 0 && !hasPlayed) {
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

  function onAutoplayBlocked() {
    if (hasPlayed) return;
    showFallback(userRequestedPlayback
      ? 'Video playback was blocked by this browser.'
      : 'Automatic playback is blocked by this browser.');
  }

  function onPlayerError(event) {
    if (hasPlayed) return;
    // Keep YouTube's numeric diagnostic out of user-facing copy, but retain it
    // for production smoke tests and browser debugging.
    if (camera) camera.dataset.playerErrorCode = String(event?.data ?? 'unknown');
    const code=Number(event?.data),embedDenied=code===101||code===150;
    const messages={
      2:'YouTube rejected the live-stream address.',
      5:'YouTube’s player could not decode the live stream.',
      100:'The live stream is unavailable or has ended.',
      101:'YouTube is not allowing this stream to play inside SacoCast.',
      150:'YouTube is not allowing this stream to play inside SacoCast.',
      153:'YouTube rejected embedded playback or its referrer check.',
    };
    if(camera)camera.dataset.playerFailure=embedDenied?'embedding_restricted':code===100?'stream_unavailable':'player_error';
    showFallback(messages[code]||'YouTube reported a live-player error.',{external:true});
  }

  function requestPlayback(fromGesture = false) {
    if (!player) return;
    if (hasPlayed) {
      if (playback === 'paused' && selected) {
        try { player.mute(); player.playVideo(); }
        catch (_) { showFallback('The embedded live video could not resume.'); }
      }
      return;
    }
    if (!fromGesture && initialPlaybackRequested) return;
    if (!fromGesture) initialPlaybackRequested = true;
    if (fromGesture) userRequestedPlayback = true;
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
    const source = iframe.dataset?.src;
    if (source && (!iframe.src || iframe.src === 'about:blank')) iframe.src = source;
    playback = 'loading';
    if (camera) camera.dataset.playbackState = playback;
    gate.hidden = false;
    gateMessage.textContent = 'Loading the live video…';
    setStatus('Loading the Abellona live video…');
    try {
      const yt = await apiLoader(win, doc);
      // Keep the iframe URL authored in the page, matching Abellona's former
      // working embed. Attach the API to that existing frame only for playback
      // state and muted retry controls; do not ask YT.Player to create it.
      player = new yt.Player(iframe, {
        events: {
          onReady: (event) => {
            event?.target?.getIframe?.()?.setAttribute('title', 'Abellona Inn Old Orchard Beach live camera');
            if (event?.target?.getPlayerState?.() === PLAYING) onPlayerState({ data: PLAYING });
            else if (selected) { playback = 'ready'; if (camera) camera.dataset.playbackState = playback; requestPlayback(false); }
          },
          onStateChange: onPlayerState,
          onAutoplayBlocked,
          onError: onPlayerError,
        },
      });
    } catch (_) {
      if(camera)camera.dataset.playerFailure='network_or_api';
      showFallback('The YouTube player API could not load. Check the network or open the official stream.',{external:true});
    }
  }

  function selectCamera(isSelected) {
    selected = Boolean(isSelected);
    if (!selected) {
      if (player && (playback === 'playing' || playback === 'starting')) {
        try { player.pauseVideo(); } catch (_) { /* The selected camera can change while YouTube is loading. */ }
      }
      if (started) {
        iframe.src = 'about:blank';
        player = null;
        started = false;
        hasPlayed = false;
        initialPlaybackRequested = false;
        userRequestedPlayback = false;
        watchOnYouTube = false;
        playback = 'waiting';
        if (camera) {
          camera.dataset.playbackState = playback;
          delete camera.dataset.playerErrorCode;
          delete camera.dataset.playerFailure;
        }
        gate.hidden = true;
        watchButton.hidden = true;
        setStatus('Abellona live video paused while this camera is not selected.');
      }
      return;
    }
    if (!started) initialize();
    else if (player) requestPlayback(false);
  }

  doc.addEventListener?.('sacocast:camera-selected', event => {
    selectCamera(event?.detail?.camera === 'abellona-camera');
  });

  watchButton.addEventListener('click', () => {
    if (watchOnYouTube) {
      win.open?.(YOUTUBE_WATCH_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    selected = true;
    if (!player) {
      started = false;
      initialize();
      return;
    }
    requestPlayback(true);
  });

  return {
    initialize,
    selectCamera,
    getPlaybackState: () => playback,
    getVideoId: () => ABELLONA_VIDEO_ID,
    handlePlayerState: onPlayerState,
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  createAbellonaPlayer();
}
