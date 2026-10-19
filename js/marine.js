'use strict';
const MARINE_MAX_AGE=60*60000;
function marineNumber(id,value,missingLabel='--'){
 const node=$(id);node.replaceChildren();
 const number=document.createTextNode(Number.isFinite(value)?Math.round(value).toString():missingLabel);
 node.append(number);if(Number.isFinite(value)){const unit=document.createElement('em');unit.textContent=' mph';node.append(unit);}
}
function marineText(id,value){const node=$(id);if(node)node.textContent=value;}
function marineMeasurement(value,min,max){return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null;}
function renderMarine(){
 const at=now(),snapshotAt=Number(state.marineSnapshotAt),snapshotAge=at-snapshotAt;
 const snapshotFresh=Number.isFinite(snapshotAt)&&snapshotAge>=-10*60000&&snapshotAge<=90*60000;
 let visibleStations=0;
 for(const id of ['44007','WEXM1']){
  const station=state.marine?.[id],t=Date.parse(station?.observed_at||''),age=at-t;
  const windFresh=snapshotFresh&&Number.isFinite(t)&&t>0&&age>=-10*60000&&age<=MARINE_MAX_AGE;
  const waveAt=Date.parse(station?.wave_observed_at||station?.observed_at||''),waveAge=at-waveAt;
  const waveFresh=snapshotFresh&&Number.isFinite(waveAt)&&waveAt>0&&waveAge>=-10*60000&&waveAge<=MARINE_MAX_AGE;
  const speed=windFresh?marineMeasurement(station?.speed_mph,0,250):null;
  const gust=windFresh?marineMeasurement(station?.gust_mph,0,250):null;
  const wave=id==='44007'&&waveFresh?marineMeasurement(station?.wave_height_ft,0,100):null;
  const period=id==='44007'&&waveFresh?marineMeasurement(station?.dominant_period_sec,0,60):null;
  const waveDirection=id==='44007'&&waveFresh?marineMeasurement(station?.wave_direction_deg,0,360):null;
  const pressure=windFresh?marineMeasurement(station?.pressure_mb,800,1200):null;
  const pressureTrend=windFresh?marineMeasurement(station?.pressure_tendency_mb,-100,100):null;
  const waterTemp=windFresh?marineMeasurement(station?.water_temp_f,-5,110):null;
  const usable=Number.isFinite(speed)||Number.isFinite(gust)||Number.isFinite(wave)||Number.isFinite(period)||Number.isFinite(waveDirection)||Number.isFinite(pressure)||Number.isFinite(pressureTrend)||Number.isFinite(waterTemp);
  const card=$('marine'+id+'Card');if(card)card.hidden=!usable;
  if(usable)visibleStations++;
  const stationStale=(Number.isFinite(t)&&age>MARINE_MAX_AGE)||(Number.isFinite(waveAt)&&waveAge>MARINE_MAX_AGE),statusLabel=usable?'Recent':stationStale||!snapshotFresh?'Stale':'Unavailable';
  const status=$('marine'+id+'Status');if(status){status.textContent=statusLabel;status.className='marine-tag '+(usable?'good':statusLabel==='Stale'?'stale':'bad');}
  marineNumber('marine'+id+'Speed',speed);marineNumber('marine'+id+'Gust',gust);
  const speedBox=$('marine'+id+'SpeedBox'),gustBox=$('marine'+id+'GustBox');if(speedBox)speedBox.hidden=!Number.isFinite(speed);if(gustBox)gustBox.hidden=!Number.isFinite(gust);
  const readingAt=Number.isFinite(speed)||Number.isFinite(gust)?t:Number.isFinite(wave)||Number.isFinite(period)||Number.isFinite(waveDirection)?waveAt:t;
  const readingAge=at-readingAt,when=Number.isFinite(readingAt)&&readingAt>0?'Observed '+dayTime(readingAt)+' ET · '+relative(readingAt)+' · '+Math.max(0,Math.round(readingAge/60000))+' min old':'';
  const directions=windFresh&&Number.isFinite(station?.direction_deg)?windCompass(station.direction_deg)+' wind':'';
  const meta=$('marine'+id+'Meta');if(meta)meta.textContent=usable?[directions,when].filter(Boolean).join(' · '):'';
  health('healthMarine'+id,usable,statusLabel);
  if(id==='44007'){
   const values={marine44007Wave:Number.isFinite(wave)?wave.toFixed(1)+' ft':null,marine44007Period:Number.isFinite(period)?period.toFixed(0)+' s':null,marine44007WaveDirection:Number.isFinite(waveDirection)?windCompass(waveDirection)+' · '+Math.round(waveDirection)+'°':null,marine44007Pressure:Number.isFinite(pressure)?pressure.toFixed(1)+' mb':null,marine44007PressureTrend:Number.isFinite(pressureTrend)?(pressureTrend>=0?'+':'')+pressureTrend.toFixed(1)+' mb / 3h':null,marine44007WaterTemp:Number.isFinite(waterTemp)?waterTemp.toFixed(1)+' °F':null};
   for(const [nodeId,value] of Object.entries(values)){marineText(nodeId,value||'');const node=$(nodeId);if(node?.parentElement)node.parentElement.hidden=!value;}
   const secondary=$('marine44007Secondary');if(secondary)secondary.hidden=!Object.values(values).some(Boolean);
  }
 }
 const observations=$('marineObservations'),grid=$('marineWindGrid'),hasMarine=visibleStations>0;
 if(observations)observations.hidden=!hasMarine;if(grid)grid.hidden=!hasMarine;
 const note=$('marineFeedNote');if(note)note.textContent='NOAA station readings are measured away from shore. Values older than 60 minutes are withheld; each measurement uses its own observation time where available.';
}
async function loadMarine(){
 try{
  if(location.protocol==='file:')throw Error('Local file mode cannot load NOAA snapshots. Start run-local.bat and open http://127.0.0.1:8765/');
  const data=await getJSON('data/wind.json?ts='+now(),12000);
  const generated=Date.parse(data?.generated_at||'');
  if(!data||!data.stations||typeof data.stations!=='object'||!Number.isFinite(generated)||generated>now()+10*60000)throw Error('Invalid or future-dated marine snapshot');
  state.marine=data.stations;state.marineSnapshotAt=generated;
  state.marineFetchError=now()-generated>90*60000?'Station snapshot is older than 90 minutes':null;
 }catch(err){
  // Keep the last complete snapshot until its own timestamp makes it stale.
  state.marineFetchError=String(err?.message||err);
 }
 renderMarine();
}
