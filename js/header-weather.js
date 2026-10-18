'use strict';
// SacoCast header conditions: observations, forecast guidance and official hazard labels stay distinct.
(function(){
 const precipRules=[['blizzard',/blizzard/i],['thunder',/thunder|lightning/i],['freezing',/freezing rain|ice pellets/i],['sleet',/sleet|wintry mix|rain and snow|snow and rain/i],['snow',/snow|flurries/i],['rain',/rain|showers|drizzle/i],['fog',/fog|mist/i],['cloud',/cloud|overcast/i],['sun',/sunny|clear|fair/i]];
 function classify(summary){return precipRules.find(([,re])=>re.test(summary||''))?.[0]||null;}
 function stormLabel(hazards){
  const names=(hazards||[]).map(a=>typeof a==='string'?a:(a?.properties?.event||a?.event||a?.label||'')).join(' ');
  return [['Blizzard',/blizzard/i],['Hurricane',/hurricane/i],['Tropical Storm',/tropical storm/i],["Nor’easter",/nor.easter/i],['Coastal Flood',/coastal flood/i],['Winter Storm',/winter storm/i],['High Surf',/high surf/i],['Storm Surge',/storm surge/i]].find(([,re])=>re.test(names))?.[0]||null;
 }
 function stormIcon(label){
  if(label==='Blizzard'||label==='Winter Storm')return 'blizzard';
  if(label==='Hurricane'||label==='Tropical Storm')return 'storm';
  if(label==='Nor’easter')return 'noreaster';
  if(label==='Coastal Flood')return 'coastal';
  if(label==='High Surf')return 'surf';
  if(label==='Storm Surge')return 'surge';
  return 'storm';
 }
 const shapes={
  sun:'<circle cx="32" cy="32" r="12" class="wx-sun"/><g class="wx-rays"><path d="M32 4v10M32 50v10M4 32h10M50 32h10M12 12l7 7M45 45l7 7M52 12l-7 7M19 45l-7 7"/></g>',
  cloud:'<path class="wx-cloud" d="M14 45h35a10 10 0 0 0 0-20 17 17 0 0 0-32-1A11 11 0 0 0 14 45Z"/>',
  rain:'<path class="wx-cloud" d="M14 37h35a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 14 37Z"/><g class="wx-drops"><path d="M20 43l-4 9M34 43l-4 9M48 43l-4 9"/></g>',
  snow:'<path class="wx-cloud" d="M14 35h35a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 14 35Z"/><g class="wx-flakes"><path d="M20 42v13m-5-6h10M43 42v13m-5-6h10"/></g>',
  sleet:'<path class="wx-cloud" d="M14 35h35a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 14 35Z"/><g class="wx-drops"><path d="M19 42l-4 9M34 42l-4 9"/></g><g class="wx-flakes"><path d="M49 42v13m-5-6h10"/></g>',
  freezing:'<path class="wx-cloud" d="M14 35h35a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 14 35Z"/><g class="wx-drops"><path d="M20 42l-4 9M43 42l-4 9"/></g><path class="wx-flakes" d="M28 55h13m-6-6v12"/>',
  thunder:'<path class="wx-cloud" d="M14 35h35a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 14 35Z"/><path class="wx-bolt" d="M34 36 24 50h10l-4 12 16-20H35Z"/>',
  fog:'<g class="wx-fog wx-fog-back"><path d="M8 23h45M15 34h39M7 45h45"/></g><g class="wx-fog wx-fog-front"><path d="M10 25h43M7 36h43M14 47h40"/></g>',
  wind:'<g class="wx-wind"><path d="M5 22h37q12 0 9-9t-12-2M6 34h49q8 0 6 8t-12 4M11 46h24q11 0 9 8"/></g>',
  storm:'<path class="wx-storm" d="M32 7a25 25 0 1 0 25 25M32 16a16 16 0 1 1-16 16M32 24a8 8 0 1 0 8 8"/><circle cx="32" cy="32" r="3" class="wx-eye"/>',
  blizzard:'<path class="wx-cloud" d="M11 35h39a9 9 0 0 0 0-18 17 17 0 0 0-32-1A10 10 0 0 0 11 35Z"/><g class="wx-flakes"><path d="M17 42v13m-5-6h10M33 42v13m-5-6h10M49 42v13m-5-6h10"/></g>',
  noreaster:'<path class="wx-cloud" d="M13 33h34a8 8 0 0 0 0-16 16 16 0 0 0-30-1A9 9 0 0 0 13 33Z"/><g class="wx-wind"><path d="M7 41h43M13 49h39M6 57h30"/></g>',
  coastal:'<g class="wx-water"><path d="M5 28q7-8 14 0t14 0 14 0 12 0M5 39q7-8 14 0t14 0 14 0 12 0M5 50q7-8 14 0t14 0 14 0 12 0"/></g>',
  surf:'<path class="wx-surf" d="M6 46q9-16 19-3 5 7 12-1 6-8 13-3 4 3 8 9M9 53h45M14 59h39"/><path class="wx-surf-foam" d="M30 39q4-13 15-14-3 9-11 11"/>',
  surge:'<g class="wx-surge"><path d="M6 30q7-8 14 0t14 0 14 0 12 0M6 42q7-8 14 0t14 0 14 0 12 0M6 54q7-8 14 0t14 0 14 0 12 0"/><path d="M47 9v12m-5-7 5 7 5-7"/></g>'
 };
 function icon(type){return '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">'+(shapes[type]||shapes.cloud)+'</svg>';}
 function observationDisplay(obs,at=Date.now()){
  const age=at-Number(obs?.t),fresh=Number.isFinite(age)&&age>=-10*60000&&age<=2*3600000;
  const temp=typeof obs?.temp==='number'&&Number.isFinite(obs.temp)&&obs.temp>=-100&&obs.temp<=140?obs.temp:null;
  const humidity=typeof obs?.humidity==='number'&&Number.isFinite(obs.humidity)&&obs.humidity>=0&&obs.humidity<=100?obs.humidity:null;
  return {fresh,temp:fresh?temp:null,humidity:fresh&&humidity!==null&&humidity>=80?humidity:null,station:fresh?String(obs?.station||'NWS station'):null,t:fresh?Number(obs.t):null};
 }
 function render(){
  const host=document.getElementById('headerWeather');if(!host||typeof state==='undefined')return;
  const t=Date.now(),obs=state.weatherObservation;
  const fresh=obs&&Number.isFinite(obs.t)&&t-obs.t>=0&&t-obs.t<=2*3600000;
  const forecast=(state.weatherForecast||[]).find(x=>x.t<=t&&x.end>t);
  const condition=classify(forecast?.summary);
  const wind=fresh&&Number.isFinite(obs.wind)?obs.wind:null;
  const hazards=[...(state.hazards?.alerts||[]),...(Array.isArray(state.alerts)?state.alerts:(state.alerts?.features||[]))];
  const officialStorm=stormLabel(hazards);
  const classifiedStorm=stormLabel((state.hazards?.active_modes||[]));
  const storm=officialStorm
   ?{label:officialStorm,source:'Official NWS alert'}
   :classifiedStorm?{label:classifiedStorm,source:'SacoCast hazard classification'}:null;
  const items=[];
  if(condition)items.push({type:condition==='blizzard'?'snow':condition,label:condition==='sun'?'Clear / Sunny':condition==='cloud'?'Cloudy':condition==='freezing'?'Freezing Rain':condition==='sleet'?'Wintry Mix':condition==='thunder'?'Thunderstorms':condition[0].toUpperCase()+condition.slice(1),source:'NWS hourly forecast'});
  if(wind!==null&&wind>=8)items.push({type:'wind',label:wind>=39?'Strong Wind':wind>=25?'Windy':'Breezy',source:'Observed '+Math.round(wind)+' mph'});
  if(storm)items.push({type:stormIcon(storm.label),label:storm.label,source:storm.source});
  if(!items.length)items.push({type:'cloud',label:'Weather Unavailable',source:'No current NWS forecast or wind observation'});
  host.replaceChildren();
  const iconRow=document.createElement('div');iconRow.className='header-weather-icons';
  for(const item of items.slice(0,3)){
   const el=document.createElement('div');el.className='header-weather-item';el.setAttribute('role','img');el.setAttribute('aria-label',item.label+' — '+item.source);
   el.innerHTML=icon(item.type);
   const caption=document.createElement('span');caption.textContent=item.label;el.append(caption);iconRow.append(el);
  }
  host.append(iconRow);
  const current=observationDisplay(obs,t),forecastLabel=forecast?.summary?.trim();
  const parts=[];
  if(current.temp!==null)parts.push(Math.round(current.temp)+'°F');
  if(forecastLabel)parts.push(forecastLabel);
  if(current.humidity!==null)parts.push('Humidity '+Math.round(current.humidity)+'%');
  if(parts.length){
   const readout=document.createElement('div');readout.className='header-weather-readout';
   const text=document.createElement('strong');text.textContent=parts.join(' · ');readout.append(text);
   const source=document.createElement('small');
   source.textContent=[current.station,current.t?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(current.t)+' ET measured':null,forecastLabel?'Condition from NWS hourly forecast':null].filter(Boolean).join(' · ')||'NWS hourly forecast condition';
   readout.append(source);host.append(readout);
  }
  host.hidden=items.length===0;
 }
 window.SacoHeaderWeather={classify,stormLabel,stormIcon,observationDisplay,render};
 document.addEventListener('DOMContentLoaded',()=>{render();setInterval(render,60000);});
})();
