/** SacoCast Web Push enrollment helpers. Never request permission on page load. */
export function pushCapability({ secureContext, serviceWorker, pushManager, notification, userAgent = '', touchPoints = 0, standalone = false } = {}) {
  if (!secureContext) return { supported: false, reason: 'Secure HTTPS connection required' };
  const appleMobile = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1);
  if (appleMobile && !standalone) return { supported: false, reason: 'On iPhone or iPad, add SacoCast to your Home Screen, then open it there to turn on notifications' };
  if (!serviceWorker || !pushManager || !notification) return { supported: false, reason: 'Push notifications are unavailable in this browser' };
  if (notification.permission === 'denied') return { supported: false, reason: 'Notifications are blocked in browser settings' };
  return { supported: true, reason: null };
}

export function decodeVapidPublicKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{87,88}$/.test(value)) throw new TypeError('Invalid VAPID public key');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  if (raw.length !== 65 || raw.charCodeAt(0) !== 4) throw new TypeError('Invalid VAPID P-256 key');
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

export async function enrollPushFromGesture({ serviceWorker, notification, vapidPublicKey, saveSubscription }) {
  if (!serviceWorker || !notification || typeof saveSubscription !== 'function') throw new TypeError('Push setup unavailable');
  // Caller must invoke this directly from a deliberate user click/tap.
  const permission = await notification.requestPermission();
  if (permission !== 'granted') return { enrolled: false, reason: 'permission-not-granted' };
  const registration = await serviceWorker.register('./push-sw.js', { scope: './' });
  const prior = await registration.pushManager.getSubscription();
  const subscription = prior || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidPublicKey(vapidPublicKey) });
  try {
    await saveSubscription(subscription.toJSON());
  } catch (error) {
    // Do not leave an unregistered subscription behind if the server rejects it.
    if (!prior) await subscription.unsubscribe();
    throw error;
  }
  return { enrolled: true };
}

const API = 'https://saco-coastal-alerts.mikewiley-nyc.workers.dev';
const CREDENTIAL_KEY = 'sacocast.push.device.v1';
export function readPushCredential(storage = localStorage) {
  try { const value = JSON.parse(storage.getItem(CREDENTIAL_KEY) || 'null'); return value && typeof value.deviceId === 'string' && /^[0-9a-f-]{36}$/i.test(value.deviceId) && /^[0-9a-f]{64}$/.test(value.token) ? value : null; }
  catch (_) { return null; }
}
async function api(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(API + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Notification service returned ${response.status}`);
  return data;
}
export async function enrollCoastalNotifications({ serviceWorker = navigator.serviceWorker, notification = window.Notification, storage = localStorage, onSave }) {
  // Must be called from a direct click or tap. No page-load permission request.
  const config = await api('/push/config');
  const result = await enrollPushFromGesture({
    serviceWorker, notification, vapidPublicKey: config.publicKey,
    saveSubscription: async (subscription) => {
      const preferences = { starts: true, ends: true, changes: true };
      const registered = await api('/push/devices', { method: 'POST', body: { subscription, preferences } });
      storage.setItem(CREDENTIAL_KEY, JSON.stringify({ deviceId: registered.deviceId, token: registered.token }));
      if (onSave) onSave(preferences);
    },
  });
  return result;
}
export async function updateCoastalNotificationPreferences(preferences, { storage = localStorage } = {}) {
  const credential = readPushCredential(storage);
  if (!credential) throw new Error('This browser does not have the saved notification control token. Turn notifications off, then enroll again.');
  await api('/push/devices/preferences', { method: 'PUT', body: { deviceId: credential.deviceId, preferences }, token: credential.token });
}
export async function getCoastalNotificationPreferences({ storage = localStorage } = {}) {
  const credential = readPushCredential(storage);
  if (!credential) return null;
  const result = await api(`/push/devices/preferences?deviceId=${encodeURIComponent(credential.deviceId)}`, { token: credential.token });
  return result.preferences;
}
export async function sendCoastalTestNotification({ storage = localStorage } = {}) {
  const credential = readPushCredential(storage);
  if (!credential) throw new Error('This browser does not have the saved notification control token.');
  return api('/push/devices/test', { method: 'POST', body: { deviceId: credential.deviceId }, token: credential.token });
}
export async function disableCoastalNotifications({ serviceWorker = navigator.serviceWorker, storage = localStorage } = {}) {
  const credential = readPushCredential(storage);
  if (credential) await api('/push/devices/disable', { method: 'POST', body: { deviceId: credential.deviceId }, token: credential.token });
  const registration = await serviceWorker.getRegistration('./');
  const subscription = await registration?.pushManager?.getSubscription();
  if (subscription) await subscription.unsubscribe();
  storage.removeItem(CREDENTIAL_KEY);
}
