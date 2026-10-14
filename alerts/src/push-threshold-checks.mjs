import { sendThresholdPush } from './push-delivery.mjs';
import { THRESHOLD_SPECS, normalizeThresholdPreferences } from './threshold-preferences.mjs';
import { decideAlert } from './threshold-state.mjs';

const SPEC_BY_ID = new Map(THRESHOLD_SPECS.map(spec => [spec.id, spec]));
const SITE_URL = 'https://nycguy.github.io/saco-coast-watch/';

function normalizedMeasurement(measurements, metric) {
  const reading = measurements?.[metric];
  return reading && Number.isFinite(reading.value) && typeof reading.time === 'string' && typeof reading.source === 'string'
    ? reading
    : null;
}

export function formatThresholdPushBody(spec, reading, threshold) {
  const modeled = reading.kind === 'model forecast peak, next 72 hours';
  return `${spec.label}: ${reading.value} ${spec.unit}; your threshold is ${threshold} ${spec.unit}. ${modeled ? 'NOAA model guidance' : 'Observation'} at ${reading.time} UTC. Source: ${reading.source}.`;
}

async function saveState(db, deviceId, metric, decision) {
  await db.prepare("INSERT INTO alert_state(subscriber_id,channel,metric,active,last_sent) VALUES(?,'push',?,?,?) ON CONFLICT(subscriber_id,channel,metric) DO UPDATE SET active=excluded.active,last_sent=excluded.last_sent")
    .bind(deviceId, metric, decision.active, decision.lastSent).run();
}

/** Evaluate opted-in app thresholds; failed provider sends remain eligible next run. */
export async function evaluatePushThresholds(env, measurements, now = Math.floor(Date.now() / 1000)) {
  const result = { devicesScanned: 0, attempted: 0, sent: 0, expired: 0, failed: 0 };
  const rows = await env.DB.prepare('SELECT d.id,d.endpoint,d.p256dh,d.auth,p.prefs_json FROM push_devices d JOIN push_threshold_preferences p ON p.device_id=d.id WHERE d.enabled=1 ORDER BY d.id LIMIT 500').all();
  for (const device of rows.results || []) {
    result.devicesScanned++;
    let preferences;
    try { preferences = normalizeThresholdPreferences(JSON.parse(device.prefs_json)); } catch (_) { continue; }
    if (!preferences?.channels.push) continue;
    for (const [metric, requested] of Object.entries(preferences.metrics)) {
      if (!requested.enabled) continue;
      const spec = SPEC_BY_ID.get(metric), reading = normalizedMeasurement(measurements, metric);
      if (!spec || !reading) continue; // Missing/stale upstream readings do not clear crossing state.
      const old = await env.DB.prepare("SELECT active,last_sent FROM alert_state WHERE subscriber_id=? AND channel='push' AND metric=?").bind(device.id, metric).first();
      const previous = old ? { active: Number(old.active), lastSent: Number(old.last_sent) || 0 } : null;
      const decision = decideAlert(previous, reading.value, requested.threshold, metric, now);
      if (!decision.send) {
        if (old && (old.active !== decision.active || old.last_sent !== decision.lastSent))
          await saveState(env.DB, device.id, metric, decision);
        continue;
      }
      if (result.attempted >= 24) return result;
      const body = formatThresholdPushBody(spec, reading, requested.threshold);
      result.attempted++;
      try {
        const delivery = await sendThresholdPush(env, device, {
          metric,
          title: `SacoCast threshold reached: ${spec.label}`,
          body,
          url: SITE_URL,
        }, now);
        if (delivery.expired) { result.expired++; continue; }
        if (delivery.sent) {
          await saveState(env.DB, device.id, metric, decision);
          result.sent++;
        }
      } catch (error) {
        result.failed++;
        // Do not log a subscription endpoint, key, device ID, or provider response body.
        console.warn('Threshold push delivery failed', JSON.stringify({ metric, status: Number(error?.status) || null }));
      }
    }
  }
  return result;
}
