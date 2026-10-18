'use strict';
function eventHistoryTime(value){const t=Date.parse(value||'');return Number.isFinite(t)?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t))+' ET':'Time unavailable';}
function briefingDataAvailability(coverage){
 if(!coverage||!Number.isFinite(coverage.total))return 'Coastal source availability is unavailable in this briefing. Check the source status cards below; missing information is not an all-clear.';
 const details=[...(Array.isArray(coverage.sources)?coverage.sources:[]),...(Array.isArray(coverage.observations)?coverage.observations:[])];
 const unavailable=details.filter(item=>item.status!=='available');
 if(!unavailable.length&&coverage.available===coverage.total){const gauge=details.some(item=>item.name==='NOAA Portland gauge observation');return `All ${coverage.total} coastal-impact inputs${gauge?' and the Portland gauge observation':''} have current source data. This describes data coverage, not forecast confidence.`;}
 const explain={missing:'no current value',stale:'latest reading is stale',malformed:'source data could not be read',unavailable:'source request failed',unsupported:'this station does not report the measurement',not_checked:'not checked by this feed'};
 const issues=unavailable.slice(0,3).map(item=>`${item.name||'Source'}: ${explain[item.status]||'status unavailable'}`);
 const count=Number.isFinite(coverage.available)?`${coverage.available} of ${coverage.total} coastal-impact inputs have current data`:'Coastal source coverage is incomplete';
 return `${count}${issues.length?'. '+issues.join('; ')+'.':''} This briefing may be incomplete; missing data does not mean conditions are safe.`;
}
function briefingCurrentStatus(briefing){
 const snapshot=briefing?.current_snapshot||{},event=snapshot.event_state||{},coverage=event.coastal_impact?.data_coverage||{};
 if(!Object.keys(event).length)return 'Current coastal status is unavailable. Check the live observations and official alert links below.';
 const sourceDetails=[...(coverage.sources||[]),...(coverage.observations||[])],incomplete=sourceDetails.some(item=>item.status!=='available');
 const hazards=snapshot.hazards||{},alerts=event.official_alerts||[],alertText=hazards.errors?.nws_alerts||hazards.errors?.nws_marine_alerts?'Official NWS alert status is unavailable.':alerts.length?'Active official NWS products: '+[...new Set(alerts.map(item=>item.event).filter(Boolean))].slice(0,3).join(', ')+'.':'No active official NWS alert was returned for this coastal reference point.';
 let current;
 if(event.show_focus){const impact=event.impact?.label;current=[event.primary_display||'Coastal hazard',impact?impact+' impact':null,event.phase].filter(Boolean).join(' · ')+'.';}
 else if(event.phase==='Recent')current=event.summary||'Recent coastal impacts were recorded; current conditions are being checked independently.';
 else current='Available data has not identified an active or near-term coastal hazard.';
 return current+' '+alertText+(incomplete?' Some sources are missing or stale, so this is not an all-clear.':'');
}
function renderBriefingPriorities(items){
 const row=$('briefPriorityRow'),compact=$('briefPriorities'),section=$('briefPrioritySection'),root=$('briefPriorityItems');
 const priorities=Array.isArray(items)?items.filter(item=>item&&item.title&&item.text):[];
 const next=priorities.slice(0,1);
 if(row)row.hidden=!next.length;
 if(compact)compact.textContent=next.map(item=>item.title+': '+item.text).join(' ');
 if(section)section.hidden=!priorities.length;
 if(root){root.replaceChildren();for(const item of priorities){const article=document.createElement('article'),title=document.createElement('h5'),text=document.createElement('p');article.className='brief-priority-item';title.textContent=item.title;text.textContent=item.text;article.append(title,text);root.append(article);}}
}
function renderEventHistory(){
 const panel=$('eventHistoryPanel'),root=$('eventHistoryCards'),archive=$('eventHistoryArchive'),archiveRoot=$('eventHistoryArchiveCards');if(!panel||!root||!archiveRoot)return;
 const events=Array.isArray(state.briefing?.event_history)?state.briefing.event_history:[];
 const groups=window.SacoEventUtils?.groupRecentEvents(events)||events.map(item=>({records:[item],...(item||{}),rank:Number(item?.highest_impact?.rank)||0}));
 panel.hidden=!events.length;root.replaceChildren();archiveRoot.replaceChildren();if(!events.length)return;
 function renderCards(target,items,primary=false){
  for(const [index,raw] of items.entries()){
   const item=raw&&typeof raw==='object'?raw:{};
   const card=document.createElement('article');card.className='event-history-card'+(primary&&index===0?' recent':'');
   const head=document.createElement('div');head.className='event-history-head';
   const title=document.createElement('div'),strong=document.createElement('strong'),time=document.createElement('span');
   strong.textContent=item.title||'Coastal Event';time.textContent=eventHistoryTime(item.started_at)+(item.ended_at?' → '+eventHistoryTime(item.ended_at):'');title.append(strong,time);
   const badge=document.createElement('span');badge.className='event-history-badge impact-'+(['green','yellow','orange','red'][Number(item.highest_impact?.rank)||0]||'green');badge.textContent=item.highest_impact?.label||'Routine';head.append(title,badge);card.append(head);
   const metrics=document.createElement('div');metrics.className='event-history-metrics';
   const pairs=[['Highest observed water',item.max_observed_water_ft,' ft',2],['Water above predicted tide',item.max_residual_ft,' ft',2],['Highest NOAA forecast',item.max_modeled_water_ft,' ft',2],['Highest waves',item.max_wave_ft,' ft',1],['Highest gust',item.max_gust_mph,' mph',1],['Highest NWS surf',item.max_surf_ft,' ft',1]];
   for(const [label,value,suffix,digits] of pairs){if(!hasNumericValue(value))continue;const d=document.createElement('div'),span=document.createElement('span'),b=document.createElement('b');span.textContent=label;b.textContent=Number(value).toFixed(digits)+suffix;d.append(span,b);metrics.append(d);}if(metrics.children.length)card.append(metrics);
   const definitions=document.createElement('p');definitions.className='event-history-definitions';definitions.textContent='Water above predicted tide compares the Portland gauge with the tide prediction. NOAA forecast is the highest captured forecast water level.';card.append(definitions);
   const coverageValue=item.captured_coverage_hours??item.duration_hours,coverage=hasNumericValue(coverageValue)?Number(coverageValue):null,bits=[];if(coverage!==null)bits.push('Recorded for '+coverage.toFixed(1)+'h');if(hasNumericValue(item.snapshot_count))bits.push(item.snapshot_count+' saved records');if((item.official_products||[]).length)bits.push('NWS: '+item.official_products.slice(0,3).join(', '));
   const foot=document.createElement('p');foot.textContent=bits.join(' · ')||'Captured event summary';card.append(foot);
   if(item.coverage_basis){const note=document.createElement('p');note.className='event-history-note';note.textContent=item.coverage_basis;card.append(note);}
   for(const quality of item.data_quality||[]){const note=document.createElement('p');note.className='event-history-quality';note.textContent=quality.message||(quality.type==='superseded_surf_parse'?'An earlier surf reading was replaced after the same forecast was checked again.':'A correction was applied to an earlier saved reading.');card.append(note);}
   if(Array.isArray(item.records)&&item.records.length>1){const grouped=document.createElement('p');grouped.className='event-history-note';grouped.textContent='One episode summarized from '+item.records.length+' overlapping records; original records are preserved in the full history.';card.append(grouped);}
   target.append(card);
  }
 }
 renderCards(root,groups,true);renderCards(archiveRoot,events);
 const summary=archive?.querySelector(':scope > summary');
 if(summary){const action=summary.querySelector('.disclosure-action');summary.textContent='Complete event history · '+events.length+' captured record'+(events.length===1?'':'s');if(action)summary.append(action);}
 window.SacoDisclosures?.init(panel);
}
function renderBriefing(){
 const b=state.briefing;
 if(!b){if(state.briefingError){$('briefPast').textContent='Briefing temporarily unavailable.';$('briefChange').textContent='NOAA chart remains available above.';$('briefNext').textContent='Use the live water-level outlook above.';$('briefPulse').textContent='Weather-related local scan unavailable.';$('briefUpdated').textContent='Briefing feed unavailable';}return;}
 $('briefPast').textContent=b.past_24h?.dashboard_text||b.past_24h?.text||'Past-24-hour summary unavailable.';
 $('briefChange').textContent=b.forecast_change_24h?.dashboard_text||b.forecast_change_24h?.text||'A fixed-window forecast comparison is unavailable.';
 $('briefNext').textContent=b.next_24h?.dashboard_text||b.next_24h?.text||'Next-24-hour guidance unavailable.';
 $('briefPulse').textContent=b.local_pulse?.dashboard_summary||b.local_pulse?.summary||'No weather-related local reports are available.';
 const generated=Date.parse(b.generated_at||'');
 $('briefUpdated').textContent=Number.isFinite(generated)?'Updated '+dayTime(generated)+' ET':'Updated recently';
 $('briefFullPast').textContent=b.past_24h?.text||'Past-24-hour summary unavailable.';
 $('briefFullChange').textContent=b.forecast_change_24h?.text||'24-hour forecast comparison unavailable.';
 $('briefFull24').textContent=b.next_24h?.text||'Next-24-hour guidance unavailable.';
 $('briefFull72').textContent=b.next_72h?.text||'Next-72-hour guidance unavailable.';
 renderBriefingPriorities(b.priorities);
 $('briefCurrentStatus').textContent=briefingCurrentStatus(b);
 const coverage=b.current_snapshot?.event_state?.coastal_impact?.data_coverage;
 $('briefDataAvailability').textContent=briefingDataAvailability(coverage);
 $('briefFullPulse').textContent=b.local_pulse?.summary||'No public local items were returned.';
 $('briefModalUpdated').textContent=(Number.isFinite(generated)?'Updated '+dayTime(generated)+' ET · ':'')+'Fixed rolling windows · NOAA / NWS / weather-related local reporting';
 const list=$('briefPulseList');list.replaceChildren();
 for(const item of (b.local_pulse?.items||[]).slice(0,8)){
  const a=document.createElement('a');a.className='brief-pulse-item';a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';
  const small=document.createElement('small');small.textContent=(item.type==='reddit'?'Anecdotal weather report · Reddit':'Weather/coastal report · '+(item.source||'Public source'));
  const span=document.createElement('span');span.textContent=item.title||'Open source';
  a.append(small,span);list.append(a);
 }
 const feedHealth=(b.local_pulse?.sources||[]).filter(item=>item&&item.name&&item.status).map(item=>item.name+': '+(item.message||({available:'available',unavailable:'temporarily unavailable',malformed:'could not be read',not_checked:'not checked'}[item.status]||'status unavailable')));
 $('briefSourceNote').textContent=(b.local_pulse?.facebook_note||'Public Facebook posts are not included because reliable public indexing and access are inconsistent.')+' Only weather/coastal-condition items are retained. Community items are anecdotal and are not official NOAA/NWS observations.'+(feedHealth.length?' Source checks: '+feedHealth.join('; ')+'.':' Feed availability was not recorded for this capture.');if(typeof renderEventBriefingExtras==='function')renderEventBriefingExtras();renderEventHistory();
 const timeline=$('briefTimeline');if(timeline){timeline.replaceChildren();const events=b.impact_timeline||[];if(!events.length){const p=document.createElement('p');p.className='impact-empty';p.textContent='No timestamped coastal impacts were retained in the past 24 hours.';timeline.append(p);}else for(const item of events){const row=document.createElement('div');row.className='impact-item';const when=document.createElement('div');when.className='impact-time';const t=Date.parse(item.at||'');when.textContent=Number.isFinite(t)?dayTime(t)+' ET':'Time unavailable';const dot=document.createElement('span');dot.className='impact-dot';const body=document.createElement('div');body.className='impact-body';const title=document.createElement('strong');title.textContent=item.title||'Coastal event';const source=document.createElement('small');source.textContent=(item.anecdotal?'Anecdotal · ':'')+(item.source||'Public source');if(item.anecdotal)source.className='anecdotal';body.append(title,source);if(item.url){const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open source ↗';a.className='mini-link';body.append(a);}row.append(when,dot,body);timeline.append(row);}}
}
async function loadBriefing(){
 try{state.briefing=await getJSON('data/coastal-briefing.json?t='+Date.now(),12000);state.briefingError=null;}
 catch(err){state.briefingError=String(err?.message||err);console.warn('Saco Coast Watch briefing:',err);}
 renderBriefing();
 if(typeof renderCoastalIntelligence==='function')renderCoastalIntelligence();
}
