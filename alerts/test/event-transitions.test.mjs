import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEventTransition, defaultEventPreferences, notificationAllowed, normalizeEventSnapshot, classifyFreshEventTransition } from '../src/event-transitions.mjs';

const active = fingerprint => ({ available: true, active: true, fingerprint });
const inactive = { available: true, active: false };

test('new active event starts only from known inactive state', () => {
  assert.equal(classifyEventTransition(inactive, active('a')), 'start');
  assert.equal(classifyEventTransition(null, active('a')), null);
  assert.equal(classifyEventTransition({ active: false }, active('a')), null);
});
test('event ends only when a healthy source confirms inactivity', () => {
  assert.equal(classifyEventTransition(active('a'), inactive), 'end');
  assert.equal(classifyEventTransition(active('a'), null), null);
  assert.equal(classifyEventTransition(active('a'), { available: false, active: false }), null);
});
test('meaningful fingerprints change without duplicate notifications', () => {
  assert.equal(classifyEventTransition(active('a'), active('b')), 'change');
  assert.equal(classifyEventTransition(active('a'), active('a')), null);
  assert.equal(classifyEventTransition(active(null), active('b')), null);
});
test('missing or malformed snapshots fail closed', () => {
  for (const bad of [null, undefined, {}, { available: true }, { available: true, active: 'false' }, { available: false, active: false }]) {
    assert.equal(classifyEventTransition(active('a'), bad), null);
    assert.equal(classifyEventTransition(bad, active('b')), null);
    assert.equal(normalizeEventSnapshot(bad).available, false);
  }
});
test('new subscription defaults enable all event kinds', () => {
  assert.deepEqual(defaultEventPreferences(), { starts: true, ends: true, changes: true });
});
test('each kind can be disabled independently', () => {
  const preferences = { starts: true, ends: false, changes: true };
  assert.equal(notificationAllowed('start', preferences), true);
  assert.equal(notificationAllowed('end', preferences), false);
  assert.equal(notificationAllowed('change', preferences), true);
  assert.equal(notificationAllowed('unknown', preferences), false);
  assert.equal(notificationAllowed('start', null), false);
});

test('stale, out-of-order, and future snapshots cannot generate lifecycle alerts', () => {
  const now = 1_800_000_000;
  const before = { ...active('a'), observedAt: now - 900 };
  const after = { ...inactive, observedAt: now - 60 };
  assert.equal(classifyFreshEventTransition(before, after, now), 'end');
  assert.equal(classifyFreshEventTransition(before, { ...after, observedAt: now - 1900 }, now), null);
  assert.equal(classifyFreshEventTransition(before, { ...after, observedAt: now + 61 }, now), null);
  assert.equal(classifyFreshEventTransition(before, { ...after, observedAt: now - 1000 }, now), null);
  assert.equal(classifyFreshEventTransition(before, { ...after, observedAt: now - 900 }, now), null);
  assert.equal(classifyFreshEventTransition(before, { ...after, observedAt: 'now' }, now), null);
  assert.equal(classifyFreshEventTransition(before, after, Number.NaN), null);
});
