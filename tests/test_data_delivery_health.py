import datetime as dt
import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("check_data_delivery_health", ROOT / "scripts/check_data_delivery_health.py")
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class DataDeliveryHealthTests(unittest.TestCase):
    def manifest(self, published="2026-11-28T02:00:00Z", generated="2026-11-28T01:55:00Z"):
        return {
            "publication_id": "test-publication",
            "published_at": published,
            "datasets": {
                "data/hazards.json": {
                    "generated_at": generated,
                    "max_age_minutes": 45,
                }
            },
        }

    def test_fresh_manifest_and_dataset_pass(self):
        result = MOD.check_freshness(self.manifest(), dt.datetime(2026, 11, 28, 2, 10, tzinfo=dt.timezone.utc), 30)
        self.assertEqual(result["publication_id"], "test-publication")
        self.assertEqual(result["dataset_count"], 1)

    def test_stale_manifest_fails(self):
        with self.assertRaisesRegex(RuntimeError, "manifest publication is stale"):
            MOD.check_freshness(self.manifest(published="2026-11-28T01:00:00Z"), dt.datetime(2026, 11, 28, 2, 0, tzinfo=dt.timezone.utc), 30)

    def test_stale_dataset_fails_even_when_manifest_is_fresh(self):
        with self.assertRaisesRegex(RuntimeError, "stale datasets"):
            MOD.check_freshness(self.manifest(generated="2026-11-28T00:00:00Z"), dt.datetime(2026, 11, 28, 2, 0, tzinfo=dt.timezone.utc), 30)

    def test_future_publication_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "future-dated"):
            MOD.check_freshness(self.manifest(published="2026-11-28T02:10:00Z"), dt.datetime(2026, 11, 28, 2, 0, tzinfo=dt.timezone.utc), 30)


if __name__ == "__main__":
    unittest.main()

