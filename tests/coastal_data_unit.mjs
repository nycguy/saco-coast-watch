import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const now=Date.UTC(2026,9,13,16,0,0);
class FixedDate extends Date { static now(){return now;} }
const context={Date:FixedDate,Intl,URL,URLSearchParams,console};
const source=['js/config.js','js/data.js','js/water-levels.js'].map(path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')).join('\n');
vm.runInNewContext(source+'\nglobalThis.api={toDate,decodeSeries,decodeHighs,decodeObservations,forecastPeriod,currentStatus,observedWaterTrend,countdown,riskBand,hasNumericValue,observationFromNWS,weatherObservationDisplay,usableWeatherForecast,hasUsefulWeatherContent,state};',context);
const api=context.api;
const state=api.state;
const timestamp=ms=>new Date(ms).toISOString().replace('T',' ').slice(0,19);

const intelligenceContext={Date:FixedDate,Number,Math,document:{},state:{},now:()=>now,dayTime:()=> 'Tue, Oct 13 at 3:00 PM'};
vm.runInNewContext(readFileSync(new URL('../js/intelligence.js',import.meta.url),'utf8')+'\nglobalThis.floodThresholdDistance=floodThresholdDistance;globalThis.assessUpcomingForecast=assessUpcomingForecast;',intelligenceContext);

test('NOAA dates reject rollover and malformed timestamps',()=>{
 assert.ok(Number.isNaN(api.toDate('2026-02-30 12:00')));
 assert.ok(Number.isNaN(api.toDate('2026-10-13 25:00')));
 assert.ok(Number.isNaN(api.toDate('2026-10-13 16:00Z')));
 assert.equal(api.toDate('2026-10-13 16:00'),now);
});

test('missing JSON measurements do not become fabricated zero values',()=>{
 assert.equal(api.hasNumericValue(null),false);
 assert.equal(api.hasNumericValue(''),false);
 assert.equal(api.hasNumericValue(undefined),false);
 assert.equal(api.hasNumericValue(0),true);
 assert.equal(api.hasNumericValue('0'),true);
});

test('high-water threshold distance follows Portland Minor Moderate and Major boundaries',()=>{
 const distance=intelligenceContext.floodThresholdDistance;
 assert.equal(distance(11.5),'0.50 ft below Minor Flood');
 assert.equal(distance(12),'1.00 ft below Moderate Flood');
 assert.equal(distance(13),'1.00 ft below Major Flood');
 assert.equal(distance(14),'0.00 ft above Major Flood');
 assert.equal(distance(null),'Unavailable');
});

test('NOAA series ignore empty and malformed measurements and deduplicate times',()=>{
 const points=api.decodeSeries({data:[
  null,
  {t:timestamp(now+60000),v:''},
  {t:'2026-02-30 12:00',v:'12.3'},
  {t:timestamp(now),v:'12.1'},
  {t:timestamp(now),v:'12.2'},
  {t:timestamp(now+120000),v:null},
  {time:timestamp(now-60000),value:'bad'},
 ]},['data']);
 assert.deepEqual(JSON.parse(JSON.stringify(points)),[{t:now,v:12.2}]);
});

test('empty NWS temperatures and precipitation probabilities stay unavailable',()=>{
 const period=api.forecastPeriod({startTime:'2026-10-13T16:00:00Z',endTime:'2026-10-13T17:00:00Z',temperature:'',probabilityOfPrecipitation:{value:''},shortForecast:'Cloudy'});
 assert.equal(period.temp,null);
 assert.equal(period.pop,null);
 assert.equal(api.forecastPeriod({startTime:'2026-10-13T17:00:00Z',endTime:'2026-10-13T16:00:00Z'}),null);
});

test('NWS station decoder keeps measured temperature and humidity independent and rejects malformed humidity',()=>{
 const at=new Date(now-5*60000).toISOString();
 const base={properties:{timestamp:at,temperature:{value:10,unitCode:'wmoUnit:degC'},windSpeed:{value:null},windGust:{value:null},relativeHumidity:{value:79,unitCode:'wmoUnit:percent'}}};
 assert.equal(api.observationFromNWS(base,'KPWM').temp,50);
 assert.equal(api.observationFromNWS(base,'KPWM').humidity,79);
 assert.equal(api.observationFromNWS({properties:{...base.properties,relativeHumidity:{value:101}}},'KPWM').humidity,null);
 const noTemp={properties:{...base.properties,temperature:{value:null},relativeHumidity:{value:81}}};
 assert.equal(api.observationFromNWS(noTemp,'KPWM').temp,null);
 assert.equal(api.observationFromNWS(noTemp,'KPWM').humidity,81);
 assert.throws(()=>api.observationFromNWS({properties:{...base.properties,temperature:{value:null},relativeHumidity:{value:null}}},'KPWM'),/did not provide valid/);
});

test('NWS station observations reject stale and malformed timestamps',()=>{
 const sample={properties:{timestamp:new Date(now-2*3600000-1).toISOString(),temperature:{value:10},windSpeed:{value:null},relativeHumidity:{value:99}}};
 assert.throws(()=>api.observationFromNWS(sample,'KPWM'),/older than 2 hours/);
 assert.throws(()=>api.observationFromNWS({properties:{...sample.properties,timestamp:'not-a-time'}},'KPWM'),/missing, future-dated, or older/);
});

test('malformed high-tide rows do not abort valid predictions',()=>{
 const highs=api.decodeHighs({predictions:[null,{type:'H',t:'2026-02-30 12:00',v:'14.2'},{type:'H',t:timestamp(now),v:''},{type:'H',t:timestamp(now+60000),v:'13.4'}]});
 assert.deepEqual(JSON.parse(JSON.stringify(highs)),[{t:now+60000,v:13.4}]);
});

test('gauge decoder excludes observations more than ten minutes in the future',()=>{
 const points=api.decodeObservations({data:[
  {t:timestamp(now-3600000),v:'11.8'},
  {t:timestamp(now+600000),v:'12.0'},
  {t:timestamp(now+660000),v:'14.2'},
 ]});
 assert.deepEqual(JSON.parse(JSON.stringify(points)),[
  {t:now-3600000,v:11.8},{t:now+600000,v:12},
 ]);
});

test('missing, stale, and future gauge states never claim current observations',()=>{
 state.model=[];state.obs=[];
 assert.equal(api.currentStatus().gaugeFresh,false);
 state.obs=[{t:now-45*60000,v:12}];
 assert.equal(api.currentStatus().gaugeFresh,false);
 state.obs=[{t:now+11*60000,v:12}];
 assert.equal(api.currentStatus().gaugeFresh,false);
 state.obs=[{t:now-44*60000,v:12}];
 assert.equal(api.currentStatus().gaugeFresh,true);
});

test('observed trend needs three recent readings spanning ten minutes and a 0.05 ft signal',()=>{
 const trend=api.observedWaterTrend;
 assert.deepEqual(JSON.parse(JSON.stringify(trend([],now))),{direction:'unavailable',change:null});
 assert.equal(trend([{t:now-12*60000,v:1},{t:now-6*60000,v:1.1}],now).direction,'unavailable');
 assert.equal(trend([{t:now-12*60000,v:1},{t:now-6*60000,v:1.02},{t:now,v:1.03}],now).direction,'steady');
 assert.equal(trend([{t:now-12*60000,v:1},{t:now-6*60000,v:1.03},{t:now,v:1.08}],now).direction,'rising');
 assert.equal(trend([{t:now-12*60000,v:1.1},{t:now-6*60000,v:1.04},{t:now,v:1}],now).direction,'falling');
 assert.equal(trend([{t:now-20*60000,v:1},{t:now-10*60000,v:1.2},{t:now,v:1.3}],now).direction,'rising');
 assert.equal(trend([{t:now-90*60000,v:1},{t:now-50*60000,v:1.2},{t:now-45*60000,v:1.3}],now).direction,'unavailable');
});

test('next high tide countdown is minute based and never reports a negative duration',()=>{
 assert.equal(api.countdown(now+5*60000),'In 5m');
 assert.equal(api.countdown(now+90*60000),'In 1h 30m');
 assert.equal(api.countdown(now+26*3600000),'In 1d 2h');
 assert.equal(api.countdown(now),'High tide now');
 assert.equal(api.countdown(Number.NaN),'High tide now');
});

test('marine observations hide completely when every station lacks current measurements',()=>{
 const nodes=new Map();
 const node=()=>({textContent:'',className:'',children:[],replaceChildren(){this.children=[];},append(value){this.children.push(value);}});
 const marineContext={
  Date:FixedDate,Number,Math,Intl,state:{marine:{},marineSnapshotAt:now,marineFetchError:'Invalid JSON: private implementation detail'},
  now:()=>now,$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},
  document:{createTextNode:text=>({textContent:text}),createElement:node},
  dayTime:()=> 'Tue, Oct 13 at 11:00 AM',relative:()=> '70 minutes ago',windCompass:()=> 'N',health:()=>{}
 };
 vm.runInNewContext(readFileSync(new URL('../js/marine.js',import.meta.url),'utf8')+'\nrenderMarine();',marineContext);
 const sourceMessage=nodes.get('marineFeedNote').textContent;
 assert.match(sourceMessage,/Values older than 60 minutes are withheld/);
 assert.doesNotMatch(sourceMessage,/Invalid JSON|temporarily unavailable|stale|workflow|updater|parser/i);
 assert.equal(nodes.get('marineObservations').hidden,true);
 assert.equal(nodes.get('marine44007Card').hidden,true);
});

