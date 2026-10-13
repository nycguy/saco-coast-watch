import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceCredential, hashDeviceToken, parseDeviceAuthorization, validDeviceId } from '../src/push-auth.mjs';

test('generates independent cryptographically random device credentials', () => {
  const a = createDeviceCredential();
  const b = createDeviceCredential();
  assert.equal(validDeviceId(a.id), true);
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.token, b.token);
});
test('hashes bearer tokens without storing raw secrets', async () => {
  const token = 'a'.repeat(64);
  const hash = await hashDeviceToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(await hashDeviceToken('invalid'), null);
});
test('strict bearer parsing and device ID validation', () => {
  const token = 'b'.repeat(64);
  assert.equal(parseDeviceAuthorization('Bearer ' + token), token);
  for (const value of ['bearer ' + token, 'Bearer invalid', 'Bearer ' + token + ' extra', null]) {
    assert.equal(parseDeviceAuthorization(value), null);
  }
  assert.equal(validDeviceId('not-a-device'), false);
});
