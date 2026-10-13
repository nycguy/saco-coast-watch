import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCoastalAlertSnapshot } from '../src/coastal-push-events.mjs';

const now = Date.parse('2026-10-12T12:00:00Z');
const response = (doc, date = 'Mon, 12 Oct 2026 12:00:00 GMT', status = 200) => new Response(JSON.stringify(doc), { status, headers: { Date: date, 'Content-Type': 'application/geo+json' } });

test('reads current coastal events only from a fresh official NWS response', async () => {
  const result = await fetchCoastalAlertSnapshot(async () => response({ type: 'FeatureCollection', features: [{ properties: { id: 'urn:alert:123', event: 'Coastal Flood Warning', headline: 'Coastal Flood Warning issued', severity: 'Severe', updated: '2026-10-12T11:55:00Z' } }] }), now);
  assert.equal(result.observedAt, now / 1000);
  assert.equal(result.events.size, 1);
  assert.match([...result.events.values()][0].fingerprint, /^[a-f0-9]{64}$/);
});

test('stale source, malformed payload, and provider failure are errors, never empty events', async () => {
  await assert.rejects(fetchCoastalAlertSnapshot(async () => response({ type: 'FeatureCollection', features: [] }, 'Mon, 12 Oct 2026 10:00:00 GMT'), now), /stale/);
  await assert.rejects(fetchCoastalAlertSnapshot(async () => response({ type: 'FeatureCollection', features: 'bad' }), now), /malformed/);
  await assert.rejects(fetchCoastalAlertSnapshot(async () => response({}, undefined, 503), now), /503/);
});

test('ignores unrelated NWS alerts and test products', async () => {
  const result = await fetchCoastalAlertSnapshot(async () => response({ type: 'FeatureCollection', features: [
    { properties: { id: 'rain', event: 'Flood Watch' } },
    { properties: { id: 'test', event: 'Coastal Flood Warning', messageType: 'Test' } },
  ] }), now);
  assert.equal(result.events.size, 0);
});
