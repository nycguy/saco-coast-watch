export const EAST_STATES = [
  ['ME','Maine'],['NH','New Hampshire'],['MA','Massachusetts'],['RI','Rhode Island'],
  ['CT','Connecticut'],['NY','New York'],['NJ','New Jersey'],['PA','Pennsylvania'],
  ['DE','Delaware'],['MD','Maryland'],['DC','District of Columbia'],['VA','Virginia'],
  ['NC','North Carolina'],['SC','South Carolina'],['GA','Georgia'],['FL','Florida'],
];

export const KEY_LOCATIONS = [
  {name:'Portland',state:'ME',lat:43.659,lon:-70.257},
  {name:'Boston',state:'MA',lat:42.360,lon:-71.058},
  {name:'Montauk',state:'NY',lat:41.035,lon:-71.954},
  {name:'New York City',state:'NY',lat:40.713,lon:-74.006},
  {name:'Atlantic City',state:'NJ',lat:39.364,lon:-74.423},
  {name:'Ocean City',state:'MD',lat:38.336,lon:-75.085},
  {name:'Norfolk',state:'VA',lat:36.851,lon:-76.286},
  {name:'Outer Banks',state:'NC',lat:35.558,lon:-75.466},
  {name:'Charleston',state:'SC',lat:32.777,lon:-79.931},
  {name:'Savannah',state:'GA',lat:32.080,lon:-81.091},
  {name:'Jacksonville',state:'FL',lat:30.332,lon:-81.656},
  {name:'Miami',state:'FL',lat:25.762,lon:-80.192},
];

export function alertType(event='') {
  const e=String(event).toLowerCase();
  if (e.includes('warning')) return 'warning';
  if (e.includes('watch')) return 'watch';
  if (e.includes('advisory')) return 'advisory';
  if (e.includes('statement')) return 'statement';
  return 'other';
}

export function eventCategory(event='') {
  const e=String(event).toLowerCase();
  if (/hurricane|tropical storm|storm surge|tropical cyclone/.test(e)) return 'tropical';
  if (/coastal flood|high surf|rip current|beach hazard|lakeshore flood/.test(e)) return 'coastal';
  if (/flash flood|flood|rain/.test(e)) return 'flood';
  if (/winter storm|blizzard|snow|ice storm|freezing rain|winter weather/.test(e)) return 'winter';
  if (/tornado|severe thunderstorm/.test(e)) return 'severe';
  if (/high wind|wind advisory|gale|storm warning|small craft/.test(e)) return 'wind';
  if (/heat|excessive heat/.test(e)) return 'heat';
  if (/dense fog/.test(e)) return 'fog';
  return 'general';
}

export function severityScore(alert={}) {
  const p=alert.properties||alert;
  const sev={Extreme:50,Severe:40,Moderate:30,Minor:20,Unknown:10}[p.severity]||10;
  const e=String(p.event||'').toLowerCase();
  let score=sev;
  if(e.includes('warning')) score+=30;
  else if(e.includes('watch')) score+=20;
  else if(e.includes('advisory')) score+=10;
  if(/hurricane|tornado|storm surge|blizzard|flash flood/.test(e)) score+=12;
  return score;
}

export function topHazard(summary={}) {
  const events=summary.top_events||[];
  if(!events.length) return {label:'No major hazard',category:'general',count:0};
  const ranked=[...events].sort((a,b)=>{
    const sa=hazardPriority(a.event)*100+(a.count||0);
    const sb=hazardPriority(b.event)*100+(b.count||0);
    return sb-sa;
  });
  const x=ranked[0];
  return {label:x.event,category:eventCategory(x.event),count:x.count||0};
}

function hazardPriority(event='') {
  const c=eventCategory(event);
  return {tropical:10,severe:9,flood:8,coastal:8,winter:8,wind:7,heat:5,fog:3,general:2}[c]||2;
}

export function confidenceFromSummary(summary={}) {
  const u=summary.most_urgent||{};
  const type=alertType(u.event||'');
  if(type==='warning') return {
    level:'High',
    tone:'high',
    text:'High confidence in near-term impacts where official warnings are in effect.'
  };
  if(type==='watch') return {
    level:'Medium',
    tone:'medium',
    text:'Meaningful hazard potential is established, but exact location or timing may still shift.'
  };
  if(type==='advisory') return {
    level:'High',
    tone:'high',
    text:'Official advisories support lower-end or localized impacts in the affected areas.'
  };
  return {
    level:'Normal',
    tone:'normal',
    text:'No high-urgency East Coast warning signal is dominating the official alert picture.'
  };
}

export function isStormMode(summary={}, tropical=[]) {
  const h=topHazard(summary);
  return (summary.warnings||0)>=8 ||
    (summary.states_affected||0)>=7 ||
    (['tropical','coastal','winter','severe','flood'].includes(h.category) && (summary.active_alerts||0)>=20) ||
    (tropical||[]).some(s=>Number(s.lon)>-80 && Number(s.lon)<-40);
}

