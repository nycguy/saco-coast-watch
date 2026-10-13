/* SacoCast push-only service worker. No fetch interception or offline caching. */
'use strict';
const SITE_SCOPE = new URL(self.registration.scope);
const SAFE_TAG = 'sacocast-coastal-event';

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    if (!event.data) return;
    let message;
    try { message = event.data.json(); } catch (_) { return; }
    if (!message || message.application !== 'SacoCast' || !['start', 'end', 'change', 'threshold'].includes(message.kind)) return;
    const title = typeof message.title === 'string' ? message.title.slice(0, 120) : 'SacoCast Coastal Update';
    const body = typeof message.body === 'string' ? message.body.slice(0, 280) : 'Coastal conditions have changed.';
    const url = typeof message.url === 'string' ? new URL(message.url, SITE_SCOPE) : SITE_SCOPE;
    if (url.origin !== SITE_SCOPE.origin || !url.pathname.startsWith(SITE_SCOPE.pathname)) return;
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
    const destination = event.notification.data?.url || SITE_SCOPE.href;
    const url = new URL(destination, SITE_SCOPE);
    if (url.origin !== SITE_SCOPE.origin || !url.pathname.startsWith(SITE_SCOPE.pathname)) return;
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const window of windows) {
      if (window.url.startsWith(SITE_SCOPE.href) && 'focus' in window) {
        await window.focus();
        if ('navigate' in window) await window.navigate(url.href);
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(url.href);
  })());
});