test('fresh wind remains visible when buoy wave data is stale or absent',()=>{
 const nodes=new Map();
 const node=()=>({textContent:'',className:'',children:[],parentElement:{hidden:false},replaceChildren(){this.children=[];},append(value){this.children.push(value);}});
 const marineContext={Date:FixedDate,Number,Math,Intl,state:{marineSnapshotAt:now,marineFetchError:null,marine:{'44007':{observed_at:new Date(now-20*60000).toISOString(),wave_observed_at:new Date(now-80*60000).toISOString(),speed_mph:17,gust_mph:24,wave_height_ft:6.2}}},now:()=>now,$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},document:{createTextNode:text=>({textContent:text}),createElement:node},dayTime:()=> 'Tue, Oct 13 at 11:40 AM',relative:()=> '20 minutes ago',windCompass:()=> 'N',health:()=>{}};
 vm.runInNewContext(readFileSync(new URL('../js/marine.js',import.meta.url),'utf8')+'\nrenderMarine();',marineContext);
 assert.equal(nodes.get('marine44007Status').textContent,'Recent');
 assert.deepEqual(nodes.get('marine44007Speed').children[0].textContent,'17');
 assert.match(nodes.get('marine44007Meta').textContent,/20 min old/);
 assert.equal(nodes.get('marine44007Wave').parentElement.hidden,true);
});

