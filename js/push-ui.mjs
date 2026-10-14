import {
  pushCapability, readPushCredential, getCoastalPushConfiguration, enrollCoastalNotifications, getCoastalNotificationPreferences, getCoastalNotificationHistory, sendCoastalTestNotification,
  updateCoastalNotificationPreferences, disableCoastalNotifications, getCoastalThresholdPreferences,
  saveCoastalThresholdPreferences, requestCoastalThresholdEmail,
} from './push-subscriptions.mjs?v=20261014-8';

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
const notificationHistory = byId('notificationHistory');
const notificationHistoryStatus = byId('notificationHistoryStatus');
const notificationHistoryList = byId('notificationHistoryList');
const notificationHistoryRefresh = byId('notificationHistoryRefresh');
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
let pushConfig = null;
let appPushVerified = null;
let thresholdLoadInFlight = null;
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
function updateAlertsEntryState() {
  const label = appPushVerified === null ? 'Alerts' : appPushVerified ? 'Manage Alerts' : 'Create Alerts';
  alertsButton.textContent = label;
  alertsDialogTitle.textContent = label;
  // Email subscriptions are identified through their verified address, not a
  // browser-local flag. The Worker page offers both signup and email-link
  // management without exposing cross-device account discovery.
  emailOnlyLink.href = 'https://saco-coastal-alerts.mikewiley-nyc.workers.dev/alerts';
  emailOnlyLink.textContent = 'Email Alerts (Create or Manage) ↗';
}
function showEnrolled() {
  appPushVerified = true;
  panel.classList.add('enrolled');
  enable.hidden = true;
  settings.hidden = false;
  emailOnlyEntry.hidden = false;
  notificationHistory.hidden = false;
  setPrefs(getPrefs());
  updateAlertsEntryState();
  void loadNotificationHistory();
}
function showNotEnrolled() {
  panel.classList.remove('enrolled');
  settings.hidden = true;
  enable.hidden = false;
  emailOnlyEntry.hidden = false;
  notificationHistory.hidden = true;
  sendTest.disabled = false;
  updateAlertsEntryState();
}

