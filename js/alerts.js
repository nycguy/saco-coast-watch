'use strict';
const NWS_ALERT_FRESH_MS=5*60*1000;
const NWS_SEVERITY_RANK=Object.freeze({Extreme:4,Severe:3,Moderate:2,Minor:1});
const NWS_SEVERITY_CLASS=Object.freeze({Extreme:'extreme',Severe:'severe',Moderate:'moderate',Minor:'minor'});
function validAlertTime(value){if(typeof value!=='string'||!value.trim())return null;const result=Date.parse(value);return Number.isFinite(result)?result:null;}
function assessNwsAlertFeed(data,{nowMs=Date.now(),fetchedAtMs=null,error=null,maxAgeMs=NWS_ALERT_FRESH_MS}={}){
 if(error)return{status:'unavailable',alerts:[],severity:null,reason:'The NWS alert feed could not be retrieved.'};
 if(!Number.isFinite(fetchedAtMs)||nowMs-fetchedAtMs< -10*60*1000||nowMs-fetchedAtMs>maxAgeMs)return{status:'unavailable',alerts:[],severity:null,reason:'The last successful NWS alert check is stale.'};
 if(!data||!Array.isArray(data.features))return{status:'unavailable',alerts:[],severity:null,reason:'The NWS response did not contain a valid alert list.'};
 const active=[];
 for(const feature of data.features){
  const p=feature?.properties;
  if(!p||typeof p!=='object'||Array.isArray(p))return{status:'unavailable',alerts:[],severity:null,reason:'The NWS response contained a malformed alert.'};
  const messageType=String(p.messageType||'').toLowerCase(),status=String(p.status||'').toLowerCase();
  if(messageType==='cancel'||status==='canceled'||status==='cancelled')continue;
  const expires=validAlertTime(p.expires)||validAlertTime(p.ends);
  if(!expires)return{status:'unavailable',alerts:[],severity:null,reason:'An NWS alert had no valid expiration time.'};
  const effective=validAlertTime(p.effective)||validAlertTime(p.onset);
  if((p.effective&&!effective)||(p.onset&&!validAlertTime(p.onset)))return{status:'unavailable',alerts:[],severity:null,reason:'An NWS alert had an invalid start time.'};
  if(expires<=nowMs||(effective&&effective>nowMs))continue;
  const raw=typeof p.severity==='string'?p.severity.trim():'';
  const severity=Object.keys(NWS_SEVERITY_RANK).find(value=>value.toLowerCase()===raw.toLowerCase())||null;
  active.push({feature,properties:p,severity,rank:severity?NWS_SEVERITY_RANK[severity]:0,expires,effective:effective||0});
 }
 active.sort((a,b)=>b.rank-a.rank||a.effective-b.effective||String(a.properties.event||'').localeCompare(String(b.properties.event||'')));
 const severity=active.reduce((highest,item)=>item.rank>highest.rank?item:highest,{rank:0,severity:null}).severity;
 return{status:active.length?'active':'none',alerts:active,severity,reason:''};
}
function renderAlerts(){
 const section=document.querySelector('.alertpanel'),list=$('alerts');if(!section||!list)return;
 const result=assessNwsAlertFeed({features:state.alerts},{nowMs:now(),fetchedAtMs:state.lastFetched.alerts,error:state.errors.alerts});
 section.hidden=false;section.classList.remove('alertpanel--minor','alertpanel--moderate','alertpanel--severe','alertpanel--extreme','alertpanel--unknown');
 list.replaceChildren();
 if(result.status==='none'){section.hidden=true;return;}
 if(result.status==='unavailable'){
  section.classList.add('alertpanel--unknown');const message=document.createElement('div');message.className='alert-feed-status';message.setAttribute('role','status');message.textContent='NWS alert status unavailable. Check the official NWS feed for current alerts.';list.append(message);return;
 }
 section.classList.add('alertpanel--'+(NWS_SEVERITY_CLASS[result.severity]||'unknown'));
 const overall=document.createElement('div');overall.className='alert-severity';overall.textContent=result.severity?'Highest NWS severity · '+result.severity:'NWS alert · Severity unavailable';list.append(overall);
 for(const item of result.alerts){const p=item.properties,card=document.createElement('article');card.className='alert'+(['Severe','Extreme'].includes(item.severity)?' urgent':'');const heading=document.createElement('strong');heading.textContent=p.event||p.headline||'Weather alert';card.append(heading);const meta=document.createElement('div');meta.className='meta';meta.textContent=[item.severity?'NWS severity: '+item.severity:'NWS severity unavailable',item.expires?'Expires '+dayTime(item.expires)+' ET':''].filter(Boolean).join(' · ');card.append(meta);const short=document.createElement('p');short.textContent=p.headline||p.description?.slice(0,240)||'See full NWS alert details.';card.append(short);if(p.description){const details=document.createElement('details');const sum=document.createElement('summary');sum.textContent='Read official alert';details.append(sum);const txt=document.createElement('p');txt.style.marginTop='7px';txt.textContent=p.description;details.append(txt);card.append(details);}list.append(card);}
}
if(typeof module!=='undefined'&&module.exports)module.exports={assessNwsAlertFeed,NWS_ALERT_FRESH_MS,NWS_SEVERITY_RANK,NWS_SEVERITY_CLASS};
