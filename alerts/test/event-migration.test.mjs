import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0002_event_notifications.sql', import.meta.url), 'utf8');
const initial = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');

test('new event migration is additive and preserves existing subscriber records', () => {
  assert.match(initial, /CREATE TABLE IF NOT EXISTS subscribers/);
  assert.match(initial, /CREATE TABLE IF NOT EXISTS alert_state/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS coastal_event_snapshots/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS coastal_event_deliveries/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE|ALTER|UPDATE)\b\s+(?:TABLE\s+)?(?:subscribers|alert_state|push_subscriptions)\b/i);
});

test('delivery ledger has explicit status and kind constraints', () => {
  assert.match(migration, /transition_kind TEXT NOT NULL CHECK/);
  assert.match(migration, /'start', 'end', 'change'/);
  assert.match(migration, /'pending', 'sent', 'failed', 'cancelled'/);
  assert.match(migration, /FOREIGN KEY \(subscriber_id\) REFERENCES subscribers/);
});

const devices = readFileSync(new URL('../migrations/0003_push_devices.sql', import.meta.url), 'utf8');
test('standalone push device migration does not modify email subscribers', () => {
  assert.match(devices, /CREATE TABLE IF NOT EXISTS push_devices/);
  assert.match(devices, /CREATE TABLE IF NOT EXISTS push_device_deliveries/);
  assert.match(devices, /endpoint TEXT NOT NULL UNIQUE/);
  assert.match(devices, /token_hash TEXT NOT NULL/);
  assert.doesNotMatch(devices, /\b(?:DROP|DELETE|TRUNCATE|ALTER|UPDATE)\b\s+(?:TABLE\s+)?(?:subscribers|alert_state|push_subscriptions)\b/i);
});
