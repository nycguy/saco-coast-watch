import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_data_manifest", ROOT / "scripts/build_data_manifest.py")
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class DataManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.data = self.root / "data"
        self.data.mkdir()
        stamp = "2026-11-27T03:00:00Z"
        docs = {
            "data/wind.json": {"generated_at": stamp, "stations": {}},
            "data/coastal-alerts.json": {"generatedAt": stamp, "features": []},
            "data/hazards.json": {"schema_version": 1, "active_modes": [], "alerts": [], "marine_alerts": [], "hourly": [], "hourly_full": [], "errors": {}},
            "data/coastal-briefing.json": {"schema_version": 2, "generated_at": stamp, "current_snapshot": {}},
            "data/coastal-history.json": {"schema_version": 2, "generated_at": stamp, "thresholds_ft_mllw": {"minor": 12.0, "moderate": 13.0, "major": 14.0}, "snapshots": [{"snapshot_at": stamp}]},
            "data/webcams/webcams.json": {"schema_version": 1, "generated_at": stamp, "cameras": {}},
            "eastcast/data/snapshot.json": {"schema_version": 2, "generated_at": stamp, "summary": {}},
        }
        for name, doc in docs.items():
            path = self.data / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(doc), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_manifest_is_deterministic_and_records_hashes(self):
        out = self.root / "current/manifest.json"
        manifest = MOD.build(self.data, out, "2026-11-27T03:01:00Z")
        self.assertEqual(manifest["manifest_schema_version"], 1)
        self.assertEqual(len(manifest["datasets"]), 7)
        self.assertEqual(manifest["datasets"]["data/hazards.json"]["path"], "current/data/hazards.json")
        self.assertEqual(len(manifest["datasets"]["data/wind.json"]["sha256"]), 64)
        self.assertEqual(json.loads(out.read_text())["publication_id"], manifest["publication_id"])

    def test_interrupted_publication_input_is_rejected(self):
        (self.data / "data/hazards.json").write_text("{interrupted", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "malformed JSON"):
            MOD.build(self.data, self.root / "manifest.json", "2026-11-27T03:01:00Z")

    def test_missing_dataset_is_rejected_before_publication(self):
        (self.data / "data/coastal-history.json").unlink()
        with self.assertRaisesRegex(ValueError, "missing or empty"):
            MOD.build(self.data, self.root / "manifest.json", "2026-11-27T03:01:00Z")


if __name__ == "__main__":
    unittest.main()
