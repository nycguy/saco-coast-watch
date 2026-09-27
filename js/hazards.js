'use strict';

function hazardModeList(){
 const modes=[...(state.hazards?.active_modes||[])],seen=new Set(modes.map(m=>m.code));
 const events=state.alerts.map(a=>a?.properties?.event||'');
 const add=(code,label,basis)=>{if(!seen.has(code)){seen.add(code);modes.push({code,label,basis});}};
 if(events.some(e=>/hurricane|tropical storm|storm surge/i.test(e)))add('tropical','Tropical Cyclone','Live NWS tropical alert');
 if(events.some(e=>/winter|blizzard|snow|ice storm|freezing rain/i.test(e)))add('winter','Winter Storm','Live NWS winter alert');
 if(events.some(e=>/coastal flood|high surf|storm surge/i.test(e)))add('coastal_flood','Coastal Flood','Live NWS coastal alert');
 if(events.some(e=>/high wind|wind advisory|gale|storm warning/i.test(e)))add('high_wind','High Wind','Live NWS wind alert');
 return modes;
}

function hazardSeverity(){
 const base=state.hazards?.severity||{level:'green',label:'Routine',rank:0,reasons:[]};
 let rank=Number(base.rank)||0;
 const {nextPeak}=currentStatus();
 if(nextPeak?.v>=14)rank=Math.max(rank,3);
 else if(nextPeak?.v>=13)rank=Math.max(rank,2);
 else if(nextPeak?.v>=12)rank=Math.max(rank,1);
 const levels=['green','yellow','orange','red'],labels=['Routine','Elevated','Significant','High Impact'];
 return {...base,rank,level:levels[rank],label:labels[rank]};
}

function eventMetric(label,value,detail){
 const node=document.createElement('div');node.className='event-metric';
 const caption=document.createElement('span');caption.textContent=label;
 const strong=document.createElement('strong');strong.textContent=value||'--';
 node.append(caption,strong);
 if(detail){const small=document.createElement('small');small.textContent=detail;node.append(small);}
 return node;
}

function fmtHaz(value,digits=1,suffix=''){
 const n=Number(value);return Number.isFinite(n)?n.toFixed(digits)+suffix:'--';
}

function modeTitle(modes){
 const codes=new Set(modes.map(m=>m.code));
 if(codes.has('tropical'))return 'Tropical Cyclone Mode';
 if(codes.has('winter')&&codes.has('coastal_flood'))return 'Winter Coastal Storm Mode';
 if(codes.has('winter'))return 'Winter Storm Mode';
 if(codes.has('coastal_flood')&&codes.has('high_wind'))return 'Coastal Storm Mode';
 if(codes.has('heavy_rain'))return 'Heavy Rain Mode';
 if(codes.has('high_wind'))return 'High Wind Mode';
 if(codes.has('extreme_cold'))return 'Extreme Cold Mode';
 return 'Coastal Storm Mode';
}

