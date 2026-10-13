/** Stateless bearer credential helpers for browser push device ownership. */
const utf8 = new TextEncoder();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export function createDeviceCredential() {
  return { id: crypto.randomUUID(), token: hex(crypto.getRandomValues(new Uint8Array(32))) };
}
export async function hashDeviceToken(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(token))));
}
export function parseDeviceAuthorization(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([0-9a-f]{64})$/.exec(header);
  return match ? match[1] : null;
}
export function validDeviceId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
