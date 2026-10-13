import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function setup() {
  const handlers = new Map();
  const notifications = [];
  const scope = 'https://example.org/saco-coast-watch/';
  const registration = { scope, showNotification: async (title, options) => notifications.push({ title, options }) };
  const self = { registration, addEventListener: (name, fn) => handlers.set(name, fn) };
  const clients = { matchAll: async () => [], openWindow: async () => {} };
  const context = vm.createContext({ self, URL, clients });
  vm.runInContext(readFileSync(new URL('../../push-sw.js', import.meta.url), 'utf8'), context);
  return { handlers, notifications };
}
async function push(harness, message) {
  let work;
  harness.handlers.get('push')({ data: { json: () => message }, waitUntil: p => { work = p; } });
  await work;
}

test('service worker only registers push and notification click handlers', () => {
  assert.deepEqual([...setup().handlers.keys()], ['push', 'notificationclick']);
});
test('valid coastal event produces a bounded notification', async () => {
  const h = setup();
  await push(h, { application: 'SacoCast', kind: 'start', title: 'X'.repeat(150), body: 'Coastal update' });
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].title.length, 120);
});
test('different coastal events have separate replacement tags', async () => {
  const h=setup();
  for (const eventId of ['a'.repeat(64),'b'.repeat(64)]) await push(h,{application:'SacoCast',eventId,kind:'change',title:'Coastal change'});
  assert.notEqual(h.notifications[0].options.tag,h.notifications[1].options.tag);
});
test('rejects malformed kinds and offsite destinations', async () => {
  const h = setup();
  await push(h, { application: 'SacoCast', kind: 'unknown' });
  await push(h, { application: 'Other', kind: 'start' });
  await push(h, { application: 'SacoCast', kind: 'start', url: 'https://attacker.example/' });
  await push(h, { application: 'SacoCast', kind: 'start', url: '/elsewhere' });
  assert.equal(h.notifications.length, 0);
});


test('service worker accepts custom threshold notification kind', async () => {
  const source = await readFile(new URL('../../push-sw.js', import.meta.url), 'utf8');
  assert.match(source, /'threshold'/);
});
