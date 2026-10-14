import { classifyFreshEventTransition } from './event-transitions.mjs';
import { enqueuePushTransition, deliverQueuedPush } from './push-delivery.mjs';
import { COASTAL_ALERT_NOTIFICATION_URL } from './push-destinations.mjs';

const SOURCE = 'https://api.weather.gov/alerts/active?point=43.464,-70.380';
const MAX_FEED_AGE = 20 * 60;
const COASTAL = /coastal flood|storm surge|high surf|coastal storm|hurricane|tropical storm/i;
const stamp = () => Math.floor(Date.now() / 1000);
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');

function signature(properties) {
  const meaningful = {
    event: properties.event || '', headline: properties.headline || '',
    severity: properties.severity || '', urgency: properties.urgency || '', certainty: properties.certainty || '',
    onset: properties.onset || properties.effective || '', ends: properties.ends || properties.expires || '',
    instruction: properties.instruction || '', messageType: properties.messageType || '',
  };
  return JSON.stringify(meaningful);
}

export async function fetchCoastalAlertSnapshot(fetcher = fetch, now = Date.now()) {
  const response = await fetcher(SOURCE, {
    headers: { Accept: 'application/geo+json', 'User-Agent': 'SacoCast coastal-alert notifications (https://nycguy.github.io/saco-coast-watch/)' },
    cache: 'no-store', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`NWS active-alert feed returned ${response.status}`);
  const serverDate = Date.parse(response.headers.get('Date') || '');
  if (!Number.isFinite(serverDate) || Math.abs(now - serverDate) > MAX_FEED_AGE * 1000) throw new Error('NWS active-alert feed timestamp is stale or unavailable');
  const document = await response.json();
  if (!document || !Array.isArray(document.features) || document.type !== 'FeatureCollection' || document.pagination?.next) throw new Error('NWS active-alert response is malformed or incomplete');
  const events = new Map();
  for (const feature of document.features) {
    const p = feature?.properties;
    const alertId = p?.id || feature?.id;
    if (!p || typeof alertId !== 'string' || !COASTAL.test(String(p.event || '')) || ['Test','Exercise','Draft'].includes(p.status) || ['Test','Cancel','Error'].includes(p.messageType)) continue;
    const id = alertId.slice(0, 500);
    events.set(id, { fingerprint: await digest(signature(p)), label: String(p.headline || p.event || 'Coastal alert').slice(0, 180), source: 'Official NWS alert', updated: Date.parse(p.updated || p.sent || '') || serverDate });
  }
  return { observedAt: Math.floor(serverDate / 1000), events };
}

/** A missing/stale/invalid feed throws before state writes, so it cannot emit false endings. */
export async function processCoastalPushEvents(env, { fetcher = fetch, now = Date.now() } = {}) {
  const { observedAt, events } = await fetchCoastalAlertSnapshot(fetcher, now);
  const nowSeconds = Math.floor(now / 1000);
  const baseline = await env.DB.prepare('SELECT active FROM coastal_event_snapshots WHERE event_key=?').bind('__sacocast_nws_baseline__').first();
  const rows = await env.DB.prepare("SELECT event_key,active,fingerprint,source_observed_at FROM coastal_event_snapshots WHERE event_key<> '__sacocast_nws_baseline__'").all();
  const previousByKey = new Map((rows.results || []).map(row => [row.event_key, row]));
  const candidates = new Map();
  for (const [key, event] of events) candidates.set(key, event);
  for (const [key, previous] of previousByKey) {
    if (previous.active && !candidates.has(key)) candidates.set(key, null);
  }

  let transitions = 0;
  for (const [key, current] of candidates) {
    const previous = previousByKey.get(key);
    const next = current ? { available: true, active: true, fingerprint: current.fingerprint, observedAt } : { available: true, active: false, fingerprint: null, observedAt };
    const before = previous ? { available: true, active: previous.active === 1, fingerprint: previous.fingerprint, observedAt: previous.source_observed_at } : { available: true, active: false, fingerprint: null, observedAt: observedAt - 1 };
    // The first successful feed establishes a baseline without historical notifications.
    const kind = baseline ? classifyFreshEventTransition(before, next, nowSeconds, MAX_FEED_AGE + 60) : null;
    if (kind) {
      const detail = current || { label: 'The coastal alert is no longer active.', source: 'Official NWS alert' };
      const event = { eventKey: key, fingerprint: current?.fingerprint || previous.fingerprint, kind, title: `${kind === 'start' ? 'Coastal alert issued' : kind === 'end' ? 'Coastal alert ended' : 'Coastal alert updated'}: ${detail.label}`, body: `${detail.source}. Check SacoCast and the official NWS alert for current details.`, url: COASTAL_ALERT_NOTIFICATION_URL };
      await enqueuePushTransition(env.DB, event, nowSeconds);
      transitions++;
    }
    await env.DB.prepare('INSERT INTO coastal_event_snapshots(event_key,active,fingerprint,source_observed_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(event_key) DO UPDATE SET active=excluded.active,fingerprint=excluded.fingerprint,source_observed_at=excluded.source_observed_at,updated_at=excluded.updated_at')
      .bind(key, current ? 1 : 0, current?.fingerprint || null, observedAt, nowSeconds).run();
  }
  await env.DB.prepare('INSERT INTO coastal_event_snapshots(event_key,active,fingerprint,source_observed_at,updated_at) VALUES(?,0,NULL,?,?) ON CONFLICT(event_key) DO UPDATE SET source_observed_at=excluded.source_observed_at,updated_at=excluded.updated_at')
    .bind('__sacocast_nws_baseline__', observedAt, nowSeconds).run();
  await env.DB.prepare("DELETE FROM coastal_event_snapshots WHERE event_key<>'__sacocast_nws_baseline__' AND active=0 AND updated_at<?").bind(nowSeconds - 90 * 86400).run();
  const delivery = await deliverQueuedPush(env, nowSeconds);
  return { feedFresh: true, activeEvents: events.size, transitions, ...delivery };
}
