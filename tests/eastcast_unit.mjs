import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertType,eventCategory,severityScore,topHazard,confidenceFromSummary,
  isStormMode,buildNowBrief,diffSummaries,chooseWatchLocations,timelineBuckets,
  stateStory,nearestForecastTime
} from '../eastcast/core.mjs';

test('alertType classifies official alert names',()=>{
  assert.equal(alertType('Coastal Flood Warning'),'warning');
  assert.equal(alertType('Hurricane Watch'),'watch');
  assert.equal(alertType('Wind Advisory'),'advisory');
});

test('eventCategory prioritizes hazard families',()=>{
  assert.equal(eventCategory('Storm Surge Warning'),'tropical');
  assert.equal(eventCategory('Coastal Flood Warning'),'coastal');
  assert.equal(eventCategory('Flash Flood Warning'),'flood');
  assert.equal(eventCategory('Winter Storm Watch'),'winter');
  assert.equal(eventCategory('Severe Thunderstorm Warning'),'severe');
});

test('severityScore ranks warnings above advisories',()=>{
  assert.ok(
    severityScore({properties:{event:'Coastal Flood Warning',severity:'Moderate'}}) >
    severityScore({properties:{event:'Coastal Flood Advisory',severity:'Moderate'}})
  );
});

test('topHazard favors higher-impact categories over raw count alone',()=>{
  const h=topHazard({top_events:[
    {event:'Small Craft Advisory',count:60},
    {event:'Flash Flood Warning',count:4}
  ]});
  assert.equal(h.category,'flood');
});

test('confidence reflects alert class without pretending to be ensemble skill',()=>{
  const c=confidenceFromSummary({most_urgent:{event:'High Wind Watch'}});
  assert.equal(c.level,'Medium');
  assert.match(c.text,/location|timing/i);
});

test('storm mode turns on for widespread warnings',()=>{
  assert.equal(isStormMode({warnings:9,states_affected:3,active_alerts:10,top_events:[]},[]),true);
  assert.equal(isStormMode({warnings:0,states_affected:1,active_alerts:2,top_events:[{event:'Wind Advisory',count:2}]},[]),false);
});

test('buildNowBrief produces concise summary',()=>{
  const b=buildNowBrief({summary:{
    active_alerts:22,warnings:5,states_affected:4,
    top_events:[{event:'Coastal Flood Warning',count:5}],
    top_states:[{code:'NJ'},{code:'NY'}],
    most_urgent:{event:'Coastal Flood Warning',ends:'2026-09-25T18:00:00Z'}
  }});
  assert.match(b.headline,/Coastal Flood Warning/);
  assert.match(b.dek,/22 active alerts/);
});

test('diffSummaries detects increases, decreases and hazard changes',()=>{
  const d=diffSummaries(
    {active_alerts:10,warnings:2,states_affected:3,top_events:[{event:'Wind Advisory',count:5}]},
    {active_alerts:12,warnings:1,states_affected:4,top_events:[{event:'Flood Warning',count:2}]}
  );
  assert.ok(d.some(x=>x.text==='+2 active alerts'));
  assert.ok(d.some(x=>x.text==='-1 warnings'));
  assert.ok(d.some(x=>x.key==='top_hazard'));
});

test('chooseWatchLocations follows most affected states',()=>{
  const x=chooseWatchLocations({top_states:[
    {code:'NJ',top_event:'Coastal Flood Warning'},
    {code:'MA',top_event:'High Wind Warning'}
  ]},2);
  assert.equal(x.length,2);
  assert.equal(x[0].state,'NJ');
  assert.equal(x[1].state,'MA');
});

test('timelineBuckets intersects effective windows',()=>{
  const now=new Date('2026-09-25T10:00:00Z');
  const a=[{properties:{event:'High Wind Warning',severity:'Severe',onset:'2026-09-25T09:00:00Z',ends:'2026-09-26T03:00:00Z'}}];
  const t=timelineBuckets(a,now);
  assert.equal(t[0].count,1);
  assert.equal(t[2].count,1);
  assert.equal(t[4].count,0);
});

test('stateStory is quiet when no alert exists',()=>{
  const s=stateStory({state_alerts:{}},'ME');
  assert.equal(s.type,'quiet');
});

test('nearestForecastTime returns closest advertised valid time',()=>{
  const t=nearestForecastTime(
    ['2026-09-25T12:00','2026-09-25T18:00','2026-09-26T00:00'],
    6,new Date('2026-09-25T11:00:00Z')
  );
  assert.equal(t,'2026-09-25T18:00');
});
