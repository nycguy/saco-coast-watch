'use strict';

function normalizedEventState(){
 const snapshot=state.briefing?.current_snapshot||{};
 const fromBrief=snapshot.event_state||snapshot.hazards?.event_state;
 if(fromBrief)return fromBrief;
 if(state.hazards?.event_state)return state.hazards.event_state;
 const modes=[...(state.hazards?.active_modes||[])];
 return {phase:modes.length?'Approaching':'Routine',show_focus:modes.length>0,primary_display:modes[0]?.label||'Routine Coastal Conditions',impact:state.hazards?.severity||{level:'green',label:'Routine',rank:0},recent_impact:{level:'green',label:'Routine',rank:0},event_identity:null,active_hazards:modes,official_alerts:state.hazards?.alerts||[],recent_impacts:[],reasons:[]};
}
function sourceHazards(){return state.briefing?.current_snapshot?.hazards||state.hazards||{};}
function hazardModeList(){return normalizedEventState().active_hazards||[];}
function hazardSeverity(){return normalizedEventState().impact||{level:'green',label:'Routine',rank:0};}
function eventDisplayTitle(eventState=normalizedEventState()){return eventState?.event_identity?.label||eventState?.primary_display||'Adaptive Event';}
function eventMetric(label,value,detail){const node=document.createElement('div');node.className='event-metric';const caption=document.createElement('span');caption.textContent=label;const strong=document.createElement('strong');strong.textContent=value||'--';node.append(caption,strong);if(detail){const small=document.createElement('small');small.textContent=detail;node.append(small);}return node;}
function fmtHaz(value,digits=1,suffix=''){const n=Number(value);return Number.isFinite(n)?n.toFixed(digits)+suffix:'--';}

