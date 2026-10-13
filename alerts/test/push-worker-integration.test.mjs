import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { validSubscription } from './fixtures.mjs';

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
  assert.equal((await response.json()).publicKey, validSubscription.keys.p256dh);
});

test('push config is denied to unrelated origins', async () => {
  const request = new Request('https://alerts.example.test/push/config', { method: 'GET', headers: { Origin: 'https://attacker.example' } });
  const DB={prepare:()=>({all:async()=>({results:[]})})};
  const response = await worker.fetch(request, { ...env, DB, PUSH_API_ENABLED: 'true', PUSH_EVENTS_ENABLED: 'true', VAPID_PUBLIC_KEY: validSubscription.keys.p256dh });
  assert.equal(response.status, 403);
});
