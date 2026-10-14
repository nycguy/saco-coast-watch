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
        (self.root / 'index.html').write_text('<link href="css/app.css"><script src="js/app.js"></script><script type="module" src="js/push-ui.mjs"></script>')
        (self.root / 'eastcast/index.html').write_text('<link href="style.css">')
        (self.root / 'manifest.webmanifest').write_text(json.dumps({'display':'standalone','icons':[{'src':'icon.png'}]}))
        for p in ('css/app.css', 'js/app.js', 'js/push-ui.mjs', 'js/push-subscriptions.mjs', 'eastcast/style.css', 'icon.png', 'favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'sacocast-app-icon-192.png', 'push-sw.js', 'data/wind.json', 'data/coastal-alerts.json', 'data/hazards.json', 'data/coastal-history.json', 'data/webcams/webcams.json', 'eastcast/data/snapshot.json'):
            (self.root / p).write_text('ok')
        (self.root / 'data/coastal-briefing.json').write_text(json.dumps({'current_snapshot': {}}))
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

if __name__ == '__main__':
    unittest.main()
