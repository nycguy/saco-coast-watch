import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { validSubscription } from './fixtures.mjs';
import { webcrypto } from 'node:crypto';

const origin = 'https://nycguy.github.io';
const env = { ALLOWED_ORIGIN: origin, PUSH_API_ENABLED: 'false' };

test('push preflight permits only configured origin', async () => {
  const request = new Request('https://alerts.example.test/push/devices', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('push preflight denies an unrelated origin', async () => {
  const request = new Request('https://alerts.example.test/push/devices', { method: 'OPTIONS', headers: { Origin: 'https://attacker.example' } });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('disabled push API is not activated by a valid browser request', async () => {
  const request = new Request('https://alerts.example.test/push/devices', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});

test('push config returns the public VAPID key only for the configured site origin', async () => {
  const request = new Request('https://alerts.example.test/push/config', { method: 'GET', headers: { Origin: origin } });
  const DB={prepare:()=>({all:async()=>({results:[]})})};
  const response = await worker.fetch(request, { ...env, DB, PUSH_API_ENABLED: 'true', PUSH_EVENTS_ENABLED: 'true', VAPID_PUBLIC_KEY: validSubscription.keys.p256dh });
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.publicKey, validSubscription.keys.p256dh);
  assert.equal(config.thresholdsEnabled, true);
});

test('push config is denied to unrelated origins', async () => {
  const request = new Request('https://alerts.example.test/push/config', { method: 'GET', headers: { Origin: 'https://attacker.example' } });
  const DB={prepare:()=>({all:async()=>({results:[]})})};
  const response = await worker.fetch(request, { ...env, DB, PUSH_API_ENABLED: 'true', PUSH_EVENTS_ENABLED: 'true', VAPID_PUBLIC_KEY: validSubscription.keys.p256dh });
  assert.equal(response.status, 403);
});

test('10-minute scheduled Worker evaluates an opted-in App threshold with one shared source pass', async () => {
  const now = Date.now(), iso = new Date(now).toISOString(), date = iso.slice(2, 10).replaceAll('-', ' '), clock = iso.slice(11, 16).replace(':', ' ');
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const device = { id: '11111111-1111-4111-8111-111111111111', endpoint: validSubscription.endpoint, p256dh: validSubscription.keys.p256dh, auth: validSubscription.keys.auth, prefs_json: JSON.stringify({ metrics: { waterObserved: { enabled: true, threshold: 12 } }, channels: { push: true, email: false } }) };
  const calls = [], sent = [], state = new Map();
  const DB = { prepare(sql) {
    const entry = { sql, args: [] }; calls.push(entry);
    return { bind(...args) { entry.args = args; return this; }, async all() {
      if (sql.includes('SELECT d.id,d.endpoint')) return { results: [device] };
      if (sql.includes('SELECT event_key,active,fingerprint')) return { results: [] };
      if (sql.includes('SELECT q.id,q.device_id')) return { results: [] };
      return { results: [] };
    }, async first() {
      if (sql.includes('request_limits')) return null;
      if (sql.includes('SELECT 1 AS opted_in')) return { opted_in: 1 };
      if (sql.includes('SELECT active FROM coastal_event_snapshots')) return null;
      if (sql.includes('SELECT active,last_sent')) return state.get(`${entry.args[0]}:${entry.args[1]}`) || null;
      return null;
    }, async run() {
      if (sql.includes('INSERT INTO alert_state')) state.set(`${entry.args[0]}:${entry.args[1]}`, { active: entry.args[2], last_sent: entry.args[3] });
      return { meta: { changes: 1 } };
    } };
  } };
  const before = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input)); calls.push({ url: url.href });
    if (url.hostname === 'api.tidesandcurrents.noaa.gov') {
      const model = url.searchParams.get('product') === 'ofs_water_level';
      return Response.json({ data: [{ t: model ? new Date(now + 3_600_000).toISOString().slice(0, 16).replace('T', ' ') : iso.slice(0, 16).replace('T', ' '), v: model ? '9.1' : '12.5' }] });
    }
    if (url.hostname === 'www.ndbc.noaa.gov') return new Response(`#YY MM DD hh mm WSPD GST\n${date} ${clock} 4 8\n`);
    if (url.hostname === 'api.weather.gov' && url.pathname.startsWith('/stations/')) return Response.json({ properties: { timestamp: iso, temperature: { value: 2 } } });
    if (url.hostname === 'api.weather.gov') return Response.json({ type: 'FeatureCollection', features: [] }, { headers: { Date: new Date(now).toUTCString() } });
    sent.push(url.href);
    return new Response(null, { status: 201 });
  };
  try {
    let scheduled;
    worker.scheduled({}, { DB, TOKEN_SECRET: 'x'.repeat(40), PUSH_API_ENABLED: 'true', PUSH_EVENTS_ENABLED: 'true', VAPID_PUBLIC_KEY: Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'), VAPID_PRIVATE_KEY: jwk.d, SUPPORT_EMAIL: 'alerts@example.org' }, { waitUntil(promise) { scheduled = promise; } });
    const results = await scheduled;
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(results[1].value.sent, 1);
    assert.deepEqual(sent, [validSubscription.endpoint]);
    assert.equal(calls.filter(call => call.url?.includes('tidesandcurrents')).length, 2);
    assert.equal(calls.filter(call => call.url?.includes('ndbc.noaa.gov')).length, 1);
    assert.equal(calls.filter(call => call.url?.includes('stations/KPWM')).length, 1);
    assert.equal(state.get(`${device.id}:waterObserved`).active, 1);
  } finally { globalThis.fetch = before; }
});
