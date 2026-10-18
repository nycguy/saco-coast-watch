'use strict';
const MARINE_MAX_AGE=60*60000;
function marineNumber(id,value,missingLabel='--'){
 const node=$(id);node.replaceChildren();
 const number=document.createTextNode(Number.isFinite(value)?Math.round(value).toString():missingLabel);
 node.append(number);if(Number.isFinite(value)){const unit=document.createElement('em');unit.textContent=' mph';node.append(unit);}
}
function marineText(id,value){const node=$(id);if(node)node.textContent=value;}
function renderMarine(){
 for(const id of ['44007','WEXM1']){
  const station=state.marine[id],t=Date.parse(station?.observed_at||''),age=now()-t;
  const timed=Number.isFinite(t)&&t>0&&age>=-10*60000;
  const snapshotFresh=!Number.isFinite(state.marineSnapshotAt)||now()-state.marineSnapshotAt<=90*60000;
  const fresh=timed&&age<=MARINE_MAX_AGE&&snapshotFresh;
  const waveAt=Date.parse(station?.wave_observed_at||station?.observed_at||''),waveAge=now()-waveAt,waveTimed=Number.isFinite(waveAt)&&waveAt>0&&waveAge>=-10*60000,waveFresh=waveTimed&&waveAge<=MARINE_MAX_AGE&&snapshotFresh;
  const speed=fresh&&Number.isFinite(station?.speed_mph)?station.speed_mph:null;
  const gust=fresh&&Number.isFinite(station?.gust_mph)?station.gust_mph:null;
  const hasWind=speed!==null||gust!==null,hasWave=id==='44007'&&waveFresh&&Number.isFinite(station?.wave_height_ft);
  const label=!station?'Unavailable':!timed?'Unavailable':!snapshotFresh?'Stale':hasWind||hasWave?'Recent':!fresh?'Stale':'Unavailable';
  const badge=$('marine'+id+'Status');badge.textContent=label;badge.className='marine-tag '+(label==='Recent'?'good':label==='Stale'?'stale':'bad');
  marineNumber('marine'+id+'Speed',speed);
  marineNumber('marine'+id+'Gust',gust,station&&fresh?'Not reported':'--');
  const when=timed?dayTime(t)+' ET · '+relative(t)+' · '+Math.max(0,Math.round(age/60000))+' min old':'No valid observation timestamp';
  const direction=fresh&&Number.isFinite(station?.direction_deg)?windCompass(station.direction_deg)+' wind · ':'';
  const note=!station?'No recent measurements are available from this NOAA station.':
    !timed?'No usable observation timestamp was provided; measurements are unavailable.':
    !snapshotFresh?'The published station snapshot is stale ('+when+'). Measurements are withheld until the feed refreshes.':
    !fresh?'Wind observation is stale ('+when+'); wind values are withheld.':
    direction+when+(speed===null?' · wind speed not reported':'')+(gust===null?' · gust not reported':'');
  $('marine'+id+'Meta').textContent=note;
  health('healthMarine'+id,label==='Recent',label);
  if(id==='44007'){
   const show=waveFresh?station||{}:{};
   const values={marine44007Wave:Number.isFinite(show.wave_height_ft)?show.wave_height_ft.toFixed(1)+' ft':null,marine44007Period:Number.isFinite(show.dominant_period_sec)?show.dominant_period_sec.toFixed(0)+' s':null,marine44007WaveDirection:Number.isFinite(show.wave_direction_deg)?windCompass(show.wave_direction_deg)+' · '+Math.round(show.wave_direction_deg)+'°':null,marine44007Pressure:fresh&&Number.isFinite(station?.pressure_mb)?station.pressure_mb.toFixed(1)+' mb':null,marine44007PressureTrend:fresh&&Number.isFinite(station?.pressure_tendency_mb)?(station.pressure_tendency_mb>=0?'+':'')+station.pressure_tendency_mb.toFixed(1)+' mb / 3h':null,marine44007WaterTemp:fresh&&Number.isFinite(station?.water_temp_f)?station.water_temp_f.toFixed(1)+' °F':null};
   for(const [nodeId,value] of Object.entries(values)){marineText(nodeId,value||'');const node=$(nodeId);if(node?.parentElement)node.parentElement.hidden=!value;}
   const secondary=$('marine44007Secondary');if(secondary)secondary.hidden=!Object.values(values).some(Boolean);
   const waveNote=Number.isFinite(station?.wave_height_ft)&&!waveFresh?'Wave reading is stale and withheld.':Number.isFinite(station?.wave_height_ft)?'Wave reading '+dayTime(waveAt)+' ET · '+relative(waveAt):station?.wave_height_supported===false?'This station does not report wave height.':'Wave height was not reported in the latest buoy sample.';
   $('marine'+id+'Meta').textContent+=' · '+waveNote;
  }
 }
 $('marineFeedNote').textContent=state.marineFetchError?
  'The NOAA marine snapshot is temporarily unavailable or stale. Use the station links for direct observations; a failed feed is not a new measurement.':
  'These NOAA station measurements are away from shore. Values older than 60 minutes are hidden. “Not reported” means the station supplied no value; the page refreshes every minute, while NOAA observations follow their own schedule.';
}
async function loadMarine(){
 try{
  // Same-origin JSON is produced by the local Python helper or the GitHub Actions workflow.
  if(location.protocol==='file:')throw Error('Local file mode cannot load NOAA snapshots. Start run-local.bat and open http://127.0.0.1:8765/');
  const data=await getJSON('data/wind.json?ts='+now(),12000);
  if(!data||!data.stations||typeof data.stations!=='object')throw Error('Invalid marine snapshot; check the local updater or GitHub deployment workflow');
  state.marine=data.stations;state.marineSnapshotAt=Date.parse(data.generated_at||'');
  if(!Number.isFinite(state.marineSnapshotAt))throw Error('Marine snapshot is a placeholder: use run-local.bat locally, or run the GitHub Actions workflow on Pages');
  state.marineFetchError=now()-state.marineSnapshotAt>90*60000?'Station snapshot is older than 90 minutes; check the local updater or GitHub Actions runs':null;
 }catch(err){
  state.marine={};
  state.marineFetchError=String(err?.message||err);
 }
 renderMarine();
}
