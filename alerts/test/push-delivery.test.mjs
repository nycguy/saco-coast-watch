import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { enqueuePushTransition, deliverQueuedPush, sendThresholdPush } from '../src/push-delivery.mjs';
import { validSubscription } from './fixtures.mjs';

const device = { id: '11111111-1111-4111-8111-111111111111', event_prefs_json: JSON.stringify({ starts: true, ends: true, changes: true }) };
function db({ devices = [device], queue = [] } = {}) {
  const calls=[];
  return { calls, prepare(sql) { const call={sql,args:[]}; calls.push(call); return { bind(...args){call.args=args;return this;}, async all(){return {results:sql.includes('push_devices WHERE enabled=1')?devices:queue};}, async run(){return {meta:{changes:1}};} }; } };
}
async function vapidPair(){
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await webcrypto.subtle.exportKey('jwk',pair.privateKey);
  return {public:Buffer.from(await webcrypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url'),private:jwk.d};
}
const event={eventKey:'urn:nws:alert:1',fingerprint:'b'.repeat(64),kind:'start',title:'Coastal alert issued',body:'Check SacoCast.',url:'https://nycguy.github.io/saco-coast-watch/'};

test('event queue is deterministic and respects the current event preferences', async()=>{
  const database=db();
  await enqueuePushTransition(database,event,1000);
  const first=database.calls.at(-1).args[0];
  await enqueuePushTransition(database,event,1010);
  assert.equal(database.calls.length,4);
  assert.equal(database.calls.at(-1).args[0],first);
  const disabled=db({devices:[{...device,event_prefs_json:JSON.stringify({starts:false,ends:true,changes:true})}]});
  await enqueuePushTransition(disabled,event,1000);
  assert.equal(disabled.calls.length,1);
});

test('successful Web Push marks the idempotent delivery sent', async()=>{
  const pair=await vapidPair(), previous=globalThis.fetch;
  const row={id:'d'.repeat(64),device_id:device.id,payload_json:JSON.stringify({application:'SacoCast',kind:'start'}),transition_kind:'start',event_prefs_json:device.event_prefs_json,endpoint:'https://fcm.googleapis.com/fcm/send/x',p256dh:validSubscription.keys.p256dh,auth:validSubscription.keys.auth,attempts:0};
  const database=db({queue:[row]});
  globalThis.fetch=async()=>new Response(null,{status:201});
  try{
    const result=await deliverQueuedPush({DB:database,VAPID_PUBLIC_KEY:pair.public,VAPID_PRIVATE_KEY:pair.private,SUPPORT_EMAIL:'alerts@example.org',PUSH_EVENTS_ENABLED:'true'},1000);
    assert.equal(result.pushSent,1);
    assert.equal(database.calls.some(c=>/SET status='sent'/.test(c.sql)),true);
  }finally{globalThis.fetch=previous;}
});

test('transient push failures use retry backoff without marking delivery sent', async()=>{
  const pair=await vapidPair(), previous=globalThis.fetch;
  const row={id:'e'.repeat(64),device_id:device.id,payload_json:'{}',transition_kind:'start',event_prefs_json:device.event_prefs_json,endpoint:'https://fcm.googleapis.com/fcm/send/x',p256dh:validSubscription.keys.p256dh,auth:validSubscription.keys.auth,attempts:0};
  const database=db({queue:[row]});
  globalThis.fetch=async()=>new Response(null,{status:503});
  try{
    const result=await deliverQueuedPush({DB:database,VAPID_PUBLIC_KEY:pair.public,VAPID_PRIVATE_KEY:pair.private,SUPPORT_EMAIL:'alerts@example.org',PUSH_EVENTS_ENABLED:'true'},2000);
    assert.equal(result.pushSent,0);
    const update=database.calls.find(c=>/SET status=\?,attempts=\?,next_attempt_at/.test(c.sql));
    assert.ok(update);
    assert.equal(update.args[0],'pending');
    assert.equal(update.args[1],1);
    assert.equal(update.args[2],2060);
  }finally{globalThis.fetch=previous;}
});

test('expired subscriptions are removed from device storage', async()=>{
  const pair=await vapidPair(), previous=globalThis.fetch;
  const row={id:'f'.repeat(64),device_id:device.id,payload_json:'{}',transition_kind:'start',event_prefs_json:device.event_prefs_json,endpoint:'https://fcm.googleapis.com/fcm/send/x',p256dh:validSubscription.keys.p256dh,auth:validSubscription.keys.auth,attempts:0};
  const database=db({queue:[row]});
  globalThis.fetch=async()=>new Response(null,{status:410});
  try{
    const result=await deliverQueuedPush({DB:database,VAPID_PUBLIC_KEY:pair.public,VAPID_PRIVATE_KEY:pair.private,SUPPORT_EMAIL:'alerts@example.org',PUSH_EVENTS_ENABLED:'true'},3000);
    assert.equal(result.pushExpired,1);
    assert.equal(database.calls.some(c=>/DELETE FROM push_devices WHERE id/.test(c.sql)),true);
  }finally{globalThis.fetch=previous;}
});


test('custom threshold push uses the same encrypted Web Push transport', async()=>{
  const pair=await vapidPair(), previous=globalThis.fetch;
  const database=db();
  globalThis.fetch=async()=>new Response(null,{status:201});
  try{
    const result=await sendThresholdPush({DB:database,VAPID_PUBLIC_KEY:pair.public,VAPID_PRIVATE_KEY:pair.private,SUPPORT_EMAIL:'alerts@example.org'},{
      id:device.id,endpoint:'https://fcm.googleapis.com/fcm/send/x',p256dh:validSubscription.keys.p256dh,auth:validSubscription.keys.auth
    },{metric:'tempHigh',title:'SacoCast threshold reached',body:'85 °F',url:'https://nycguy.github.io/saco-coast-watch/'},4000);
    assert.equal(result.sent,true);
  }finally{globalThis.fetch=previous;}
});
