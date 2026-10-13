import {
  pushCapability, readPushCredential, getCoastalPushConfiguration, enrollCoastalNotifications, getCoastalNotificationPreferences, sendCoastalTestNotification,
  updateCoastalNotificationPreferences, disableCoastalNotifications,
} from './push-subscriptions.mjs?v=20261013-3';

const byId = id => document.getElementById(id);
const status = byId('pushStatus');
const panel = byId('pushPanel');
const enable = byId('pushEnable');
const sendTest = byId('pushTest');
const disable = byId('pushDisable');
const preferences = byId('pushPreferences');
const prefsStorageKey = 'sacocast.push.preferences.v1';
let pushConfig = null;
const getPrefs = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(prefsStorageKey) || 'null');
    return { starts: stored?.starts !== false, ends: stored?.ends !== false, changes: stored?.changes !== false };
  } catch (_) { return { starts: true, ends: true, changes: true }; }
};
function setPrefs(value) {
  for (const [name, key] of [['pushStarts', 'starts'], ['pushEnds', 'ends'], ['pushChanges', 'changes']]) byId(name).checked = value[key];
}
function currentPrefs() { return { starts: byId('pushStarts').checked, ends: byId('pushEnds').checked, changes: byId('pushChanges').checked }; }
function showEnrolled() { enable.hidden = true; sendTest.hidden = false; disable.hidden = false; preferences.hidden = false; setPrefs(getPrefs()); }

async function initialize() {
  try {
    pushConfig = await getCoastalPushConfiguration();
    if (!pushConfig) return;
  } catch (_) {
    return;
  }
  panel.hidden = false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const capability = pushCapability({
    secureContext: window.isSecureContext,
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window ? Notification : null,
    userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints || 0,
    standalone,
  });
  if (!capability.supported) {
    enable.disabled = true;
    status.textContent = capability.reason + (capability.reason?.includes('Home Screen') ? '. In Safari, use Share → Add to Home Screen, then launch the installed SacoCast icon.' : '.');
    return;
  }
  if (Notification.permission === 'denied') {
    enable.disabled = true;
    status.textContent = 'Notifications are blocked in browser settings. Change the SacoCast site permission there if you want to enable them.';
    return;
  }
  const registration = await navigator.serviceWorker.getRegistration('./').catch(() => null);
  const existing = await registration?.pushManager?.getSubscription().catch(() => null);
  if (existing && readPushCredential()) {
    showEnrolled();
    try {
      const saved = await getCoastalNotificationPreferences();
      if (saved) { localStorage.setItem(prefsStorageKey, JSON.stringify(saved)); setPrefs(saved); }
      status.textContent = 'Notifications are on for this device. Choose the updates you want below.';
    } catch (_) {
      status.textContent = 'Notifications are on, but saved preferences could not be refreshed. Your current choices remain shown.';
    }
  } else if (existing) {
    status.textContent = 'A browser subscription already exists, but its saved control credential is missing. Keep it until you can turn it off in browser settings, then enroll again.';
  }
}

enable.addEventListener('click', async () => {
  enable.disabled = true;
  status.textContent = 'Connecting this device…';
  try {
    const result = await enrollCoastalNotifications({ onSave: setPrefs, vapidPublicKey: pushConfig?.publicKey });
    if (!result.enrolled) { status.textContent = 'Notifications were not enabled. You can try again whenever you like.'; return; }
    const next = { starts: true, ends: true, changes: true };
    localStorage.setItem(prefsStorageKey, JSON.stringify(next));
    showEnrolled();
    status.textContent = 'Notifications are on. Coastal event starts, ends, and meaningful changes are enabled.';
  } catch (error) {
    status.textContent = error?.message || 'Could not enable notifications. Try again later.';
  } finally { enable.disabled = Notification.permission === 'denied'; }
});

disable.addEventListener('click', async () => {
  disable.disabled = true;
  try {
    const result = await disableCoastalNotifications();
    disable.hidden = true; enable.hidden = false; enable.disabled = false; preferences.hidden = true;
    sendTest.hidden = true;
    status.textContent = result?.serverDisabled === false
      ? 'Notifications are off on this device. Server cleanup could not be confirmed, but this browser subscription was removed.'
      : 'Notifications are off for this device.';
  } catch (error) { status.textContent = error?.message || 'Could not turn off notifications. Try again.'; }
  finally { disable.disabled = false; }
});

sendTest.addEventListener('click', async () => {
  sendTest.disabled = true;
  status.textContent = 'Sending a test notification to this device…';
  try {
    await sendCoastalTestNotification();
    status.textContent = 'Test notification sent. Check this device’s notification center.';
  } catch (error) {
    status.textContent = error?.message || 'Could not send a test notification. Try again later.';
  } finally { sendTest.disabled = false; }
});

preferences.addEventListener('change', async event => {
  if (event.target?.type !== 'checkbox') return;
  const before = getPrefs();
  const next = currentPrefs();
  const inputs = [...preferences.querySelectorAll('input[type="checkbox"]')];
  inputs.forEach(input => { input.disabled = true; });
  status.textContent = 'Saving notification preferences…';
  try {
    const result = await updateCoastalNotificationPreferences(next);
    const confirmed = result?.preferences || next;
    localStorage.setItem(prefsStorageKey, JSON.stringify(confirmed));
    setPrefs(confirmed);
    status.textContent = 'Notification preferences updated.';
  } catch (error) {
    setPrefs(before);
    status.textContent = (error?.message || 'Could not save notification preferences.') + ' Your previous choices were restored.';
  } finally {
    inputs.forEach(input => { input.disabled = false; });
  }
});

initialize().catch(() => { status.textContent = 'Notification settings could not be checked. The rest of SacoCast remains available.'; });
