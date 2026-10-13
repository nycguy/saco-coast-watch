import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createVapidAuthorization } from '../src/vapid.mjs';

const b64 = bytes => Buffer.from(bytes).toString('base64url');
test('VAPID authorization signs the expected push-service audience with P-256', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const privateKey = Buffer.from(jwk.d, 'base64url');
  const authorization = await createVapidAuthorization('https://fcm.googleapis.com/fcm/send/x', b64(publicKey), b64(privateKey), 'mailto:alerts@example.org', 1000);
  const match = /^vapid t=([A-Za-z0-9_.-]+), k=(.+)$/.exec(authorization);
  assert.ok(match);
  const [header, claims, signature] = match[1].split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), { aud: 'https://fcm.googleapis.com', exp: 4600, sub: 'mailto:alerts@example.org' });
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${claims}`)), true);
});

test('VAPID rejects invalid private-key lengths and non-HTTPS audiences', async () => {
  const publicKey = Buffer.from([4, ...Array(64).fill(1)]).toString('base64url');
  await assert.rejects(createVapidAuthorization('http://fcm.googleapis.com/send/x', publicKey, 'AA', 'mailto:a@b.test'), /Invalid/);
});
