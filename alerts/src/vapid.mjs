/** RFC 8292 VAPID authentication. Private key supplied only at runtime. */
const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const decode = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('Invalid key encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
};
export async function createVapidAuthorization(endpoint, publicKey, privateKey, subject, now = Math.floor(Date.now()/1000)) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !/^(mailto:|https:\/\/)/.test(subject)) throw new TypeError('Invalid VAPID audience or subject');
  const pub = decode(publicKey), secret = decode(privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || secret.length !== 32) throw new TypeError('Invalid VAPID keys');
  const jwk = { kty:'EC', crv:'P-256', x:b64(pub.slice(1,33)), y:b64(pub.slice(33)), d:b64(secret), ext:false };
  const key = await crypto.subtle.importKey('jwk', jwk, { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']);
  const unsigned = b64(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'}))) + '.' + b64(enc.encode(JSON.stringify({aud:url.origin,exp:now+3600,sub:subject})));
  const signature = new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(unsigned)));
  return 'vapid t=' + unsigned + '.' + b64(signature) + ', k=' + publicKey;
}