function renderEventFocus(){
 const panel=$('stormModePanel');if(!panel)return;
 const modes=hazardModeList(),coastalReasons=typeof liveStormReasons==='function'?liveStormReasons():[];
 const active=modes.length>0||coastalReasons.length>0;
 panel.hidden=!active;document.body.classList.toggle('hazard-active',active);document.body.classList.toggle('storm-mode',active);
 for(const level of ['green','yellow','orange','red'])document.body.classList.remove('hazard-severity-'+level);
 if(!active)return;
 const severity=hazardSeverity();document.body.classList.add('hazard-severity-'+severity.level);
 $('eventFocusTitle').textContent=modeTitle(modes);
 $('eventFocusBadge').textContent=severity.label+' conditions';
 $('eventFocusDescription').textContent='Saco Coast Watch is temporarily prioritizing the hazards most relevant to the next 72 hours. Official NWS and NHC products remain authoritative.';
 const chips=$('hazardModeChips');chips.replaceChildren();
 const shown=modes.length?modes:[{code:'coastal',label:'Coastal Storm'}];
 for(const mode of shown){const span=document.createElement('span');span.className='hazard-chip hazard-'+mode.code;span.textContent=mode.label;chips.append(span);}
 const reasonRoot=$('stormModeReasons');reasonRoot.replaceChildren();
 const combined=[...(severity.reasons||[]),...coastalReasons];
 for(const reason of [...new Set(combined)].slice(0,6)){const span=document.createElement('span');span.textContent=reason;reasonRoot.append(span);}
 const metrics=$('eventFocusMetrics');metrics.replaceChildren();
 const h=state.hazards||{},codes=new Set(modes.map(m=>m.code)),{nextPeak}=currentStatus(),buoy=state.marine?.['44007']||{};
 if(codes.has('winter')){
  metrics.append(eventMetric('Snow next 24h',fmtHaz(h.winter?.snowfall_24h_in,1,' in'),'NWS grid guidance'));
  metrics.append(eventMetric('Snow next 72h',fmtHaz(h.winter?.snowfall_72h_in,1,' in'),'NWS grid guidance'));
 }
 if(codes.has('tropical')){
  const storm=h.tropical?.storms?.[0];
  metrics.append(eventMetric('Nearest NHC track',storm?fmtHaz(storm.min_forecast_track_distance_mi,0,' mi'):'--',storm?.label||'Relevant tropical system'));
 }
 if(codes.has('heavy_rain'))metrics.append(eventMetric('Rain next 24h',fmtHaz(h.rain?.qpf_24h_in,1,' in'),'NWS grid guidance'));
 if(codes.has('high_wind')||codes.has('winter')||codes.has('tropical'))metrics.append(eventMetric('Peak gust next 24h',fmtHaz(h.wind?.max_gust_24h_mph,0,' mph'),'NWS hourly guidance'));
 if(codes.has('extreme_cold')||codes.has('winter'))metrics.append(eventMetric('Low temperature next 24h',fmtHaz(h.cold?.min_temp_24h_f,0,'°F'),'NWS hourly guidance'));
 if(nextPeak)metrics.append(eventMetric('Portland modeled peak',fmtN(nextPeak.v)+' ft',dayTime(nextPeak.t)+' ET'));
 const high=(state.highs.length?state.highs:highTides()).find(x=>x.t>=now()-10*60000);
 if(high&&metrics.children.length<4)metrics.append(eventMetric('Next high tide',fmtN(high.v)+' ft',dayTime(high.t)+' ET'));
 if(Number.isFinite(buoy.wave_height_ft)&&metrics.children.length<4)metrics.append(eventMetric('Buoy 44007 waves',buoy.wave_height_ft.toFixed(1)+' ft',Number.isFinite(buoy.dominant_period_sec)?buoy.dominant_period_sec.toFixed(0)+' s period':'Measured'));
 while(metrics.children.length>4)metrics.lastElementChild.remove();
}

function renderImpactForecast(){
 const panel=$('impactTimelinePanel'),root=$('impactForecastTimeline');if(!panel||!root)return;
 const modes=hazardModeList(),rows=state.hazards?.hourly||[];
 panel.hidden=!(modes.length&&rows.length);if(panel.hidden)return;
 root.replaceChildren();
 const highs=state.highs.length?state.highs:highTides();
 for(const row of rows){
  const when=Date.parse(row.start||'');if(!Number.isFinite(when))continue;
  const card=document.createElement('article');card.className='impact-forecast-card';
  const timeNode=document.createElement('strong');timeNode.textContent=dayTime(when)+' ET';card.append(timeNode);
  const primary=document.createElement('span');primary.className='impact-primary';primary.textContent=row.precip_type&&row.precip_type!=='Dry / Clouds'?row.precip_type:(row.summary||'Forecast');card.append(primary);
  const bits=[];
  if(Number.isFinite(row.temperature_f))bits.push(Math.round(row.temperature_f)+'°F');
  if(Number.isFinite(row.gust_mph))bits.push('gust '+Math.round(row.gust_mph)+' mph');
  else if(Number.isFinite(row.wind_mph))bits.push('wind '+Math.round(row.wind_mph)+' mph');
  if(Number.isFinite(row.precip_probability_pct))bits.push(Math.round(row.precip_probability_pct)+'% precip');
  const near=highs.find(high=>Math.abs(high.t-when)<=90*60000);
  if(near)bits.push('high tide '+fmtN(near.v)+' ft');
  const small=document.createElement('small');small.textContent=bits.join(' · ');card.append(small);root.append(card);
 }
}

function renderWinterPanel(){
 const panel=$('winterWeatherPanel');if(!panel)return;
 const winter=state.hazards?.winter||{},active=hazardModeList().some(mode=>mode.code==='winter');
 panel.hidden=!active;if(!active)return;
 $('winterSnow24').textContent=fmtHaz(winter.snowfall_24h_in,1,' in');
 $('winterSnow72').textContent=fmtHaz(winter.snowfall_72h_in,1,' in');
 $('winterSnowRate').textContent=fmtHaz(winter.max_average_snow_rate_24h_in_hr,1,' in/hr');
 $('winterTemp').textContent=fmtHaz(state.hazards?.cold?.min_temp_24h_f,0,'°F');
 $('winterGust').textContent=fmtHaz(state.hazards?.wind?.max_gust_24h_mph,0,' mph');
 $('winterVisibility').textContent=fmtHaz(winter.min_visibility_24h_mi,1,' mi');
 $('winterTransition').textContent=winter.precip_transition_24h||'Precipitation-type guidance unavailable.';
 const root=$('winterAlerts');root.replaceChildren();
 const alerts=(state.hazards?.alerts||[]).filter(alert=>/winter|blizzard|snow|ice|freezing/i.test(alert.event||''));
 if(!alerts.length){const span=document.createElement('span');span.textContent='No active NWS winter alert at the Saco coastal reference point.';root.append(span);}
 else for(const alert of alerts){const span=document.createElement('span');span.textContent=alert.event;root.append(span);}
}

