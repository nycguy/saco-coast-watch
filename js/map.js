/* Coastal hazard map is independent of water-level/meteorological feed failures. */
(() => {
 'use strict';
 const status=document.getElementById('mapAlertStatus');
 const cameras=[
  {name:'Camp Ellis · jetty & surf',lat:43.4640,lng:-70.3795,url:'https://webcoos.org/cameras/campellis_south/',source:'WebCOOS / NERACOOS'},
  {name:'Ferry Beach · shoreline',lat:43.4740,lng:-70.3855,url:'https://webcoos.org/cameras/ferrybeach_north/',source:'WebCOOS / NERACOOS'},
  {name:'Camp Ellis · city cameras',lat:43.4613,lng:-70.3830,url:'https://www.sacomaine.org/departments/administration/camp_ellis_cameras.php',source:'City of Saco'},
  {name:'Old Orchard Beach · ocean',lat:43.5145,lng:-70.3738,url:'https://abellonainn.com/webcam/',source:'Abellona Inn'},
  {name:'Wells Beach · ocean',lat:43.3062,lng:-70.5630,url:'https://www.wellsbeachmaine.com/wells-beach-maine-web-cam/',source:'Lafayette’s Oceanfront Resort'}
 ];
 for(const c of cameras){const a=document.createElement('a');a.href=c.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=c.name+' ↗';document.getElementById('mapCameraLinks').append(a);}
 if(typeof window.L==='undefined'){
  status.textContent='Map library could not load. Webcam links remain available below.';
  status.className='map-bad';document.getElementById('coastalMap').textContent='Interactive map unavailable. Verify your internet connection and try again.';return;
 }
 document.getElementById('coastalMap').replaceChildren();
 const L=window.L, map=L.map('coastalMap',{zoomControl:false,scrollWheelZoom:false,preferCanvas:true}).setView([43.47,-70.40],12);
 L.control.zoom({position:'topright'}).addTo(map);
 L.control.scale({imperial:true,metric:false,position:'bottomleft'}).addTo(map);
 // The former default USGS imagery/labels service returned only a subset of tiles
 // at some zoom levels, producing large blank rectangles. Start with a complete
 // street basemap; offer independent aerial and topo layers and fall back on errors.
 const tiles={
  streets:L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
   subdomains:'abc',attribution:'&copy; OpenStreetMap contributors',maxZoom:19,updateWhenIdle:true,keepBuffer:3}),
  imagery:L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
   attribution:'Tiles &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community',maxZoom:19,updateWhenIdle:true,keepBuffer:3}),
  topo:L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',{
   attribution:'USGS The National Map',maxNativeZoom:16,maxZoom:19,updateWhenIdle:true,keepBuffer:3})
 };
 let currentBasemap='streets';
 const basemapSelect=document.getElementById('coastalBasemap');
 const basemapStatus=document.getElementById('mapBasemapStatus');
 let errors=0;
 function activateBasemap(name){
  if(!tiles[name])name='streets';
  Object.values(tiles).forEach(layer=>{if(map.hasLayer(layer))map.removeLayer(layer)});
  currentBasemap=name;errors=0;basemapSelect.value=name;
  tiles[name].addTo(map);
  basemapStatus.textContent='Basemap: '+(name==='streets'?'OpenStreetMap streets':name==='imagery'?'Esri aerial imagery':'USGS topographic')+' · no API key';
 }
 Object.entries(tiles).forEach(([name,layer])=>layer.on('tileerror',()=>{
  if(currentBasemap!==name)return;
  errors++;
  if(errors>=3&&name!=='streets'){
   activateBasemap('streets');
   basemapStatus.textContent='Some '+(name==='imagery'?'aerial':'topographic')+' tiles failed; switched to street map.';
  }else if(errors>=3){
   basemapStatus.textContent='Street tiles are unavailable. Check internet access; alert and camera links remain below.';
  }
 }));
 activateBasemap('streets');
 const surge=L.layerGroup().addTo(map), coastal=L.layerGroup().addTo(map), tropical=L.layerGroup().addTo(map), cams=L.layerGroup().addTo(map);let tropicalBounds=null;
 for(const c of cameras){
  const icon=L.divIcon({html:'<div class="cam-pin" aria-hidden="true">▣</div>',className:'',iconSize:[29,29],iconAnchor:[14,14]});
  const pop=document.createElement('div');pop.className='map-pop';
  const strong=document.createElement('strong');strong.textContent=c.name;pop.append(strong);
  const para=document.createElement('p');para.textContent=c.source+' · location approximate; feed availability is controlled by the operator.';pop.append(para);
  const link=document.createElement('a');link.href=c.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open live camera ↗';pop.append(link);
  L.marker([c.lat,c.lng],{icon,title:c.name}).bindPopup(pop).addTo(cams);
 }
 basemapSelect.addEventListener('change',e=>activateBasemap(e.target.value));
 document.getElementById('mapHome').addEventListener('click',()=>map.flyTo([43.47,-70.40],12,{duration:.65}));
 [['showSurgeAlerts',surge],['showCoastalAlerts',coastal],['showCameras',cams]].forEach(([id,layer])=>document.getElementById(id).addEventListener('change',e=>e.target.checked?layer.addTo(map):map.removeLayer(layer)));const tropicalToggle=document.getElementById('showTropicalTrack');tropicalToggle.addEventListener('change',e=>{if(e.target.checked){tropical.addTo(map);if(tropicalBounds?.isValid())map.fitBounds(tropicalBounds.pad(.12));}else map.removeLayer(tropical);});document.getElementById('mapStormTrack').addEventListener('click',()=>{if(tropicalBounds?.isValid())map.fitBounds(tropicalBounds.pad(.12));});
 const approved=new Set(['Storm Surge Watch','Storm Surge Warning','Coastal Flood Watch','Coastal Flood Warning','Coastal Flood Advisory']);
 const getColor=name=>name.startsWith('Storm Surge')?(name.endsWith('Warning')?'#df3e99':'#c89de9'):(name.endsWith('Warning')?'#f69b45':name.endsWith('Watch')?'#f1cb64':'#ffe3a0');
 async function updateAlertMap(){
  try{
   const response=await fetch('data/coastal-alerts.json?ts='+Date.now(),{cache:'no-store'});
   if(!response.ok)throw new Error('Map alert feed HTTP '+response.status);
   const json=await response.json();
   if(json.error)throw new Error(String(json.error));
   if(!json.generatedAt||!Array.isArray(json.features))throw new Error('Map alert snapshot missing');
   const age=Date.now()-Date.parse(json.generatedAt);
   if(!Number.isFinite(age)||age< -120000||age>30*60000)throw new Error('Mapped alert snapshot is delayed or stale');
   const nextSurge=L.layerGroup(),nextCoastal=L.layerGroup();let displayed=0;
   for(const f of json.features){
    const a=f.properties||{},name=a.prod_type||a.event||'';
    if(!approved.has(name)||!f.geometry)continue;
    const isSurge=name.startsWith('Storm Surge'),color=getColor(name);
    const feat=L.geoJSON(f,{style:{color,weight:name.endsWith('Warning')?3:2,dashArray:name.endsWith('Warning')?null:'7 6',fillColor:color,fillOpacity:isSurge ? 0.23 : 0.17},interactive:true});
    const pop=document.createElement('div');pop.className='map-pop';
    const strong=document.createElement('strong');strong.textContent=name;pop.append(strong);
    const p=document.createElement('p');p.textContent='Official NWS alert area, not a street-level flood footprint.';pop.append(p);
    if(a.ends||a.expiration){const t=document.createElement('p');const date=new Date(a.ends||a.expiration);if(Number.isFinite(date.getTime())){t.textContent='Listed end: '+date.toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'})+' ET';pop.append(t);}}
    const url=String(a.url||'');if(/^https:\/\//i.test(url)){const link=document.createElement('a');link.href=url;link.rel='noopener noreferrer';link.target='_blank';link.textContent='Read official alert ↗';pop.append(link);}
    feat.bindPopup(pop);feat.addTo(isSurge?nextSurge:nextCoastal);displayed++;
   }
   surge.clearLayers();coastal.clearLayers();
   nextSurge.eachLayer(l=>surge.addLayer(l));nextCoastal.eachLayer(l=>coastal.addLayer(l));
   const stamp=new Date(json.generatedAt).toLocaleString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
   status.textContent=(displayed?displayed+' active coastal alert area'+(displayed===1?'':'s')+' mapped':'No matching active surge/coastal-flood alerts reported for map area')+' · checked '+stamp;
   status.className='map-good';
  }catch(err){
   // Do not keep old polygons on screen as if they were still active.
   surge.clearLayers();coastal.clearLayers();
   status.textContent='Map alert feed unavailable or stale. No active-alert status can be confirmed here; check NWS Gray. '+(err?.message||'');
   status.className='map-bad';
  }
 }

 async function updateTropicalMap(){
  const node=document.getElementById('mapTropicalStatus'),button=document.getElementById('mapStormTrack');
  try{
   const response=await fetch('data/hazards.json?ts='+Date.now(),{cache:'no-store'});if(!response.ok)throw new Error('Tropical feed HTTP '+response.status);
   const json=await response.json(),storms=json?.tropical?.storms||[];tropical.clearLayers();tropicalBounds=null;const pts=[];
   for(const storm of storms){
    const cone=Array.isArray(storm.cone)?storm.cone:[],track=Array.isArray(storm.track)?storm.track:[];
    if(cone.length>=3){L.polygon(cone,{color:'#dc3545',weight:1.5,fillColor:'#f28c28',fillOpacity:.12,interactive:false}).addTo(tropical);pts.push(...cone);}
    if(track.length>=2){L.polyline(track,{color:'#dc3545',weight:3,opacity:.9}).addTo(tropical);pts.push(...track);}
    if(Number.isFinite(Number(storm.latitude))&&Number.isFinite(Number(storm.longitude))){
     const icon=L.divIcon({html:'<div class="tropical-center-pin" aria-hidden="true">◎</div>',className:'',iconSize:[28,28],iconAnchor:[14,14]});
     const pop=document.createElement('div');pop.className='map-pop';const strong=document.createElement('strong');strong.textContent=storm.label||storm.name||'Tropical cyclone';pop.append(strong);
     const p=document.createElement('p');p.textContent=Number.isFinite(Number(storm.min_forecast_track_distance_mi))?'Nearest NHC forecast-track point is about '+Math.round(storm.min_forecast_track_distance_mi)+' miles from Saco Bay.':'NHC track-distance estimate unavailable.';pop.append(p);
     if(/^https:\/\//i.test(storm.forecast_graphics_url||'')){const a=document.createElement('a');a.href=storm.forecast_graphics_url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open NHC graphics ↗';pop.append(a);}
     L.marker([Number(storm.latitude),Number(storm.longitude)],{icon,title:storm.label||storm.name||'Tropical cyclone'}).bindPopup(pop).addTo(tropical);pts.push([Number(storm.latitude),Number(storm.longitude)]);
    }
   }
   if(pts.length)tropicalBounds=L.latLngBounds(pts);
   button.hidden=!storms.length;node.textContent=storms.length?storms.length+' locally relevant NHC tropical track'+(storms.length===1?'':'s')+' available':'No NHC tropical track is close enough to activate local tropical focus';node.className='map-good';
  }catch(err){tropical.clearLayers();tropicalBounds=null;button.hidden=true;node.textContent='NHC tropical layer unavailable. '+(err?.message||'');node.className='map-bad';}
 }
 updateAlertMap();updateTropicalMap();setInterval(()=>{if(!document.hidden){updateAlertMap();updateTropicalMap();}},60*1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateAlertMap();updateTropicalMap();}});
 window.addEventListener('resize',()=>map.invalidateSize());
})();
