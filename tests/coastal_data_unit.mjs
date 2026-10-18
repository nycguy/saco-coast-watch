import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const now=Date.UTC(2026,9,13,16,0,0);
class FixedDate extends Date { static now(){return now;} }
const context={Date:FixedDate,Intl,URL,URLSearchParams,console};
const source=['js/config.js','js/data.js','js/water-levels.js'].map(path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')).join('\n');
vm.runInNewContext(source+'\nglobalThis.api={toDate,decodeSeries,decodeHighs,decodeObservations,forecastPeriod,currentStatus,observedWaterTrend,countdown,riskBand,hasNumericValue,observationFromNWS,state};',context);
const api=context.api;
const state=api.state;
const timestamp=ms=>new Date(ms).toISOString().replace('T',' ').slice(0,19);

const intelligenceContext={Date:FixedDate,Number,Math,document:{},state:{},now:()=>now};
vm.runInNewContext(readFileSync(new URL('../js/intelligence.js',import.meta.url),'utf8')+'\nglobalThis.floodThresholdDistance=floodThresholdDistance;',intelligenceContext);

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

test('marine source failures show plain-language status without workflow or parser details',()=>{
 const nodes=new Map();
 const node=()=>({textContent:'',className:'',children:[],replaceChildren(){this.children=[];},append(value){this.children.push(value);}});
 const marineContext={
  Date:FixedDate,Number,Math,Intl,state:{marine:{},marineFetchError:'Invalid JSON: private implementation detail'},
  now:()=>now,$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},
  document:{createTextNode:text=>({textContent:text}),createElement:node},
  dayTime:()=> 'Tue, Oct 13 at 11:00 AM',relative:()=> '70 minutes ago',windCompass:()=> 'N',health:()=>{}
 };
 vm.runInNewContext(readFileSync(new URL('../js/marine.js',import.meta.url),'utf8')+'\nrenderMarine();',marineContext);
 const sourceMessage=nodes.get('marineFeedNote').textContent;
 assert.match(sourceMessage,/NOAA marine measurements are temporarily unavailable/);
 assert.match(sourceMessage,/Use the NOAA station links/);
 assert.doesNotMatch(sourceMessage,/Invalid JSON|workflow|updater|parser/i);
 assert.match(nodes.get('marine44007Meta').textContent,/No recent measurements are available/);
});

test('Portland flood classifications retain exact threshold boundaries',()=>{
 for(const [value,expected] of [
  [11.999,'below'],[12,'minor'],[12.999,'minor'],[13,'moderate'],
  [13.999,'moderate'],[14,'major'],[Number.NaN,'unavailable'],
 ]) assert.equal(api.riskBand(value),expected,String(value));
});
