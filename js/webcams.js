/* Both webcams load their live streams automatically. Ferry Beach uses native HLS on Safari
   and hls.js elsewhere, with the generated same-origin still retained only as a fallback. */
(function(){
  'use strict';
  const stream='https://stage-ams.srv.axds.co/stream/adaptive/neracoos/ferrybeach_north/hls.m3u8';
  const ferryPreview=document.getElementById('ferryPreview');
  const ferryVideo=document.getElementById('ferryVideo');
  const ferryStatus=document.getElementById('ferryStatus');
  let hls=null;

  function etTime(value){
    const t=Date.parse(value||'');
    if(!Number.isFinite(t))return 'recently';
    return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',month:'short',day:'numeric'}).format(new Date(t))+' ET';
  }
  function setStatus(node,text,isWarning){
    if(!node)return;
    node.textContent=text;
    node.classList.toggle('warn',Boolean(isWarning));
  }
  function preloadPreview(cam,imgId,timeId,statusId,liveNode){
    const img=document.getElementById(imgId),time=document.getElementById(timeId),status=document.getElementById(statusId);
    if(!img||!time)return Promise.resolve();
    if(!cam||cam.status!=='ok'||!cam.image){
      time.textContent='Latest preview unavailable · live camera remains available';
      if(!liveNode||liveNode.hidden)setStatus(status,'Latest still image is unavailable. You can still open the live camera.',true);
      return Promise.resolve();
    }
    return new Promise(resolve=>{
      const probe=new Image();
      probe.decoding='async';
      probe.onload=()=>{
        img.src=probe.src;img.hidden=false;
        time.textContent='Latest preview fetched '+etTime(cam.fetched_at);
        if(!liveNode||liveNode.hidden)setStatus(status,'Latest camera preview loaded. Tap Watch live for the video stream.',false);
        resolve();
      };
      probe.onerror=()=>{
        time.textContent='Latest preview could not load · live camera remains available';
        if(!liveNode||liveNode.hidden)setStatus(status,'Latest still image could not load. You can still open the live camera.',true);
        resolve();
      };
      const sep=cam.image.includes('?')?'&':'?';
      probe.src=cam.image+sep+'v='+encodeURIComponent(cam.fetched_at||Date.now());
    });
  }
  async function loadWebcamPreviews(){
    try{
      const r=await fetch('data/webcams/webcams.json?t='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw Error('preview manifest HTTP '+r.status);
      const m=await r.json();
      await preloadPreview(m.cameras?.ferry_beach,'ferryPreviewImage','ferryPreviewTime','ferryStatus',ferryVideo);
    }catch(err){
      console.warn('Saco Coast Watch webcam previews:',err);
      const ft=document.getElementById('ferryPreviewTime');
      if(ft)ft.textContent='Latest preview unavailable · live camera remains available';
      if(ferryVideo?.hidden)setStatus(ferryStatus,'Latest still image is unavailable. You can still open the live camera.',true);
    }
  }
  function ferryUnavailable(){
    if(hls){hls.destroy();hls=null;}
    setStatus(ferryStatus,'Live stream unavailable here. Showing the latest captured shoreline still when available.',true);
    try{ferryVideo.pause();}catch(_err){}
    ferryVideo.hidden=true;
    if(ferryPreview)ferryPreview.hidden=false;
  }
  function playWhenReady(){
    if(ferryPreview)ferryPreview.hidden=true;
    ferryVideo.hidden=false;
    ferryVideo.play().catch(()=>setStatus(ferryStatus,'Live stream loaded. Press Play on the video for current conditions.',false));
  }
  function connectFerryLive(){
    if(!ferryVideo||!ferryStatus)return;
    setStatus(ferryStatus,'Connecting to the Ferry Beach live stream…',false);
    ferryVideo.addEventListener('playing',()=>setStatus(ferryStatus,'Live camera playing · stream may be delayed.',false));
    ferryVideo.addEventListener('waiting',()=>setStatus(ferryStatus,'Loading live video…',false));
    ferryVideo.addEventListener('error',ferryUnavailable);
    if(ferryVideo.canPlayType('application/vnd.apple.mpegurl')){
      ferryVideo.src=stream;
      ferryVideo.load();
      playWhenReady();
      return;
    }
    function connect(){
      if(!window.Hls||!window.Hls.isSupported()){ferryUnavailable();return;}
      hls=new window.Hls({liveSyncDurationCount:3,enableWorker:true});
      hls.on(window.Hls.Events.MANIFEST_PARSED,playWhenReady);
      hls.on(window.Hls.Events.ERROR,(_event,data)=>{if(data&&data.fatal)ferryUnavailable();});
      hls.loadSource(stream);
      hls.attachMedia(ferryVideo);
    }
    if(window.Hls){connect();return;}
    const loader=document.createElement('script');
    loader.src='https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
    loader.async=true;
    loader.onload=connect;
    loader.onerror=ferryUnavailable;
    document.head.appendChild(loader);
  }
  loadWebcamPreviews();
  connectFerryLive();
  setInterval(()=>{if(!document.hidden)loadWebcamPreviews();},5*60*1000);
  window.addEventListener('pagehide',()=>{if(hls)hls.destroy();});
})();
