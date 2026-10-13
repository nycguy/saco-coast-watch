/** Validation of browser Web Push subscription payloads before any D1 write. */
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
// Never resolve or fetch user-supplied URLs outside approved push-service hosts.

export function validatePushSubscription(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { endpoint, keys } = payload;
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return null;
  let url;
  try { url = new URL(endpoint); } catch (_) { return null; }
  if (url.protocol !== 'https:' || !(PUSH_HOSTS.has(url.hostname) || url.hostname.endsWith('.notify.windows.com')) || url.port || url.username || url.password || url.hash) return null;
  if (typeof keys !== 'object' || !keys) return null;
  const { p256dh, auth } = keys;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{86,88}$/.test(p256dh) || !/^[A-Za-z0-9_-]{21,24}$/.test(auth)) return null;
  try {
    const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4-value.length%4)%4)), c => c.charCodeAt(0));
    const publicKey = decode(p256dh), authSecret = decode(auth);
    if (publicKey.length !== 65 || publicKey[0] !== 4 || authSecret.length !== 16) return null;
  } catch (_) { return null; }
  return { endpoint: url.href, p256dh, auth };
}

/** Explicitly allow only known event preferences. Missing keys use new-user defaults. */
export function validateEventPreferences(value) {
  if (value == null) return { starts: true, ends: true, changes: true };
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of ['starts', 'ends', 'changes']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') return null;
    result[key] = value[key] === undefined ? true : value[key];
  }
  return result;
}
