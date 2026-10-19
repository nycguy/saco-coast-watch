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

test('different named tropical cyclones sharing a marine product remain separate',()=>{
 const groups=api.groupRecentEvents([
  event({title:'Hurricane Isaias'}),
  event({title:'Tropical Storm Beta'}),
 ]);
 assert.equal(groups.length,2);
});

test('same-family records sharing one official product group across an 18-hour episode gap',()=>{
 const groups=api.groupRecentEvents([
  event({title:'Coastal Event',official_products:['Small Craft Advisory']}),
  event({title:'Coastal Event',started_at:'2026-10-19T03:00:00Z',ended_at:'2026-10-19T05:00:00Z',official_products:['Small Craft Advisory']}),
 ]);
 assert.equal(groups.length,1);
 assert.equal(groups[0].records.length,2);
});

test('same hazard and product more than 18 hours apart remain distinct episodes',()=>{
 const groups=api.groupRecentEvents([
  event({title:'Coastal Event',official_products:['Small Craft Advisory']}),
  event({title:'Coastal Event',started_at:'2026-10-19T09:00:00Z',ended_at:'2026-10-19T11:00:00Z',official_products:['Small Craft Advisory']}),
 ]);
 assert.equal(groups.length,2);
});

test('storm stages with the same named cyclone group across a four-day episode',()=>{
 const groups=api.groupRecentEvents([
  event({title:'Tropical Storm Isaias',started_at:'2026-10-18T10:00:00Z',ended_at:'2026-10-18T14:00:00Z',official_products:[]}),
  event({title:'Hurricane Isaias',started_at:'2026-10-19T18:00:00Z',ended_at:'2026-10-20T13:00:00Z',official_products:[]}),
  event({title:'Potential Tropical Cyclone Isaias',started_at:'2026-10-21T18:00:00Z',ended_at:'2026-10-21T21:00:00Z',official_products:[]}),
 ]);
 assert.equal(groups.length,1);
 assert.equal(groups[0].records.length,3);
});

test('same storm label after the four-day window remains a separate episode',()=>{
 const groups=api.groupRecentEvents([
  event({title:'Hurricane Isaias',started_at:'2026-10-18T10:00:00Z',ended_at:'2026-10-18T14:00:00Z',official_products:[]}),
  event({title:'Tropical Storm Isaias',started_at:'2026-10-23T15:00:00Z',ended_at:'2026-10-23T18:00:00Z',official_products:[]}),
 ]);
 assert.equal(groups.length,2);
});

test('archive fixture groups one named-storm lifecycle but retains separate storm identities and marine periods',()=>{
 const records=[
  event({title:'Coastal Event',started_at:'2026-10-16T15:25:48Z',ended_at:'2026-10-18T00:19:22Z',official_products:['Small Craft Advisory']}),
  event({title:'Coastal Event',started_at:'2026-10-13T11:06:04Z',ended_at:'2026-10-15T01:50:40Z',official_products:['Small Craft Advisory']}),
  event({title:'Potential Tropical Cyclone Isaias',started_at:'2026-10-11T18:05:24Z',ended_at:'2026-10-11T21:55:14Z',official_products:[]}),
  event({title:'Hurricane Isaias',started_at:'2026-10-08T17:56:01Z',ended_at:'2026-10-10T13:38:11Z',official_products:['Small Craft Advisory']}),
  event({title:'Tropical Storm Isaias',started_at:'2026-10-07T23:49:28Z',ended_at:'2026-10-07T23:49:28Z',official_products:['Small Craft Advisory']}),
  event({title:'Tropical Depression Nine',started_at:'2026-10-05T22:48:40Z',ended_at:'2026-10-07T06:16:59Z',official_products:['Small Craft Advisory']}),
  event({title:'High Surf / Wave Impact',started_at:'2026-09-29T18:57:39Z',ended_at:'2026-09-30T01:47:12Z',official_products:[]}),
 ];
 const groups=api.groupRecentEvents(records);
 assert.equal(groups.length,5);
 assert.equal(JSON.stringify(groups.map(group=>group.records.length).sort((a,b)=>a-b)),'[1,1,1,1,3]');
 assert.equal(groups.reduce((count,group)=>count+group.records.length,0),records.length);
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

test('recent event navigation orders newest first and preserves one event identity',()=>{
 const groups=api.orderRecentEvents(api.groupRecentEvents([
  event({title:'Winter Storm',started_at:'2026-10-16T10:00:00Z',ended_at:'2026-10-16T14:00:00Z',official_products:['Winter Storm Warning']}),
  event({title:'Tropical Storm Alex',started_at:'2026-10-18T08:00:00Z',ended_at:'2026-10-18T12:00:00Z',official_products:[]}),
  event({title:'High Surf Advisory',started_at:'2026-10-17T10:00:00Z',ended_at:'2026-10-17T14:00:00Z',official_products:['High Surf Advisory']}),
 ]));
 assert.deepEqual(Array.from(groups,group=>group.title),['Tropical Storm Alex','High Surf Advisory','Winter Storm']);
 assert.equal(api.recentEventIndex(groups,api.recentGroupKey(groups[1]),api.recentGroupTime(groups[1])),1);
});

test('removed selected event restores the nearest remaining event chronologically',()=>{
 const make=times=>api.orderRecentEvents(times.map((time,index)=>api.groupRecentEvents([event({title:['Winter Storm','High Surf Advisory','Tropical Storm Alex'][index],started_at:time,ended_at:time,official_products:[]})])[0]));
 const before=make(['2026-10-16T10:00:00Z','2026-10-17T18:00:00Z','2026-10-18T10:00:00Z']);
 const selectedAt=api.recentGroupTime(before[1]);
 const after=make(['2026-10-16T10:00:00Z','2026-10-18T10:00:00Z']);
 assert.equal(api.recentEventIndex(after,api.recentGroupKey(before[1]),selectedAt),0);
 assert.equal(api.recentEventIndex([],null,selectedAt),-1);
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

test('upcoming events preserve missing timing and missing official severity without inventing either',()=>{
 const [event]=api.upcomingEvents({now:Date.parse('2026-10-18T09:00:00Z'),alerts:[{event:'Coastal Flood Warning',severity:null,onset:'malformed',ends:'malformed'}]});
 assert.equal(event.at,null);
 assert.equal(event.severityLabel,'Severity not stated');
});

test('official NWS alert severity maps to distinct text and hazard emphasis',()=>{
 const now=Date.parse('2026-10-18T09:00:00Z');
 for(const [severity,rank] of [['Minor',1],['Moderate',2],['Severe',3],['Extreme',3]]){
  const [event]=api.upcomingEvents({now,alerts:[{event:'Coastal Flood Warning',severity,onset:'2026-10-18T10:00:00Z'}]});
  assert.equal(event.rank,rank);assert.equal(event.severityLabel,severity);
 }
});
