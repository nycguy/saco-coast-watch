/* SacoCast push-only service worker. No fetch interception or offline caching. */
'use strict';
const SITE_SCOPE = new URL(self.registration.scope);
const SAFE_TAG = 'sacocast-coastal-event';
const MANAGE_ALERTS_URL = new URL('index.html?openAlerts=1', SITE_SCOPE);

function scopedUrl(value, fallback = SITE_SCOPE.href) {
  try {
    const url = new URL(typeof value === 'string' && value ? value : fallback, SITE_SCOPE);
    return url.origin === SITE_SCOPE.origin && url.pathname.startsWith(SITE_SCOPE.pathname) ? url : null;
  } catch (_) { return null; }
}

function isScopedClient(client) {
  return typeof client?.url === 'string' && Boolean(scopedUrl(client.url));
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    if (!event.data) return;
    let message;
    try { message = event.data.json(); } catch (_) { return; }
    if (!message || message.application !== 'SacoCast' || !['start', 'end', 'change', 'threshold', 'test'].includes(message.kind)) return;
    const title = typeof message.title === 'string' ? message.title.slice(0, 120) : 'SacoCast Coastal Update';
    const body = typeof message.body === 'string' ? message.body.slice(0, 280) : 'Coastal conditions have changed.';
    const url = scopedUrl(message.url, MANAGE_ALERTS_URL.href);
    if (!url || (typeof message.url === 'string' && message.url && !scopedUrl(message.url))) return;
    await self.registration.showNotification(title, {
      body,
      tag: SAFE_TAG + '-' + (typeof message.eventId === 'string' && /^[a-f0-9]{64}$/.test(message.eventId) ? message.eventId : 'general') + '-' + message.kind,
      icon: new URL('sacocast-app-icon-192.png', SITE_SCOPE).href,
      data: { url: url.href },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = scopedUrl(event.notification.data?.url, MANAGE_ALERTS_URL.href) || MANAGE_ALERTS_URL;
    let windows = [];
    try { windows = await clients.matchAll({ type: 'window', includeUncontrolled: true }); } catch (_) {}
    const existing = windows.find(isScopedClient);
    if (existing && typeof existing.navigate === 'function') {
      try {
        const navigated = await existing.navigate(url.href);
        const target = navigated || existing;
        if (typeof target.focus === 'function') await target.focus();
        return;
      } catch (_) {
        // WebKit can reject WindowClient.navigate() for an installed iOS PWA.
        // Try openWindow with the absolute in-scope destination below.
      }
    }
    if (typeof clients.openWindow === 'function') {
      try {
        const opened = await clients.openWindow(url.href);
        if (opened && typeof opened.navigate === 'function' && scopedUrl(opened.url)?.href !== url.href) {
          try { await opened.navigate(url.href); } catch (_) {}
        }
        if (opened && typeof opened.focus === 'function') await opened.focus();
        else if (existing && typeof existing.focus === 'function') await existing.focus();
        return;
      } catch (_) {
        // Keep a matching installed app usable even if opening a target window fails.
      }
    }
    if (existing && typeof existing.focus === 'function') {
      try { await existing.focus(); } catch (_) {}
    }
  })());
});
