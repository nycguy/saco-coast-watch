'use strict';
function updateNotice(){const missing=[];if(state.errors.observed)missing.push('live gauge');if(state.errors.predicted)missing.push('astronomical tide');if(state.errors.model)missing.push('model forecast');if(state.errors.alerts)missing.push('NWS alerts');if(state.errors.weatherObservation)missing.push('nearby measured weather');if(state.errors.weatherForecast)missing.push('coastal-point weather forecast');const recent=state.obs.at(-1);const age=recent?now()-recent.t:Infinity;const stale=!!recent&&(age>=45*60000||age< -10*60000);const node=$('notice');if(!missing.length&&!stale){node.classList.add('hidden');return;}node.classList.remove('hidden');const lines=[];if(missing.length)lines.push('Some live feeds are unavailable: '+missing.join(', ')+'. A dash means no data, not zero risk.');if(stale)lines.push('The most recent gauge reading is '+relative(recent.t)+'; treat it as stale.');lines.push('Open the official NOAA/NWS links below for current conditions.');$('noticeText').textContent=lines.join(' ');}
function arrangeDashboard(){
 const main=document.querySelector('main.shell'),status=document.querySelector('.panel.status'),metrics=document.querySelector('.metrics'),chart=document.querySelector('.main-grid'),brief=document.querySelector('.coastal-briefing'),intel=document.querySelector('.coastal-intelligence'),history=$('#eventHistoryPanel'),weather=document.querySelector('.weather-panel'),alerts=document.querySelector('.alertpanel'),hub=document.querySelector('.camera-hub'),tools=$('#coastalToolsDetails');
 if(!main)return;
 // Put official products and the live coastal outlook ahead of detail panels.
 if(status&&metrics)main.insertBefore(status,metrics);
 if(chart&&metrics)main.insertBefore(chart,metrics.nextSibling);
 if(hub&&chart)main.insertBefore(hub,chart.nextSibling);
 if(brief&&hub)main.insertBefore(brief,hub.nextSibling);
 if(intel&&brief)main.insertBefore(intel,brief.nextSibling);
 if(history&&intel)main.insertBefore(history,intel.nextSibling);
 if(weather&&history)main.insertBefore(weather,history.nextSibling);
 if(tools&&weather)main.insertBefore(tools,weather.nextSibling);
 const toolGrid=tools?.querySelector('.coastal-tools-grid');
 for(const selector of ['.threshold-reference','.comparison-panel','.tablepanel','.hourly-panel','.calendar-panel','.coastal-map-panel','.sources']){
  const section=document.querySelector(selector);if(section&&toolGrid)toolGrid.append(section);
 }
 const cameraPanels=hub?.querySelector('.camera-panels');
 let savedCamera='ferry-camera';try{const value=sessionStorage.getItem('sacocast-selected-camera');if(value==='abellona-camera')savedCamera=value;}catch(_err){}
 for(const cls of ['ferry-camera','abellona-camera']){const camera=document.querySelector('main > .'+cls);if(camera&&cameraPanels)cameraPanels.append(camera);}
 cameraPanels?.querySelectorAll('.ferry-camera').forEach(camera=>{camera.hidden=savedCamera==='abellona-camera'?!camera.classList.contains('abellona-camera'):camera.classList.contains('abellona-camera');});
 const choices=hub?.querySelectorAll('[data-camera]');
 choices?.forEach(button=>{const selected=button.dataset.camera===savedCamera;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
 choices?.forEach(button=>button.addEventListener('click',()=>{
  const selectedCamera=button.dataset.camera;
  try{sessionStorage.setItem('sacocast-selected-camera',selectedCamera);}catch(_err){}
  cameraPanels?.querySelectorAll('.ferry-camera').forEach(camera=>{
   const selected=selectedCamera==='abellona-camera'
    ?camera.classList.contains('abellona-camera')
    :!camera.classList.contains('abellona-camera');
   if(selected)return;
   camera.querySelector('video')?.pause();
   if(camera.classList.contains('ferry-camera')&&window.SacoFerryCamera)window.SacoFerryCamera.deactivate();
  });
  choices.forEach(choice=>{const selected=choice===button;choice.classList.toggle('active',selected);choice.setAttribute('aria-pressed',String(selected));});
  cameraPanels?.querySelectorAll('.ferry-camera').forEach(camera=>{
   camera.hidden=button.dataset.camera==='abellona-camera'
    ?!camera.classList.contains('abellona-camera')
    :camera.classList.contains('abellona-camera');
  });
  document.dispatchEvent(new CustomEvent('sacocast:camera-selected',{detail:{camera:selectedCamera}}));
 }));
 // Reassert this after all section moves so official products stay above
 // derived summaries and supporting content in every rendered layout.
 if(alerts&&status)main.insertBefore(alerts,status);
}
function updateClock(){$('currentClock').textContent=fmt(now(),{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});const o=state.obs.at(-1),age=o?now()-o.t:Infinity;const healthy=!!o&&age>=-10*60000&&age<45*60000;$('liveDot').className='dot '+(healthy?'good':state.loading?'warn':'bad');$('liveText').textContent=state.loading?'Refreshing feeds':healthy?'Gauge current':o?'Gauge delayed':'Live data unavailable';if(state.lastSuccess)$('syncTime').textContent='Last successful data refresh '+relative(state.lastSuccess);}
function render(){renderSummary();renderHistoricalComparison();renderMarine();renderWeather();renderTable();renderCalendar();renderCoastalIntelligence();renderAlerts();renderChart();renderBriefing();renderHazards();updateNotice();updateClock();}
async function load(){
if(state.loading)return;state.loading=true;state.lastAttempt=now();updateClock();const t=now(),start=ymd(t-3*86400000),end=ymd(t+4*86400000);
const calls=[
['observed',query('water_level',{date:'recent'}),data=>{const pts=decodeObservations(data);if(!pts.length)throw Error('No valid Portland gauge observations returned');state.obs=pts;},0],
['predicted',query('predictions',{begin_date:start,end_date:end,interval:'6'}),data=>{const pts=decodeSeries(data,['predictions','data']);if(!pts.length)throw Error('No short-range tide predictions returned');state.predShort=pts;combinePredictions();},5*60000],
['longTide',query('predictions',{begin_date:ymd(t),end_date:ymd(t+30*86400000),interval:'15'}),data=>{const pts=decodeSeries(data,['predictions','data']);if(!pts.length)throw Error('No 30-day tide predictions returned');state.predLong=pts;combinePredictions();},6*3600000],
['highs',query('predictions',{begin_date:ymd(t),end_date:ymd(t+30*86400000),interval:'hilo'}),data=>{const pts=decodeHighs(data);if(!pts.length)throw Error('No 30-day high tide predictions returned');state.highs=pts;},6*3600000],
['model',query('ofs_water_level',{begin_date:ymd(t-86400000),end_date:ymd(t+4*86400000)}),data=>{const pts=decodeSeries(data,['data','predictions','ofs_water_level','forecast']);const future=pts.filter(p=>p.t>t-10*60000&&p.t<t+72*3600000);if(!future.length)throw Error('No near-term model guidance returned');state.model=pts.filter(p=>p.t<=t+72*3600000);},0],
['alerts','https://api.weather.gov/alerts/active?point=43.48,-70.38',data=>{const checked=assessNwsAlertFeed(data,{nowMs:now(),fetchedAtMs:now()});if(checked.status==='unavailable')throw Error(checked.reason||'No valid NWS alert response');state.alerts=data.features;state.alertsActiveCount=checked.alerts.length;},0]
];
for(const [name,url,save,interval] of calls){if(interval&&!shouldFetch(name,interval))continue;try{const data=await getJSON(url);save(data);state.lastFetched[name]=now();delete state.errors[name];if(['observed','predicted','model','alerts'].includes(name))health('health'+name[0].toUpperCase()+name.slice(1),true,name==='alerts'?state.alertsActiveCount+' active':'Connected');state.lastSuccess=now();}catch(err){if(name==='model')state.model=[];state.errors[name]=String(err?.message||err);if(['observed','predicted','model','alerts'].includes(name))health('health'+name[0].toUpperCase()+name.slice(1),false,'Unavailable');console.warn('Saco Coast Watch '+name+':',err);}render();if(name!=='alerts')await new Promise(r=>setTimeout(r,250));}
await Promise.all([loadWeather(),loadMarine(),loadBriefing(),loadHazards()]);state.loading=false;$('lastUpdated').textContent='Last checked '+fmt(now(),{hour:'numeric',minute:'2-digit',timeZoneName:'short'})+' · 60-second live checks';render();
}
function exportCSV(){const timestamps=new Set([...state.obs,...state.pred,...state.model].map(x=>x.t));const lines=['utc_time,observed_ft_MLLW,astronomical_tide_ft_MLLW,model_guidance_ft_MLLW'];const obs=new Map(state.obs.map(x=>[x.t,x.v])),pred=new Map(state.pred.map(x=>[x.t,x.v])),model=new Map(state.model.map(x=>[x.t,x.v]));for(const t of [...timestamps].sort((a,b)=>a-b)){lines.push([new Date(t).toISOString(),obs.get(t)??'',pred.get(t)??'',model.get(t)??''].join(','));}const blob=new Blob([lines.join('\n')+'\n'],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='saco-coast-watch-'+ymd(now())+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('exportBtn').addEventListener('click',exportCSV);
$('briefOpen').addEventListener('click',()=>{const d=$('briefingDialog');if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','');});
$('briefClose').addEventListener('click',()=>$('briefingDialog').close());
$('briefingDialog').addEventListener('click',e=>{if(e.target===$('briefingDialog'))$('briefingDialog').close();});
$('refreshBtn').addEventListener('click',()=>window.location.reload());
document.querySelectorAll('[data-days]').forEach(btn=>btn.addEventListener('click',()=>{state.days=Number(btn.dataset.days);document.querySelectorAll('[data-days]').forEach(b=>{b.classList.toggle('active',b===btn);b.setAttribute('aria-pressed',String(b===btn));});render();}));
$('showFlood').addEventListener('change',e=>{state.showFlood=e.target.checked;renderChart();});$('showModel').addEventListener('change',e=>{state.showModel=e.target.checked;renderChart();});
arrangeDashboard();
setInterval(updateClock,10000);setInterval(()=>{if(!document.hidden)load();},60*1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(!state.lastAttempt||now()-state.lastAttempt>=60*1000))load();});let chartResizeTimer;window.addEventListener('resize',()=>{clearTimeout(chartResizeTimer);chartResizeTimer=setTimeout(renderChart,120);});load();
