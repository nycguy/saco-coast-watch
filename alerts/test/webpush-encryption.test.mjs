import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { encryptWebPushPayload } from '../src/webpush-encryption.mjs';

const enc = new TextEncoder();
const b64 = bytes => Buffer.from(bytes).toString('base64url');
async function hkdf(ikm, salt, info, length) {
  const key = await webcrypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await webcrypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

test('Web Push uses RFC 8291 ECDH/HKDF and aes128gcm record framing', async () => {
  const receiver = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await webcrypto.subtle.exportKey('raw', receiver.publicKey));
  const auth = new Uint8Array(16).fill(7);
  const encrypted = await encryptWebPushPayload({ p256dh: b64(uaPublic), auth: b64(auth) }, '{"kind":"start"}');
  const bytes = encrypted.body;
  assert.equal(bytes.length > 16 + 4 + 1 + 65 + 16, true);
  assert.deepEqual(Array.from(bytes.slice(16, 20)), [0, 0, 16, 0]);
  assert.equal(bytes[20], 65);
  const salt = bytes.slice(0, 16);
  const asPublicBytes = bytes.slice(21, 86);
  const asPublic = await webcrypto.subtle.importKey('raw', asPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await webcrypto.subtle.deriveBits({ name: 'ECDH', public: asPublic }, receiver.privateKey, 256));
  const ikm = await hkdf(shared, auth, new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublicBytes]), 32);
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await webcrypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const clear = new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, bytes.slice(86)));
  assert.equal(new TextDecoder().decode(clear), '{"kind":"start"}\u0002');
});
