import test from 'node:test';
import assert from 'node:assert/strict';
import {cronStatus,readCronStatus,recordCron,trackCron} from '../src/cron-health.mjs';
test('unknown, stale, fresh, failed and disabled channels are distinct',()=>{
 const now=2000000000;
 const status=cronStatus([{channel:'email',state:'healthy',completed_at:now-1801},{channel:'threshold_push',state:'failed',completed_at:now-30},{channel:'event_push',state:'disabled',completed_at:now-10}],now);
 assert.equal(status.email.status,'stale');assert.equal(status.threshold_push.status,'failed');assert.equal(status.event_push.status,'disabled');
 assert.equal(cronStatus([{channel:'email',state:'healthy',completed_at:now-1800}],now).email.status,'healthy');
 assert.equal(cronStatus([],now).email.status,'unknown');
});
test('missing migration degrades without claiming health',async()=>{
 const status=await readCronStatus({prepare(){throw Error('missing table');}});
 assert.equal(status.available,false);assert.equal(status.channels.email.status,'unknown');
});
test('successful and failed jobs persist independently',async()=>{
 const records=[];
 const db={prepare(sql){return {bind(...args){records.push({sql,args});return this;},async run(){return {};}};}};
 assert.equal(await trackCron(db,'email',async()=>42),42);
 await assert.rejects(trackCron(db,'threshold_push',async()=>{throw Error('upstream unavailable');}),/upstream/);
 assert.deepEqual(records.map(r=>r.args[1]),['running','healthy','running','failed']);
});
test('invalid channel and status cannot write',async()=>{
 await assert.rejects(recordCron({},'subscriber_email','healthy'),/Invalid/);
});
