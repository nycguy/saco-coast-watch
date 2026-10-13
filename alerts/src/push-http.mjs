import { createDeviceCredential, hashDeviceToken, parseDeviceAuthorization, validDeviceId } from './push-auth.mjs';
import { registerDevice, setDevicePreferences, getDevicePreferences, disableDevice, getDeviceThresholdPreferences, setDeviceThresholdPreferences } from './push-device-store.mjs';
import { validatePushSubscription, validateEventPreferences } from './push-validation.mjs';
import { normalizeThresholdPreferences } from './threshold-preferences.mjs';
import { sendControlledTestPush } from './push-delivery.mjs';
import { syncLinkedThresholdDevices } from './email-device-sync.mjs';

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const validEmail = value => typeof value === 'string' && value.length < 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}
async function digestHex(value) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
function randomHexToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
function maskedEmail(email) {
  const [local, domain] = email.split('@');
  return (local?.slice(0, 1) || '*') + '***@' + domain;
}
async function reserveRateLimit(env, tag, seconds = 600) {
  const now = Math.floor(Date.now() / 1000);
  const key = await hmacHex(env.TOKEN_SECRET, 'push-threshold:' + tag);
  const result = await env.DB.prepare("INSERT INTO request_limits(ip_hash,until_ts) VALUES(?,?) ON CONFLICT(ip_hash) DO UPDATE SET until_ts=excluded.until_ts WHERE request_limits.until_ts<?").bind(key, now + seconds, now).run();
  return result.meta?.changes === 1;
}
async function sendThresholdEmailConfirmation(env, email, rawToken) {
  const base = env.WORKER_PUBLIC_URL.replace(/\/$/, '');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [email],
      subject: 'Confirm SacoCast custom alert email delivery',
      text: 'Confirm email delivery for the custom thresholds selected in your SacoCast app:\n' + base + '/alerts/push-confirm?token=' + rawToken + '\n\nThe link expires in one hour. App notifications are managed separately on your device. This is not an official emergency-warning service.',
      reply_to: env.SUPPORT_EMAIL,
    }),
  });
  if (!response.ok) throw new Error('Email provider returned ' + response.status);
}

const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

export async function pushConfiguration(env) {
  if (env.PUSH_API_ENABLED !== 'true' || env.PUSH_EVENTS_ENABLED !== 'true' || !env.VAPID_PUBLIC_KEY || !env.DB) return reply({ enabled: false }, 503);
  try {
    const decoded = Uint8Array.from(atob(env.VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4-env.VAPID_PUBLIC_KEY.length%4)%4)), c => c.charCodeAt(0));
    if (!/^[A-Za-z0-9_-]{87,88}$/.test(env.VAPID_PUBLIC_KEY) || decoded.length !== 65 || decoded[0] !== 4) return reply({ enabled: false }, 503);
  } catch (_) { return reply({ enabled: false }, 503); }
  try { await env.DB.prepare('SELECT id FROM push_devices LIMIT 1').all(); }
  catch (_) { return reply({ enabled: false }, 503); }
  let thresholdsEnabled = false;
  try { await env.DB.prepare('SELECT device_id FROM push_threshold_preferences LIMIT 1').all(); thresholdsEnabled = true; }
  catch (_) { thresholdsEnabled = false; }
  return reply({ enabled: true, publicKey: env.VAPID_PUBLIC_KEY, thresholdsEnabled });
}

