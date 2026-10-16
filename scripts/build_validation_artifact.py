#!/usr/bin/env python3
"""Assemble local UI-test files without pretending placeholder feeds are production data."""
import json
import shutil
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'dist')

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ('index.html', 'manifest.webmanifest', 'favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'sacocast-app-icon-192.png', 'push-sw.js'):
        shutil.copy2(ROOT / name, OUT / name)
    for folder in ('css', 'js', 'eastcast'):
        shutil.copytree(ROOT / folder, OUT / folder, dirs_exist_ok=True)
    (OUT / 'data').mkdir(parents=True, exist_ok=True)
    test_time = '2000-01-01T00:00:00Z'
    write_json(OUT / 'data/wind.json', {'generated_at': test_time, 'stations': {'44007': None, 'WEXM1': None}})
    write_json(OUT / 'data/coastal-alerts.json', {'generatedAt': test_time, 'source': 'test-only unavailable feed', 'features': [], 'error': 'Not collected in a validation artifact'})
    write_json(OUT / 'data/hazards.json', {'schema_version': 1, 'generated_at': test_time, 'active_modes': [], 'severity': {'level': 'unknown', 'label': 'Unavailable', 'rank': 0}, 'event_state': {}, 'alerts': [], 'marine_alerts': [], 'surf': {}, 'winter': {}, 'rain': {}, 'wind': {}, 'cold': {}, 'tropical': {}, 'hourly': [], 'hourly_full': [], 'errors': {'test': 'Not collected in a validation artifact'}})
    write_json(OUT / 'data/coastal-briefing.json', {'schema_version': 2, 'generated_at': test_time, 'status': 'unavailable', 'current_snapshot': {'water': {'latest_observed_ft': None, 'latest_observed_at': None}, 'hazards': {'errors': {'test': 'Not collected in a validation artifact'}}}})
    write_json(OUT / 'data/coastal-history.json', {'schema_version': 2, 'generated_at': test_time, 'window_basis': 'Fixed rolling windows', 'station': '8418150', 'thresholds_ft_mllw': {'minor': 12.0, 'moderate': 13.0, 'major': 14.0}, 'snapshots': [{'snapshot_at': test_time, 'snapshot_kind': 'validation_placeholder'}]})
    write_json(OUT / 'data/webcams/webcams.json', {'schema_version': 1, 'cameras': {'ferry_beach': {'status': 'unavailable'}, 'abellona': {'status': 'live_embed'}}})
    write_json(OUT / 'eastcast/data/snapshot.json', {'schema_version': 2, 'summary': {}, 'alerts': [], 'outlooks': [], 'coastal_pulse': [], 'sources': {'coastal_pulse': {'ok': True}}})
    print(f'Assembled SacoCast validation artifact at {OUT}; generated-feed placeholders are test-only.')

if __name__ == '__main__':
    main()
