import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class DataDeliveryFrontendTests(unittest.TestCase):
    def test_primary_loaders_use_independent_path_with_pages_fallback(self):
        data = (ROOT / "js/data.js").read_text(encoding="utf-8")
        self.assertIn("raw.githubusercontent.com/nycguy/saco-coast-watch/data-delivery/current", data)
        self.assertIn("getDeliveryManifest", data)
        self.assertIn("Independent data manifest is stale", data)
        self.assertIn("delivery=fallback", data)
        self.assertIn("last-known-good", data)
        for path in ("data/wind.json", "data/coastal-briefing.json", "data/hazards.json", "data/coastal-alerts.json", "data/webcams/webcams.json"):
            self.assertIn(f"getGeneratedJSON('{path}'", "\n".join((ROOT / name).read_text(encoding="utf-8") for name in ("js/marine.js", "js/briefing.js", "js/hazards.js", "js/map.js", "js/webcams.js")))

    def test_existing_pages_and_worker_contracts_remain_referenced(self):
        self.assertIn("data/coastal-history.json", (ROOT / "scripts/verify_site_artifact.py").read_text(encoding="utf-8"))
        worker = (ROOT / ".github/workflows/release-worker.yml").read_text(encoding="utf-8")
        self.assertIn("CLOUDFLARE_API_TOKEN", worker)
        self.assertNotIn("data-delivery", worker)


if __name__ == "__main__":
    unittest.main()
