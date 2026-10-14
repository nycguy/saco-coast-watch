import { createVapidAuthorization } from './vapid.mjs';
import { encryptWebPushPayload } from './webpush-encryption.mjs';
import { TEST_NOTIFICATION_URL } from './push-destinations.mjs';

const RETRY_SECONDS = [60, 300, 1800, 7200, 43200];
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
async function deliveryId(deviceId, event) {
  const value = `${deviceId}\0${event.eventKey}\0${event.kind}\0${event.fingerprint || ''}`;
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

export async function enqueuePushTransition(db, event, now) {
  const devices = await db.prepare('SELECT id,event_prefs_json FROM push_devices WHERE enabled=1').all();
  for (const device of devices.results || []) {
    let prefs;
    try { prefs = JSON.parse(device.event_prefs_json); } catch (_) { continue; }
    const preference = { start: 'starts', end: 'ends', change: 'changes' }[event.kind];
    if (!preference || prefs?.[preference] !== true) continue;
    const id = await deliveryId(device.id, event);
    const message = { application: 'SacoCast', eventId: await hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(event.eventKey)))), kind: event.kind, title: event.title, body: event.body, url: event.url };
    await db.prepare("INSERT OR IGNORE INTO push_delivery_queue(id,device_id,event_key,transition_kind,event_fingerprint,payload_json,status,attempts,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,'pending',0,?,?)")
      .bind(id, device.id, event.eventKey, event.kind, event.fingerprint || null, JSON.stringify(message), now, now).run();
  }
}

async function sendPush(endpoint, keys, message, env, now) {
  const subscription = { endpoint, p256dh: keys.p256dh, auth: keys.auth };
  const payload = await encryptWebPushPayload(subscription, typeof message === 'string' ? message : JSON.stringify(message));
  const subject = env.VAPID_SUBJECT || (env.SUPPORT_EMAIL ? `mailto:${env.SUPPORT_EMAIL}` : null);
  if (!subject) throw Object.assign(new Error('VAPID subject is not configured'), { retryable: false });
  const authorization = await createVapidAuthorization(endpoint, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, subject, now);
  return fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: authorization, TTL: '3600', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
    body: payload.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
}

async function sendOne(env, row, now) {
  const response = await sendPush(row.endpoint, { p256dh: row.p256dh, auth: row.auth }, row.payload_json, env, now);
  if (response.status === 404 || response.status === 410) {
    await env.DB.prepare('DELETE FROM push_devices WHERE id=?').bind(row.device_id).run();
    return 'expired';
  }
  if (response.status === 429 || response.status >= 500) throw Object.assign(new Error(`Push provider returned ${response.status}`), { retryable: true });
  if (!response.ok) throw Object.assign(new Error(`Push provider rejected delivery (${response.status})`), { retryable: false });
  await env.DB.prepare("UPDATE push_delivery_queue SET status='sent',sent_at=?,attempts=attempts+1,last_error=NULL WHERE id=? AND status='pending'").bind(now, row.id).run();
  return 'sent';
}

/** Explicit, owner-authenticated delivery check for a single enrolled device. */
export async function sendControlledTestPush(env, device, now = Math.floor(Date.now() / 1000)) {
  const message = createControlledTestPushMessage();
  const response = await sendPush(device.endpoint, { p256dh: device.p256dh, auth: device.auth }, message, env, now);
  if (response.status === 404 || response.status === 410) {
    await env.DB.prepare('DELETE FROM push_devices WHERE id=?').bind(device.id).run();
    return { sent: false, expired: true };
  }
  if (!response.ok) throw Object.assign(new Error(`Push provider returned ${response.status}`), { status: response.status });
  return { sent: true, expired: false };
}

export function createControlledTestPushMessage() {
  return { application: 'SacoCast', kind: 'test', eventId: '0'.repeat(64), title: 'SacoCast Test Notification', body: 'This confirms that Web Push reached this browser.', url: TEST_NOTIFICATION_URL };
}

/** Delivery is best-effort, bounded, deduplicated, and isolated from email processing. */
export async function deliverQueuedPush(env, now = Math.floor(Date.now() / 1000)) {
  if (env.PUSH_EVENTS_ENABLED !== 'true' || !env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return { pushAttempted: 0, pushSent: 0, pushDeferred: true };
  await env.DB.prepare("UPDATE push_delivery_queue SET status='cancelled',last_error='event update expired' WHERE status='pending' AND created_at<?").bind(now - 2 * 3600).run();
  await env.DB.prepare("DELETE FROM push_delivery_queue WHERE status IN ('sent','cancelled','failed') AND created_at<?").bind(now - 30 * 86400).run();
  const rows = await env.DB.prepare("SELECT q.id,q.device_id,q.payload_json,q.transition_kind,d.event_prefs_json,d.endpoint,d.p256dh,d.auth,q.attempts FROM push_delivery_queue q JOIN push_devices d ON d.id=q.device_id WHERE q.status='pending' AND q.next_attempt_at<=? AND d.enabled=1 ORDER BY q.created_at LIMIT 24").bind(now).all();
  let sent = 0, attempted = 0, expired = 0;
  for (const row of rows.results || []) {
    let prefs;
    try { prefs = JSON.parse(row.event_prefs_json); } catch (_) { prefs = {}; }
    const preference = { start: 'starts', end: 'ends', change: 'changes' }[row.transition_kind];
    if (!preference || prefs?.[preference] !== true) {
      await env.DB.prepare("UPDATE push_delivery_queue SET status='cancelled',last_error='preference disabled' WHERE id=? AND status='pending'").bind(row.id).run();
      continue;
    }
    attempted++;
    try { const result = await sendOne(env, row, now); if (result === 'sent') sent++; else expired++; }
    catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const retry = error.retryable === false ? null : RETRY_SECONDS[Math.min(attempts - 1, RETRY_SECONDS.length - 1)];
      const status = retry ? 'pending' : 'failed';
      const next = now + (retry || 0);
      await env.DB.prepare('UPDATE push_delivery_queue SET status=?,attempts=?,next_attempt_at=?,last_error=? WHERE id=? AND status=\'pending\'')
        .bind(status, attempts, next, String(error.message || 'Push delivery failed').slice(0, 240), row.id).run();
    }
  }
  return { pushAttempted: attempted, pushSent: sent, pushExpired: expired, pushDeferred: false };
}


/** Direct best-effort custom-threshold delivery. Failed sends leave threshold state unchanged so the next scheduled check can retry. */
export async function sendThresholdPush(env, device, message, now = Math.floor(Date.now() / 1000)) {
  const eventId = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('threshold\0' + device.id + '\0' + message.metric))));
  const payload = {
    application: 'SacoCast',
    kind: 'threshold',
    eventId,
    title: message.title,
    body: message.body,
    url: message.url,
  };
  const response = await sendPush(device.endpoint, { p256dh: device.p256dh, auth: device.auth }, payload, env, now);
  if (response.status === 404 || response.status === 410) {
    await env.DB.prepare('DELETE FROM push_devices WHERE id=?').bind(device.id).run();
    return { sent: false, expired: true };
  }
  if (!response.ok) throw Object.assign(new Error(`Push provider returned ${response.status}`), { status: response.status });
  return { sent: true, expired: false };
}
