import { validatePushSubscription, validateEventPreferences } from './push-validation.mjs';
import { defaultThresholdMetrics, normalizeThresholdPreferences } from './threshold-preferences.mjs';

function validCredential(id, tokenHash) {
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) && typeof tokenHash === 'string' && /^[0-9a-f]{64}$/.test(tokenHash);
}

export async function registerDevice(db, subscriptionData, preferenceData, now, credential) {
  const subscription = validatePushSubscription(subscriptionData);
  const preferences = validateEventPreferences(preferenceData);
  if (!subscription || !preferences || !Number.isSafeInteger(now)) return null;
  if (typeof credential !== 'object' || !credential) return null;
  const { id, tokenHash } = credential;
  if (!validCredential(id, tokenHash)) return null;
  const result = await db.prepare('INSERT INTO push_devices(id,endpoint,p256dh,auth,token_hash,event_prefs_json,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(endpoint) DO NOTHING')
    .bind(id, subscription.endpoint, subscription.p256dh, subscription.auth, tokenHash, JSON.stringify(preferences), now, now).run();
  if (result.meta?.changes !== 1) return { conflict: true };
  return { id, preferences };
}

export async function setDevicePreferences(db, id, tokenHash, preferencesData, now) {
  const preferences = validateEventPreferences(preferencesData);
  if (!preferences || !Number.isSafeInteger(now) || !validCredential(id, tokenHash)) return false;
  const result = await db.prepare('UPDATE push_devices SET event_prefs_json=?,updated_at=? WHERE id=? AND token_hash=? AND enabled=1')
    .bind(JSON.stringify(preferences), now, id, tokenHash).run();
  return result.meta?.changes === 1;
}

export async function getDevicePreferences(db, id, tokenHash) {
  if (!validCredential(id, tokenHash)) return null;
  const row = await db.prepare('SELECT event_prefs_json FROM push_devices WHERE id=? AND token_hash=? AND enabled=1').bind(id, tokenHash).first();
  if (!row) return null;
  try { return validateEventPreferences(JSON.parse(row.event_prefs_json)); }
  catch (_) { return null; }
}

export async function disableDevice(db, id, tokenHash, now) {
  if (!Number.isSafeInteger(now) || !validCredential(id, tokenHash)) return false;
  const result = await db.prepare('DELETE FROM push_devices WHERE id=? AND token_hash=? AND enabled=1')
    .bind(id, tokenHash).run();
  return result.meta?.changes === 1;
}


export async function getDeviceThresholdPreferences(db, id, tokenHash) {
  if (!validCredential(id, tokenHash)) return null;
  const row = await db.prepare(
    "SELECT p.prefs_json,p.linked_subscriber_id,s.email FROM push_devices d LEFT JOIN push_threshold_preferences p ON p.device_id=d.id LEFT JOIN subscribers s ON s.id=p.linked_subscriber_id AND s.email_confirmed=1 AND s.unsubscribed=0 WHERE d.id=? AND d.token_hash=? AND d.enabled=1"
  ).bind(id, tokenHash).first();
  if (!row) return null;
  let preferences = { metrics: defaultThresholdMetrics(), channels: { push: false, email: false } };
  if (row.prefs_json) {
    try { preferences = normalizeThresholdPreferences(JSON.parse(row.prefs_json)) || preferences; } catch (_) {}
  }
  return {
    preferences,
    linkedSubscriberId: typeof row.linked_subscriber_id === 'string' ? row.linked_subscriber_id : null,
    linkedEmail: typeof row.email === 'string' ? row.email : null,
  };
}

export async function setDeviceThresholdPreferences(db, id, tokenHash, preferenceData, now) {
  const preferences = normalizeThresholdPreferences(preferenceData);
  if (!preferences || !Number.isSafeInteger(now) || !validCredential(id, tokenHash)) return null;
  const owned = await db.prepare('SELECT id FROM push_devices WHERE id=? AND token_hash=? AND enabled=1').bind(id, tokenHash).first();
  if (!owned) return null;
  const previous = await db.prepare('SELECT linked_subscriber_id FROM push_threshold_preferences WHERE device_id=?').bind(id).first();
  await db.prepare(
    'INSERT INTO push_threshold_preferences(device_id,linked_subscriber_id,prefs_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET prefs_json=excluded.prefs_json,updated_at=excluded.updated_at'
  ).bind(id, previous?.linked_subscriber_id || null, JSON.stringify(preferences), now).run();
  return { preferences, linkedSubscriberId: previous?.linked_subscriber_id || null };
}

export async function linkDeviceThresholdSubscriber(db, deviceId, subscriberId, preferenceData, now) {
  const preferences = normalizeThresholdPreferences(preferenceData);
  if (!preferences || !Number.isSafeInteger(now) || typeof subscriberId !== 'string' || !/^[0-9a-f-]{36}$/i.test(subscriberId)) return false;
  const device = await db.prepare('SELECT id FROM push_devices WHERE id=? AND enabled=1').bind(deviceId).first();
  if (!device) return false;
  await db.prepare(
    'INSERT INTO push_threshold_preferences(device_id,linked_subscriber_id,prefs_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET linked_subscriber_id=excluded.linked_subscriber_id,prefs_json=excluded.prefs_json,updated_at=excluded.updated_at'
  ).bind(deviceId, subscriberId, JSON.stringify(preferences), now).run();
  return true;
}
