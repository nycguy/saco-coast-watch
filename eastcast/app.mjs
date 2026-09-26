import {
  EAST_STATES, KEY_LOCATIONS, buildNowBrief, diffSummaries, chooseWatchLocations,
  timelineBuckets, stateStory, stateName, topHazard, isStormMode,
  nearestForecastTime, severityScore, alertType, eventCategory
} from './core.mjs';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const fmt = v => {
  const d=new Date(v); if(Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(d);
};
const ageText = v => {
  const d=new Date(v), mins=Math.max(0,Math.floor((Date.now()-d.getTime())/60000));
  return mins<1?'just now':mins<60?mins+' min ago':Math.floor(mins/60)+'h '+(mins%60)+'m ago';
};

const MAP_VIEWS={
  all:[[24.0,-83.5],[46.9,-66.0]],
  newengland:[[40.7,-73.9],[45.8,-66.4]],
  nyc:[[39.6,-75.2],[42.0,-71.0]],
  midatlantic:[[35.4,-78.6],[40.8,-73.0]],
  carolinas:[[31.6,-82.0],[36.9,-74.0]],
  southeast:[[24.5,-82.5],[33.5,-78.0]],
};

const NDFD={
  rain:{layer:'ndfd.conus.qpf',times:'ndfd.conus.qpf',label:'Forecast precipitation'},
  wind:{layer:'ndfd.conus.wgust',times:'ndfd.conus.wgust',label:'Forecast wind gust'},
  waves:{layer:'ndfd.conus.waveh',times:'ndfd.conus.waveh',label:'Forecast wave height'},
};

let snapshot=null;
let map=null;
let baseLayer=null;
let alertLayer=null;
let primaryLayer=null;
let pointMarker=null;
let currentMode='radar';
let currentHorizon=0;
let currentPoint=null;
let lastSnapshotFetch=0;

async function loadSnapshot(force=false){
  const url='data/snapshot.json'+(force?'?t='+Date.now():'');
  const r=await fetch(url,{cache:force?'no-store':'default'});
  if(!r.ok) throw new Error('EastCast snapshot '+r.status);
  const data=await r.json();
  if(!data?.summary) throw new Error('Invalid EastCast snapshot');
  snapshot=data; lastSnapshotFetch=Date.now();
  renderAll();
  if(map) rebuildMapData();
  return data;
}

function renderAll(){
  renderNow();
  renderMetrics();
  renderChanges();
  renderWatchList();
  renderTimeline();
  renderCoastalPulse();
  renderStory();
  renderOutlooks();
  renderTropical();
  renderCameras();
  renderFavorites();
  renderSourceHealth();
  document.body.classList.toggle('storm-mode',isStormMode(snapshot.summary,snapshot.tropical));
  $('#lastUpdated').textContent=fmt(snapshot.generated_at);
  $('#freshness').textContent=ageText(snapshot.generated_at);
}

function renderNow(){
  const b=buildNowBrief(snapshot);
  $('#nowHeadline').textContent=b.headline;
  $('#nowDek').textContent=b.dek;
  $('#topHazard').textContent=b.hazard.label;
  $('#confidenceLevel').textContent=b.confidence.level;
  $('#confidenceText').textContent=b.confidence.text;
  $('#confidenceBadge').dataset.tone=b.confidence.tone;
  const urgent=snapshot.summary.most_urgent;
  $('#nowTiming').textContent=urgent?.ends?'Most urgent alert through '+fmt(urgent.ends):'Updated '+fmt(snapshot.generated_at);
  const mode=isStormMode(snapshot.summary,snapshot.tropical);
  $('#modeLabel').textContent=mode?'EVENT MODE':'EAST COAST NOW';
}

function renderMetrics(){
  const s=snapshot.summary;
  $('#metricAlerts').textContent=s.active_alerts;
  $('#metricWarnings').textContent=s.warnings;
  $('#metricStates').textContent=s.states_affected;
  $('#metricTropical').textContent=(snapshot.tropical||[]).length;
  $('#metricTropicalLabel').textContent=(snapshot.tropical||[]).length===1?'Atlantic system':'Atlantic systems';
}

function renderChanges(){
  let prev=null;
  try{prev=JSON.parse(localStorage.getItem('eastcast:lastSummary')||'null')}catch{}
  const box=$('#changesList');
  if(!prev){
    box.innerHTML='<span class="change-chip neutral">Baseline saved. Changes will appear after the next updated snapshot.</span>';
  }else{
    const changes=diffSummaries(prev,snapshot.summary);
    box.innerHTML=changes.length?changes.map(c=>'<span class="change-chip '+esc(c.tone)+'">'+esc(c.text)+'</span>').join(''):'<span class="change-chip neutral">No material alert-count change since your last update.</span>';
  }
  try{localStorage.setItem('eastcast:lastSummary',JSON.stringify(snapshot.summary))}catch{}
}

function renderWatchList(){
  const list=chooseWatchLocations(snapshot.summary,4);
  $('#watchList').innerHTML=list.map((x,i)=>`
    <button class="watch-card" data-lat="${x.lat}" data-lon="${x.lon}" data-name="${esc(x.name)}" type="button">
      <span class="watch-rank">0${i+1}</span>
      <span><strong>${esc(x.name)}</strong><small>${esc(stateName(x.state))}</small></span>
      <em>${esc(x.reason)}</em>
      <b>›</b>
    </button>`).join('');
  $$('#watchList .watch-card').forEach(b=>b.addEventListener('click',()=>focusLocation(+b.dataset.lat,+b.dataset.lon,b.dataset.name)));
}

function renderTimeline(){
  const buckets=timelineBuckets(snapshot.alerts?.features||[],new Date());
  $('#impactTimeline').innerHTML=buckets.map((x,i)=>`
    <button class="timeline-card ${i===0?'active':''}" data-horizon="${[0,6,12,24,48][i]}" type="button">
      <span>${esc(x.label)}</span><strong>${esc(x.event)}</strong>
      <small>${x.count} active alert${x.count===1?'':'s'} intersect this window</small>
    </button>`).join('');
  $$('#impactTimeline .timeline-card').forEach(b=>b.addEventListener('click',()=>{
    $$('#impactTimeline .timeline-card').forEach(x=>x.classList.remove('active'));b.classList.add('active');
    currentHorizon=+b.dataset.horizon; syncTimeButtons(); applyMapMode();
    $('#map-section').scrollIntoView({behavior:'smooth',block:'start'});
  }));
}


function coastalAlertForState(code){
  const list=snapshot.state_alerts?.[code]||[];
  return list.find(x=>/storm surge|coastal flood/i.test(x.event||'')) ||
         list.find(x=>/high surf|beach hazard|rip current/i.test(x.event||'')) || null;
}

function coastalSignal(row,alert){
  let score=0;
  if(alert){
    const t=alertType(alert.event);
    score+=t==='warning'?5:t==='watch'?3:2;
  }
  if(Number(row.departure_ft)>=1) score+=3; else if(Number(row.departure_ft)>=0.5) score+=2;
  if(Number(row.wave_ft)>=10) score+=3; else if(Number(row.wave_ft)>=6) score+=2;
  if(Number(row.gust_kt)>=40) score+=3; else if(Number(row.gust_kt)>=25) score+=2;
  return score>=7?'high':score>=4?'elevated':score>=2?'watch':'normal';
}

function value(v,digits=1){
  if(v===null||v===undefined||v==='') return '—';
  const n=Number(v); return Number.isFinite(n)?n.toFixed(digits):'—';
}

function renderCoastalPulse(){
  const rows=snapshot.coastal_pulse||[];
  const target=$('#coastalPulse');
  if(!target) return;
  if(!rows.length){
    target.innerHTML='<div class="empty-card"><strong>Coastal observations temporarily unavailable</strong><span>EastCast will retry during the next data build.</span></div>';
    return;
  }
  target.innerHTML=rows.map(row=>{
    const alert=coastalAlertForState(row.state);
    const signal=coastalSignal(row,alert);
    const departure=row.departure_ft===null||row.departure_ft===undefined?null:Number(row.departure_ft);
    const departureText=Number.isFinite(departure)?(departure>=0?'+':'')+departure.toFixed(2)+' ft':'—';
    const gust=row.gust_kt!==null&&row.gust_kt!==undefined&&Number.isFinite(Number(row.gust_kt))?value(row.gust_kt)+' kt':'—';
    const wind=row.wind_kt!==null&&row.wind_kt!==undefined&&Number.isFinite(Number(row.wind_kt))?value(row.wind_kt)+' kt':'—';
    const marine=gust!=='—'?(wind+' / '+gust):wind;
    const status=alert?.event || (signal==='high'?'Multiple elevated coastal signals':signal==='elevated'?'Elevated coastal conditions':signal==='watch'?'Worth watching':'No major coastal signal');
    return `<button class="coastal-card ${signal}" data-lat="${row.lat}" data-lon="${row.lon}" data-name="${esc(row.name)}" type="button">
      <div class="coastal-head"><span><strong>${esc(row.name)}</strong><small>${esc(row.state)} · NOAA CO-OPS ${esc(row.coops)} / NDBC ${esc(row.buoy)}</small></span><b class="coastal-status">${esc(status)}</b></div>
      <div class="coastal-values">
        <span><small>Water level</small><strong>${value(row.water_level_ft,2)} <em>ft MLLW</em></strong></span>
        <span class="${Number.isFinite(departure)&&departure>=0.5?'emphasis':''}"><small>Departure</small><strong>${departureText}</strong></span>
        <span><small>Next high</small><strong>${value(row.next_high_ft,2)} <em>ft</em></strong><i>${row.next_high_time?esc(fmt(row.next_high_time)):''}</i></span>
        <span class="${Number(row.wave_ft)>=6?'emphasis':''}"><small>Offshore seas</small><strong>${value(row.wave_ft)} <em>ft</em></strong><i>${row.wave_period_s?value(row.wave_period_s,0)+' sec':''}</i></span>
        <span class="${Number(row.gust_kt)>=25?'emphasis':''}"><small>Wind / gust</small><strong>${marine}</strong></span>
      </div>
      <div class="coastal-foot"><span>Departure = observed water level minus NOAA astronomical tide prediction, not a storm-surge estimate.</span><span>Open local forecast ›</span></div>
    </button>`;
  }).join('');
  $$('#coastalPulse .coastal-card').forEach(b=>b.addEventListener('click',()=>focusLocation(+b.dataset.lat,+b.dataset.lon,b.dataset.name)));
}

function renderStory(filter='all'){
  const html=EAST_STATES.map(([code,name])=>{
    const story=stateStory(snapshot,code);
    const count=snapshot.summary.state_counts?.[code]||0;
    if(filter==='active'&&!count) return '';
    if(filter==='warning'&&!((snapshot.state_alerts?.[code]||[]).some(x=>alertType(x.event)==='warning'))) return '';
    return `<button class="state-row ${story.type}" data-state="${code}" type="button">
      <span class="state-code">${code}</span>
      <span class="state-main"><strong>${esc(name)}</strong><b>${esc(story.title)}</b><small>${esc(story.body)}</small></span>
      <span class="state-count"><strong>${count}</strong><small>alerts</small></span>
      <span class="chev">›</span>
    </button>`;
  }).join('');
  $('#stateStory').innerHTML=html||'<div class="empty-card">No states match this filter.</div>';
  $$('#stateStory .state-row').forEach(b=>b.addEventListener('click',()=>{
    const code=b.dataset.state;
    const loc=KEY_LOCATIONS.find(x=>x.state===code);
    if(loc) focusLocation(loc.lat,loc.lon,loc.name);
  }));
}

function riskName(feature){
  const p=feature?.properties||{};
  return p.LABEL||p.label||p.RISK||p.risk||p.CATEGORY||p.category||p.DN||p.name||'Outlook area';
}

function renderOutlooks(){
  const ero=snapshot.outlooks?.excessive_rain_day1?.features||[];
  const severe=snapshot.outlooks?.severe_day1?.features||[];
  const sourceOk=snapshot.sources?.wpc_outlooks?.ok;
  $('#outlookCards').innerHTML=`
    <button class="outlook-card" data-mode="excessive" type="button"><span class="outlook-icon rain">R</span><strong>Excessive Rain</strong><small>WPC Day 1 · ${ero.length} mapped area${ero.length===1?'':'s'}</small><em>Open on map ›</em></button>
    <button class="outlook-card" data-mode="severe" type="button"><span class="outlook-icon severe">S</span><strong>Severe Weather</strong><small>Official Day 1 · ${severe.length} mapped area${severe.length===1?'':'s'}</small><em>Open on map ›</em></button>
    <a class="outlook-card" href="https://www.wpc.ncep.noaa.gov/wwd/winter_wx.shtml" target="_blank" rel="noopener"><span class="outlook-icon winter">W</span><strong>Winter Weather</strong><small>WPC official outlooks</small><em>Open WPC ›</em></a>
    <a class="outlook-card" href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener"><span class="outlook-icon tropical">T</span><strong>Tropical Atlantic</strong><small>${(snapshot.tropical||[]).length} active Atlantic system${(snapshot.tropical||[]).length===1?'':'s'}</small><em>Open NHC ›</em></a>`;
  $$('#outlookCards [data-mode]').forEach(b=>b.addEventListener('click',()=>{setMode(b.dataset.mode);$('#map-section').scrollIntoView({behavior:'smooth'})}));
  $('#outlookStatus').textContent=sourceOk?'Official outlook feeds loaded':'Some outlook feeds are temporarily unavailable';
}

function renderTropical(){
  const storms=snapshot.tropical||[];
  $('#tropicalList').innerHTML=storms.length?storms.map(s=>`
    <article class="tropical-row">
      <span class="storm-symbol">${esc(s.classification||'TC')}</span>
      <div><strong>${esc(s.name||s.id)}</strong><small>${esc(s.classification||'')} · ${esc(s.intensity||'—')} kt · ${esc(s.pressure||'—')} mb</small></div>
      <div class="storm-pos"><strong>${Number(s.lat).toFixed(1)}°, ${Math.abs(Number(s.lon)).toFixed(1)}°W</strong><small>Moving ${esc(s.movementDir??'—')}° at ${esc(s.movementSpeed??'—')} kt</small></div>
      <a href="${esc(s.graphicsUrl||s.advisoryUrl||'https://www.nhc.noaa.gov/')}" target="_blank" rel="noopener">NHC ›</a>
    </article>`).join(''):'<div class="empty-card">No active Atlantic tropical cyclones in the NHC current-storm feed.</div>';
}

function renderCameras(){
  const cams=snapshot.webcams||[];
  $('#cameraGrid').innerHTML=cams.map(c=>{
    const source=c.source||'WebCOOS';
    if(c.embed){
      return `<article class="camera-card camera-featured">
        <div class="camera-video">
          <iframe src="${esc(c.embed)}" title="${esc(c.name)} live camera" loading="lazy"
            referrerpolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen></iframe>
        </div>
        <div class="camera-copy">
          <span class="camera-live-badge"><i></i> Live</span>
          <strong>${esc(c.name)}</strong>
          <small>${esc(c.state)} · ${esc(c.use)} · ${esc(source)}</small>
          <a href="${esc(c.url)}" target="_blank" rel="noopener">Open camera on YouTube ›</a>
        </div>
      </article>`;
    }
    return `<a class="camera-card" href="${esc(c.url)}" target="_blank" rel="noopener">
      <span class="camera-dot"></span><strong>${esc(c.name)}</strong>
      <small>${esc(c.state)} · ${esc(c.use)}</small><em>Open ${esc(source)} ›</em>
    </a>`;
  }).join('');
}

function getFavorites(){
  try{return JSON.parse(localStorage.getItem('eastcast:favorites')||'[]')}catch{return []}
}
function setFavorites(v){try{localStorage.setItem('eastcast:favorites',JSON.stringify(v.slice(0,8)))}catch{}renderFavorites()}
function renderFavorites(){
  const fav=getFavorites();
  const defaults=KEY_LOCATIONS.slice(0,5);
  const all=[...fav,...defaults.filter(d=>!fav.some(f=>f.name===d.name))].slice(0,8);
  $('#favoritesStrip').innerHTML=all.map((x,i)=>`<button class="place-chip ${i<fav.length?'saved':''}" data-lat="${x.lat}" data-lon="${x.lon}" data-name="${esc(x.name)}" type="button">${i<fav.length?'★':'○'} ${esc(x.name)}</button>`).join('')+
    '<button class="place-chip locate" id="quickLocate" type="button">◎ My location</button>';
  $$('#favoritesStrip .place-chip[data-lat]').forEach(b=>b.addEventListener('click',()=>focusLocation(+b.dataset.lat,+b.dataset.lon,b.dataset.name)));
  $('#quickLocate')?.addEventListener('click',locateMe);
}

function renderSourceHealth(){
  const s=snapshot.sources||{};
  const rows=[
    ['NWS alerts',s.nws_alerts?.ok],['WPC outlooks',s.wpc_outlooks?.ok],
    ['NHC tropical',s.nhc?.ok],['NDFD forecast map',s.ndfd?.ok],
    ['Coastal gauges + buoys',s.coastal_pulse?.ok]
  ];
  $('#sourceHealth').innerHTML=rows.map(([n,ok])=>'<span class="'+(ok?'ok':'warn')+'"><i></i>'+esc(n)+'</span>').join('');
}

function initMap(){
  if(!window.L) throw new Error('Leaflet unavailable');
  map=L.map('eastMap',{zoomControl:false,minZoom:3,maxZoom:13,preferCanvas:true}).fitBounds(MAP_VIEWS.all);
  L.control.zoom({position:'bottomright'}).addTo(map);
  baseLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
  map.on('click',e=>loadPointForecast(e.latlng.lat,e.latlng.lng));
  rebuildMapData();
  applyMapMode();
}

function rebuildMapData(){
  if(!map||!snapshot) return;
  if(alertLayer) alertLayer.remove();
  alertLayer=L.geoJSON(snapshot.alerts||{type:'FeatureCollection',features:[]},{
    style:f=>{
      const t=alertType(f.properties?.event||'');
      return t==='warning'?{color:'#ff645f',weight:2,fillColor:'#ff645f',fillOpacity:.14}:
        t==='watch'?{color:'#ffca62',weight:2,fillColor:'#ffca62',fillOpacity:.11}:
        {color:'#52bfe9',weight:1.5,fillColor:'#52bfe9',fillOpacity:.08};
    },
    onEachFeature:(f,l)=>{
      const p=f.properties||{};
      l.bindPopup('<div class="map-pop"><strong>'+esc(p.event||'NWS alert')+'</strong><p>'+esc(p.headline||p.areaDesc||'')+'</p><small>'+(p.ends?'Through '+esc(fmt(p.ends)):'Official NWS alert')+'</small></div>');
    }
  }).addTo(map);
}

function clearPrimary(){
  if(primaryLayer){try{primaryLayer.remove()}catch{} primaryLayer=null}
}

function setMode(mode){
  currentMode=mode;
  $$('.map-mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  applyMapMode();
}

function applyMapMode(){
  if(!map||!snapshot) return;
  clearPrimary();
  const status=$('#mapLayerStatus');
  const timeline=$('#forecastHorizon');
  timeline.classList.toggle('disabled',!['rain','wind','waves'].includes(currentMode));
  if(currentMode==='radar'){
    primaryLayer=L.tileLayer.wms('https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows',{
      layers:'conus_bref_qcd',format:'image/png',transparent:true,version:'1.1.1',opacity:.62,attribution:'NOAA / NWS radar'
    }).addTo(map);
    status.textContent='Live NWS base reflectivity';
    return;
  }
  if(currentMode==='alerts'){status.textContent='NWS watches, warnings and advisories';return}
  if(NDFD[currentMode]){
    const cfg=NDFD[currentMode];
    const time=nearestForecastTime(snapshot.ndfd_times?.[cfg.times]||[],currentHorizon,new Date());
    const opts={layers:cfg.layer,format:'image/png',transparent:true,version:'1.1.1',opacity:.62,attribution:'NWS NDFD'};
    if(time) opts.VTIT=time;
    primaryLayer=L.tileLayer.wms('https://digital.weather.gov/ndfd/wms',opts).addTo(map);
    status.textContent=cfg.label+(time?' · '+fmt(time+'Z'):' · latest available');
    return;
  }
  if(currentMode==='excessive'){
    primaryLayer=outlookGeo('excessive_rain_day1','rain').addTo(map);
    status.textContent='WPC Day 1 Excessive Rainfall Outlook';
    return;
  }
  if(currentMode==='severe'){
    primaryLayer=outlookGeo('severe_day1','severe').addTo(map);
    status.textContent='Official Day 1 severe-weather outlook';
    return;
  }
  if(currentMode==='tropical'){
    const g=L.layerGroup();
    (snapshot.tropical||[]).forEach(s=>{
      if(!Number.isFinite(+s.lat)||!Number.isFinite(+s.lon)) return;
      L.circleMarker([+s.lat,+s.lon],{radius:11,color:'#ffd166',fillColor:'#ff7d5c',fillOpacity:.92,weight:3})
        .bindPopup('<div class="map-pop"><strong>'+esc(s.name||s.id)+'</strong><p>'+esc(s.classification||'')+' · '+esc(s.intensity||'—')+' kt</p><a href="'+esc(s.graphicsUrl||s.advisoryUrl||'https://www.nhc.noaa.gov/')+'" target="_blank" rel="noopener">Official NHC graphics ›</a></div>').addTo(g);
    });
    primaryLayer=g.addTo(map);status.textContent='Current NHC Atlantic tropical systems';return;
  }
  if(currentMode==='cameras'){
    const g=L.layerGroup();
    (snapshot.webcams||[]).forEach(c=>{
      L.circleMarker([c.lat,c.lon],{radius:8,color:'#d6fff9',fillColor:'#20cfbd',fillOpacity:1,weight:2})
        .bindPopup('<div class="map-pop"><strong>'+esc(c.name)+'</strong><p>'+esc(c.use)+'</p><a href="'+esc(c.url)+'" target="_blank" rel="noopener">Open live camera ›</a></div>').addTo(g);
    });
    primaryLayer=g.addTo(map);status.textContent='Curated coastal cameras';return;
  }
}

function outlookGeo(key,kind){
  const fc=snapshot.outlooks?.[key]||{type:'FeatureCollection',features:[]};
  return L.geoJSON(fc,{style:f=>{
    const n=riskName(f).toLowerCase();
    const high=/high|moderate|enhanced/.test(n);
    const med=/slight/.test(n);
    return {color:high?'#ff6b5f':med?'#ffbf5e':'#f5db74',weight:2,fillColor:high?'#ff6b5f':med?'#ffbf5e':'#f5db74',fillOpacity:.22};
  },onEachFeature:(f,l)=>l.bindPopup('<div class="map-pop"><strong>'+esc(kind==='rain'?'Excessive Rainfall Outlook':'Severe Weather Outlook')+'</strong><p>'+esc(riskName(f))+'</p></div>')});
}

function syncTimeButtons(){
  $$('#forecastHorizon button').forEach(b=>b.classList.toggle('active',+b.dataset.horizon===currentHorizon));
}

async function focusLocation(lat,lon,name){
  if(map) map.flyTo([lat,lon],8,{duration:.8});
  await loadPointForecast(lat,lon,name);
  $('#map-section').scrollIntoView({behavior:'smooth',block:'start'});
}

async function loadPointForecast(lat,lon,name=''){
  const panel=$('#forecastInspector');
  panel.innerHTML='<div class="inspector-loading"><span class="spinner"></span> Loading official NWS point forecast…</div>';
  try{
    const point=await fetchJson('https://api.weather.gov/points/'+lat.toFixed(4)+','+lon.toFixed(4));
    const p=point.properties||{};
    const rel=p.relativeLocation?.properties||{};
    const locName=name||[rel.city,rel.state].filter(Boolean).join(', ')||'Selected location';
    const [forecast,alerts]=await Promise.all([
      fetchJson(p.forecast),
      fetchJson('https://api.weather.gov/alerts/active?point='+lat.toFixed(4)+','+lon.toFixed(4))
    ]);
    const periods=(forecast.properties?.periods||[]).slice(0,6);
    currentPoint={name:locName,lat,lon,state:rel.state||'',forecast:periods};
    if(pointMarker) pointMarker.remove();
    if(map) pointMarker=L.marker([lat,lon]).addTo(map);
    const active=alerts.features||[];
    panel.innerHTML=`
      <div class="inspector-head"><div><span class="panel-kicker">Official NWS forecast</span><h3>${esc(locName)}</h3><small>${esc(p.forecastOffice||'')}</small></div><button id="savePlace" class="save-place" type="button">☆ Save</button></div>
      ${active.length?'<div class="point-alert"><strong>'+active.length+' active alert'+(active.length===1?'':'s')+'</strong><span>'+esc(active[0].properties?.event||'NWS alert')+'</span></div>':''}
      <div class="period-grid">${periods.map(x=>'<article><span>'+esc(x.name)+'</span><strong>'+esc(x.temperature)+'°'+esc(x.temperatureUnit)+'</strong><b>'+esc(x.windSpeed)+' '+esc(x.windDirection)+'</b><small>'+esc(x.shortForecast)+'</small></article>').join('')}</div>
      <button class="text-btn" id="sharePlace" type="button">Share this location forecast</button>`;
    $('#savePlace').addEventListener('click',saveCurrentPlace);
    $('#sharePlace').addEventListener('click',()=>shareText(locName+' weather on EastCast',location.href));
  }catch(err){
    panel.innerHTML='<div class="empty-card"><strong>Point forecast unavailable</strong><span>The NWS point service did not respond. Try another point or refresh.</span></div>';
    console.warn(err);
  }
}

async function fetchJson(url){
  const r=await fetch(url,{headers:{Accept:'application/geo+json, application/json'},cache:'no-store'});
  if(!r.ok) throw new Error(r.status+' '+r.statusText);
  return r.json();
}

function saveCurrentPlace(){
  if(!currentPoint) return;
  const fav=getFavorites();
  if(!fav.some(x=>Math.abs(x.lat-currentPoint.lat)<.001&&Math.abs(x.lon-currentPoint.lon)<.001)){
    fav.unshift({name:currentPoint.name,state:currentPoint.state,lat:currentPoint.lat,lon:currentPoint.lon});
  }
  setFavorites(fav);
  $('#savePlace').textContent='★ Saved';
}

function locateMe(){
  if(!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(p=>focusLocation(p.coords.latitude,p.coords.longitude,'My location'),()=>alert('Location access was not available.'));
}

async function shareSnapshot(){
  const b=buildNowBrief(snapshot), s=snapshot.summary;
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=630;
  const ctx=canvas.getContext('2d');
  const g=ctx.createLinearGradient(0,0,1200,630);g.addColorStop(0,'#061c29');g.addColorStop(1,'#0b4050');ctx.fillStyle=g;ctx.fillRect(0,0,1200,630);
  ctx.fillStyle='#7ef3e7';ctx.font='700 28px system-ui';ctx.fillText('EASTCAST · EAST COAST NOW',70,78);
  ctx.fillStyle='#fff';ctx.font='800 54px system-ui';wrapText(ctx,b.headline,70,155,1030,64);
  ctx.fillStyle='#b8d2de';ctx.font='28px system-ui';wrapText(ctx,b.dek,70,300,1030,40);
  const metrics=[['ACTIVE ALERTS',s.active_alerts],['WARNINGS',s.warnings],['STATES',s.states_affected],['ATLANTIC TROPICAL',(snapshot.tropical||[]).length]];
  metrics.forEach((m,i)=>{const x=70+i*265;ctx.fillStyle='#829fab';ctx.font='700 18px system-ui';ctx.fillText(m[0],x,500);ctx.fillStyle='#fff';ctx.font='800 44px system-ui';ctx.fillText(String(m[1]),x,552)});
  ctx.fillStyle='#8ba9b6';ctx.font='18px system-ui';ctx.fillText('Updated '+fmt(snapshot.generated_at)+' · Official NOAA/NWS sources',70,600);
  const blob=await new Promise(res=>canvas.toBlob(res,'image/png'));
  const file=new File([blob],'eastcast-weather.png',{type:'image/png'});
  const text=b.headline+' '+b.dek;
  if(navigator.share && navigator.canShare?.({files:[file]})){
    await navigator.share({title:'EastCast',text,files:[file]});return;
  }
  if(navigator.share){await navigator.share({title:'EastCast',text,url:location.href});return}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='eastcast-weather.png';a.click();URL.revokeObjectURL(a.href);
}

function wrapText(ctx,text,x,y,maxWidth,lineHeight){
  const words=String(text).split(' ');let line='';
  for(const word of words){const test=line+word+' ';if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=word+' ';y+=lineHeight}else line=test}
  ctx.fillText(line,x,y);
}

async function shareText(text,url){
  if(navigator.share) return navigator.share({title:'EastCast',text,url});
  await navigator.clipboard?.writeText(text+' '+url);
  alert('Link copied.');
}

function wire(){
  $$('.map-mode').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
  $$('#forecastHorizon button').forEach(b=>b.addEventListener('click',()=>{currentHorizon=+b.dataset.horizon;syncTimeButtons();applyMapMode()}));
  $('#regionSelect').addEventListener('change',e=>map?.fitBounds(MAP_VIEWS[e.target.value],{padding:[10,10]}));
  $('#locateBtn').addEventListener('click',locateMe);
  $('#refreshBtn').addEventListener('click',async()=>{const b=$('#refreshBtn');b.disabled=true;b.textContent='Refreshing…';try{await loadSnapshot(true)}finally{b.disabled=false;b.textContent='↻ Refresh'}});
  $('#shareBtn').addEventListener('click',shareSnapshot);
  $$('.story-filter').forEach(b=>b.addEventListener('click',()=>{$$('.story-filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderStory(b.dataset.filter)}));
  $$('.radar-tab').forEach(b=>b.addEventListener('click',()=>{
    $$('.radar-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');
    const r=b.dataset.radar;$('#radarTitle').textContent=b.textContent+' radar loop';
    const img=$('#radarGif');img.src='https://radar.weather.gov/ridge/standard/'+r+'_loop.gif';$('#radarOpen').href=img.src;
  }));
  $('#radarGif').addEventListener('error',()=>{$('#radarGif').hidden=true;$('#radarOpen').style.display='block'});
  $('#radarGif').addEventListener('load',()=>{$('#radarGif').hidden=false;$('#radarOpen').style.display='none'});
}

function scheduleTopOfHour(){
  const n=new Date(),next=new Date(n);next.setHours(n.getHours()+1,0,4,0);
  setTimeout(async()=>{try{await loadSnapshot(true)}catch(e){console.warn(e)}scheduleTopOfHour()},next-n);
}

async function boot(){
  wire();
  try{
    await loadSnapshot(true);
    initMap();
    $('#appStatus').textContent='Live';
    $('#appStatus').classList.add('ok');
  }catch(err){
    console.error(err);
    $('#appStatus').textContent='Data issue';
    $('#nowHeadline').textContent='EastCast could not load its live snapshot.';
    $('#nowDek').textContent='The page shell is available, but the published weather snapshot is missing or invalid. Refresh in a moment.';
  }
  scheduleTopOfHour();
  setInterval(()=>{if(snapshot)$('#freshness').textContent=ageText(snapshot.generated_at)},60000);
}

boot();
