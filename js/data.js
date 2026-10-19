'use strict';
const now=()=>Date.now(); const fmtN=(v,d=2)=>Number.isFinite(v)?Number(v).toFixed(d):'--';
const toDate=s=>{const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);if(!m)return NaN;const [,year,month,day,hour,minute,second='0']=m,parts=[+year,+month,+day,+hour,+minute,+second],ms=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]),d=new Date(ms);return d.getUTCFullYear()===parts[0]&&d.getUTCMonth()===parts[1]-1&&d.getUTCDate()===parts[2]&&d.getUTCHours()===parts[3]&&d.getUTCMinutes()===parts[4]&&d.getUTCSeconds()===parts[5]?ms:NaN;};
const fmt=(ms,options={})=>new Intl.DateTimeFormat('en-US',{timeZone:TZ,...options}).format(ms);
const time=ms=>fmt(ms,{hour:'numeric',minute:'2-digit'});
const dayTime=ms=>fmt(ms,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const relative=ms=>{const min=Math.max(0,Math.round((now()-ms)/60000));return min<2?'just now':min<60?min+' min ago':min<1440?Math.floor(min/60)+'h '+(min%60)+'m ago':Math.floor(min/1440)+' days ago';};
function countdown(ms){const remaining=ms-now();if(!Number.isFinite(ms)||remaining<=0)return 'High tide now';const total=Math.floor(remaining/60000),days=Math.floor(total/1440),hours=Math.floor((total%1440)/60),minutes=total%60;return ['In',days?days+'d':'',hours?hours+'h':'',minutes?minutes+'m':''].filter(Boolean).join(' ');}
const ymd=t=>{const d=new Date(t);return d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,'0')+String(d.getUTCDate()).padStart(2,'0');};
function query(product,extra={}){const u=new URL(NOAA);Object.entries({station:STATION,product,datum:'MLLW',units:'english',time_zone:'gmt',format:'json',application:'SacoCoastWatch',...extra}).forEach(([k,v])=>u.searchParams.set(k,String(v)));return u.toString();}
async function getJSON(url,ms=18000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);try{const response=await fetch(url,{signal:controller.signal,cache:'no-store',headers:{Accept:url.startsWith('https://api.weather.gov/')?'application/geo+json':'application/json'}});if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();if(data.error)throw new Error(data.error.message||JSON.stringify(data.error));return data;}finally{clearTimeout(timer);}}
function numericValue(value){if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value!=='string'||!value.trim())return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function decodeHighs(json){const rows=Array.isArray(json?.predictions)?json.predictions:[];return rows.filter(x=>x&&x.type==='H').map(x=>({t:toDate(x.t),v:numericValue(x.v)})).filter(x=>Number.isFinite(x.t)&&x.v!==null).sort((a,b)=>a.t-b.t);}
function localParts(ms){const parts=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms);const obj=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return {year:+obj.year,month:+obj.month,day:+obj.day,key:obj.year+'-'+obj.month+'-'+obj.day};}
function combinePredictions(){const short=state.predShort,long=state.predLong;if(!long.length){state.pred=short;return;}if(!short.length){state.pred=long;return;}const first=short[0].t,last=short.at(-1).t;state.pred=[...long.filter(x=>x.t<first),...short,...long.filter(x=>x.t>last)];}
function shouldFetch(name,interval){return !state.lastFetched[name]||now()-state.lastFetched[name]>=interval;}
function decodeSeries(json,preferred){const rows=preferred.map(k=>json?.[k]).find(x=>Array.isArray(x))||[];const unique=new Map();for(const row of rows){if(!row||typeof row!=='object')continue;const point={t:toDate(row.t||row.time),v:numericValue(row.v??row.value)};if(Number.isFinite(point.t)&&point.v!==null)unique.set(point.t,point);}return [...unique.values()].sort((a,b)=>a.t-b.t);}
function decodeObservations(json){const latestAllowed=now()+10*60000;return decodeSeries(json,['data','observations']).filter(point=>point.t<=latestAllowed);}
function nearest(series,t,maxMs=12*60000){if(!series.length)return null;let l=0,r=series.length-1;while(l<r){let m=(l+r)>>1;if(series[m].t<t)l=m+1;else r=m;}const a=series[l],b=series[Math.max(0,l-1)];const picked=!b||Math.abs(a.t-t)<Math.abs(b.t-t)?a:b;return Math.abs(picked.t-t)<=maxMs?picked:null;}
function peak(series,start,end){return series.filter(p=>p.t>=start&&p.t<=end).reduce((a,b)=>!a||b.v>a.v?b:a,null);}
function highTides(){
const cutoff=now()-30*60000,limit=now()+state.days*86400000;
if(state.highs.length)return state.highs.filter(x=>x.t>=cutoff&&x.t<=limit);
const p=state.pred,result=[];
for(let i=1;i<p.length-1;i++){const a=p[i-1],b=p[i],c=p[i+1];if(b.t<cutoff||b.t>limit||b.t-a.t>32*60000||c.t-b.t>32*60000)continue;if(b.v>=a.v&&b.v>c.v&&(!result.length||b.t-result.at(-1).t>3*3600000))result.push(b);}
return result;
}
function currentStatus(){const latest=state.obs.at(-1);const age=latest?now()-latest.t:Infinity;const nextPeak=peak(state.model,now(),now()+72*3600000);const gaugeFresh=!!latest&&age>=-10*60000&&age<45*60000;const source=gaugeFresh?latest:nextPeak;return{latest,nextPeak,gaugeFresh,source};}
// Require three observations over at least 10 minutes; endpoint change under
// 0.05 ft is treated as gauge noise. Ignore data older than one hour.
function observedWaterTrend(observations,at=now()){
 const rows=(Array.isArray(observations)?observations:[]).filter(p=>Number.isFinite(p?.t)&&Number.isFinite(p?.v)&&p.t<=at&&p.t>=at-60*60000).sort((a,b)=>a.t-b.t);
 if(rows.length<3||rows.at(-1).t-rows[0].t<10*60000)return{direction:'unavailable',change:null};
 const change=rows.at(-1).v-rows[0].v;
 return{direction:change>0.05?'rising':change< -0.05?'falling':'steady',change};
}
function health(id,ok,label){$(id).textContent=label|| (ok?'Connected':'Unavailable');$(id).className='badge '+(ok?'ok':'fail');}