function renderEventFocus(){
 const panel=$('stormModePanel');if(!panel)return;
 const eventState=normalizedEventState(),active=Boolean(eventState.show_focus);
 panel.hidden=!active;document.body.classList.toggle('hazard-active',active);document.body.classList.toggle('storm-mode',active);
 for(const level of ['green','yellow','orange','red'])document.body.classList.remove('hazard-severity-'+level);
 if(!active)return;
 const severity=hazardSeverity();document.body.classList.add('hazard-severity-'+severity.level);
 $('eventFocusTitle').textContent=eventDisplayTitle(eventState);
 $('eventFocusBadge').textContent=severity.label+' · '+(eventState.phase||'Active');
 $('eventFocusDescription').textContent=(eventState.summary||'Saco Coast Watch is prioritizing the hazards most relevant to the next 72 hours.')+' Official NWS/NHC products remain authoritative.';
 const timing=eventState.event_timing||{},peakAt=Date.parse(timing.peak_at||''),hours=Number(timing.hours_until_peak);
 const peakNode=$('eventPeakSummary');
 if(peakNode){
  if(Number.isFinite(peakAt)){
   const relative=Number.isFinite(hours)?(hours>0.5?'Peak coastal-impact window in '+Math.round(hours)+'h':hours>=-0.5?'Peak coastal-impact window is near now':'Peak window passed '+Math.abs(Math.round(hours))+'h ago'):'Peak timing available';
   peakNode.textContent=relative+' · '+dayTime(peakAt)+' ET';
  }else peakNode.textContent='Peak timing is unavailable from the current authoritative guidance.';
 }
 const coastal=eventState.coastal_impact||{},confidence=coastal.confidence||{};
 const confidenceNode=$('eventConfidence');
 if(confidenceNode){const missing=(confidence.missing||[]);confidenceNode.textContent=(confidence.label?'Confidence: '+confidence.label:'Confidence unavailable')+(missing.length?' · Missing '+missing.slice(0,2).join(', '):'');}
 const chips=$('hazardModeChips');chips.replaceChildren();
 for(const mode of hazardModeList()){const span=document.createElement('span');span.className='hazard-chip hazard-'+mode.code;span.textContent=mode.label;chips.append(span);}
 const reasonRoot=$('stormModeReasons');reasonRoot.replaceChildren();const reasons=[...(eventState.reasons||[])];
 for(const alert of eventState.official_alerts||[]){if(alert?.event)reasons.push('NWS '+alert.event);}
 for(const reason of [...new Set(reasons)].slice(0,6)){const span=document.createElement('span');span.textContent=reason;reasonRoot.append(span);}
 const why=$('eventWhyList');if(why){why.replaceChildren();const drivers=coastal.drivers||[];for(const driver of drivers.slice(0,6)){const row=document.createElement('div');row.className='event-why-row';const label=document.createElement('span');label.textContent=driver.label||'Driver';const value=document.createElement('strong');value.textContent=driver.value||'Available';const source=document.createElement('small');source.textContent=driver.source||'';row.append(label,value,source);why.append(row);}if(!drivers.length){const row=document.createElement('div');row.className='event-why-empty';row.textContent='This event is being driven by the active hazard signals shown above; no compound coastal-impact drivers are available.';why.append(row);}}
 const method=$('eventWhyMethod');if(method)method.textContent=coastal.method||'Impact level combines hazard-specific official guidance and available local observations. Official NWS/NHC products remain authoritative.';
 const metrics=$('eventFocusMetrics');metrics.replaceChildren();
 const h=sourceHazards(),codes=new Set(hazardModeList().map(m=>m.code)),{nextPeak}=currentStatus(),buoy=state.marine?.['44007']||{};
 if(codes.has('tropical')){const storm=h.tropical?.storms?.[0];metrics.append(eventMetric('Nearest NHC track',storm?fmtHaz(storm.min_forecast_track_distance_mi,0,' mi'):'--',storm?.label||'Official NHC storm'));}
 if(codes.has('coastal_flood')&&nextPeak)metrics.append(eventMetric('Portland modeled peak',fmtN(nextPeak.v)+' ft',dayTime(nextPeak.t)+' ET'));
 if(codes.has('high_surf'))metrics.append(eventMetric('Forecast surf',fmtHaz(h.surf?.max_surf_height_ft,0,' ft'),'NWS Coastal York Surf Zone Forecast'));
 if(codes.has('beach_hazard'))metrics.append(eventMetric('Rip current risk',h.surf?.rip_current_risk||'--','NWS Surf Zone Forecast'));
 if(codes.has('winter')){metrics.append(eventMetric('Snow next 24h',fmtHaz(h.winter?.snowfall_24h_in,1,' in'),'NWS grid guidance'));metrics.append(eventMetric('Snow next 72h',fmtHaz(h.winter?.snowfall_72h_in,1,' in'),'NWS grid guidance'));}
 if(codes.has('heavy_rain')||codes.has('flooding'))metrics.append(eventMetric('Rain next 24h',fmtHaz(h.rain?.qpf_24h_in,1,' in'),'NWS grid guidance'));
 if(codes.has('high_wind')||codes.has('winter')||codes.has('tropical'))metrics.append(eventMetric('Peak gust next 24h',fmtHaz(h.wind?.max_gust_24h_mph,0,' mph'),'NWS land forecast'));
 if(codes.has('marine_hazard'))metrics.append(eventMetric('Buoy 44007 waves',Number.isFinite(buoy.wave_height_ft)?buoy.wave_height_ft.toFixed(1)+' ft':'--',Number.isFinite(buoy.gust_mph)?'gust '+Math.round(buoy.gust_mph)+' mph':'Measured offshore'));
 if(codes.has('extreme_cold')||codes.has('winter'))metrics.append(eventMetric('Low temperature next 24h',fmtHaz(h.cold?.min_temp_24h_f,0,'°F'),'NWS hourly guidance'));
 if(codes.has('coastal_impact')){const peak=coastal.peak_window||{},impact=coastal.impact||{};metrics.append(eventMetric('Compound coastal impact',impact.label||'--',Number.isFinite(Number(impact.score))?'Score '+impact.score+'/100':'Saco Coast Watch synthesis'));if(Number.isFinite(Number(peak.onshore_component_mph)))metrics.append(eventMetric('Onshore wind component',Math.round(peak.onshore_component_mph)+' mph',peak.forecast_wind_direction||'NWS hourly wind'));}
 const wave=coastal.wave_context||{};if(Number.isFinite(Number(wave.power_proxy_kw_m))&&metrics.children.length<4)metrics.append(eventMetric('Wave-power proxy',Number(wave.power_proxy_kw_m).toFixed(1)+' kW/m','Derived from latest NDBC Hs and dominant period'));
 const high=(state.highs.length?state.highs:highTides()).find(x=>x.t>=now()-10*60000);if(high&&metrics.children.length<4)metrics.append(eventMetric('Next high tide',fmtN(high.v)+' ft',dayTime(high.t)+' ET'));
 while(metrics.children.length>4)metrics.lastElementChild.remove();
}
function renderImpactForecast(){
 const panel=$('impactTimelinePanel'),root=$('impactForecastTimeline');if(!panel||!root)return;
 const eventState=normalizedEventState(),rows=sourceHazards().hourly||[];panel.hidden=!(eventState.show_focus&&rows.length);if(panel.hidden)return;
 root.replaceChildren();const highs=state.highs.length?state.highs:highTides();
 for(const row of rows){const when=Date.parse(row.start||'');if(!Number.isFinite(when))continue;const card=document.createElement('article');card.className='impact-forecast-card';const timeNode=document.createElement('strong');timeNode.textContent=dayTime(when)+' ET';card.append(timeNode);const primary=document.createElement('span');primary.className='impact-primary';primary.textContent=row.precip_type&&row.precip_type!=='Dry / Clouds'?row.precip_type:(row.summary||'Forecast');card.append(primary);const bits=[];if(Number.isFinite(row.temperature_f))bits.push(Math.round(row.temperature_f)+'°F');if(Number.isFinite(row.gust_mph))bits.push('gust '+Math.round(row.gust_mph)+' mph');else if(Number.isFinite(row.wind_mph))bits.push('wind '+Math.round(row.wind_mph)+' mph');if(Number.isFinite(row.precip_probability_pct))bits.push(Math.round(row.precip_probability_pct)+'% precip');const near=highs.find(high=>Math.abs(high.t-when)<=90*60000);if(near)bits.push('high tide '+fmtN(near.v)+' ft');const small=document.createElement('small');small.textContent=bits.join(' · ');card.append(small);root.append(card);}
}
function renderWinterPanel(){
 const panel=$('winterWeatherPanel');if(!panel)return;const h=sourceHazards(),winter=h.winter||{},active=hazardModeList().some(mode=>mode.code==='winter');panel.hidden=!active;if(!active)return;
 $('winterSnow24').textContent=fmtHaz(winter.snowfall_24h_in,1,' in');$('winterSnow72').textContent=fmtHaz(winter.snowfall_72h_in,1,' in');$('winterSnowRate').textContent=fmtHaz(winter.max_average_snow_rate_24h_in_hr,1,' in/hr');$('winterTemp').textContent=fmtHaz(h.cold?.min_temp_24h_f,0,'°F');$('winterGust').textContent=fmtHaz(h.wind?.max_gust_24h_mph,0,' mph');$('winterVisibility').textContent=fmtHaz(winter.min_visibility_24h_mi,1,' mi');$('winterTransition').textContent=winter.precip_transition_24h||'Precipitation-type guidance unavailable.';
 const root=$('winterAlerts');root.replaceChildren();const alerts=(h.alerts||[]).filter(alert=>/winter|blizzard|snow|ice|freezing/i.test(alert.event||''));if(!alerts.length){const span=document.createElement('span');span.textContent='No active NWS winter alert at the Saco coastal reference point.';root.append(span);}else for(const alert of alerts){const span=document.createElement('span');span.textContent=alert.event;root.append(span);}
}
function renderTropicalPanel(){
 const panel=$('tropicalPanel');if(!panel)return;const h=sourceHazards(),tropical=h.tropical||{},active=hazardModeList().some(mode=>mode.code==='tropical');panel.hidden=!active;if(!active)return;
 const root=$('tropicalStorms');root.replaceChildren(),storms=tropical.storms||[];$('tropicalHeading').textContent=(storms[0]?.label||'Tropical cyclone')+' outlook';
 if(!storms.length){const p=document.createElement('p');p.className='intel-note';p.textContent='A local tropical alert is active, but a matching NHC storm track is unavailable in the current snapshot.';root.append(p);}
 for(const storm of storms){const card=document.createElement('article');card.className='tropical-storm-card';const head=document.createElement('div');head.className='tropical-storm-head';const title=document.createElement('strong');title.textContent=storm.label||storm.name||'Tropical cyclone';const distance=document.createElement('span');distance.textContent=Number.isFinite(Number(storm.min_forecast_track_distance_mi))?Math.round(storm.min_forecast_track_distance_mi)+' mi nearest forecast track':'Track distance unavailable';head.append(title,distance);card.append(head);const facts=document.createElement('p'),parts=[];if(Number.isFinite(Number(storm.intensity_kt)))parts.push(Math.round(storm.intensity_kt)+' kt');if(Number.isFinite(Number(storm.pressure_mb)))parts.push(Math.round(storm.pressure_mb)+' mb');if(storm.last_update){const t=Date.parse(storm.last_update);if(Number.isFinite(t))parts.push('NHC update '+dayTime(t)+' ET');}facts.textContent=parts.join(' · ');card.append(facts);const links=document.createElement('div');links.className='tropical-links';for(const [label,url] of [['Advisory',storm.public_advisory_url],['NHC graphics',storm.forecast_graphics_url],['Discussion',storm.forecast_discussion_url],['Earliest wind-arrival guidance',storm.earliest_arrival_guidance_url]]){if(!/^https:\/\//i.test(url||''))continue;const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label+' ↗';links.append(a);}card.append(links);root.append(card);}
 const wind=h.wind||{};$('tropicalLocalContext').textContent='Local NWS hourly guidance peaks at '+fmtHaz(wind.max_gust_24h_mph,0,' mph')+' gust in the next 24 hours. NHC track graphics describe cyclone-center uncertainty; local impacts can occur well away from the center.';
}
function renderEventBriefingExtras(){
 const briefing=state.briefing?.event_briefing,recent=state.briefing?.recent_event;if(!briefing&&!recent)return;const active=Boolean(briefing?.active),recentActive=Boolean(!active&&recent?.active),row=$('briefEventRow'),section=$('briefEventSection');row.hidden=!(active||recentActive);section.hidden=!(active||recentActive);
 if(active){$('briefHeading').textContent=briefing.title||'Event Briefing';$('briefModalTitle').textContent='Southern Maine '+(briefing.title||'Event Briefing');$('briefEventLabel').textContent='Event status';$('briefEvent').textContent=briefing.summary||'Active weather hazards are being prioritized.';$('briefFullEvent').textContent=[briefing.summary,briefing.change_text].filter(Boolean).join(' ');}
 else if(recentActive){$('briefHeading').textContent='Coastal Briefing';$('briefModalTitle').textContent='Southern Maine coastal briefing';$('briefEventLabel').textContent='Recent event';$('briefEvent').textContent=recent.summary;$('briefFullEvent').textContent=recent.summary;}
 else{$('briefHeading').textContent='Coastal Briefing';$('briefModalTitle').textContent='Southern Maine coastal briefing';}
}
function renderHazards(){renderEventFocus();renderImpactForecast();renderWinterPanel();renderTropicalPanel();renderEventBriefingExtras();}
async function loadHazards(){if(state.hazardsFetchedAt&&now()-state.hazardsFetchedAt<4*60000){renderHazards();return;}try{const data=await getJSON('data/hazards.json?t='+Date.now(),12000);if(data?.schema_version!==1)throw new Error('Unexpected hazard snapshot schema');const generated=Date.parse(data.generated_at||'');if(Number.isFinite(generated)&&now()-generated>45*60000)throw new Error('Hazard snapshot is stale');state.hazards=data;state.hazardsError=null;state.hazardsFetchedAt=now();health('healthHazards',true,'Connected');}catch(err){state.hazardsError=String(err?.message||err);console.warn('Adaptive hazard feed:',err);health('healthHazards',false,'Unavailable');}renderHazards();}
