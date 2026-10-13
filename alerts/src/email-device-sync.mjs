import { normalizeThresholdPreferences } from './threshold-preferences.mjs';

/**
 * Keep threshold choices shared by an email subscriber and any app devices
 * that were explicitly linked after email confirmation. Channel choices stay
 * independent: email changes preserve each device's current App setting.
 */
export async function syncLinkedThresholdDevices(db, subscriberId, metrics, emailEnabled, now) {
  if (typeof subscriberId !== 'string' || typeof emailEnabled !== 'boolean' || !Number.isSafeInteger(now)) return;
  let rows;
  try {
    rows = await db.prepare('SELECT device_id,prefs_json FROM push_threshold_preferences WHERE linked_subscriber_id=?').bind(subscriberId).all();
  } catch (_) {
    // Email-only subscriptions remain functional if the optional device-link
    // schema has not been deployed in a non-production environment.
    return;
  }
  for (const row of rows.results || []) {
    let current;
    try { current = normalizeThresholdPreferences(JSON.parse(row.prefs_json)); } catch (_) { current = null; }
    if (!current) continue;
    const next = normalizeThresholdPreferences({
      metrics,
      channels: { push: current.channels.push, email: emailEnabled },
    });
    if (!next) continue;
    const thresholdsChanged = JSON.stringify(current.metrics) !== JSON.stringify(next.metrics);
    await db.prepare('UPDATE push_threshold_preferences SET prefs_json=?,updated_at=? WHERE device_id=?')
      .bind(JSON.stringify(next), now, row.device_id).run();
    if (thresholdsChanged) {
      await db.prepare("DELETE FROM alert_state WHERE subscriber_id=? AND channel='push'")
        .bind(row.device_id).run();
    }
  }
}
