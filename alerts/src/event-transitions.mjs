/** Pure event lifecycle logic. Unknown source state must never be treated as an event ending. */
export function normalizeEventSnapshot(value) {
  if (!value || typeof value !== 'object' || value.available !== true || typeof value.active !== 'boolean') {
    return { available: false, active: false, fingerprint: null };
  }
  const fingerprint = value.active && typeof value.fingerprint === 'string' && value.fingerprint.trim()
    ? value.fingerprint.trim() : null;
  return { available: true, active: value.active, fingerprint };
}

/** Only compare fresh, ordered source snapshots; callers supply the evaluation clock. */
export function classifyFreshEventTransition(previous, current, nowSeconds, maxAgeSeconds = 1800) {
  if (!Number.isFinite(nowSeconds) || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) return null;
  const beforeTime = previous?.observedAt;
  const afterTime = current?.observedAt;
  if (!Number.isFinite(beforeTime) || !Number.isFinite(afterTime)) return null;
  if (afterTime <= beforeTime || afterTime > nowSeconds + 60 || nowSeconds - afterTime > maxAgeSeconds) return null;
  return classifyEventTransition(previous, current);
}

export function classifyEventTransition(previous, current) {
  const before = normalizeEventSnapshot(previous);
  const after = normalizeEventSnapshot(current);
  if (!before.available || !after.available) return null;
  if (!before.active && after.active) return 'start';
  if (before.active && !after.active) return 'end';
  if (before.active && after.active && before.fingerprint && after.fingerprint && before.fingerprint !== after.fingerprint) return 'change';
  return null;
}

/** Preferences for newly created subscriptions only. */
export function defaultEventPreferences() {
  return { starts: true, ends: true, changes: true };
}

export function notificationAllowed(kind, preferences) {
  if (!kind || !preferences || typeof preferences !== 'object') return false;
  const key = { start: 'starts', end: 'ends', change: 'changes' }[kind];
  return Boolean(key && preferences[key] === true);
}
