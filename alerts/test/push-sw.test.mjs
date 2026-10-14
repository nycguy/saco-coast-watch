import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const scope = 'https://example.org/saco-coast-watch/';
const manageAlerts = `${scope}index.html?openAlerts=1`;

function setup({ windows = [], openWindow = async () => null, matchAll = async () => windows } = {}) {
  const handlers = new Map();
  const notifications = [];
  const registration = { scope, showNotification: async (title, options) => notifications.push({ title, options }) };
  const self = { registration, addEventListener: (name, fn) => handlers.set(name, fn) };
  const clients = { matchAll, openWindow };
  const context = vm.createContext({ self, URL, clients });
  vm.runInContext(readFileSync(new URL('../../push-sw.js', import.meta.url), 'utf8'), context);
  return { handlers, notifications, clients };
}
async function push(harness, message) {
  let work;
  harness.handlers.get('push')({ data: { json: () => message }, waitUntil: p => { work = p; } });
  await work;
}
async function click(harness, url) {
  let work, closed = false;
  harness.handlers.get('notificationclick')({
    notification: { data: url === undefined ? {} : { url }, close: () => { closed = true; } },
    waitUntil: p => { work = p; },
  });
  await work;
  assert.equal(closed, true);
}

test('service worker registers push and notification click handlers', () => {
  assert.deepEqual([...setup().handlers.keys()], ['push', 'notificationclick']);
});
test('valid coastal event produces a bounded notification with its alert destination', async () => {
  const h = setup();
  await push(h, { application: 'SacoCast', kind: 'start', title: 'X'.repeat(150), body: 'Coastal update', url: `${scope}index.html#alerts` });
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].title.length, 120);
  assert.equal(h.notifications[0].options.data.url, `${scope}index.html#alerts`);
});
test('test notification kind opens the Manage Alerts deep link', async () => {
  const h = setup();
  await push(h, { application: 'SacoCast', kind: 'test', title: 'SacoCast Test Notification', url: manageAlerts });
  assert.equal(h.notifications[0].options.data.url, manageAlerts);
});
test('missing push and click destinations fall back to Manage Alerts', async () => {
  const h = setup();
  await push(h, { application: 'SacoCast', kind: 'test' });
  assert.equal(h.notifications[0].options.data.url, manageAlerts);
  const opened = [];
  const fallback = setup({ openWindow: async url => { opened.push(url); return null; } });
  await click(fallback);
  assert.deepEqual(opened, [manageAlerts]);
});
test('different coastal events have separate replacement tags', async () => {
  const h = setup();
  for (const eventId of ['a'.repeat(64), 'b'.repeat(64)]) await push(h, { application: 'SacoCast', eventId, kind: 'change', title: 'Coastal change' });
  assert.notEqual(h.notifications[0].options.tag, h.notifications[1].options.tag);
});
test('rejects malformed kinds, other applications, and offsite destinations', async () => {
  const h = setup();
  await push(h, { application: 'SacoCast', kind: 'unknown' });
  await push(h, { application: 'Other', kind: 'start' });
  await push(h, { application: 'SacoCast', kind: 'start', url: 'https://attacker.example/' });
  await push(h, { application: 'SacoCast', kind: 'start', url: '/elsewhere' });
  await push(h, { application: 'SacoCast', kind: 'start', url: 'http://[' });
  assert.equal(h.notifications.length, 0);
});
test('notification click navigates and focuses an existing in-scope app window', async () => {
  const navigated = [], focused = [], opened = [];
  const app = { url: `${scope}index.html`, navigate: async url => { navigated.push(url); return app; }, focus: async () => focused.push(true) };
  const h = setup({ windows: [app], openWindow: async url => opened.push(url) });
  await click(h, `${scope}index.html#alerts`);
  assert.deepEqual(navigated, [`${scope}index.html#alerts`]);
  assert.equal(focused.length, 1);
  assert.deepEqual(opened, []);
});
test('rejected iOS-style WindowClient.navigate falls back to openWindow with the destination', async () => {
  const opened = [], focused = [];
  const app = { url: `${scope}index.html`, navigate: async () => { throw new TypeError('navigate failed'); }, focus: async () => focused.push(true) };
  const h = setup({ windows: [app], openWindow: async url => { opened.push(url); return { url, focus: async () => focused.push(true) }; } });
  await click(h, `${scope}index.html#weatherHeading`);
  assert.deepEqual(opened, [`${scope}index.html#weatherHeading`]);
  assert.equal(focused.length, 1);
});
test('opens a new app window when no reusable window exists and focuses its result', async () => {
  const opened = [], focused = [];
  const h = setup({ openWindow: async url => { opened.push(url); return { url, focus: async () => focused.push(true) }; } });
  await click(h, `${scope}index.html#alerts`);
  assert.deepEqual(opened, [`${scope}index.html#alerts`]);
  assert.equal(focused.length, 1);
});
test('keeps a reusable app window focused if openWindow resolves without a client', async () => {
  const focused = [];
  const app = { url: `${scope}index.html`, navigate: async () => { throw new Error('navigation unavailable'); }, focus: async () => focused.push(true) };
  const h = setup({ windows: [app], openWindow: async () => null });
  await click(h, `${scope}index.html#alerts`);
  assert.equal(focused.length, 1);
});
test('unsafe click URLs use the in-scope Manage Alerts fallback', async () => {
  const opened = [];
  const h = setup({ openWindow: async url => { opened.push(url); } });
  await click(h, 'https://attacker.example/');
  assert.deepEqual(opened, [manageAlerts]);
});

test('service worker accepts the test and custom threshold notification kinds', () => {
  const source = readFileSync(new URL('../../push-sw.js', import.meta.url), 'utf8');
  assert.match(source, /'threshold'/);
  assert.match(source, /'test'/);
});
