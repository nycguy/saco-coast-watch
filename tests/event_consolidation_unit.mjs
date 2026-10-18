import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context={Date,Number,Math,globalThis:null};context.globalThis=context;
vm.runInNewContext(readFileSync(new URL('../js/coastal-events.js',import.meta.url),'utf8'),context);
const api=context.SacoEventUtils;
const start='2026-10-18T10:00:00Z';
const end='2026-10-18T14:00:00Z';
const event=(overrides={})=>({title:'Nor’easter',started_at:start,ended_at:end,highest_impact:{rank:1,label:'Elevated'},official_products:['Coastal Flood Warning'],snapshot_count:2,...overrides});

test('overlapping records for one named nor’easter become one ranked primary episode',()=>{
 const groups=api.groupRecentEvents([
  event({title:'Nor’easter · Coastal Flood Warning',max_residual_ft:1.1}),
  event({title:'Nor’easter',started_at:'2026-10-18T11:00:00Z',ended_at:'2026-10-18T16:00:00Z',snapshot_count:3,max_residual_ft:1.4}),
 ]);
 assert.equal(groups.length,1);
 assert.equal(groups[0].records.length,2);
 assert.equal(groups[0].snapshot_count,5);
 assert.equal(groups[0].max_residual_ft,1.4);
});

test('different hazard families remain separate even when their times overlap',()=>{
 const groups=api.groupRecentEvents([
  event({title:'Coastal Flood Warning',official_products:['Coastal Flood Warning']}),
  event({title:'High Surf Advisory',official_products:['High Surf Advisory']}),
 ]);
 assert.equal(groups.length,2);
});

test('same hazard and product separated by more than twelve hours remain distinct episodes',()=>{
 const groups=api.groupRecentEvents([
  event({title:'Coastal Event',official_products:['Small Craft Advisory']}),
  event({title:'Coastal Event',started_at:'2026-10-19T03:00:00Z',ended_at:'2026-10-19T05:00:00Z',official_products:['Small Craft Advisory']}),
 ]);
 assert.equal(groups.length,2);
});

test('storm stage labels sharing the same named cyclone group when reports overlap',()=>{
 const groups=api.groupRecentEvents([
  event({title:'Hurricane Isaias',official_products:[]}),
  event({title:'Tropical Storm Isaias',started_at:'2026-10-18T12:00:00Z',ended_at:'2026-10-18T16:00:00Z',official_products:[]}),
 ]);
 assert.equal(groups.length,1);
});

test('empty and malformed event records are retained as separate history entries',()=>{
 const input=[null,{},event({started_at:'bad',ended_at:'also bad'})];
 const groups=api.groupRecentEvents(input);
 assert.equal(groups.length,3);
 assert.equal(groups.reduce((n,group)=>n+group.records.length,0),3);
});

test('grouped events never turn null metrics into fabricated zero measurements',()=>{
 const [group]=api.groupRecentEvents([event({max_wave_ft:null,max_residual_ft:null})]);
 assert.equal(group.max_wave_ft,null);
 assert.equal(group.max_residual_ft,null);
});

test('upcoming selection ignores routine high tides and shows plain empty when no hazard qualifies',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(api.upcomingEvents({windows:[{impact:{rank:0,label:'Routine'},high_tide_at:start,astronomical_ft:11.2}],now:Date.parse('2026-10-18T09:00:00Z')}))),[]);
});

test('next event keeps official alerts and materially different hazard families distinct',()=>{
 const events=api.upcomingEvents({now:Date.parse('2026-10-18T09:00:00Z'),alerts:[
  {event:'Coastal Flood Warning',severity:'Severe',onset:start,ends:end},
  {event:'Winter Storm Warning',severity:'Severe',onset:start,ends:end},
 ],windows:[{impact:{rank:2,label:'High'},window_start:'2026-10-18T11:00:00Z',window_end:end,astronomical_ft:11.2,modeled_total_ft:12.1}]});
 assert.equal(events.length,2);
 assert.equal(events[0].source,'Official NWS alert');
 assert.notEqual(events[0].family,events[1].family);
});

test('malformed and expired alerts do not invent an upcoming coastal event',()=>{
 const events=api.upcomingEvents({now:Date.parse('2026-10-18T09:00:00Z'),alerts:[
  null,{event:'',onset:start},{event:'Coastal Flood Warning',onset:'bad',ends:'2026-10-18T08:00:00Z'},
 ],windows:[{impact:{rank:'bad'},window_start:'bad',high_tide_at:start}]});
 assert.equal(events.length,0);
});
