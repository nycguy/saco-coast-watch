'use strict';
// SacoCast header conditions: observations, forecast guidance and official hazard labels stay distinct.
(function(){
 const precipRules=[['blizzard',/blizzard/i],['thunder',/thunder|lightning/i],['freezing',/freezing rain|ice pellets/i],['sleet',/sleet|wintry mix|rain and snow|snow and rain/i],['snow',/snow|flurries/i],['rain',/rain|showers|drizzle/i],['fog',/fog|mist/i],['cloud',/cloud|overcast/i],['sun',/sunny|clear|fair/i]];
 function classify(summary){return precipRules.find(([,re])=>re.test(summary||''))?.[0]||null;}
 function stormLabel(hazards){
  const names=(hazards||[]).map(a=>typeof a==='string'?a:(a?.properties?.event||a?.event||a?.label||'')).join(' ');
  return [['Blizzard',/blizzard/i],['Hurricane',/hurricane/i],['Tropical Storm',/tropical storm/i],["Nor’easter",/nor.easter/i],['Coastal Flood',/coastal flood/i],['Winter Storm',/winter storm/i],['High Surf',/high surf/i],['Storm Surge',/storm surge/i]].find(([,re])=>re.test(names))?.[0]||null;
 }
 const shapes={
  sun:'<circle cx="32" cy="32" r="12" class="wx-sun"/><g class="wx-rays"><path d="M32 4v10M32 50v10M4 32h10M50 32h10M12 12l7 7M45 45l7 7M52 12l-7 7M19 45l-7 7"/></g>',
  cloud:'<path class="wx-cloud" d="M14 45h35a10 10 0 0 0 0-20 17 17 0 0 0-32-1A11 11 0 0 0 14 45Z"/>',
  rain:'<path class="wx-cloud" d="M14 37h35a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 14 37Z"/><g class="wx-drops"><path d="M20 43l-4 9M34 43l-4 9M48 43l-4 9"/></g>',
  snow:'<path class="wx-cloud" d="M14 35h35a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 14 35Z"/><g class="wx-flakes"><path d="M20 42v13m-5-6h10M43 42v13m-5-6h10"/></g>',
  sleet:'<path class="wx-cloud" d="M14 35h35a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 14 35Z"/><g class="wx-drops"><path d="M19 42l-4 9M34 42l-4 9"/></g><g class="wx-flakes"><path d="M49 42v13m-5-6h10"/></g>',
  freezing:'<path class="wx-cloud" d="M14 35h35a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 14 35Z"/><g class="wx-drops"><path d="M20 42l-4 9M43 42l-4 9"/></g><path class="wx-flakes" d="M28 55h13m-6-6v12"/>',
  thunder:'<path class="wx-cloud" d="M14 35h35a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 14 35Z"/><path class="wx-bolt" d="M34 36 24 50h10l-4 12 16-20H35Z"/>',
  fog:'<g class="wx-wind"><path d="M7 21h49M13 32h39M7 43h49"/></g>',
  wind:'<g class="wx-wind"><path d="M5 22h37q12 0 9-9t-12-2M6 34h49q8 0 6 8t-12 4M11 46h24q11 0 9 8"/></g>',
  storm:'<path class="wx-storm" d="M32 7a25 25 0 1 0 25 25M32 16a16 16 0 1 1-16 16M32 24a8 8 0 1 0 8 8"/><circle cx="32" cy="32" r="3" class="wx-eye"/>'
 };
 function icon(type){return '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">'+(shapes[type]||shapes.cloud)+'</svg>';}
 function render(){
  const host=document.getElementById('headerWeather');if(!host||typeof state==='undefined')return;
  const t=Date.now(),obs=state.weatherObservation;
  const fresh=obs&&Number.isFinite(obs.t)&&t-obs.t>=0&&t-obs.t<=2*3600000;
  const forecast=(state.weatherForecast||[]).find(x=>x.t<=t&&x.end>t);
  const condition=classify(forecast?.summary);
  const wind=fresh&&Number.isFinite(obs.wind)?obs.wind:null;
  const hazards=state.hazards?.alerts||state.alerts?.features||[];
  const storm=stormLabel(hazards)||stormLabel((state.hazards?.active_modes||[]));
  const items=[];
  if(condition)items.push({type:condition==='blizzard'?'snow':condition,label:condition==='sun'?'Clear / Sunny':condition==='cloud'?'Cloudy':condition==='freezing'?'Freezing Rain':condition==='sleet'?'Wintry Mix':condition==='thunder'?'Thunderstorms':condition[0].toUpperCase()+condition.slice(1),source:'NWS hourly forecast'});
  if(wind!==null&&wind>=8)items.push({type:'wind',label:wind>=39?'Strong Wind':wind>=25?'Windy':'Breezy',source:'Observed '+Math.round(wind)+' mph'});
  if(storm)items.push({type:'storm',label:storm,source:'Official / event classification'});
  if(!items.length)items.push({type:'cloud',label:'Weather Unavailable',source:'No current NWS forecast or wind observation'});\n  host.replaceChildren();
  for(const item of items.slice(0,3)){
   const el=document.createElement('div');el.className='header-weather-item';el.setAttribute('role','img');el.setAttribute('aria-label',item.label+' — '+item.source);
   el.innerHTML=icon(item.type);
   const caption=document.createElement('span');caption.textContent=item.label;el.append(caption);host.append(el);
  }
  host.hidden=items.length===0;
 }
 window.SacoHeaderWeather={classify,stormLabel,render};
 document.addEventListener('DOMContentLoaded',()=>{render();setInterval(render,60000);});
})();
