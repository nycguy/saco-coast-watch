import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const now=Date.UTC(2026,9,13,16,0,0);
class FixedDate extends Date { static now(){return now;} }
const context={Date:FixedDate,Intl,URL,URLSearchParams,console};
const source=['js/config.js','js/data.js','js/water-levels.js'].map(path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')).join('\n');
vm.runInNewContext(source+'\nglobalThis.api={toDate,decodeSeries,decodeHighs,decodeObservations,forecastPeriod,currentStatus,riskBand,state};',context);
const api=context.api;
const state=api.state;
const timestamp=ms=>new Date(ms).toISOString().replace('T',' ').slice(0,19);

test('NOAA dates reject rollover and malformed timestamps',()=>{
 assert.ok(Number.isNaN(api.toDate('2026-02-30 12:00')));
 assert.ok(Number.isNaN(api.toDate('2026-10-13 25:00')));
 assert.ok(Number.isNaN(api.toDate('2026-10-13 16:00Z')));
 assert.equal(api.toDate('2026-10-13 16:00'),now);
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

test('Portland flood classifications retain exact threshold boundaries',()=>{
 for(const [value,expected] of [
  [11.999,'below'],[12,'minor'],[12.999,'minor'],[13,'moderate'],
  [13.999,'moderate'],[14,'major'],[Number.NaN,'unavailable'],
 ]) assert.equal(api.riskBand(value),expected,String(value));
});
