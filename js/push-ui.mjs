import {
  pushCapability, readPushCredential, getCoastalPushConfiguration, enrollCoastalNotifications, getCoastalNotificationPreferences, sendCoastalTestNotification,
  updateCoastalNotificationPreferences, disableCoastalNotifications, getCoastalThresholdPreferences,
  saveCoastalThresholdPreferences, requestCoastalThresholdEmail,
} from './push-subscriptions.mjs?v=20261013-7';

const byId = id => document.getElementById(id);
const alertsButton = byId('alertsButton');
const alertsDialog = byId('alertsDialog');
const alertsDialogTitle = byId('alertsDialogTitle');
const alertsClose = byId('alertsClose');
const status = byId('pushStatus');
const panel = byId('pushPanel');
const enable = byId('pushEnable');
const settings = byId('pushSettings');
const emailOnlyEntry = byId('emailOnlyEntry');
const emailOnlyLink = byId('emailOnlyLink');
const sendTest = byId('pushTest');
const disable = byId('pushDisable');
const preferences = byId('pushPreferences');
const thresholdPreferences = byId('thresholdPreferences');
const thresholdChannelPush = byId('thresholdChannelPush');
const thresholdChannelEmail = byId('thresholdChannelEmail');
const thresholdEmailField = byId('thresholdEmailField');
const thresholdEmailAddress = byId('thresholdEmailAddress');
const thresholdLinkedEmail = byId('thresholdLinkedEmail');
const thresholdSave = byId('thresholdSave');
const thresholdStatus = byId('thresholdStatus');
const prefsStorageKey = 'sacocast.push.preferences.v1';
const emailLinkedStorageKey = 'sacocast.alerts.email-linked.v1';
let pushConfig = null;
let thresholdSettingsLoaded = false;
let linkedThresholdEmail = null;
const thresholdSpecs = [
  ['waterObserved', 12], ['waterForecast', 12], ['wind', 30], ['gust', 45], ['tempHigh', 90], ['tempLow', 32],
];
updateAlertsEntryState();
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
function hasKnownEmailAlerts() { return localStorage.getItem(emailLinkedStorageKey) === 'true'; }
function hasSavedAlerts() { return Boolean(readPushCredential() || hasKnownEmailAlerts()); }
function updateAlertsEntryState() {
  const saved = hasSavedAlerts();
  alertsButton.textContent = saved ? 'Manage Alerts' : 'Create Alerts';
  alertsDialogTitle.textContent = saved ? 'Manage Alerts' : 'Create Alerts';
  emailOnlyLink.href = hasKnownEmailAlerts()
    ? 'https://saco-coastal-alerts.mikewiley-nyc.workers.dev/alerts/manage'
    : 'https://saco-coastal-alerts.mikewiley-nyc.workers.dev/alerts';
  emailOnlyLink.textContent = hasKnownEmailAlerts() ? 'Manage Email Alerts ↗' : 'Create Email-Only Alerts ↗';
}
function showEnrolled() {
  panel.classList.add('enrolled');
  enable.hidden = true;
  settings.hidden = false;
  emailOnlyEntry.hidden = true;
  setPrefs(getPrefs());
  updateAlertsEntryState();
}
function showNotEnrolled() {
  panel.classList.remove('enrolled');
  settings.hidden = true;
  enable.hidden = false;
  emailOnlyEntry.hidden = false;
  updateAlertsEntryState();
}


function thresholdPrefsFromForm() {
  const metrics = {};
  let selected = 0;
  for (const [id, fallback] of thresholdSpecs) {
    const enabled = byId(`threshold-${id}-enabled`).checked;
    const threshold = Number(byId(`threshold-${id}-value`).value || fallback);
    metrics[id] = { enabled, threshold };
    if (enabled) selected++;
  }
  return { preferences: { metrics, channels: { push: thresholdChannelPush.checked, email: thresholdChannelEmail.checked } }, selected };
}
function renderThresholdEmailState() {
  const wantsEmail = thresholdChannelEmail.checked;
  thresholdEmailField.hidden = !wantsEmail || !!linkedThresholdEmail;
  thresholdLinkedEmail.hidden = !linkedThresholdEmail;
  thresholdLinkedEmail.textContent = linkedThresholdEmail ? `Email delivery linked to ${linkedThresholdEmail}.` : '';
}
function renderThresholdPreferences(result) {
  const prefs = result?.preferences;
  if (!prefs) return;
  for (const [id, fallback] of thresholdSpecs) {
    const item = prefs.metrics?.[id] || { enabled: false, threshold: fallback };
    byId(`threshold-${id}-enabled`).checked = item.enabled === true;
    byId(`threshold-${id}-value`).value = Number.isFinite(Number(item.threshold)) ? item.threshold : fallback;
  }
  thresholdChannelPush.checked = prefs.channels?.push === true;
  thresholdChannelEmail.checked = prefs.channels?.email === true;
  linkedThresholdEmail = result.linkedEmail || null;
  if (linkedThresholdEmail) localStorage.setItem(emailLinkedStorageKey, 'true');
  renderThresholdEmailState();
  updateAlertsEntryState();
  const count = Object.values(prefs.metrics || {}).filter(item => item?.enabled === true).length;
  thresholdStatus.textContent = count ? `${count} custom threshold alert${count === 1 ? '' : 's'} configured.` : 'No custom threshold alerts are selected.';
}
async function loadThresholdPreferences() {
  if (!pushConfig?.thresholdsEnabled || !readPushCredential()) {
    thresholdPreferences.hidden = true;
    return;
  }
  thresholdPreferences.hidden = false;
  try {
    const result = await getCoastalThresholdPreferences();
    renderThresholdPreferences(result);
    thresholdSettingsLoaded = true;
  } catch (error) {
    thresholdStatus.textContent = error?.message || 'Custom threshold settings could not be loaded.';
  }
}

