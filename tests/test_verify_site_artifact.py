import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('verify_site_artifact', ROOT / 'scripts/verify_site_artifact.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        (self.root / 'eastcast/data').mkdir(parents=True)
        (self.root / 'data/webcams').mkdir(parents=True)
        (self.root / 'css').mkdir()
        (self.root / 'js').mkdir()
        (self.root / 'index.html').write_text('<link href="css/app.css"><script src="js/app.js"></script><script type="module" src="js/push-ui.mjs"></script><script type="module" src="js/abellona-player.mjs"></script>')
        (self.root / 'eastcast/index.html').write_text('<link href="style.css">')
        (self.root / 'manifest.webmanifest').write_text(json.dumps({'display':'standalone','icons':[{'src':'icon.png'}]}))
        for p in ('css/app.css', 'js/app.js', 'js/push-ui.mjs', 'js/push-subscriptions.mjs', 'js/abellona-player.mjs', 'eastcast/style.css', 'icon.png', 'favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'sacocast-app-icon-192.png', 'push-sw.js'):
            (self.root / p).write_text('ok')
        (self.root / 'data/wind.json').write_text(json.dumps({'stations': {}}))
        (self.root / 'data/coastal-alerts.json').write_text(json.dumps({'features': []}))
        (self.root / 'data/hazards.json').write_text(json.dumps({'schema_version': 1, 'active_modes': [], 'alerts': [], 'marine_alerts': [], 'hourly': [], 'hourly_full': [], 'errors': {}}))
        (self.root / 'data/coastal-briefing.json').write_text(json.dumps({'schema_version': 2, 'current_snapshot': {}}))
        history = {'schema_version': 2, 'thresholds_ft_mllw': {'minor': 12.0, 'moderate': 13.0, 'major': 14.0}, 'snapshots': [{'snapshot_at': '2026-10-15T12:00:00Z'}]}
        (self.root / 'data/coastal-history.json').write_text(json.dumps(history))
        (self.root / 'data/webcams/webcams.json').write_text(json.dumps({'schema_version': 1, 'cameras': {'ferry_beach': {}, 'abellona': {}}}))
        (self.root / 'eastcast/data/snapshot.json').write_text(json.dumps({'schema_version': 2}))
    def tearDown(self):
        self.tmp.cleanup()
    def test_complete_artifact(self):
        MODULE.verify(self.root)
    def test_missing_script_fails(self):
        (self.root / 'js/app.js').unlink()
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)
    def test_missing_icon_fails(self):
        (self.root / 'icon.png').unlink()
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)
    def test_missing_push_service_worker_fails(self):
        (self.root / 'push-sw.js').unlink()
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)
    def test_missing_push_subscription_module_fails(self):
        (self.root / 'js/push-subscriptions.mjs').unlink()
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)
    def test_missing_abellona_player_module_fails(self):
        (self.root / 'js/abellona-player.mjs').unlink()
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)
    def test_missing_data_fails(self):
        (self.root / 'data/hazards.json').unlink()
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)
    def test_briefing_rejects_duplicated_history(self):
        (self.root / 'data/coastal-briefing.json').write_text(json.dumps({'history': [], 'history_compact': []}))
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)
    def test_briefing_enforces_mobile_payload_budget(self):
        (self.root / 'data/coastal-briefing.json').write_text(json.dumps({'note': 'x' * 1_000_000}))
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)

    def test_malformed_critical_json_fails_artifact_validation(self):
        (self.root / 'data/hazards.json').write_text('{malformed')
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)

    def test_history_without_timestamped_snapshots_fails_artifact_validation(self):
        history = {'schema_version': 2, 'thresholds_ft_mllw': {'minor': 12.0, 'moderate': 13.0, 'major': 14.0}, 'snapshots': [{}]}
        (self.root / 'data/coastal-history.json').write_text(json.dumps(history))
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)

    def test_threshold_datum_contract_mismatch_fails_artifact_validation(self):
        history = {'schema_version': 2, 'thresholds_ft_mllw': {'minor': 12.0, 'moderate': 13.0, 'major': 14.1}, 'snapshots': [{'snapshot_at': '2026-10-15T12:00:00Z'}]}
        (self.root / 'data/coastal-history.json').write_text(json.dumps(history))
        with self.assertRaises(SystemExit):
            MODULE.verify(self.root)

if __name__ == '__main__':
    unittest.main()
