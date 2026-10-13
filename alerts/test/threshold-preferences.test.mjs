import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultThresholdMetrics, normalizeThresholdMetrics, normalizeThresholdPreferences, selectedThresholdCount } from '../src/threshold-preferences.mjs';

test('custom threshold defaults are disabled and retain safe baseline values', () => {
  const metrics = defaultThresholdMetrics();
  assert.equal(metrics.waterObserved.enabled, false);
  assert.equal(metrics.waterObserved.threshold, 12);
  assert.equal(metrics.tempLow.threshold, 32);
});

test('custom thresholds accept App, Email, or Both channels', () => {
  const metrics = defaultThresholdMetrics();
  metrics.tempHigh = { enabled: true, threshold: 85 };
  for (const channels of [{push:true,email:false},{push:false,email:true},{push:true,email:true}]) {
    const value = normalizeThresholdPreferences({ metrics, channels });
    assert.deepEqual(value.channels, channels);
    assert.equal(selectedThresholdCount(value), 1);
  }
});

test('malformed, out-of-range, and unknown-type values fail closed', () => {
  const metrics = defaultThresholdMetrics();
  metrics.tempHigh = { enabled: true, threshold: 141 };
  assert.equal(normalizeThresholdMetrics(metrics), null);
  assert.equal(normalizeThresholdPreferences({ metrics: defaultThresholdMetrics(), channels: { push: 'yes' } }), null);
  assert.equal(normalizeThresholdPreferences(null), null);
});

test('all thresholds may be disabled without deleting the device', () => {
  const value = normalizeThresholdPreferences({ metrics: defaultThresholdMetrics(), channels: { push: false, email: false } });
  assert.ok(value);
  assert.equal(selectedThresholdCount(value), 0);
});
