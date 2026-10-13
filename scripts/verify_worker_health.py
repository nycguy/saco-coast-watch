#!/usr/bin/env python3
"""Production release gate for Worker health and preserved email-alert state."""
import json
import sys
from pathlib import Path

before_path, after_path = map(Path, sys.argv[1:3])
before = json.loads(before_path.read_text())
after = json.loads(after_path.read_text())
if before.get('service') != 'saco-coastal-alerts':
    raise SystemExit('Could not identify the pre-deployment Worker; refusing to claim preservation')
if not before.get('databaseConnected') or before.get('missingTables'):
    raise SystemExit('Pre-deployment D1 health was not ready; stop before declaring a safe release')
if before.get('emailAlertsEnabled') != after.get('emailAlertsEnabled'):
    raise SystemExit('Email alert enablement changed during Worker deployment')
if not after.get('configurationReady') or not after.get('databaseConnected'):
    raise SystemExit('Deployed Worker or existing email-alert configuration is unhealthy')
if after.get('missingTables') or after.get('pushTablesMissing') or after.get('thresholdTablesMissing'):
    raise SystemExit('Deployed Worker reports missing D1 tables')
if not after.get('webPushEnabled'):
    raise SystemExit('Deployed Worker reports Web Push disabled')
if not after.get('thresholdPushEnabled'):
    raise SystemExit('Deployed Worker reports custom-threshold Web Push disabled')
if after.get('cronRequiresSetup') is not False:
    raise SystemExit('Worker cron schedule is not confirmed by source configuration')
print(json.dumps({'preexistingEmailAlertsEnabled': before.get('emailAlertsEnabled'), 'emailAlertsEnabledAfter': after.get('emailAlertsEnabled'), 'databaseConnected': True, 'webPushEnabled': True, 'thresholdPushEnabled': True, 'missingTables': [], 'pushTablesMissing': [], 'thresholdTablesMissing': []}))
