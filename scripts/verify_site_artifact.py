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
    for asset in ('favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'sacocast-app-icon-192.png', 'push-sw.js', 'js/push-ui.mjs', 'js/push-subscriptions.mjs'):
        if not (root / asset).is_file():
            missing.append(asset)
    if (root / 'manifest.webmanifest').is_file():
        manifest_data = json.loads((root / 'manifest.webmanifest').read_text(encoding='utf-8'))
        if manifest_data.get('display') != 'standalone':
            missing.append('manifest.webmanifest -> display must be standalone for iPhone Web Push')
    if (root / 'index.html').is_file() and 'js/push-ui.mjs' not in (root / 'index.html').read_text(encoding='utf-8'):
        missing.append('index.html -> notification controls script js/push-ui.mjs')
    for asset in ('data/wind.json', 'data/coastal-alerts.json', 'data/hazards.json', 'data/coastal-briefing.json', 'data/coastal-history.json', 'data/webcams/webcams.json', 'eastcast/data/snapshot.json'):
        if not (root / asset).is_file():
            missing.append(asset)
    briefing_path = root / 'data/coastal-briefing.json'
    if briefing_path.is_file():
        briefing = json.loads(briefing_path.read_text(encoding='utf-8'))
        # Durable history is published separately; duplicating it in this browser
        # payload needlessly penalizes mobile users on every briefing refresh.
        for key in ('history', 'history_compact'):
            if key in briefing:
                missing.append(f'data/coastal-briefing.json -> unexpected duplicated {key}')
        if briefing_path.stat().st_size > 1_000_000:
            missing.append('data/coastal-briefing.json -> exceeds 1 MB mobile payload budget')
    if missing:
        raise SystemExit('Missing assembled assets:\n' + '\n'.join(missing))
    print('SacoCast assembled artifact: required files and references present')

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('directory', type=Path)
    verify(ap.parse_args().directory)