function renderTropicalPanel(){
 const panel=$('tropicalPanel');if(!panel)return;
 const tropical=state.hazards?.tropical||{},active=hazardModeList().some(mode=>mode.code==='tropical');
 panel.hidden=!active;if(!active)return;
 const root=$('tropicalStorms');root.replaceChildren();
 const storms=tropical.storms||[];
 if(!storms.length){
  const p=document.createElement('p');p.className='intel-note';p.textContent='A local tropical alert is active, but a matching NHC storm track is unavailable in the current snapshot.';root.append(p);
 }
 for(const storm of storms){
  const card=document.createElement('article');card.className='tropical-storm-card';
  const head=document.createElement('div');head.className='tropical-storm-head';
  const title=document.createElement('strong');title.textContent=storm.label||storm.name||'Tropical cyclone';
  const distance=document.createElement('span');distance.textContent=Number.isFinite(Number(storm.min_forecast_track_distance_mi))?Math.round(storm.min_forecast_track_distance_mi)+' mi nearest forecast track':'Track distance unavailable';
  head.append(title,distance);card.append(head);
  const facts=document.createElement('p'),parts=[];
  if(Number.isFinite(Number(storm.intensity_kt)))parts.push(Math.round(storm.intensity_kt)+' kt');
  if(Number.isFinite(Number(storm.pressure_mb)))parts.push(Math.round(storm.pressure_mb)+' mb');
  if(storm.last_update){const t=Date.parse(storm.last_update);if(Number.isFinite(t))parts.push('NHC update '+dayTime(t)+' ET');}
  facts.textContent=parts.join(' · ');card.append(facts);
  const links=document.createElement('div');links.className='tropical-links';
  for(const [label,url] of [['Advisory',storm.public_advisory_url],['NHC graphics',storm.forecast_graphics_url],['Discussion',storm.forecast_discussion_url],['Earliest wind-arrival guidance',storm.earliest_arrival_guidance_url]]){
   if(!/^https:\/\//i.test(url||''))continue;
   const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label+' ↗';links.append(a);
  }
  card.append(links);root.append(card);
 }
 const wind=state.hazards?.wind||{};
 $('tropicalLocalContext').textContent='Local NWS hourly guidance peaks at '+fmtHaz(wind.max_gust_24h_mph,0,' mph')+' gust in the next 24 hours. NHC track graphics describe cyclone-center uncertainty; local impacts can occur well away from the center.';
}

function renderEventBriefingExtras(){
 const briefing=state.briefing?.event_briefing;if(!briefing)return;
 $('briefHeading').textContent=briefing.active?(briefing.title||'Event Briefing'):'Coastal Briefing';
 $('briefModalTitle').textContent=briefing.active?('Southern Maine '+(briefing.title||'Event Briefing')):'Southern Maine coastal briefing';
 const row=$('briefEventRow'),section=$('briefEventSection');
 row.hidden=!briefing.active;section.hidden=!briefing.active;
 if(briefing.active){
  $('briefEvent').textContent=briefing.summary||'Active weather hazards are being prioritized.';
  $('briefFullEvent').textContent=[briefing.summary,briefing.change_text].filter(Boolean).join(' ');
 }
}

function renderHazards(){
 renderEventFocus();
 renderImpactForecast();
 renderWinterPanel();
 renderTropicalPanel();
 renderEventBriefingExtras();
}

async function loadHazards(){
 if(state.hazardsFetchedAt&&now()-state.hazardsFetchedAt<4*60000){renderHazards();return;}
 try{
  const data=await getJSON('data/hazards.json?t='+Date.now(),12000);
  if(data?.schema_version!==1)throw new Error('Unexpected hazard snapshot schema');
  const generated=Date.parse(data.generated_at||'');
  if(Number.isFinite(generated)&&now()-generated>45*60000)throw new Error('Hazard snapshot is stale');
  state.hazards=data;state.hazardsError=null;state.hazardsFetchedAt=now();health('healthHazards',true,'Connected');
 }catch(err){
  state.hazardsError=String(err?.message||err);console.warn('Adaptive hazard feed:',err);health('healthHazards',false,'Unavailable');
 }
 renderHazards();
}
