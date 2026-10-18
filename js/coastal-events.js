/* Deterministic coastal-event grouping shared by recent and forecast displays. */
(function(root){
 'use strict';
 const HOURS=60*60*1000;
 const familyOf=value=>{
  const s=String(value||'').toLowerCase();
  if(/hurricane|tropical storm|tropical cyclone|tropical depression|nhc|named storm/.test(s))return 'tropical';
  if(/coastal flood|storm surge|flooding|inundation/.test(s))return 'coastal-flood';
  if(/high surf|rip current|beach hazard|wave impact|surf|small craft|marine/.test(s))return 'marine';
  if(/winter|blizzard|snow|sleet|ice storm|freezing rain/.test(s))return 'winter';
  if(/heavy rain|rainfall|flash flood/.test(s))return 'rain';
  if(/high wind|wind advisory|wind warning|gale/.test(s))return 'wind';
  if(/nor.?easter|coastal storm/.test(s))return 'coastal-storm';
  return 'other';
 };
 const identityOf=item=>{
  const title=String(item?.title||item?.label||item?.event||'').toLowerCase()
   .replace(/potential tropical cyclone|tropical depression|tropical storm|hurricane|coastal flood(ing)?|high surf|wave impact|small craft advisory|coastal event/g,' ')
   .replace(/\b(approaching|ongoing|improving|recent|warning|watch|advisory|statement|conditions|event|coastal|storm|the|and|for)\b/g,' ')
   .replace(/[^a-z0-9]+/g,' ').trim();
  return title.split(/\s+/).filter(token=>token.length>1).join(' ');
 };
 const dateOf=value=>{const ms=Date.parse(value||'');return Number.isFinite(ms)?ms:null;};
 function rangesNear(a,b,maxGapHours=12){
  const as=dateOf(a?.started_at||a?.start||a?.window_start||a?.onset||a?.at),ae=dateOf(a?.ended_at||a?.end||a?.window_end||a?.expires)||as;
  const bs=dateOf(b?.started_at||b?.start||b?.window_start||b?.onset||b?.at),be=dateOf(b?.ended_at||b?.end||b?.window_end||b?.expires)||bs;
  if(as===null||bs===null)return false;
  return Math.max(as,bs)<=Math.min(ae,be)+maxGapHours*HOURS;
 }
 function matchingEvidence(a,b){
  const af=familyOf([a?.title,a?.label,a?.event,...(a?.official_products||[])].join(' '));
  const bf=familyOf([b?.title,b?.label,b?.event,...(b?.official_products||[])].join(' '));
  const locationA=String(a?.location||a?.area||'').trim().toLowerCase(),locationB=String(b?.location||b?.area||'').trim().toLowerCase();
  if(locationA&&locationB&&locationA!==locationB)return false;
  const ai=identityOf(a),bi=identityOf(b);
  if(ai&&bi&&ai===bi)return true;
  if(af!==bf)return false;
  const products=new Set((a?.official_products||[]).map(x=>String(x).toLowerCase().trim()).filter(Boolean));
  const otherProducts=(b?.official_products||[]).map(x=>String(x).toLowerCase().trim());
  if(otherProducts.some(x=>products.has(x)))return true;
  return false;
 }
 function sameEpisode(a,b,maxGapHours=12){return rangesNear(a,b,maxGapHours)&&matchingEvidence(a,b);}
 function groupRecentEvents(events){
  const groups=[];
  for(const event of Array.isArray(events)?events:[]){
   const match=groups.find(group=>group.records.some(record=>sameEpisode(record,event)));
   if(match)match.records.push(event);else groups.push({records:[event]});
  }
  return groups.map(group=>summarize(group.records)).sort((a,b)=>
   (b.rank-a.rank)||(dateOf(b.ended_at)||dateOf(b.started_at)||0)-(dateOf(a.ended_at)||dateOf(a.started_at)||0));
 }
 function summarize(records){
  const rankOf=x=>Number.isFinite(Number(x?.highest_impact?.rank))?Number(x.highest_impact.rank):0;
  const rich=records.slice().sort((a,b)=>(rankOf(b)-rankOf(a))||(String(b?.title||'').length-String(a?.title||'').length)||((dateOf(b?.started_at)||0)-(dateOf(a?.started_at)||0)))[0]||{};
  const dates=records.flatMap(x=>[dateOf(x?.started_at),dateOf(x?.ended_at)]).filter(x=>x!==null);
  const out={...rich,records,rank:Math.max(0,...records.map(rankOf)),snapshot_count:records.reduce((n,x)=>n+(Number.isFinite(Number(x?.snapshot_count))?Number(x.snapshot_count):0),0)};
  if(dates.length){out.started_at=new Date(Math.min(...records.map(x=>dateOf(x?.started_at)).filter(x=>x!==null))).toISOString();out.ended_at=new Date(Math.max(...records.map(x=>dateOf(x?.ended_at)).filter(x=>x!==null))).toISOString();}
  out.highest_impact={...(rich.highest_impact||{}),rank:out.rank,label:['Routine','Elevated','Significant','High Impact'][Math.min(out.rank,3)]};
  out.official_products=[...new Set(records.flatMap(x=>Array.isArray(x?.official_products)?x.official_products:[]))];
  for(const key of ['max_observed_water_ft','max_residual_ft','max_modeled_water_ft','max_wave_ft','max_gust_mph','max_surf_ft']){
   const values=records.map(x=>x?.[key]).filter(value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))).map(Number);if(values.length)out[key]=Math.max(...values);
  }
  return out;
 }
 function upcomingEvents({alerts=[],eventState={},windows=[],now=Date.now(),maxHours=72}={}){
  const until=now+maxHours*HOURS,candidates=[];
  const rows=Array.isArray(alerts)?alerts:[];
  for(const raw of rows){
   const p=raw?.properties||raw||{},label=String(p.event||'').trim();if(!label)continue;
   const start=dateOf(p.onset||p.effective||p.sent)||now,end=dateOf(p.ends||p.expires);
   if((end!==null&&end<now)||(start>until))continue;
   const family=familyOf(label),severity=String(p.severity||'').toLowerCase();
   candidates.push({title:label,family,location:String(p.areaDesc||'').trim(),source:'Official NWS alert',at:start,end,rank:/extreme/.test(severity)?3:/severe|warning/.test(severity)?2:/moderate|advisory|watch/.test(severity)?1:0,details:[p.headline,p.description].filter(Boolean)});
  }
  const identity=eventState?.event_identity||{},phase=String(eventState?.phase||'');
  const active=(eventState?.show_focus===true)&&!['Routine','Recent'].includes(phase);
  if(active){
   const title=String(identity.label||eventState.primary_display||'Coastal hazard guidance');
   const timing=eventState.event_timing||{},at=dateOf(timing.peak_at)||now;
   if(at<=until)candidates.push({title,family:familyOf(title),source:'SacoCast hazard classification based on official guidance',at,rank:Number(eventState.impact?.rank)||0,details:[eventState.summary].filter(Boolean)});
  }
  for(const w of Array.isArray(windows)?windows:[]){
   const rank=Number(w?.impact?.rank)||0,at=dateOf(w?.window_start||w?.high_tide_at);
   if(rank<1||at===null||at<now-30*60*1000||at>until)continue;
   candidates.push({title:(w.impact?.label||'Elevated')+' coastal-impact guidance',family:'coastal-flood',source:'SacoCast forecast synthesis',at,end:dateOf(w.window_end),rank,details:[],window:w});
  }
  candidates.sort((a,b)=>b.rank-a.rank||((a.source==='Official NWS alert'?-1:0)-(b.source==='Official NWS alert'?-1:0))||a.at-b.at);
  const chosen=[];
  for(const candidate of candidates){
   const same=chosen.find(item=>item.family===candidate.family&&rangesNear(item,candidate,18)&&(!item.location||!candidate.location||item.location.toLowerCase()===candidate.location.toLowerCase()));
   if(same){same.sources=[...new Set([...(same.sources||[same.source]),candidate.source])];same.details=[...new Set([...(same.details||[]),...(candidate.details||[])])];continue;}
   if(chosen.length<2)chosen.push({...candidate,sources:[candidate.source]});
  }
  return chosen;
 }
 root.SacoEventUtils={familyOf,sameEpisode,groupRecentEvents,upcomingEvents};
})(typeof window!=='undefined'?window:globalThis);
