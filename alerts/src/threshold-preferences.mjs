/** Shared validation for custom water, wind, and temperature thresholds. */
export const THRESHOLD_SPECS = Object.freeze([
  { id: 'waterObserved', label: 'Observed Portland water level', unit: 'ft MLLW', defaultThreshold: 12, min: 0, max: 30, direction: 'at or above' },
  { id: 'waterForecast', label: 'Forecast Portland peak in next 72 hours', unit: 'ft MLLW', defaultThreshold: 12, min: 0, max: 30, direction: 'at or above' },
  { id: 'wind', label: 'Offshore sustained wind', unit: 'mph', defaultThreshold: 30, min: 0, max: 180, direction: 'at or above' },
  { id: 'gust', label: 'Offshore wind gust', unit: 'mph', defaultThreshold: 45, min: 0, max: 220, direction: 'at or above' },
  { id: 'tempHigh', label: 'Portland airport temperature above', unit: '°F', defaultThreshold: 90, min: -40, max: 140, direction: 'at or above' },
  { id: 'tempLow', label: 'Portland airport temperature below', unit: '°F', defaultThreshold: 32, min: -40, max: 140, direction: 'at or below' },
]);

export function defaultThresholdMetrics() {
  return Object.fromEntries(THRESHOLD_SPECS.map(spec => [spec.id, { enabled: false, threshold: spec.defaultThreshold }]));
}

export function normalizeThresholdMetrics(value, { allowEmpty = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  let selected = 0;
  for (const spec of THRESHOLD_SPECS) {
    const raw = value[spec.id] ?? {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return null;
    const threshold = Number(raw.threshold ?? spec.defaultThreshold);
    if (!Number.isFinite(threshold) || threshold < spec.min || threshold > spec.max) return null;
    const enabled = raw.enabled === true;
    if (enabled) selected++;
    result[spec.id] = { enabled, threshold };
  }
  if (!allowEmpty && selected === 0) return null;
  return result;
}

export function normalizeThresholdPreferences(value, { allowEmpty = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metrics = normalizeThresholdMetrics(value.metrics, { allowEmpty });
  if (!metrics) return null;
  const channels = value.channels ?? {};
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) return null;
  for (const key of ['push', 'email']) if (channels[key] !== undefined && typeof channels[key] !== 'boolean') return null;
  return { metrics, channels: { push: channels.push === true, email: channels.email === true } };
}

export function selectedThresholdCount(preferences) {
  return Object.values(preferences?.metrics || {}).filter(item => item?.enabled === true).length;
}
