'use strict';
const MARINE_MAX_AGE=60*60000;
function marineNumber(id,value,missingLabel='--'){
 const node=$(id);node.replaceChildren();
 const number=document.createTextNode(Number.isFinite(value)?Math.round(value).toString():missingLabel);
 node.append(number);if(Number.isFinite(value)){const unit=document.createElement('em');unit.textContent=' mph';node.append(unit);}
}
function renderMarine(){
 for(const id of ['44007','WEXM1']){
  const station=state.marine[id],t=Date.parse(station?.observed_at||''),age=now()-t;
  const timed=Number.isFinite(t)&&t>0&&age>=-10*60000;
  const fresh=timed&&age<=MARINE_MAX_AGE;
  const speed=fresh&&Number.isFinite(station?.speed_mph)?station.speed_mph:null;
  const gust=fresh&&Number.isFinite(station?.gust_mph)?station.gust_mph:null;
  const label=!station?'Unavailable':!fresh?'Stale':speed===null?'No speed':'Live';
  const badge=$('marine'+id+'Status');badge.textContent=label;badge.className='marine-tag '+(label==='Live'?'good':label==='Stale'?'stale':'bad');
  marineNumber('marine'+id+'Speed',speed);
  marineNumber('marine'+id+'Gust',gust,station&&!fresh?'--':station&&fresh?'Not reported':'--');
  const when=timed?dayTime(t)+' ET · '+relative(t):'No valid observation timestamp';
  const direction=fresh&&Number.isFinite(station?.direction_deg)?windCompass(station.direction_deg)+' wind · ':'';
  const note=!station?'Marine measurement unavailable. Check the local updater or GitHub workflow, and the NOAA station link.':
    !fresh?'Stale observation ('+when+'). Values withheld until fresh data arrive.':
    direction+when+(gust===null?' · gust not reported':'');
  $('marine'+id+'Meta').textContent=note;
  health('healthMarine'+id,label==='Live',label);
 }
 $('marineFeedNote').textContent=state.marineFetchError?
  'Marine snapshot warning: '+state.marineFetchError+'. Station timestamps determine whether values are fresh; old readings are withheld. The webpage retries every 60 seconds.':
  'NDBC measured winds, not at your property. Station readings older than 60 minutes are withheld; missing gusts show Not reported. Webpage checks each minute; the local updater or GitHub workflow normally refreshes snapshots every five minutes (GitHub runs may be delayed).';
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
  const message=String(err?.message||err);
  state.marineFetchError=message==='Failed to fetch'?'Marine data file cannot be reached. Locally, use run-local.bat, not index.html opened directly; on GitHub, check the deployment workflow':message;
 }
 renderMarine();
}
