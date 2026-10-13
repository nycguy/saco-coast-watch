import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePushSubscription, validateEventPreferences } from '../src/push-validation.mjs';
import { validSubscription as good } from './fixtures.mjs';
test('accepts structurally valid HTTPS subscription', () => {
  assert.deepEqual(validatePushSubscription(good), {
    endpoint: good.endpoint,
    p256dh: good.keys.p256dh,
    auth: good.keys.auth,
  });
});
test('rejects unsafe or malformed endpoints and keys', () => {
  for (const endpoint of ['http://fcm.googleapis.com/abc', 'javascript:alert(1)', 'https://user:pass@fcm.googleapis.com/', 'https://fcm.googleapis.com/#fragment', 'https://push.example.org/abc', 'not a URL', 'https://fcm.googleapis.com/' + 'x'.repeat(2100)]) {
    assert.equal(validatePushSubscription({ ...good, endpoint }), null);
  }
  assert.equal(validatePushSubscription({ ...good, keys: { p256dh: 'short', auth: good.keys.auth } }), null);
  assert.equal(validatePushSubscription({ ...good, keys: { ...good.keys, auth: 'abc' } }), null);
  assert.equal(validatePushSubscription({ ...good, keys: { ...good.keys, p256dh: Buffer.from([3, ...Array(64).fill(1)]).toString('base64url') } }), null);
  assert.equal(validatePushSubscription(null), null);
});
test('defaults new event preferences on, permits explicit opt out', () => {
  assert.deepEqual(validateEventPreferences(null), { starts: true, ends: true, changes: true });
  assert.deepEqual(validateEventPreferences({ ends: false }), { starts: true, ends: false, changes: true });
  assert.equal(validateEventPreferences({ starts: 'false' }), null);
  assert.equal(validateEventPreferences([]), null);
});

test('supports Apple and Mozilla notification gateways', () => {
  for (const endpoint of ['https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc']) {
    assert.equal(validatePushSubscription({ ...good, endpoint })?.endpoint, endpoint);
  }
});

test('accepts Microsoft WNS region endpoints without accepting arbitrary hosts', () => {
  assert.equal(validatePushSubscription({ ...good, endpoint: 'https://wns2-pn1p.notify.windows.com/w/?token=x' })?.endpoint, 'https://wns2-pn1p.notify.windows.com/w/?token=x');
  assert.equal(validatePushSubscription({ ...good, endpoint: 'https://notify.windows.com.attacker.example/device' }), null);
});
