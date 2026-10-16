#!/usr/bin/env python3
"""Validate assembled SacoCast site assets without external network access."""
import argparse
import html.parser
import json
from pathlib import Path

class LocalAssets(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []
    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        for key in ('src', 'href'):
            value = data.get(key, '')
            if value and not value.startswith(('https:', 'http:', 'data:', 'mailto:', '#', '//')):
                self.paths.append(value.split('?', 1)[0].split('#', 1)[0])

def verify(root):
    root = root.resolve()
    missing = []
    for page in (root / 'index.html', root / 'eastcast/index.html'):
        if not page.is_file():
            missing.append(str(page.relative_to(root)))
            continue
        parser = LocalAssets()
        parser.feed(page.read_text(encoding='utf-8'))
        for asset in parser.paths:
            if asset.startswith('/'):
                # GitHub Pages base path may be absolute; only check relative URLs.
                continue
            path = (page.parent / asset).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                missing.append(f'{page.relative_to(root)} -> {asset}')
    manifest = root / 'manifest.webmanifest'
    if manifest.is_file():
        data = json.loads(manifest.read_text(encoding='utf-8'))
        for icon in data.get('icons', []):
            path = root / icon['src'].lstrip('/')
            if not path.is_file():
                missing.append(f'manifest.webmanifest -> {icon["src"]}')
    else:
        missing.append('manifest.webmanifest')
    for asset in ('favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'sacocast-app-icon-192.png', 'push-sw.js', 'js/push-ui.mjs', 'js/push-subscriptions.mjs', 'js/abellona-player.mjs'):
        if not (root / asset).is_file():
            missing.append(asset)
    if (root / 'manifest.webmanifest').is_file():
        manifest_data = json.loads((root / 'manifest.webmanifest').read_text(encoding='utf-8'))
        if manifest_data.get('display') != 'standalone':
            missing.append('manifest.webmanifest -> display must be standalone for iPhone Web Push')
    if (root / 'index.html').is_file() and 'js/push-ui.mjs' not in (root / 'index.html').read_text(encoding='utf-8'):
        missing.append('index.html -> notification controls script js/push-ui.mjs')
    data_assets = ('data/wind.json', 'data/coastal-alerts.json', 'data/hazards.json', 'data/coastal-briefing.json', 'data/coastal-history.json', 'data/webcams/webcams.json', 'eastcast/data/snapshot.json')
    for asset in data_assets:
        if not (root / asset).is_file():
            missing.append(asset)
    documents = {}
    for asset in data_assets:
        path = root / asset
        if not path.is_file():
            continue
        try:
            document = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            missing.append(f'{asset} -> invalid JSON')
            continue
        if not isinstance(document, dict):
            missing.append(f'{asset} -> top-level JSON value must be an object')
            continue
        documents[asset] = document

    def require(condition, description):
        if not condition:
            missing.append(description)

    wind = documents.get('data/wind.json', {})
    require(isinstance(wind.get('stations'), dict), 'data/wind.json -> stations must be an object')
    alerts = documents.get('data/coastal-alerts.json', {})
    require(isinstance(alerts.get('features'), list), 'data/coastal-alerts.json -> features must be a list')
    hazards = documents.get('data/hazards.json', {})
    require(hazards.get('schema_version') == 1, 'data/hazards.json -> unsupported schema version')
    require(all(isinstance(hazards.get(key), list) for key in ('active_modes', 'alerts', 'marine_alerts', 'hourly', 'hourly_full')), 'data/hazards.json -> required hazard collections have invalid shapes')
    require(isinstance(hazards.get('errors'), dict), 'data/hazards.json -> errors must preserve source-health details')
    briefing = documents.get('data/coastal-briefing.json', {})
    require(briefing.get('schema_version') == 2, 'data/coastal-briefing.json -> unsupported schema version')
    require(isinstance(briefing.get('current_snapshot'), dict), 'data/coastal-briefing.json -> current_snapshot must be an object')
    history = documents.get('data/coastal-history.json', {})
    require(history.get('schema_version') == 2, 'data/coastal-history.json -> unsupported schema version')
    require(history.get('thresholds_ft_mllw') == {'minor': 12.0, 'moderate': 13.0, 'major': 14.0}, 'data/coastal-history.json -> Portland thresholds must remain 12/13/14 ft MLLW')
    snapshots = history.get('snapshots')
    require(isinstance(snapshots, list) and bool(snapshots), 'data/coastal-history.json -> timestamped snapshots are required')
    if isinstance(snapshots, list):
        require(all(isinstance(row, dict) and (row.get('snapshot_at') or row.get('generated_at')) for row in snapshots), 'data/coastal-history.json -> every snapshot requires its captured timestamp')
    webcams = documents.get('data/webcams/webcams.json', {})
    require(webcams.get('schema_version') == 1, 'data/webcams/webcams.json -> unsupported schema version')
    require(isinstance(webcams.get('cameras'), dict) and set(webcams.get('cameras', {})) == {'ferry_beach', 'abellona'}, 'data/webcams/webcams.json -> expected camera entries are required')
    eastcast = documents.get('eastcast/data/snapshot.json', {})
    require(eastcast.get('schema_version') == 2, 'eastcast/data/snapshot.json -> unsupported schema version')
    briefing_path = root / 'data/coastal-briefing.json'
    briefing = documents.get('data/coastal-briefing.json')
    if briefing_path.is_file() and isinstance(briefing, dict):
        # Durable history is published separately; duplicating it in this browser
        # payload needlessly penalizes mobile users on every briefing refresh.
        for key in ('history', 'history_compact'):
            if key in briefing:
                missing.append(f'data/coastal-briefing.json -> unexpected duplicated {key}')
        if briefing_path.stat().st_size > 1_000_000:
            missing.append('data/coastal-briefing.json -> exceeds 1 MB mobile payload budget')
    if missing:
        raise SystemExit('Invalid assembled artifact:\n' + '\n'.join(missing))
    print('SacoCast assembled artifact: required files, references, JSON schemas, and critical data contracts are valid')

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('directory', type=Path)
    verify(ap.parse_args().directory)