function historyTime(seconds) {
  const value=Number(seconds);if(!Number.isFinite(value)||value<=0)return 'Time unavailable';
  return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value*1000))+' ET';
}
async function loadNotificationHistory() {
  if(!readPushCredential())return;
  notificationHistoryRefresh.disabled=true;notificationHistoryStatus.textContent='Loading recent notifications…';notificationHistoryList.replaceChildren();
  try {
    const result=await getCoastalNotificationHistory();
    const eventItems=Array.isArray(result.items)?result.items:[];
    const thresholdItems=(Array.isArray(result.thresholdItems)?result.thresholdItems:[]).map(item=>({
      title:item.title||'Custom threshold reached',
      body:'Latest successful '+(item.channel==='email'?'email':'app')+' delivery for this threshold.',
      status:'delivered',sentAt:item.sentAt
    }));
    const items=[...eventItems,...thresholdItems].sort((a,b)=>Number(b.sentAt||b.createdAt||0)-Number(a.sentAt||a.createdAt||0)).slice(0,32);
    for(const item of items){
      const row=document.createElement('li'),head=document.createElement('div'),title=document.createElement('strong'),state=document.createElement('span'),body=document.createElement('p'),time=document.createElement('time');
      title.textContent=item.title||'Coastal event update';state.textContent=item.status==='delivered'?'Sent':'Not delivered';state.className=item.status==='delivered'?'history-delivered':'history-failed';head.append(title,state);body.textContent=item.body||'';time.textContent=historyTime(item.sentAt||item.createdAt);row.append(head,body,time);notificationHistoryList.append(row);
    }
    notificationHistoryStatus.textContent=items.length?items.length+' recent notification record'+(items.length===1?'':'s')+' shown. Threshold entries show the latest successful delivery per metric and channel.':'No retained app-event or successful custom-threshold deliveries were found for this device in the past 30 days.';
  } catch (_) { notificationHistoryStatus.textContent='Recent app and custom-threshold notification history could not be loaded. Try again later.'; }
  finally {notificationHistoryRefresh.disabled=false;}
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
    byId(`threshold-${id}-value`).value = item.threshold !== null && item.threshold !== '' && Number.isFinite(Number(item.threshold)) ? item.threshold : fallback;
  }
  thresholdChannelPush.checked = prefs.channels?.push === true;
  thresholdChannelEmail.checked = prefs.channels?.email === true;
  linkedThresholdEmail = result.linkedEmail || null;
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
  if (thresholdLoadInFlight) return thresholdLoadInFlight;
  thresholdPreferences.hidden = false;
  thresholdLoadInFlight = (async () => {
    try {
      const result = await getCoastalThresholdPreferences();
      renderThresholdPreferences(result);
    } catch (error) {
      thresholdStatus.textContent = error?.message || 'Custom threshold settings could not be loaded.';
      throw error;
    } finally { thresholdLoadInFlight = null; }
  })();
  return thresholdLoadInFlight;
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
  const permissionDenied = Notification.permission === 'denied';
  const capability = pushCapability({
    secureContext: window.isSecureContext,
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    // A denied permission prevents new enrollment, but we still need to verify
    // an existing server-owned device so Manage Alerts can offer recovery.
    notification: 'Notification' in window ? (permissionDenied ? { permission: 'default' } : Notification) : null,
    userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints || 0,
    standalone,
  });
  if (!capability.supported) {
    enable.disabled = true;
    status.textContent = capability.reason + (capability.reason?.includes('Home Screen') ? '. In Safari, use Share → Add to Home Screen, then launch the installed SacoCast icon.' : '.');
    return;
  }
  const registration = await navigator.serviceWorker.register('./push-sw.js', { scope: './' }).catch(() => navigator.serviceWorker.getRegistration('./').catch(() => null));
  const existing = await registration?.pushManager?.getSubscription().catch(() => null);
  const credential = readPushCredential();
  if (existing && credential) {
    status.textContent = 'Checking this device’s saved notification settings…';
    try {
      const saved = await getCoastalNotificationPreferences();
      if (!saved) throw new Error('This device’s notification settings could not be verified.');
      showEnrolled();
      if (saved) { localStorage.setItem(prefsStorageKey, JSON.stringify(saved)); setPrefs(saved); }
      sendTest.disabled = permissionDenied;
      status.textContent = permissionDenied
        ? 'This device is enrolled, but notifications are blocked in browser settings. Allow SacoCast notifications in iPhone Settings to receive them.'
        : 'App notifications are on for this device.';
      await loadThresholdPreferences().catch(() => {});
    } catch (error) {
      if (error?.status === 404 || error?.status === 401) {
        try {
          await disableCoastalNotifications();
          appPushVerified = false;
          showNotEnrolled();
          enable.disabled = permissionDenied;
          status.textContent = permissionDenied
            ? 'This device is no longer enrolled. Notifications are blocked in browser settings; allow SacoCast notifications there before setting it up again.'
            : 'This device is no longer enrolled for App notifications. You can set it up again if you want.';
        } catch (_) {
          appPushVerified = null;
          showNotEnrolled();
          enable.disabled = true;
          status.textContent = 'The saved App subscription could not be verified or removed. Check this browser’s notification settings before enrolling again.';
        }
      } else {
        appPushVerified = null;
        showNotEnrolled();
        enable.disabled = true;
        status.textContent = 'App notification settings could not be checked. Try again later; the existing subscription was left unchanged.';
      }
    }
  } else if (existing) {
    appPushVerified = null;
    updateAlertsEntryState();
    enable.disabled = true;
    status.textContent = 'A browser subscription already exists, but its saved control credential is missing. Keep it until you can turn it off in browser settings, then enroll again.';
  } else if (credential) {
    try {
      await disableCoastalNotifications();
      appPushVerified = false;
      showNotEnrolled();
      enable.disabled = permissionDenied;
      status.textContent = permissionDenied
        ? 'The saved App subscription is no longer active. Notifications are blocked in browser settings; allow SacoCast notifications there before setting it up again.'
        : 'The saved App subscription is no longer active in this browser. You can set it up again if you want.';
    } catch (_) {
      appPushVerified = null;
      showNotEnrolled();
      enable.disabled = true;
      status.textContent = 'App notification settings could not be checked. Try again later; your saved server record was left unchanged.';
    }
  } else {
    appPushVerified = false;
    updateAlertsEntryState();
    if (permissionDenied) {
      enable.disabled = true;
      status.textContent = 'Notifications are blocked in browser settings. Change the SacoCast notification permission there if you want to enable them.';
    }
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
  if (readPushCredential()) await loadThresholdPreferences().catch(() => {});
});
async function refreshConfirmedEmailLink() {
  if (!document.hidden && alertsDialog.open && readPushCredential()) {
    await loadThresholdPreferences().catch(() => {});
  }
}
window.addEventListener('focus', refreshConfirmedEmailLink);
document.addEventListener('visibilitychange', refreshConfirmedEmailLink);
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
notificationHistoryRefresh.addEventListener('click',loadNotificationHistory);

disable.addEventListener('click', async () => {
  disable.disabled = true;
  try {
    const result = await disableCoastalNotifications();
    appPushVerified = false;
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
    status.textContent = 'The push service accepted the test. Check this device’s notification center; acceptance does not confirm that it was displayed.';
  } catch (error) {
    if (error?.status === 410) {
      try {
        await disableCoastalNotifications();
        appPushVerified = false;
        showNotEnrolled();
        enable.disabled = Notification.permission === 'denied';
        status.textContent = 'This browser subscription expired and was removed. Turn on App notifications again to create a fresh subscription.';
      } catch (_) {
        status.textContent = 'This browser subscription expired. Turn it off in SacoCast or browser settings, then set it up again.';
      }
    } else {
      status.textContent = error?.message || 'Could not send a test notification. Try again later.';
    }
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

function openAlertsFromNotificationLink() {
  const current = new URL(window.location.href);
  if (current.searchParams.get('openAlerts') !== '1') return;
  current.searchParams.delete('openAlerts');
  const query = current.searchParams.toString();
  window.history.replaceState(null, '', `${current.pathname}${query ? `?${query}` : ''}${current.hash}`);
  alertsButton.click();
}

// Open the requested view before remote subscription checks finish so a slow
// Worker cannot make a notification tap appear to do nothing.
openAlertsFromNotificationLink();

initialize()
  .catch(() => { status.textContent = 'Notification settings could not be checked. The rest of SacoCast remains available.'; });
