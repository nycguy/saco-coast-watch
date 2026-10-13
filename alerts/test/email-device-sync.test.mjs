import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLinkedThresholdDevices } from '../src/email-device-sync.mjs';

const metrics = {
  waterObserved: { enabled: false, threshold: 12 },
  waterForecast: { enabled: false, threshold: 12 },
  wind: { enabled: false, threshold: 30 },
  gust: { enabled: false, threshold: 45 },
  tempHigh: { enabled: true, threshold: 85 },
  tempLow: { enabled: false, threshold: 32 },
};

function database(rows) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, args: [] };
      calls.push(call);
      return {
        bind(...args) { call.args = args; return this; },
        async all() { return { results: rows }; },
        async run() { return { meta: { changes: 1 } }; },
      };
    },
  };
}

test('email preference changes sync linked device thresholds without changing App delivery', async () => {
  const existing = {
    metrics: { ...metrics, tempHigh: { enabled: false, threshold: 90 } },
    channels: { push: true, email: true },
  };
  const db = database([
    { device_id: 'device-1', prefs_json: JSON.stringify(existing) },
    { device_id: 'device-2', prefs_json: '{malformed' },
  ]);

  await syncLinkedThresholdDevices(db, 'subscriber-1', metrics, false, 2_000_000_000);

  const update = db.calls.find(call => call.sql.startsWith('UPDATE push_threshold_preferences'));
  assert.ok(update);
  assert.deepEqual(JSON.parse(update.args[0]), { metrics, channels: { push: true, email: false } });
  assert.equal(update.args[1], 2_000_000_000);
  assert.equal(update.args[2], 'device-1');
  assert.ok(db.calls.some(call => call.sql.includes("DELETE FROM alert_state") && call.args[0] === 'device-1'));
  assert.equal(db.calls.filter(call => call.sql.startsWith('UPDATE push_threshold_preferences')).length, 1);
});

test('missing optional device-link schema does not break email notification changes', async () => {
  const db = { prepare() { throw new Error('no optional table'); } };
  await assert.doesNotReject(() => syncLinkedThresholdDevices(db, 'subscriber-1', metrics, true, 2_000_000_000));
});