function metricNumber(id,n,unit,decimals=0){$(id).innerHTML=(Number.isFinite(n)?Number(n).toFixed(decimals):'--')+'<em> '+unit+'</em>';}
function validMeasurement(measurement){const value=measurement?.value;return typeof value==='number'&&Number.isFinite(value)?value:null;}
function observationFromNWS(data,station){
 const p=data?.properties||{},rawTime=Date.parse(p.timestamp||'');
 if(!Number.isFinite(rawTime)||now()-rawTime>2*3600000||rawTime>now()+10*60000)throw new Error('Station observation is missing, future-dated, or older than 2 hours');
 const wind=validMeasurement(p.windSpeed),gust=validMeasurement(p.windGust),temp=validMeasurement(p.temperature);
 const humidityRaw=validMeasurement(p.relativeHumidity),humidity=humidityRaw!==null&&humidityRaw>=0&&humidityRaw<=100?humidityRaw:null;
 if(wind===null&&gust===null&&temp===null&&humidity===null)throw new Error('Station did not provide valid wind, air temperature, gust, or relative humidity');
 return {station,t:rawTime,wind:wind===null?null:wind*2.236936,gust:gust===null?null:gust*2.236936,temp:temp===null?null:temp*9/5+32,humidity,direction:validMeasurement(p.windDirection)};
}
function weatherObservationDisplay(observation,at=now(),maxAgeMs=2*3600000){
 const t=Number(observation?.t),age=at-t,base={fresh:false,age:null,wind:null,gust:null,temp:null,humidity:null,direction:null};
 if(!Number.isFinite(t)||age< -10*60000||age>maxAgeMs)return base;
 const within=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null;
 const wind=within(observation?.wind,0,250),gust=within(observation?.gust,0,250),temp=within(observation?.temp,-100,140),humidity=within(observation?.humidity,0,100);
 if(wind===null&&gust===null&&temp===null&&humidity===null)return base;
 const direction=within(observation?.direction,0,360);
 return{fresh:true,age,wind,gust,temp,humidity,direction};
}
// Forecast guidance must be issued/fetched within 24h and cannot be >10m future dated.
function usableWeatherForecast(rows,at=now(),hours=72,sourceAt=at,maxSourceAgeMs=24*3600000){
 const sourceAge=at-Number(sourceAt);if(!Number.isFinite(sourceAge)||sourceAge< -10*60000||sourceAge>maxSourceAgeMs)return[];
 const end=at+hours*3600000;
 return(Array.isArray(rows)?rows:[]).filter(row=>{
  if(!Number.isFinite(row?.t)||!Number.isFinite(row?.end)||row.end<=at||row.t>=end||row.end<=row.t)return false;
  const hasNumber=value=>typeof value==='number'&&Number.isFinite(value);
  return hasNumber(row.wind)||hasNumber(row.gust)||hasNumber(row.temp)||hasNumber(row.pop)||Boolean(String(row.summary||'').trim());
 });
}
function hasUsefulWeatherContent({marine=false,observation=false,forecast=false}={}){return Boolean(marine||observation||forecast);}
function parseWindSpeed(text){
 if(typeof text==='object'&&text!==null){const v=validMeasurement(text);return v===null?null:(String(text.unitCode||'').includes('km_h')?v*.621371:String(text.unitCode||'').includes('m_s-1')?v*2.236936:v);}
 const m=String(text||'').match(/(\d+(?:\.\d+)?)(?:\s*(?:to|-|–)\s*(\d+(?:\.\d+)?))?/i);
 return m?Number(m[2]??m[1]):null; // upper end for a forecast range, not a gust
}
function windCompass(deg){if(!Number.isFinite(deg))return '—';return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((deg%360)+360)%360/22.5)%16];}
function forecastPeriod(p){
 const begin=Date.parse(p.startTime||''),end=Date.parse(p.endTime||'');
 if(!Number.isFinite(begin)||!Number.isFinite(end)||end<=begin)return null;
 const rawTemp=numericValue(p.temperature),temp=rawTemp===null?null:(p.temperatureUnit==='C'?rawTemp*9/5+32:rawTemp);
 const pop=numericValue(p.probabilityOfPrecipitation?.value);return {t:begin,end,wind:parseWindSpeed(p.windSpeed),gust:typeof p.windGust?.value==='number'&&Number.isFinite(p.windGust.value)?(String(p.windGust.unitCode||'').includes('km_h')?p.windGust.value*.621371:String(p.windGust.unitCode||'').includes('m_s')?p.windGust.value*2.236936:p.windGust.value):null,dir:String(p.windDirection||'—'),temp,pop,summary:String(p.shortForecast||'')};
}