test('NOAA marine freshness keeps the exact 60-minute boundary and withholds older readings',()=>{
 for(const [minutes,label,expectedSpeed] of [[60,'Recent','12'],[61,'Stale','--']]){
  const nodes=new Map(),node=()=>({textContent:'',className:'',children:[],parentElement:{hidden:false},replaceChildren(){this.children=[];},append(value){this.children.push(value);}});
  const station={observed_at:new Date(now-minutes*60000).toISOString(),speed_mph:12,gust_mph:18};
  const marineContext={Date:FixedDate,Number,Math,Intl,state:{marineSnapshotAt:now,marineFetchError:null,marine:{'44007':station}},now:()=>now,$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},document:{createTextNode:text=>({textContent:text}),createElement:node},dayTime:()=> 'Tue, Oct 13 at 3:00 PM',relative:()=> `${minutes} minutes ago`,windCompass:()=> 'N',health:()=>{}};
  vm.runInNewContext(readFileSync(new URL('../js/marine.js',import.meta.url),'utf8')+'\nrenderMarine();',marineContext);
  assert.equal(nodes.get('marine44007Status').textContent,label);
  assert.equal(nodes.get('marine44007Speed').children[0].textContent,expectedSpeed);
  assert.equal(nodes.get('marine44007Card').hidden,minutes>60);
  assert.equal(nodes.get('marine44007SpeedBox').hidden,minutes>60);
  if(minutes===60)assert.match(nodes.get('marine44007Meta').textContent,/60 min old/);
 }
});

