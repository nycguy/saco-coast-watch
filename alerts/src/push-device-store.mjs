import { validatePushSubscription, validateEventPreferences } from './push-validation.mjs';

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
