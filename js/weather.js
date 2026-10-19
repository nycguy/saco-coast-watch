'use strict';
function renderWeather(){
 if(window.SacoHeaderWeather)window.SacoHeaderWeather.render();
 const at=now(),o=state.weatherObservation,display=weatherObservationDisplay(o,at,60*60000),age=display.age??Infinity;
 const w=display.wind,temperature=display.temp,gust=display.gust,obsFresh=display.fresh;
 metricNumber('windNow',w,'mph');metricNumber('gustNow',gust,'mph');metricNumber('tempNow',temperature,'°F');
 const origin=obsFresh?'NWS '+o.station+' · '+dayTime(o.t)+' ET · '+relative(o.t):'';
 $('windNowCard').hidden=!Number.isFinite(w);$('gustNowCard').hidden=Number.isFinite(w)||!Number.isFinite(gust);$('tempNowCard').hidden=!Number.isFinite(temperature);
 $('windNowBadge').textContent=age>45*60000?'Delayed':'Measured';$('tempNowBadge').textContent=age>45*60000?'Delayed':'Measured';
 $('windNowDetail').textContent=Number.isFinite(w)?(Number.isFinite(display.direction)?windCompass(display.direction)+' wind · ':'')+(Number.isFinite(gust)?'gust '+Math.round(gust)+' mph · ':'')+origin:'';
 $('gustNowDetail').textContent=Number.isFinite(gust)?origin:'';
 $('tempNowDetail').textContent=Number.isFinite(temperature)?origin:'';
 $('windNowSource').textContent=obsFresh?'Reporting site: '+o.station+' (nearby, not at the coast point)':'';
 $('gustNowSource').textContent=obsFresh?'Reporting site: '+o.station+' (nearby, not at the coast point)':'';
 $('tempNowSource').textContent=obsFresh?'Reporting site: '+o.station+' (nearby, not at the coast point)':'';
 const forecastSourceAt=Number.isFinite(state.weatherForecastUpdated)?state.weatherForecastUpdated:state.weatherForecastFetchedAt;
 const active=usableWeatherForecast(state.weatherForecast,at,72,forecastSourceAt);
 const high=highTides()[0];const target=high?.t??active[0]?.t;
 const match=active.find(x=>x.t<=target&&x.end>target)||active.find(x=>x.t>=target)||null;
 const max72=active.filter(x=>Number.isFinite(x.wind)).reduce((a,b)=>!a||b.wind>a.wind?b:a,null);
 const forecastGust=active.reduce((v,x)=>Number.isFinite(x.gust)?Math.max(v,x.gust):v,0);
 metricNumber('windForecast',match?.wind??null,'mph');
 $('windForecastCard').hidden=!match||!Number.isFinite(match.wind);
 const when=match?(high&&Math.abs(match.t-high.t)<=90*60000?'Next high tide '+dayTime(high.t)+' ET':'Forecast '+dayTime(match.t)+' ET'):'Hourly weather forecast unavailable';
 $('windForecastDetail').textContent=match?(when+' · '+match.dir+(max72?' · Peak forecast wind '+Math.round(max72.wind)+' mph'+(forecastGust?' / gust '+Math.round(forecastGust)+' mph':'')+' within 72h.':'.')):'No current NWS hourly wind forecast; the tide forecast cannot replace it.';
 $('weatherAsOf').textContent=active.length?
  (state.weatherForecastUpdated?'NWS forecast issued '+dayTime(state.weatherForecastUpdated)+' ET':'NWS hourly forecast available (issue time not provided)')+
  (state.lastFetched.weatherForecast?' · checked '+time(state.lastFetched.weatherForecast)+' ET':''):
  'NWS hourly forecast unavailable'+(state.errors.weatherForecast?' · '+state.errors.weatherForecast:'');
 const body=$('weatherRows');body.replaceChildren();const next=active.filter(x=>x.t<at+24*3600000).slice(0,24),hourlyPanel=$('hourlyWeatherPanel');
 if(hourlyPanel)hourlyPanel.hidden=!next.length;
 const hasMarine=$('marineObservations')&&!$('marineObservations').hidden,hasObservation=Number.isFinite(w)||Number.isFinite(gust)||Number.isFinite(temperature),hasForecast=active.length>0;
 const weatherPanel=document.querySelector('.weather-panel');if(weatherPanel)weatherPanel.hidden=!hasUsefulWeatherContent({marine:hasMarine,observation:hasObservation,forecast:hasForecast});
 if(!next.length)return;
 for(const x of next){const row=document.createElement('tr');const vals=[dayTime(x.t)+' ET',Number.isFinite(x.wind)?Math.round(x.wind):'—',Number.isFinite(x.gust)?Math.round(x.gust):'—',x.dir,Number.isFinite(x.temp)?Math.round(x.temp):'—',x.summary||'—',Number.isFinite(x.pop)?Math.round(x.pop)+'%':'—'];vals.forEach((value,i)=>{const td=document.createElement('td');td.textContent=value;if(i===1)td.className='wx-wind';if(i===2)td.className='wx-gust';if(i===4)td.className='wx-temp';if(i===5)td.className='wx-summary';row.append(td);});body.append(row);}
}
async function loadWeather(){
 if(!shouldFetch('weatherObservation',60*1000)&&!shouldFetch('weatherForecast',10*60000))return;
 if(shouldFetch('weatherObservation',60*1000)){
  let obs=null;
  for(const station of WEATHER_OBS_STATIONS){try{const candidate=observationFromNWS(await getJSON('https://api.weather.gov/stations/'+station+'/observations/latest'),station);obs=candidate;if(candidate.wind!==null&&candidate.temp!==null)break;}catch(err){console.warn('Nearby NWS weather observation '+station+':',err);}}
  if(obs){state.weatherObservation=obs;delete state.errors.weatherObservation;health('healthWeatherObservation',true,obs.station);}else{state.errors.weatherObservation='No recent station observation';health('healthWeatherObservation',false,'Unavailable');}
  state.lastFetched.weatherObservation=now();renderWeather();
 }
 if(shouldFetch('weatherForecast',10*60000)){
  try{
   if(!state.weatherPointUrl||shouldFetch('weatherPoint',24*3600000)){
    const point=await getJSON('https://api.weather.gov/points/'+COASTAL_POINT);
    const u=point?.properties?.forecastHourly;if(!u||!u.startsWith('https://api.weather.gov/'))throw new Error('NWS point did not provide an hourly forecast URL');
    state.weatherPointUrl=u;state.lastFetched.weatherPoint=now();
   }
   let forecast;
   try{forecast=await getJSON(state.weatherPointUrl);}catch(err){ // Gridpoint URL may change: re-resolve once.
    const point=await getJSON('https://api.weather.gov/points/'+COASTAL_POINT);
    state.weatherPointUrl=point?.properties?.forecastHourly;state.lastFetched.weatherPoint=now();forecast=await getJSON(state.weatherPointUrl);
   }
   const rows=(forecast?.properties?.periods||[]).map(forecastPeriod).filter(Boolean).sort((a,b)=>a.t-b.t);
   if(!rows.length)throw new Error('No NWS hourly forecast periods returned');
   state.weatherForecast=rows;const updated=Date.parse(forecast?.properties?.updated||'');state.weatherForecastUpdated=Number.isFinite(updated)?updated:null;
   state.lastFetched.weatherForecast=now();state.weatherForecastFetchedAt=now();delete state.errors.weatherForecast;health('healthWeatherForecast',true,'Connected');
  }catch(err){state.errors.weatherForecast=String(err?.message||err);console.warn('NWS hourly coastal forecast:',err);state.lastFetched.weatherForecast=now();health('healthWeatherForecast',false,'Unavailable');}
  renderWeather();
 }
}