test('a stale wind timestamp does not withhold a separately fresh buoy wave',()=>{
 const nodes=new Map(),node=()=>({textContent:'',className:'',children:[],parentElement:{hidden:false},replaceChildren(){this.children=[];},append(value){this.children.push(value);}});
 const marineContext={Date:FixedDate,Number,Math,Intl,state:{marineSnapshotAt:now,marineFetchError:null,marine:{'44007':{observed_at:new Date(now-75*60000).toISOString(),wave_observed_at:new Date(now-10*60000).toISOString(),speed_mph:12,gust_mph:18,wave_height_ft:5.4}}},now:()=>now,$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},document:{createTextNode:text=>({textContent:text}),createElement:node},dayTime:()=> 'Tue, Oct 13 at 2:50 PM',relative:()=> '10 minutes ago',windCompass:()=> 'N',health:()=>{}};
 vm.runInNewContext(readFileSync(new URL('../js/marine.js',import.meta.url),'utf8')+'\nrenderMarine();',marineContext);
 assert.equal(nodes.get('marine44007Status').textContent,'Recent');
 assert.match(nodes.get('marine44007Speed').children[0].textContent,/--/);
 assert.match(nodes.get('marine44007Meta').textContent,/10 min old/);
 assert.equal(nodes.get('marine44007Wave').parentElement.hidden,false);
 assert.equal(nodes.get('marine44007Wave').textContent,'5.4 ft');
});

test('all missing, malformed, and stale marine observations hide the complete subsection',()=>{
 for(const station of [{observed_at:new Date(now-5*60000).toISOString(),speed_mph:null,gust_mph:null},{observed_at:'not-a-date',speed_mph:12,gust_mph:20},{observed_at:new Date(now-61*60000).toISOString(),speed_mph:12,gust_mph:20}]){
  const nodes=new Map(),node=()=>({textContent:'',className:'',children:[],parentElement:{hidden:false},replaceChildren(){this.children=[];},append(value){this.children.push(value);}});
  const marineContext={Date:FixedDate,Number,Math,Intl,state:{marineSnapshotAt:now,marine:{'44007':station}},now:()=>now,$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},document:{createTextNode:text=>({textContent:text}),createElement:node},dayTime:()=> 'Tue, Oct 13 at 3:00 PM',relative:()=> 'recently',windCompass:()=> 'N',health:()=>{}};
  vm.runInNewContext(readFileSync(new URL('../js/marine.js',import.meta.url),'utf8')+'\nrenderMarine();',marineContext);
  assert.equal(nodes.get('marineObservations').hidden,true);
  assert.equal(nodes.get('marine44007Card').hidden,true);
 }
});

