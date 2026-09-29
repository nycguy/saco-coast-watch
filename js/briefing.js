'use strict';
function briefShort(text,max=130){const s=String(text||'').trim();return s.length<=max?s:s.slice(0,max-1).trimEnd()+'…';}
function eventHistoryTime(value){const t=Date.parse(value||'');return Number.isFinite(t)?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t))+' ET':'Time unavailable';}
function renderEventHistory(){
 const panel=$('eventHistoryPanel'),root=$('eventHistoryCards');if(!panel||!root)return;
 const events=state.briefing?.event_history||[];panel.hidden=!events.length;root.replaceChildren();if(!events.length)return;
 for(const [index,item] of events.entries()){
  const card=document.createElement('article');card.className='event-history-card'+(index===0&&item.phase==='Recent'?' recent':'');
  const head=document.createElement('div');head.className='event-history-head';
  const title=document.createElement('div'),strong=document.createElement('strong'),time=document.createElement('span');
  strong.textContent=item.title||'Coastal Event';time.textContent=eventHistoryTime(item.started_at)+(item.ended_at?' → '+eventHistoryTime(item.ended_at):'');title.append(strong,time);
  const badge=document.createElement('span');badge.className='event-history-badge impact-'+(['green','yellow','orange','red'][Number(item.highest_impact?.rank)||0]||'green');badge.textContent=item.highest_impact?.label||'Routine';head.append(title,badge);card.append(head);
  const metrics=document.createElement('div');metrics.className='event-history-metrics';
  const pairs=[
   ['Highest observed water',item.max_observed_water_ft,' ft',2],
   ['Water above predicted tide',item.max_residual_ft,' ft',2],
   ['Highest NOAA forecast',item.max_modeled_water_ft,' ft',2],
   ['Highest waves',item.max_wave_ft,' ft',1],
   ['Highest gust',item.max_gust_mph,' mph',1],
   ['Highest NWS surf',item.max_surf_ft,' ft',1]
  ];
  for(const [label,value,suffix,digits] of pairs){if(!Number.isFinite(Number(value)))continue;const d=document.createElement('div'),span=document.createElement('span'),b=document.createElement('b');span.textContent=label;b.textContent=Number(value).toFixed(digits)+suffix;d.append(span,b);metrics.append(d);}card.append(metrics);
  const definitions=document.createElement('p');definitions.className='event-history-definitions';definitions.textContent='Water above predicted tide compares the Portland gauge with the tide prediction. NOAA forecast is the highest forecast water level captured for this event.';card.append(definitions);
  const foot=document.createElement('p'),coverage=Number(item.captured_coverage_hours??item.duration_hours),bits=[];if(Number.isFinite(coverage))bits.push('Recorded for '+coverage.toFixed(1)+'h');if(Number.isFinite(Number(item.snapshot_count)))bits.push(item.snapshot_count+' snapshots');if((item.official_products||[]).length)bits.push('NWS: '+item.official_products.slice(0,3).join(', '));foot.textContent=bits.join(' · ')||'Captured event summary';card.append(foot);
  if(item.coverage_basis){const note=document.createElement('p');note.className='event-history-note';note.textContent=item.coverage_basis;card.append(note);}
  for(const quality of item.data_quality||[]){const note=document.createElement('p');note.className='event-history-quality';note.textContent=quality.message||'A superseded historical parse was excluded from this retrospective.';card.append(note);}
  root.append(card);
 }
}
function renderBriefing(){
 const b=state.briefing;
 if(!b){if(state.briefingError){$('briefPast').textContent='Briefing temporarily unavailable.';$('briefChange').textContent='NOAA chart remains available above.';$('briefNext').textContent='Use the live water-level outlook above.';$('briefPulse').textContent='Weather-related local scan unavailable.';$('briefUpdated').textContent='Briefing feed unavailable';}return;}
 $('briefPast').textContent=briefShort(b.past_24h?.text);
 $('briefChange').textContent=briefShort(b.forecast_change_24h?.text);
 $('briefNext').textContent=briefShort(b.next_24h?.text);
 $('briefPulse').textContent=briefShort(b.local_pulse?.summary);
 const generated=Date.parse(b.generated_at||'');
 $('briefUpdated').textContent=Number.isFinite(generated)?'Updated '+dayTime(generated)+' ET':'Updated recently';
 $('briefFullPast').textContent=b.past_24h?.text||'Past-24-hour summary unavailable.';
 $('briefFullChange').textContent=b.forecast_change_24h?.text||'24-hour forecast comparison unavailable.';
 $('briefFull24').textContent=b.next_24h?.text||'Next-24-hour guidance unavailable.';
 $('briefFull72').textContent=b.next_72h?.text||'Next-72-hour guidance unavailable.';
 $('briefFullPulse').textContent=b.local_pulse?.summary||'No public local items were returned.';
 $('briefModalUpdated').textContent=(Number.isFinite(generated)?'Updated '+dayTime(generated)+' ET · ':'')+'Fixed rolling windows · NOAA / NWS / weather-related local reporting';
 const list=$('briefPulseList');list.replaceChildren();
 for(const item of (b.local_pulse?.items||[]).slice(0,8)){
  const a=document.createElement('a');a.className='brief-pulse-item';a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';
  const small=document.createElement('small');small.textContent=(item.type==='reddit'?'Anecdotal weather report · Reddit':'Weather/coastal report · '+(item.source||'Public source'));
  const span=document.createElement('span');span.textContent=item.title||'Open source';
  a.append(small,span);list.append(a);
 }
 $('briefSourceNote').textContent=(b.local_pulse?.facebook_note||'Public Facebook posts are not included because reliable public indexing and access are inconsistent.')+' Only weather/coastal-condition items are retained. Community items are anecdotal and are not official NOAA/NWS observations.';if(typeof renderEventBriefingExtras==='function')renderEventBriefingExtras();renderEventHistory();
 const timeline=$('briefTimeline');if(timeline){timeline.replaceChildren();const events=b.impact_timeline||[];if(!events.length){const p=document.createElement('p');p.className='impact-empty';p.textContent='No timestamped coastal impacts were retained in the past 24 hours.';timeline.append(p);}else for(const item of events){const row=document.createElement('div');row.className='impact-item';const when=document.createElement('div');when.className='impact-time';const t=Date.parse(item.at||'');when.textContent=Number.isFinite(t)?dayTime(t)+' ET':'Time unavailable';const dot=document.createElement('span');dot.className='impact-dot';const body=document.createElement('div');body.className='impact-body';const title=document.createElement('strong');title.textContent=item.title||'Coastal event';const source=document.createElement('small');source.textContent=(item.anecdotal?'Anecdotal · ':'')+(item.source||'Public source');if(item.anecdotal)source.className='anecdotal';body.append(title,source);if(item.url){const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open source ↗';a.className='mini-link';body.append(a);}row.append(when,dot,body);timeline.append(row);}}
}
async function loadBriefing(){
 try{state.briefing=await getJSON('data/coastal-briefing.json?t='+Date.now(),12000);state.briefingError=null;}
 catch(err){state.briefingError=String(err?.message||err);console.warn('Saco Coast Watch briefing:',err);}
 renderBriefing();
 if(typeof renderCoastalIntelligence==='function')renderCoastalIntelligence();
}
