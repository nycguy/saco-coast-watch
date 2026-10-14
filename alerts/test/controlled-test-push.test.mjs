import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handlePushApi } from '../src/push-http.mjs';
import { hashDeviceToken } from '../src/push-auth.mjs';
import { validSubscription } from './fixtures.mjs';

const origin = 'https://nycguy.github.io';
const deviceId = '11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);
const tokenHash = await hashDeviceToken(token);
const device = {
  id: deviceId,
  endpoint: 'https://fcm.googleapis.com/fcm/send/this-device-only',
  p256dh: validSubscription.keys.p256dh,
  auth: validSubscription.keys.auth,
};

function makeDb({ registered = true, rateLimitChanges = 1 } = {}) {
  const calls = [];
  let nextRateLimitChanges = rateLimitChanges;
  const db = {
    calls,
    setRateLimitChanges(value) { nextRateLimitChanges = value; },
    prepare(sql) {
      const call = { sql, args: [] };
      calls.push(call);
      return {
        bind(...args) { call.args = args; return this; },
        async first() {
          if (sql.startsWith('SELECT id,endpoint,p256dh,auth FROM push_devices')) {
            return registered && call.args[0] === deviceId && call.args[1] === tokenHash ? { ...device } : null;
          }
          return null;
        },
        async run() { return { meta: { changes: nextRateLimitChanges } }; },
      };
    },
  };
  return db;
}

function request({ device = deviceId, bearer = token, ip = '192.0.2.55' } = {}) {
  return new Request('https://alerts.example.test/push/devices/test', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ deviceId: device }),
  });
}

function env(DB, extra = {}) {
  return {
    DB,
    ALLOWED_ORIGIN: origin,
    PUSH_API_ENABLED: 'true',
    PUSH_EVENTS_ENABLED: 'true',
    TOKEN_SECRET: 's'.repeat(32),
    VAPID_PUBLIC_KEY: validSubscription.keys.p256dh,
    VAPID_PRIVATE_KEY: 'unused-by-fixture',
    SUPPORT_EMAIL: 'alerts@example.org',
    ...extra,
  };
}

async function vapidKeys() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    public: Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'),
    private: privateJwk.d,
  };
}

test('test push requires the owner credential for an existing enabled device', async () => {
  const db = makeDb({ registered: false });
  let sends = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { sends++; return new Response(null, { status: 201 }); };
  try {
    const missing = await handlePushApi(request(), env(db));
    assert.equal(missing.status, 404);
    const wrongOwner = await handlePushApi(request({ bearer: 'b'.repeat(64) }), env(db));
    assert.equal(wrongOwner.status, 404);
    assert.equal(sends, 0);
  } finally { globalThis.fetch = previous; }
});

test('test push reaches only the authenticated device and reports provider acceptance', async () => {
  const db = makeDb();
  const previous = globalThis.fetch;
  const sentTo = [];
  const keys = await vapidKeys();
  globalThis.fetch = async (url, options) => {
    sentTo.push({ url: String(url), options });
    return new Response(null, { status: 201 });
  };
  try {
    const response = await handlePushApi(request(), env(db, { VAPID_PUBLIC_KEY: keys.public, VAPID_PRIVATE_KEY: keys.private }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sent: true });
    assert.equal(sentTo.length, 1);
    assert.equal(sentTo[0].url, device.endpoint);
    assert.equal(sentTo[0].options.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(db.calls.some(call => /push_delivery_queue|subscribers|push_subscriptions/.test(call.sql)), false);
  } finally { globalThis.fetch = previous; }
});

test('expired test subscription is deleted and returned as expired', async () => {
  const db = makeDb();
  const previous = globalThis.fetch;
  const keys = await vapidKeys();
  globalThis.fetch = async () => new Response(null, { status: 410 });
  try {
    const response = await handlePushApi(request(), env(db, { VAPID_PUBLIC_KEY: keys.public, VAPID_PRIVATE_KEY: keys.private }));
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), { error: 'This browser subscription has expired' });
    const deletion = db.calls.find(call => call.sql === 'DELETE FROM push_devices WHERE id=?');
    assert.deepEqual(deletion?.args, [deviceId]);
    assert.equal(db.calls.some(call => /DELETE FROM subscribers|push_subscriptions/.test(call.sql)), false);
  } finally { globalThis.fetch = previous; }
});

test('provider failures are bounded and do not expose provider details', async () => {
  const db = makeDb();
  const previous = globalThis.fetch;
  const keys = await vapidKeys();
  globalThis.fetch = async () => new Response('secret provider response', { status: 503 });
  try {
    const response = await handlePushApi(request(), env(db, { VAPID_PUBLIC_KEY: keys.public, VAPID_PRIVATE_KEY: keys.private }));
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, /provider did not accept/);
    assert.doesNotMatch(body, /secret provider response|VAPID|Bearer/);
    assert.equal(db.calls.some(call => call.sql === 'DELETE FROM push_devices WHERE id=?'), false);
  } finally { globalThis.fetch = previous; }
});

test('repeated test requests are rate limited before a second push is sent', async () => {
  const db = makeDb();
  const previous = globalThis.fetch;
  const keys = await vapidKeys();
  let sends = 0;
  globalThis.fetch = async () => { sends++; return new Response(null, { status: 201 }); };
  try {
    const first = await handlePushApi(request(), env(db, { VAPID_PUBLIC_KEY: keys.public, VAPID_PRIVATE_KEY: keys.private }));
    assert.equal(first.status, 200);
    db.setRateLimitChanges(0);
    const repeated = await handlePushApi(request(), env(db, { VAPID_PUBLIC_KEY: keys.public, VAPID_PRIVATE_KEY: keys.private }));
    assert.equal(repeated.status, 429);
    assert.equal(sends, 1);
  } finally { globalThis.fetch = previous; }
});