export function buildNowBrief(snapshot={}) {
  const s=snapshot.summary||{};
  const hazard=topHazard(s);
  const states=(s.top_states||[]).slice(0,3);
  const stateNames=states.map(x=>stateName(x.code)).filter(Boolean);
  const urgent=s.most_urgent;
  let headline='A relatively quiet East Coast weather picture.';
  let dek='No single high-impact hazard currently dominates the official alert picture from Florida to Maine.';
  if(urgent){
    headline=hazard.label+' is the leading East Coast signal.';
    dek=(s.active_alerts||0)+' active alerts affect '+(s.states_affected||0)+' East Coast state'+(s.states_affected===1?'':'s')+(stateNames.length?', with the strongest concentration around '+stateNames.join(', '):'')+'.';
  }
  const next=urgent?.ends || urgent?.onset || null;
  return {headline,dek,hazard,stateNames,next,confidence:confidenceFromSummary(s)};
}

export function diffSummaries(prev={}, curr={}) {
  const fields=[
    ['active_alerts','active alerts'],
    ['warnings','warnings'],
    ['states_affected','states affected']
  ];
  const changes=[];
  for(const [key,label] of fields){
    const a=Number(prev[key]||0), b=Number(curr[key]||0), d=b-a;
    if(d) changes.push({key,label,delta:d,text:(d>0?'+':'')+d+' '+label,tone:d>0?'up':'down'});
  }
  const prevHaz=topHazard(prev).label, currHaz=topHazard(curr).label;
  if(prevHaz!==currHaz) changes.push({key:'top_hazard',label:'top hazard',delta:null,text:'Top signal: '+currHaz,tone:'change'});
  return changes;
}

export function chooseWatchLocations(summary={}, limit=4) {
  const states=(summary.top_states||[]).map(x=>x.code);
  const out=[];
  for(const state of states){
    const loc=KEY_LOCATIONS.find(x=>x.state===state && !out.some(y=>y.state===state));
    if(loc) out.push({...loc,reason:(summary.top_states||[]).find(x=>x.code===state)?.top_event||'Active weather'});
    if(out.length>=limit) break;
  }
  for(const loc of KEY_LOCATIONS){
    if(out.length>=limit) break;
    if(!out.some(x=>x.name===loc.name)) out.push({...loc,reason:'Quick coastal check'});
  }
  return out;
}

export function timelineBuckets(alerts=[], now=new Date()) {
  const base=now instanceof Date?now:new Date(now);
  const cuts=[0,6,12,24,48];
  return cuts.map((h,i)=>{
    const start=new Date(base.getTime()+h*3600000);
    const end=i<cuts.length-1?new Date(base.getTime()+cuts[i+1]*3600000):new Date(base.getTime()+72*3600000);
    const active=alerts.filter(a=>{
      const p=a.properties||a;
      const onset=new Date(p.onset||p.effective||p.sent||base);
      const ends=new Date(p.ends||p.expires||new Date(base.getTime()+72*3600000));
      return onset<end && ends>start;
    });
    active.sort((a,b)=>severityScore(b)-severityScore(a));
    const top=active[0];
    return {
      label:h===0?'Now':'+'+h+'h',
      start:start.toISOString(),
      end:end.toISOString(),
      count:active.length,
      event:(top?.properties||top)?.event||'No dominant alert',
      category:eventCategory((top?.properties||top)?.event||'')
    };
  });
}

export function stateName(code) {
  return EAST_STATES.find(x=>x[0]===code)?.[1]||code;
}

export function stateStory(snapshot={}, code) {
  const list=(snapshot.state_alerts||{})[code]||[];
  if(!list.length) return {title:'No active NWS hazards',body:'No current watch, warning or advisory is mapped to this state.',type:'quiet'};
  const top=list[0];
  const extra=list.length-1;
  const timing=top.ends?'Through '+formatShortTime(top.ends)+'. ':'';
  return {
    title:top.event||'Active NWS hazard',
    body:timing+(top.headline||'Official National Weather Service alert in effect.')+(extra>0?' '+extra+' additional alert'+(extra===1?' is':'s are')+' active.':''),
    type:alertType(top.event)
  };
}

export function formatShortTime(value) {
  if(!value) return '';
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US',{weekday:'short',hour:'numeric',minute:'2-digit'}).format(d);
}

export function nearestForecastTime(times=[], targetHours=0, now=new Date()) {
  if(!times.length) return null;
  const target=now.getTime()+targetHours*3600000;
  return [...times].map(v=>({v,t:new Date(v.endsWith('Z')?v:v+'Z').getTime()}))
    .filter(x=>Number.isFinite(x.t))
    .sort((a,b)=>Math.abs(a.t-target)-Math.abs(b.t-target))[0]?.v||null;
}
