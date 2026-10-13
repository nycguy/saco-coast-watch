const deviceId = '11111111-1111-4111-8111-111111111111';
const credentialHash = 'c'.repeat(64);
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerDevice, setDevicePreferences, getDevicePreferences, disableDevice } from '../src/push-device-store.mjs';
import { validSubscription } from './fixtures.mjs';
const subscription = { ...validSubscription, endpoint: 'https://web.push.apple.com/device' };
function mockDb(existing = null, changes = 1) {
  const calls = [];
  return { calls, prepare(sql) { const call = { sql, args: [] }; calls.push(call); return { bind(...args) { call.args = args; return this; }, async first() { return existing; }, async run() { return { meta: { changes } }; } }; } };
}
test('new browser subscription is stored without an email subscriber record', async () => {
  const db = mockDb();
  const result = await registerDevice(db, subscription, null, 100, { id: deviceId, tokenHash: credentialHash });
  assert.equal(result.id, deviceId);
  assert.deepEqual(result.preferences, { starts: true, ends: true, changes: true });
  assert.match(db.calls[0].sql, /^INSERT INTO push_devices/);
  assert.equal(db.calls[0].args[5], JSON.stringify(result.preferences));
});
test('duplicate endpoint does not replace existing ownership token', async () => {
  const db = mockDb(null, 0);
  assert.deepEqual(await registerDevice(db, subscription, null, 100, { id: deviceId, tokenHash: credentialHash }), { conflict: true });
  assert.equal(db.calls.length, 1);
});
test('invalid subscriptions never touch database', async () => {
  const db = mockDb();
  assert.equal(await registerDevice(db, { ...subscription, endpoint: 'http://example.com' }, null, 100, { id: deviceId, tokenHash: credentialHash }), null);
  assert.equal(db.calls.length, 0);
});
test('preference changes and disabling require matching credential hash', async () => {
  const db = mockDb(null, 1);
  assert.equal(await setDevicePreferences(db, deviceId, credentialHash, { ends: false }, 101), true);
  assert.equal(await disableDevice(db, deviceId, credentialHash, 102), true);
  assert.match(db.calls[0].sql, /WHERE id=\? AND token_hash=\?/);
  assert.match(db.calls[1].sql, /DELETE FROM push_devices WHERE id=\? AND token_hash=\?/);
  assert.equal(await disableDevice(mockDb(null, 0), deviceId, 'd'.repeat(64), 102), false);
});
test('reading preferences requires the owner token and returns stored choices', async()=>{
  const prefs={starts:false,ends:true,changes:false};
  const db=mockDb({event_prefs_json:JSON.stringify(prefs)});
  assert.deepEqual(await getDevicePreferences(db,deviceId,credentialHash),prefs);
  assert.match(db.calls[0].sql,/WHERE id=\? AND token_hash=\? AND enabled=1/);
  assert.equal(await getDevicePreferences(mockDb(null),deviceId,credentialHash),null);
});

test('invalid device credentials are rejected before database access', async () => {
  const db = mockDb();
  assert.equal(await registerDevice(db, subscription, null, 100, { id: 'invalid', tokenHash: credentialHash }), null);
  assert.equal(await setDevicePreferences(db, deviceId, 'invalid', {}, 100), false);
  assert.equal(await disableDevice(db, 'invalid', credentialHash, 100), false);
  assert.equal(db.calls.length, 0);
});

test('an endpoint conflict cannot overwrite the prior device', async () => {
  const db = mockDb(null, 0);
  const result = await registerDevice(db, subscription, { starts: false }, 103, { id: deviceId, tokenHash: credentialHash });
  assert.deepEqual(result, { conflict: true });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /ON CONFLICT\(endpoint\) DO NOTHING/);
});

test('an unsuccessful insert is not reported as enrolled', async () => {
  const db = mockDb(null, 0);
  const result = await registerDevice(db, subscription, null, 104, { id: deviceId, tokenHash: credentialHash });
  assert.notEqual(result?.id, deviceId);
});
