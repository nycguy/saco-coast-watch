/** RFC 8291 aes128gcm payload encryption for Web Push (one final record). */
const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
async function hkdf(ikm, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}
function decode(value, expected) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('Invalid Web Push key');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (bytes.length !== expected) throw new TypeError('Invalid Web Push key length');
  return bytes;
}
export async function encryptWebPushPayload(subscription, payload, random = crypto) {
  const uaPublic = decode(subscription.p256dh, 65);
  const authSecret = decode(subscription.auth, 16);
  const receiver = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiver }, ephemeral.privateKey, 256));
  const ikm = await hkdf(shared, authSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = new Uint8Array(16); random.getRandomValues(salt);
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext = concat(typeof payload === 'string' ? enc.encode(payload) : payload, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, plaintext));
  // RFC 8188 header: salt, record size (4096), key-id length and ephemeral public key.
  const rs = new Uint8Array([0, 0, 16, 0]);
  return { body: concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext), salt: b64url(salt) };
}
