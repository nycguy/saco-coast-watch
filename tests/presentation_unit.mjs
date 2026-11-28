import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {midnight,dailyModelGuidance,recentArchiveFrames,localReports}=require('../js/presentation.js');
const now=Date.parse('2026-11-28T14:00:00Z'),hour=3600000;
const frame=(age,file='frame.jpg')=>({captured_at:new Date(now-age*hour).toISOString(),file});
test('archive enforces the rolling boundary, rejects malformed/future entries, and deduplicates',()=>{
 const result=recentArchiveFrames({retention_hours:24,frames:[frame(24),frame(24.001,'old.jpg'),frame(-1,'future.jpg'),frame(3,'../escape.jpg'),frame(2,'new.jpg'),frame(2,'new.jpg'),{file:'bad.jpg',captured_at:'bad'}]},now);
 assert.equal(result.hours,24);assert.deepEqual(result.frames.map(x=>x.file),['frame.jpg','new.jpg']);
});
test('unbounded or malformed archive retention cannot turn old frames into past-24-hour images',()=>{
 for(const retention_hours of [72,-1,null,'bad'])assert.equal(recentArchiveFrames({retention_hours,frames:[frame(25)]},now).frames.length,0);
 assert.equal(recentArchiveFrames({frames:'bad'},now).frames.length,0);
});
test('Eastern local midnight follows 23-hour and 25-hour daylight-saving days',()=>{
 assert.equal(midnight('2026-03-09')-midnight('2026-03-08'),23*hour);
 assert.equal(midnight('2026-11-02')-midnight('2026-11-01'),25*hour);
});
test('a model ending at 1 AM is a partial-day maximum, never a complete daily peak',()=>{
 const at=Date.parse('2026-11-30T15:00:00Z');
 const points=Array.from({length:16},(_,i)=>({t:at+i*hour,v:i===4?11.49:3.83}));
 const result=dailyModelGuidance(points,at);
 assert.equal(result.get('2026-11-30').partial,false);
 assert.equal(result.get('2026-12-01').partial,true);
 assert.equal(result.get('2026-12-01').last,Date.parse('2026-12-01T06:00:00Z'));
});
test('complete days require both coverage endpoints and no hidden multi-hour gap',()=>{
 const at=midnight('2026-11-29');const full=Array.from({length:24},(_,i)=>({t:at+i*hour,v:10}));
 assert.equal(dailyModelGuidance(full,at).get('2026-11-29').partial,false);
 assert.equal(dailyModelGuidance(full.filter((_,i)=>i!==12),at).get('2026-11-29').partial,true);
 assert.equal(dailyModelGuidance([{t:at,v:null}],at).size,0);
 assert.equal(dailyModelGuidance(null,at).size,0);
});
const report=(title,extra={})=>({title,url:'https://example.test/'+encodeURIComponent(title),published_at:new Date(now-hour).toISOString(),source:'Public News',...extra});
test('local reports reject sports metaphors, marketing and ambiguous overseas Scarborough',()=>{
 const items=[report('Scarborough volleyball storms into Class A final',{source:'Portland Press Herald'}),report('Exceptional Coastal Living Near Biddeford Pool'),report('Flash Flooding Hits Scarborough',{source:'This is the Coast'}),report('Scarborough surf competition in Perth'),report('Saco road closed after coastal flooding'),report('Scarborough, Maine sees high surf'),report('Scarborough storm damages seawall',{source:'WMTW'})];
 assert.equal(localReports(items,now).length,3);
});
test('national sources can report Saco impacts; old, future, malformed and duplicate reports are excluded',()=>{
 const good=report('Camp Ellis storm damages seawall',{source:'Reuters'});
 const duplicate={...good,url:good.url+'?utm_source=rss'};
 const items=[good,duplicate,report('Saco flooding',{published_at:new Date(now-8*24*hour).toISOString()}),report('Saco high surf',{published_at:'bad'}),report('Saco wind',{published_at:new Date(now+hour).toISOString()}),report('Saco flooding',{url:'javascript:alert(1)'})];
 assert.deepEqual(localReports(items,now),[good]);
});
