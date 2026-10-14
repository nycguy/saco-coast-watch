const DASHBOARD = 'https://nycguy.github.io/saco-coast-watch/index.html';

export const TEST_NOTIFICATION_URL = `${DASHBOARD}?openAlerts=1`;
export const COASTAL_ALERT_NOTIFICATION_URL = `${DASHBOARD}#alerts`;

const THRESHOLD_DESTINATIONS = Object.freeze({
  waterObserved: '#chart',
  waterForecast: '#chart',
  wind: '#weatherHeading',
  gust: '#weatherHeading',
  tempHigh: '#weatherHeading',
  tempLow: '#weatherHeading',
});

export function thresholdNotificationUrl(metric) {
  return `${DASHBOARD}${THRESHOLD_DESTINATIONS[metric] || ''}`;
}
