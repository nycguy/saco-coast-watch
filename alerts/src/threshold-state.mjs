/** Pure threshold crossing state used independently by email and app delivery. */
export function decideAlert(previous, value, threshold, metric, checkedAtSeconds) {
  if (!Number.isFinite(value) || !Number.isFinite(threshold))
    return { send: false, active: previous?.active === 1 ? 1 : 0, lastSent: previous?.lastSent || 0, reason: 'invalid-input' };
  const lastSent = previous?.lastSent || 0;
  const triggered = metric === 'tempLow' ? value <= threshold : value >= threshold;
  if (!triggered) return { send: false, active: 0, lastSent, reason: 'below-trigger' };
  if (previous?.active === 1) return { send: false, active: 1, lastSent, reason: 'already-active' };
  if (lastSent && checkedAtSeconds - lastSent < 3600)
    return { send: false, active: 1, lastSent, reason: 'one-hour-cooldown' };
  return { send: true, active: 1, lastSent: checkedAtSeconds, reason: 'new-crossing' };
}
