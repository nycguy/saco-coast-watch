import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { evaluatePushThresholds, formatThresholdPushBody } from '../src/push-threshold-checks.mjs';
import { defaultThresholdMetrics, THRESHOLD_SPECS } from '../src/threshold-preferences.mjs';
import { validSubscription } from './fixtures.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
function prefs({ push = true, email = false, metrics = ['waterObserved'] } = {}) {
  const selected = defaultThresholdMetrics();
  for (const metric of metrics) selected[metric] = { enabled: true, threshold: metric === 'tempLow' ? 32 : 12 };
  return JSON.stringify({ metrics: selected, channels: { push, email } });
}
function fakeDb(devices = [{ id: ID, endpoint: validSubscription.endpoint, p256dh: validSubscription.keys.p256dh, auth: validSubscription.keys.auth, prefs_json: prefs() }]) {
  const states = new Map(), calls = [], deleted = [];
  return {
    states, calls, deleted,
    prepare(sql) {
      const call = { sql, args: [] }; calls.push(call);
      return {
        bind(...args) { call.args = args; return this; },
        async all() { return { results: devices }; },
        async first() {
          if (sql.includes('SELECT active,last_sent')) return states.get(`${call.args[0]}:${call.args[1]}`) || null;
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO alert_state')) states.set(`${call.args[0]}:${call.args[1]}`, { active: call.args[2], last_sent: call.args[3] });
          if (sql.includes('DELETE FROM push_devices')) deleted.push(call.args[0]);
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}
async function vapidPair() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  return { VAPID_PUBLIC_KEY: Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'), VAPID_PRIVATE_KEY: jwk.d, SUPPORT_EMAIL: 'alerts@example.org' };
}
const water = { waterObserved: { value: 12, time: '2026-10-14T12:00:00.000Z', source: 'NOAA Portland station 8418150; ft MLLW', kind: 'observation' } };

test('scheduled threshold push sends for app-only preference and stores crossing state', async () => {
  const DB = fakeDb(), env = { ...await vapidPair(), DB }, before = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return new Response(null, { status: 201 }); };
  try {
    const result = await evaluatePushThresholds(env, water, 1_800_000_000);
    assert.deepEqual(result, { devicesScanned: 1, attempted: 1, sent: 1, expired: 0, failed: 0 });
    assert.equal(DB.states.get(`${ID}:waterObserved`).active, 1);
    assert.equal(request.url, validSubscription.endpoint);
    assert.equal(new Headers(request.options.headers).get('Content-Encoding'), 'aes128gcm');
  } finally { globalThis.fetch = before; }
});

test('active crossing does not repeat and missing readings never clear its state', async () => {
  const DB = fakeDb(), env = { ...await vapidPair(), DB }, before = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('unexpected push'); };
  try {
    DB.states.set(`${ID}:waterObserved`, { active: 1, last_sent: 1000 });
    assert.equal((await evaluatePushThresholds(env, water, 2000)).attempted, 0);
    assert.equal((await evaluatePushThresholds(env, {}, 3000)).attempted, 0);
    assert.equal(DB.states.get(`${ID}:waterObserved`).active, 1);
  } finally { globalThis.fetch = before; }
});

test('push failure leaves the crossing retryable; provider expiry removes only the device', async () => {
  const DB = fakeDb(), env = { ...await vapidPair(), DB }, before = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  try {
    const failed = await evaluatePushThresholds(env, water, 1_800_000_000);
    assert.equal(failed.failed, 1);
    assert.equal(DB.states.has(`${ID}:waterObserved`), false);
    globalThis.fetch = async () => new Response(null, { status: 410 });
    const expired = await evaluatePushThresholds(env, water, 1_800_000_600);
    assert.equal(expired.expired, 1);
    assert.deepEqual(DB.deleted, [ID]);
    assert.equal(DB.states.has(`${ID}:waterObserved`), false);
  } finally { globalThis.fetch = before; }
});

test('email-only or invalid preferences never cause an app push', async () => {
  const DB = fakeDb([
    { id: ID, endpoint: validSubscription.endpoint, p256dh: validSubscription.keys.p256dh, auth: validSubscription.keys.auth, prefs_json: prefs({ push: false, email: true }) },
    { id: '22222222-2222-4222-8222-222222222222', endpoint: validSubscription.endpoint, p256dh: validSubscription.keys.p256dh, auth: validSubscription.keys.auth, prefs_json: '{bad json' },
  ]);
  const result = await evaluatePushThresholds({ DB }, water, 1_800_000_000);
  assert.equal(result.devicesScanned, 2);
  assert.equal(result.attempted, 0);
  assert.equal(DB.calls.some(call => call.sql.includes('INSERT INTO alert_state')), false);
});

test('a downward temperature threshold uses the inclusive boundary', async () => {
  const DB = fakeDb([{ id: ID, endpoint: validSubscription.endpoint, p256dh: validSubscription.keys.p256dh, auth: validSubscription.keys.auth, prefs_json: prefs({ metrics: ['tempLow'] }) }]);
  const before = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 201 }); };
  try {
    const result = await evaluatePushThresholds({ ...await vapidPair(), DB }, { tempLow: { value: 32, time: '2026-10-14T12:00:00.000Z', source: 'NWS KPWM; °F', kind: 'observation' } }, 1_800_000_000);
    assert.equal(result.sent, 1);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = before; }
});

test('model-water threshold notification identifies guidance separately from observations', () => {
  const body = formatThresholdPushBody(THRESHOLD_SPECS.find(spec => spec.id === 'waterForecast'), {
    value: 12.4, time: '2026-10-14T12:00:00.000Z', source: 'NOAA Portland station 8418150; ft MLLW', kind: 'model forecast peak, next 72 hours',
  }, 12);
  assert.match(body, /NOAA model guidance/);
  assert.doesNotMatch(body, /Observation/);
  assert.match(body, /2026-10-14T12:00:00\.000Z UTC/);
});