async function initialize() {
  updateAlertsEntryState();
  showNotEnrolled();
  try {
    pushConfig = await getCoastalPushConfiguration();
    if (!pushConfig) {
      enable.disabled = true;
      status.textContent = 'App notifications are temporarily unavailable. Email alerts remain available.';
      return;
    }
  } catch (_) {
    enable.disabled = true;
    status.textContent = 'App notifications could not be checked. Email alerts remain available.';
    return;
  }
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
  const registration = await navigator.serviceWorker.register('./push-sw.js', { scope: './' }).catch(() => navigator.serviceWorker.getRegistration('./').catch(() => null));
  const existing = await registration?.pushManager?.getSubscription().catch(() => null);
  if (existing && readPushCredential()) {
    showEnrolled();
    try {
      const saved = await getCoastalNotificationPreferences();
      if (saved) { localStorage.setItem(prefsStorageKey, JSON.stringify(saved)); setPrefs(saved); }
      status.textContent = 'App notifications are on for this device.';
      await loadThresholdPreferences();
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
    status.textContent = 'App notifications are on for this device.';
    await loadThresholdPreferences();
  } catch (error) {
    status.textContent = error?.message || 'Could not enable notifications. Try again later.';
  } finally { enable.disabled = Notification.permission === 'denied'; }
});

alertsButton.addEventListener('click', async () => {
  updateAlertsEntryState();
  if (typeof alertsDialog.showModal === 'function') alertsDialog.showModal();
  else alertsDialog.setAttribute('open', '');
  if (readPushCredential() && !thresholdSettingsLoaded) await loadThresholdPreferences();
});
alertsClose.addEventListener('click', () => {
  if (typeof alertsDialog.close === 'function') alertsDialog.close();
  else alertsDialog.removeAttribute('open');
});
alertsDialog.addEventListener('click', event => {
  if (event.target === alertsDialog) {
    if (typeof alertsDialog.close === 'function') alertsDialog.close();
    else alertsDialog.removeAttribute('open');
  }
});

disable.addEventListener('click', async () => {
  disable.disabled = true;
  try {
    const result = await disableCoastalNotifications();
    showNotEnrolled();
    enable.disabled = false;
    status.textContent = result?.serverDisabled === false
      ? 'App notifications are off on this device. Server cleanup could not be confirmed, but this browser subscription was removed.'
      : 'App notifications are off on this device.';
    updateAlertsEntryState();
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

thresholdChannelEmail.addEventListener('change', renderThresholdEmailState);

thresholdSave.addEventListener('click', async () => {
  const { preferences: next, selected } = thresholdPrefsFromForm();
  if (selected > 0 && !next.channels.push && !next.channels.email) {
    thresholdStatus.textContent = 'Choose App notification, Email, or both for the selected thresholds.';
    return;
  }
  if (next.channels.email && !linkedThresholdEmail && !thresholdEmailAddress.validity.valid) {
    thresholdEmailField.hidden = false;
    thresholdEmailAddress.reportValidity();
    thresholdStatus.textContent = 'Enter the email address you want to use for threshold alerts.';
    return;
  }
  const inputs = [...thresholdPreferences.querySelectorAll('input,button')];
  inputs.forEach(input => { input.disabled = true; });
  thresholdStatus.textContent = 'Saving custom alert preferences…';
  try {
    const result = await saveCoastalThresholdPreferences(next);
    if (result.linkedEmail) linkedThresholdEmail = result.linkedEmail;
    if (result.emailConfirmationRequired) {
      const confirmation = await requestCoastalThresholdEmail(thresholdEmailAddress.value.trim(), next);
      thresholdStatus.textContent = `App settings saved. Check ${confirmation.maskedEmail || 'your email'} to confirm Email delivery.`;
    } else {
      thresholdStatus.textContent = selected ? 'Custom alert preferences saved.' : 'Custom threshold alerts are off.';
    }
    renderThresholdEmailState();
    updateAlertsEntryState();
  } catch (error) {
    thresholdStatus.textContent = error?.message || 'Could not save custom alert preferences.';
  } finally {
    inputs.forEach(input => { input.disabled = false; });
  }
});

initialize().catch(() => { status.textContent = 'Notification settings could not be checked. The rest of SacoCast remains available.'; });
