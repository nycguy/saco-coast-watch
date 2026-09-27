'use strict';
function briefShort(text,max=130){const s=String(text||'').trim();return s.length<=max?s:s.slice(0,max-1).trimEnd()+'…';}
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
 $('briefSourceNote').textContent=(b.local_pulse?.facebook_note||'Public Facebook posts are not included because reliable public indexing and access are inconsistent.')+' Only weather/coastal-condition items are retained. Community items are anecdotal and are not official NOAA/NWS observations.';
}
async function loadBriefing(){
 try{state.briefing=await getJSON('data/coastal-briefing.json?t='+Date.now(),12000);state.briefingError=null;}
 catch(err){state.briefingError=String(err?.message||err);console.warn('Saco Coast Watch briefing:',err);}
 renderBriefing();
}