test('one fresh station remains while another goes stale, and stale stations reappear on recovery',()=>{
 const nodes=new Map(),node=()=>({textContent:'',className:'',children:[],parentElement:{hidden:false},replaceChildren(){this.children=[];},append(value){this.children.push(value);}});
 const marineState={marineSnapshotAt:now,marine:{'44007':{observed_at:new Date(now-75*60000).toISOString(),speed_mph:12},WEXM1:{observed_at:new Date(now-10*60000).toISOString(),speed_mph:7}}};
 const marineContext={Date:FixedDate,Number,Math,Intl,state:marineState,now:()=>now,$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},document:{createTextNode:text=>({textContent:text}),createElement:node},dayTime:()=> 'Tue, Oct 13 at 2:50 PM',relative:()=> '10 min ago',windCompass:()=> 'N',health:()=>{}};
 vm.runInNewContext(readFileSync(new URL('../js/marine.js',import.meta.url),'utf8')+'\nrenderMarine();',marineContext);
 assert.equal(nodes.get('marineObservations').hidden,false);
 assert.equal(nodes.get('marine44007Card').hidden,true);
 assert.equal(nodes.get('marineWEXM1Card').hidden,false);
 marineState.marine['44007']={observed_at:new Date(now-10*60000).toISOString(),speed_mph:12};
 marineContext.renderMarine();assert.equal(nodes.get('marine44007Card').hidden,false);
 marineState.marine['44007']={observed_at:new Date(now-61*60000).toISOString(),speed_mph:12};
 marineState.marine.WEXM1={observed_at:new Date(now-61*60000).toISOString(),speed_mph:7};
 marineContext.renderMarine();assert.equal(nodes.get('marineObservations').hidden,true);
});

test('weather observations require valid measurements and expire after the 60-minute display threshold',()=>{
 const display=api.weatherObservationDisplay;
 assert.equal(display({t:now-60*60000,wind:10,temp:42},now,60*60000).wind,10);
 assert.equal(display({t:now-60*60000-1,wind:10,temp:42},now,60*60000).fresh,false);
 assert.equal(display({t:now,wind:NaN,temp:42},now,60*60000).temp,42);
 assert.equal(display({t:now,wind:NaN,temp:NaN},now,60*60000).fresh,false);
 assert.equal(display({t:now+11*60000,wind:10},now,60*60000).fresh,false);
});

test('coastal hourly forecasts remain usable only with valid future periods and supported content',()=>{
 const usable=api.usableWeatherForecast;
 assert.equal(usable([{t:now+3600000,end:now+2*3600000,wind:8,summary:'Clear'}],now).length,1);
 assert.equal(usable([{t:now-3600000,end:now-1,wind:8},{t:now+3600000,end:now+2*3600000,wind:NaN,summary:''}],now).length,0);
 const future=[{t:now+3600000,end:now+2*3600000,wind:8}];
 assert.equal(usable(future,now,72,now-24*3600000).length,1);
 assert.equal(usable(future,now,72,now-24*3600000-1).length,0);
 assert.equal(usable(future,now,72,now+11*60000).length,0);
});

test('weather section stays available for airport observations or coastal forecasts when marine data is unavailable',()=>{
 const available=api.hasUsefulWeatherContent;
 assert.equal(available({marine:false,observation:true,forecast:false}),true);
 assert.equal(available({marine:false,observation:false,forecast:true}),true);
 assert.equal(available({marine:false,observation:false,forecast:false}),false);
 assert.equal(available({marine:true,observation:false,forecast:false}),true);
});

test('upcoming forecast assessment distinguishes full, partial, stale, and unavailable source coverage',()=>{
 const assess=intelligenceContext.assessUpcomingForecast,at=now;
 const full={generated_at:new Date(at).toISOString(),hourly_full:[{end:new Date(at+72*3600000).toISOString()}],errors:{}};
 assert.equal(assess(full,at,true).state,'available');
 assert.equal(assess({...full,hourly_full:[{end:new Date(at+24*3600000).toISOString()}]},at,true).state,'partial');
 assert.equal(assess({...full,generated_at:new Date(at-46*60000).toISOString()},at,true).state,'unavailable');
 assert.equal(assess(full,at,false).state,'unavailable');
 assert.equal(assess(full,at,true,'feed failed').state,'unavailable');
});

test('Portland flood classifications retain exact threshold boundaries',()=>{
 for(const [value,expected] of [
  [11.999,'below'],[12,'minor'],[12.999,'minor'],[13,'moderate'],
  [13.999,'moderate'],[14,'major'],[Number.NaN,'unavailable'],
 ]) assert.equal(api.riskBand(value),expected,String(value));
});
