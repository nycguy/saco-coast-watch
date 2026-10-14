import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePushApi } from '../src/push-http.mjs';
import { validSubscription } from './fixtures.mjs';
const subscription = { ...validSubscription, endpoint: 'https://web.push.apple.com/device' };
function db(changes = 1) {
  const calls = [];
  return { calls, prepare(sql) { const call = { sql, args: [] }; calls.push(call); return { bind(...args) { call.args = args; return this; }, async first() { return { event_prefs_json: JSON.stringify({ starts:false,ends:true,changes:false }) }; }, async run() { return { meta: { changes } }; } }; } };
}
const env = database => ({ DB: database, ALLOWED_ORIGIN: 'https://nycguy.github.io', PUSH_API_ENABLED: 'true', TOKEN_SECRET: 's'.repeat(32) });
function request(path, body, headers = {}) {
  return new Request('https://worker.example.test' + path, { method: 'POST', headers: { Origin: 'https://nycguy.github.io', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10', ...headers }, body: JSON.stringify(body) });
}
test('push API stays unavailable until explicitly enabled', async () => {
  const response = await handlePushApi(request('/push/devices', { subscription }), { ...env(db()), PUSH_API_ENABLED: 'false' });
  assert.equal(response.status, 503);
});
test('cross-origin enrollment is rejected without database access', async () => {
  const database = db();
  const response = await handlePushApi(request('/push/devices', { subscription }, { Origin: 'https://other.example' }), env(database));
  assert.equal(response.status, 403);
  assert.equal(database.calls.length, 0);
});
test('valid enrollment creates a device with default event preferences', async () => {
  const database = db();
  const response = await handlePushApi(request('/push/devices', { subscription }), env(database));
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.match(data.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(data.preferences, { starts: true, ends: true, changes: true });
  assert.equal(database.calls.length, 2);
});
test('rate-limited enrollment returns 429 before device creation', async () => {
  const response = await handlePushApi(request('/push/devices', { subscription }), env(db(0)));
  assert.equal(response.status, 429);
});

test('missing client address fails closed without consuming a shared rate limit', async () => {
  const database = db();
  const response = await handlePushApi(request('/push/devices', { subscription }, { 'CF-Connecting-IP': '' }), env(database));
  assert.equal(response.status, 503);
  assert.equal(database.calls.length, 0);
});

test('device preferences can be restored with the device ownership credential',async()=>{
  const database=db();
  const req=new Request('https://worker.example.test/push/devices/preferences?deviceId=11111111-1111-4111-8111-111111111111',{method:'GET',headers:{Origin:'https://nycguy.github.io',Authorization:'Bearer '+'a'.repeat(64)}});
  const response=await handlePushApi(req,{...env(database),PUSH_API_ENABLED:'true'});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).preferences,{starts:false,ends:true,changes:false});
  assert.match(database.calls[0].sql,/SELECT event_prefs_json/);
});

test('device notification history requires its owner token and returns only bounded event details',async()=>{
  const calls=[],deviceId='11111111-1111-4111-8111-111111111111';
  const database={prepare(sql){const call={sql,args:[]};calls.push(call);return{bind(...args){call.args=args;return this;},async first(){if(sql.includes('push_devices WHERE id=? AND token_hash=? AND enabled=1'))return{id:deviceId};if(sql.includes('linked_subscriber_id FROM push_threshold_preferences'))return{linked_subscriber_id:'subscriber-private-id'};return null;},async all(){if(sql.includes('push_delivery_queue'))return{results:[
    {payload_json:JSON.stringify({application:'SacoCast',kind:'start',title:'Coastal Flood Warning',body:'Official event update',url:'https://nycguy.github.io/saco-coast-watch/#alerts',endpoint:'https://push.example/private'}),status:'sent',created_at:100,sent_at:110},
    {payload_json:JSON.stringify({application:'SacoCast',kind:'change',title:'Not delivered',body:'Provider rejected',url:'https://nycguy.github.io/saco-coast-watch/'}),status:'failed',created_at:90,sent_at:null},
    {payload_json:'not-json',status:'sent',created_at:80,sent_at:81},
    {payload_json:JSON.stringify({application:'Other',kind:'start'}),status:'sent',created_at:70,sent_at:71},
  ]};if(sql.includes('FROM alert_state'))return{results:[{metric:'waterObserved',last_sent:200}]};return{results:[]};}};}};
  const req=new Request(`https://worker.example.test/push/devices/history?deviceId=${deviceId}`,{headers:{Origin:'https://nycguy.github.io',Authorization:'Bearer '+'a'.repeat(64)}});
  const response=await handlePushApi(req,env(database));
  assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.retentionDays,30);assert.equal(data.items.length,2);
  assert.deepEqual(data.items[0],{kind:'start',title:'Coastal Flood Warning',body:'Official event update',status:'delivered',createdAt:100,sentAt:110});
  assert.equal(data.items[1].status,'not_delivered');
  assert.deepEqual(data.thresholdItems.map(item=>item.channel),['app','email']);
  assert.equal(data.thresholdItems[0].title,'Observed water level threshold reached');
  assert.equal(JSON.stringify(data).includes('subscriber-private-id'),false);
  assert.equal(JSON.stringify(data).includes('push.example'),false);
  assert.match(calls.find(call=>call.sql.includes('push_delivery_queue')).sql,/device_id=\? AND status IN \('sent','failed'\).*LIMIT 20/);
});

test('notification history rejects missing credentials before querying D1',async()=>{
  const database=db(),deviceId='11111111-1111-4111-8111-111111111111';
  const req=new Request(`https://worker.example.test/push/devices/history?deviceId=${deviceId}`,{headers:{Origin:'https://nycguy.github.io'}});
  const response=await handlePushApi(req,env(database));assert.equal(response.status,401);assert.equal(database.calls.length,0);
});

test('invalid enrollment does not consume a rate-limit slot', async () => {
  const database = db();
  const response = await handlePushApi(request('/push/devices', { subscription: { ...subscription, endpoint: 'https://invalid.example/device' } }), env(database));
  assert.equal(response.status, 400);
  assert.equal(database.calls.length, 0);
});
test('unsupported push routes and methods do not touch the database', async () => {
  const database = db();
  const response = await handlePushApi(request('/push/unknown', { subscription }), env(database));
  assert.equal(response.status, 404);
  assert.equal(database.calls.length, 0);
});


test('test delivery fails closed when the platform client address is unavailable', async () => {
  const database = db();
  const req = request('/push/devices/test', { deviceId: '11111111-1111-4111-8111-111111111111' }, { 'CF-Connecting-IP': '', Authorization: 'Bearer ' + 'a'.repeat(64) });
  const response = await handlePushApi(req, { ...env(database), PUSH_EVENTS_ENABLED: 'true' });
  assert.equal(response.status, 503);
  assert.equal(database.calls.length, 0);
});


test('preference update accepts false selectors with valid device ownership', async () => {
  const database = db();
  const req = new Request('https://worker.example.test/push/devices/preferences', {
    method: 'PUT',
    headers: {
      Origin: 'https://nycguy.github.io',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + 'a'.repeat(64),
    },
    body: JSON.stringify({
      deviceId: '11111111-1111-4111-8111-111111111111',
      preferences: { starts: false, ends: false, changes: false },
    }),
  });
  const response = await handlePushApi(req, env(database));
  assert.equal(response.status, 200);
  assert.match(database.calls.at(-1).sql, /UPDATE push_devices SET event_prefs_json/);
  assert.equal(database.calls.at(-1).args[0], JSON.stringify({ starts: false, ends: false, changes: false }));
});


test('threshold preference endpoint accepts App-only custom thresholds', async () => {
  const calls=[];
  const database={
    prepare(sql){const call={sql,args:[]};calls.push(call);return{
      bind(...args){call.args=args;return this;},
      async first(){
        if(sql.startsWith('SELECT id FROM push_devices')) return {id:'11111111-1111-4111-8111-111111111111'};
        if(sql.startsWith('SELECT linked_subscriber_id')) return null;
        return null;
      },
      async run(){return {meta:{changes:1}};}
    };}
  };
  const preferences={metrics:{
    waterObserved:{enabled:false,threshold:12},waterForecast:{enabled:false,threshold:12},wind:{enabled:false,threshold:30},
    gust:{enabled:false,threshold:45},tempHigh:{enabled:true,threshold:85},tempLow:{enabled:false,threshold:32}
  },channels:{push:true,email:false}};
  const req=new Request('https://worker.example.test/push/devices/thresholds',{method:'PUT',headers:{Origin:'https://nycguy.github.io','Content-Type':'application/json',Authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify({deviceId:'11111111-1111-4111-8111-111111111111',preferences})});
  const response=await handlePushApi(req,env(database));
  assert.equal(response.status,200);
  assert.equal((await response.json()).emailConfirmationRequired,false);
  assert.equal(calls.some(call=>/push_threshold_preferences/.test(call.sql)),true);
});

test('changing linked threshold delivery keeps App channels independent across devices', async () => {
  const calls=[];
  const currentId='11111111-1111-4111-8111-111111111111';
  const rows=[
    {device_id:currentId,prefs_json:JSON.stringify({metrics:{},channels:{push:true,email:true}})},
    {device_id:'22222222-2222-4222-8222-222222222222',prefs_json:JSON.stringify({metrics:{},channels:{push:false,email:true}})},
  ];
  const database={
    prepare(sql){const call={sql,args:[]};calls.push(call);return{
      bind(...args){call.args=args;return this;},
      async first(){
        if(sql.startsWith('SELECT id FROM push_devices')) return {id:currentId};
        if(sql.startsWith('SELECT linked_subscriber_id')) return {linked_subscriber_id:'subscriber-1'};
        if(sql.startsWith('SELECT id,email,prefs_json')) return {id:'subscriber-1',email:'person@example.com',email_confirmed:1,unsubscribed:0,prefs_json:'{}'};
        return null;
      },
      async all(){return {results:rows};},
      async run(){return {meta:{changes:1}};}
    };}
  };
  const preferences={metrics:{
    waterObserved:{enabled:false,threshold:12},waterForecast:{enabled:false,threshold:12},wind:{enabled:false,threshold:30},
    gust:{enabled:false,threshold:45},tempHigh:{enabled:true,threshold:85},tempLow:{enabled:false,threshold:32}
  },channels:{push:true,email:false}};
  const req=new Request('https://worker.example.test/push/devices/thresholds',{method:'PUT',headers:{Origin:'https://nycguy.github.io','Content-Type':'application/json',Authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify({deviceId:currentId,preferences})});
  const response=await handlePushApi(req,{...env(database),PUSH_API_ENABLED:'true'});
  assert.equal(response.status,200);
  assert.equal((await response.json()).linkedEmail,'person@example.com');
  const updates=calls.filter(call=>call.sql.startsWith('UPDATE push_threshold_preferences'));
  assert.equal(updates.length,2);
  assert.deepEqual(JSON.parse(updates[0].args[0]).channels,{push:true,email:false});
  assert.deepEqual(JSON.parse(updates[1].args[0]).channels,{push:false,email:false});
});


test('authenticated device can request one-time email confirmation for Both delivery', async () => {
  const calls=[];
  const database={
    prepare(sql){const call={sql,args:[]};calls.push(call);return{
      bind(...args){call.args=args;return this;},
      async first(){
        if(sql.startsWith('SELECT id FROM push_devices')) return {id:'11111111-1111-4111-8111-111111111111'};
        if(sql.startsWith('SELECT linked_subscriber_id')) return null;
        return null;
      },
      async run(){return {meta:{changes:1}};}
    };}
  };
  const preferences={metrics:{
    waterObserved:{enabled:false,threshold:12},waterForecast:{enabled:false,threshold:12},wind:{enabled:false,threshold:30},
    gust:{enabled:false,threshold:45},tempHigh:{enabled:true,threshold:85},tempLow:{enabled:false,threshold:32}
  },channels:{push:true,email:true}};
  const previousFetch=globalThis.fetch;
  const deliveries=[];
  globalThis.fetch=async (url,options)=>{deliveries.push({url:String(url),options});return new Response('{}',{status:202,headers:{'content-type':'application/json'}});};
  try{
    const req=new Request('https://worker.example.test/push/devices/thresholds/email',{
      method:'POST',
      headers:{Origin:'https://nycguy.github.io','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.20',Authorization:'Bearer '+'a'.repeat(64)},
      body:JSON.stringify({deviceId:'11111111-1111-4111-8111-111111111111',email:'person@example.com',preferences})
    });
    const response=await handlePushApi(req,{...env(database),PUSH_API_ENABLED:'true',RESEND_API_KEY:'secret',FROM_EMAIL:'SacoCast <alerts@example.org>',WORKER_PUBLIC_URL:'https://worker.example.test',SUPPORT_EMAIL:'support@example.org'});
    assert.equal(response.status,202);
    assert.equal((await response.json()).confirmationSent,true);
    assert.equal(deliveries.length,1);
    assert.equal(deliveries[0].url,'https://api.resend.com/emails');
    assert.equal(calls.some(call=>/purpose,payload_json,expires_at/.test(call.sql)),true);
  }finally{globalThis.fetch=previousFetch;}
});