/** Explicit opt-in API. Caller must configure DB, ALLOWED_ORIGIN, and PUSH_API_ENABLED. */
export async function handlePushApi(req, env) {
  if (env.PUSH_API_ENABLED !== 'true' || !env.DB || !env.ALLOWED_ORIGIN) return reply({ error: 'Push enrollment unavailable' }, 503);
  if (req.headers.get('Origin') !== env.ALLOWED_ORIGIN) return reply({ error: 'Origin not allowed' }, 403);
  const path = new URL(req.url).pathname;
  const ip = req.headers.get('CF-Connecting-IP');
  if (path === '/push/devices/thresholds' && req.method === 'GET') {
    const deviceId = new URL(req.url).searchParams.get('deviceId');
    const token = parseDeviceAuthorization(req.headers.get('Authorization'));
    if (!validDeviceId(deviceId) || !token) return reply({ error: 'Unauthorized' }, 401);
    const result = await getDeviceThresholdPreferences(env.DB, deviceId, await hashDeviceToken(token));
    return result ? reply(result) : reply({ error: 'Not found' }, 404);
  }
  if (path === '/push/devices/preferences' && req.method === 'GET') {
    const deviceId = new URL(req.url).searchParams.get('deviceId');
    const token = parseDeviceAuthorization(req.headers.get('Authorization'));
    if (!validDeviceId(deviceId) || !token) return reply({ error: 'Unauthorized' }, 401);
    const preferences = await getDevicePreferences(env.DB, deviceId, await hashDeviceToken(token));
    return preferences ? reply({ preferences }) : reply({ error: 'Not found' }, 404);
  }
  if (path === '/push/devices/test' && req.method === 'POST') {
    if (env.PUSH_EVENTS_ENABLED !== 'true') return reply({ error: 'Push delivery unavailable' }, 503);
    if (!ip) return reply({ error: 'Test delivery unavailable' }, 503);
    if (req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply({ error: 'JSON required' }, 415);
    if (Number(req.headers.get('Content-Length') || 0) > 8192) return reply({ error: 'Request too large' }, 413);
    let body;
    try { const raw=await req.text(); if(raw.length>8192)return reply({error:'Request too large'},413); body=JSON.parse(raw); } catch (_) { return reply({ error: 'Invalid JSON' }, 400); }
    const token = parseDeviceAuthorization(req.headers.get('Authorization'));
    if (!body || typeof body !== 'object' || !validDeviceId(body.deviceId) || !token) return reply({ error: 'Unauthorized' }, 401);
    const tokenHash = await hashDeviceToken(token);
    const device = await env.DB.prepare('SELECT id,endpoint,p256dh,auth FROM push_devices WHERE id=? AND token_hash=? AND enabled=1').bind(body.deviceId, tokenHash).first();
    if (!device) return reply({ error: 'Not found' }, 404);
    const secret = env.TOKEN_SECRET;
    if (typeof secret !== 'string' || secret.length < 32) return reply({ error: 'Test delivery unavailable' }, 503);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`push-test:${body.deviceId}:${ip}`)));
    const ipHash = 'push-test:' + Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
    const now = Math.floor(Date.now() / 1000);
    const limit = await env.DB.prepare('INSERT INTO request_limits(ip_hash,until_ts) VALUES(?,?) ON CONFLICT(ip_hash) DO UPDATE SET until_ts=excluded.until_ts WHERE request_limits.until_ts<?').bind(ipHash, now + 300, now).run();
    if (limit.meta?.changes !== 1) return reply({ error: 'Please wait before sending another test notification' }, 429);
    try {
      const result = await sendControlledTestPush(env, device, now);
      return result.sent ? reply({ sent: true }) : reply({ error: 'This browser subscription has expired' }, 410);
    } catch (error) {
      console.error('Controlled push test failed', String(error));
      return reply({ error: 'The push provider did not accept the test notification' }, 502);
    }
  }
  if (req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply({ error: 'JSON required' }, 415);
  if (Number(req.headers.get('Content-Length') || 0) > 8192) return reply({ error: 'Request too large' }, 413);
  let body;
  try {
    const raw = await req.text();
    if (raw.length > 8192) return reply({ error: 'Request too large' }, 413);
    body = JSON.parse(raw);
  } catch (_) { return reply({ error: 'Invalid JSON' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid payload' }, 400);
  if (!((path === '/push/devices' && req.method === 'POST') || (path === '/push/devices/preferences' && req.method === 'PUT') || (path === '/push/devices/disable' && req.method === 'POST') || (path === '/push/devices/thresholds' && req.method === 'PUT') || (path === '/push/devices/thresholds/email' && req.method === 'POST'))) return reply({ error: 'Not found' }, 404);
  if (path === '/push/devices' && (!validatePushSubscription(body.subscription) || !validateEventPreferences(body.preferences))) return reply({ error: 'Invalid subscription or preferences' }, 400);
  if (!ip && new URL(req.url).pathname === '/push/devices') return reply({ error: 'Enrollment unavailable' }, 503);
  const now = Math.floor(Date.now() / 1000);
  if (path === '/push/devices/thresholds' && req.method === 'PUT') {
    const token = parseDeviceAuthorization(req.headers.get('Authorization'));
    const preferences = normalizeThresholdPreferences(body.preferences);
    if (!validDeviceId(body.deviceId) || !token || !preferences) return reply({ error: 'Invalid threshold preferences' }, 400);
    const tokenHash = await hashDeviceToken(token);
    const stored = await setDeviceThresholdPreferences(env.DB, body.deviceId, tokenHash, preferences, now);
    if (!stored) return reply({ error: 'Not found' }, 404);
    let linkedEmail = null;
    if (stored.linkedSubscriberId) {
      const subscriber = await env.DB.prepare('SELECT id,email,prefs_json,email_confirmed,unsubscribed FROM subscribers WHERE id=?').bind(stored.linkedSubscriberId).first();
      if (subscriber?.email_confirmed === 1 && subscriber?.unsubscribed === 0) {
        let old = {};
        try { old = JSON.parse(subscriber.prefs_json || '{}'); } catch (_) {}
        const next = { ...old, metrics: preferences.metrics, channels: { email: preferences.channels.email, push: preferences.channels.push } };
        if (preferences.channels.email && !next.emailOptInAt) next.emailOptInAt = now;
        await env.DB.prepare('UPDATE subscribers SET prefs_json=?,updated_at=? WHERE id=?').bind(JSON.stringify(next), now, subscriber.id).run();
        linkedEmail = subscriber.email;
        await env.DB.prepare("DELETE FROM alert_state WHERE subscriber_id=? AND channel='email'").bind(subscriber.id).run();
        await syncLinkedThresholdDevices(env.DB, subscriber.id, preferences.metrics, preferences.channels.email, now);
      }
    }
    await env.DB.prepare("DELETE FROM alert_state WHERE subscriber_id=? AND channel='push'").bind(body.deviceId).run();
    return reply({ updated: true, preferences, linkedEmail, emailConfirmationRequired: preferences.channels.email && !linkedEmail });
  }
  if (path === '/push/devices/thresholds/email' && req.method === 'POST') {
    const token = parseDeviceAuthorization(req.headers.get('Authorization'));
    const preferences = normalizeThresholdPreferences(body.preferences);
    const email = String(body.email || '').trim().toLowerCase();
    if (!validDeviceId(body.deviceId) || !token || !preferences || !preferences.channels.email || !validEmail(email)) return reply({ error: 'Invalid email alert request' }, 400);
    if (!ip || typeof env.TOKEN_SECRET !== 'string' || env.TOKEN_SECRET.length < 32 || !env.RESEND_API_KEY || !env.FROM_EMAIL || !env.WORKER_PUBLIC_URL) return reply({ error: 'Email confirmation unavailable' }, 503);
    const tokenHash = await hashDeviceToken(token);
    const stored = await setDeviceThresholdPreferences(env.DB, body.deviceId, tokenHash, preferences, now);
    if (!stored) return reply({ error: 'Not found' }, 404);
    if (!await reserveRateLimit(env, 'device:' + body.deviceId) || !await reserveRateLimit(env, 'email:' + email) || !await reserveRateLimit(env, 'ip:' + ip)) return reply({ error: 'Please wait before requesting another confirmation email' }, 429);
    const raw = randomHexToken();
    await env.DB.prepare('INSERT INTO tokens(hash,subscriber_id,email,purpose,payload_json,expires_at) VALUES(?,?,?,?,?,?)')
      .bind(await digestHex(raw), null, email, 'push-threshold-email-confirm', JSON.stringify({ deviceId: body.deviceId, requestedAt: now, termsVersion: '2026-10' }), now + 3600).run();
    try { await sendThresholdEmailConfirmation(env, email, raw); }
    catch (error) { console.error('Threshold email confirmation failed', String(error)); return reply({ error: 'Could not send confirmation email' }, 503); }
    return reply({ confirmationSent: true, maskedEmail: maskedEmail(email) }, 202);
  }
  if (path === '/push/devices' && req.method === 'POST') {
    if (typeof env.TOKEN_SECRET !== 'string' || env.TOKEN_SECRET.length < 32) return reply({ error: 'Enrollment unavailable' }, 503);
    const ipBytes = new TextEncoder().encode('push-enroll:' + ip);
    const rateKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const ipDigest = await crypto.subtle.sign('HMAC', rateKey, ipBytes);
    const ipKey = 'push-enroll:' + Array.from(new Uint8Array(ipDigest), b => b.toString(16).padStart(2, '0')).join('');
    const result = await env.DB.prepare('INSERT INTO request_limits(ip_hash,until_ts) VALUES(?,?) ON CONFLICT(ip_hash) DO UPDATE SET until_ts=excluded.until_ts WHERE request_limits.until_ts<?').bind(ipKey, Math.floor(Date.now()/1000)+60, Math.floor(Date.now()/1000)).run();
    if (result.meta?.changes !== 1) return reply({ error: 'Please wait before trying again' }, 429);
  }
  if (path === '/push/devices' && req.method === 'POST') {
    const credential = createDeviceCredential();
    const tokenHash = await hashDeviceToken(credential.token);
    const stored = await registerDevice(env.DB, body.subscription, body.preferences, now, { id: credential.id, tokenHash });
    if (!stored) return reply({ error: 'Invalid subscription' }, 400);
    if (stored.conflict) return reply({ error: 'Subscription already registered' }, 409);
    return reply({ deviceId: credential.id, token: credential.token, preferences: stored.preferences }, 201);
  }
  if (path === '/push/devices/preferences' && req.method === 'PUT') {
    const token = parseDeviceAuthorization(req.headers.get('Authorization'));
    if (!validDeviceId(body.deviceId) || !token) return reply({ error: 'Unauthorized' }, 401);
    const ok = await setDevicePreferences(env.DB, body.deviceId, await hashDeviceToken(token), body.preferences, now);
    return ok ? reply({ updated: true }) : reply({ error: 'Not found or invalid preferences' }, 404);
  }
  if (path === '/push/devices/disable' && req.method === 'POST') {
    const token = parseDeviceAuthorization(req.headers.get('Authorization'));
    if (!validDeviceId(body.deviceId) || !token) return reply({ error: 'Unauthorized' }, 401);
    const ok = await disableDevice(env.DB, body.deviceId, await hashDeviceToken(token), now);
    return ok ? reply({ disabled: true }) : reply({ error: 'Not found' }, 404);
  }
  return reply({ error: 'Not found' }, 404);
}
