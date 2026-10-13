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
