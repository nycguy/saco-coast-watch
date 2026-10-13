import test from 'node:test';
import assert from 'node:assert/strict';
import { pushCapability, decodeVapidPublicKey, enrollPushFromGesture } from '../../js/push-subscriptions.mjs';

test('push capability requires HTTPS and supported browser', () => {
  assert.equal(pushCapability({ secureContext: false }).supported, false);
  assert.equal(pushCapability({ secureContext: true, serviceWorker: {}, pushManager: {}, notification: { permission: 'denied' } }).supported, false);
  assert.equal(pushCapability({ secureContext: true, serviceWorker: {}, pushManager: {}, notification: { permission: 'default' } }).supported, true);
});
test('iPhone and touch iPad require an installed Home Screen app',()=>{
  const supported={secureContext:true,serviceWorker:{},pushManager:{},notification:{permission:'default'}};
  assert.match(pushCapability({...supported,userAgent:'Mozilla/5.0 (iPhone)',standalone:false}).reason,/Home Screen/);
  assert.match(pushCapability({...supported,userAgent:'Mozilla/5.0 (Macintosh)',touchPoints:5,standalone:false}).reason,/Home Screen/);
  assert.equal(pushCapability({...supported,userAgent:'Mozilla/5.0 (iPhone)',standalone:true}).supported,true);
});
test('VAPID public key must be uncompressed P-256', () => {
  const valid = Buffer.from([4, ...Array(64).fill(1)]).toString('base64url');
  assert.equal(decodeVapidPublicKey(valid).length, 65);
  for (const value of ['', 'x', 'not a key', Buffer.from([3, ...Array(64).fill(1)]).toString('base64url')]) {
    assert.throws(() => decodeVapidPublicKey(value), TypeError);
  }
});
test('permission denial cannot register or subscribe', async () => {
  let called = false;
  const result = await enrollPushFromGesture({
    serviceWorker: { register: async () => { called = true; } },
    notification: { requestPermission: async () => 'denied' },
    vapidPublicKey: '', saveSubscription: async () => {}
  });
  assert.equal(result.enrolled, false);
  assert.equal(called, false);
});
test('failed server enrollment unsubscribes to avoid orphaned registration', async () => {
  const key = Buffer.from([4, ...Array(64).fill(1)]).toString('base64url');
  let unsubscribed = false;
  const subscription = { toJSON: () => ({ endpoint: 'https://example.com' }), unsubscribe: async () => { unsubscribed = true; } };
  const serviceWorker = { register: async () => ({ pushManager: { getSubscription: async () => null, subscribe: async () => subscription } }) };
  await assert.rejects(enrollPushFromGesture({ serviceWorker, notification: { requestPermission: async () => 'granted' }, vapidPublicKey: key, saveSubscription: async () => { throw Error('server unavailable'); } }));
  assert.equal(unsubscribed, true);
});

test('failed server enrollment preserves an existing browser subscription', async () => {
  const key = Buffer.from([4, ...Array(64).fill(1)]).toString('base64url');
  let unsubscribed = false;
  const prior = { toJSON: () => ({ endpoint: 'https://web.push.apple.com/existing' }), unsubscribe: async () => { unsubscribed = true; } };
  const serviceWorker = { register: async () => ({ pushManager: { getSubscription: async () => prior, subscribe: async () => { throw Error('must not resubscribe'); } } }) };
  await assert.rejects(enrollPushFromGesture({ serviceWorker, notification: { requestPermission: async () => 'granted' }, vapidPublicKey: key, saveSubscription: async () => { throw Error('server unavailable'); } }));
  assert.equal(unsubscribed, false);
});
