import datetime as dt
import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
P = ROOT / "scripts" / "fetch_hazards.py"
S = importlib.util.spec_from_file_location("fetch_hazards", P)
h = importlib.util.module_from_spec(S)
S.loader.exec_module(h)
UTC = dt.timezone.utc


class HazardTests(unittest.TestCase):
    def test_grid_accumulation_and_average_rate(self):
        now = dt.datetime(2026, 1, 1, 0, tzinfo=UTC)
        prop = {
            "uom": "wmoUnit:m",
            "values": [
                {"validTime": "2026-01-01T00:00:00+00:00/PT6H", "value": 0.1524},
                {"validTime": "2026-01-01T06:00:00+00:00/PT6H", "value": 0.0762},
            ],
        }
        self.assertAlmostEqual(h.grid_total_inches(prop, now, now + dt.timedelta(hours=12)), 9.0, places=1)
        self.assertAlmostEqual(h.grid_max_average_rate(prop, now, now + dt.timedelta(hours=12)), 1.0, places=1)

    def test_precip_category(self):
        self.assertEqual(h.precip_category("Heavy Snow"), "Snow")
        self.assertEqual(h.precip_category("Freezing Rain and Sleet"), "Wintry Mix")
        self.assertEqual(h.precip_category("Rain Showers"), "Rain")

    def test_modes_activate_for_winter_wind_and_coastal(self):
        alerts = [{"event": "Coastal Flood Watch"}, {"event": "Winter Storm Warning"}]
        winter = {"snowfall_72h_in": 8.0}
        wind = {"max_gust_72h_mph": 45, "max_sustained_72h_mph": 30}
        rain = {"qpf_72h_in": 1.0}
        cold = {"min_temp_24h_f": 20}
        tropical = {"active": False}
        codes = [mode["code"] for mode in h.detect_modes(alerts, winter, wind, rain, cold, tropical)]
        self.assertIn("winter", codes)
        self.assertIn("coastal_flood", codes)
        self.assertIn("high_wind", codes)

    def test_haversine_local_reference(self):
        self.assertLess(h.haversine_miles(h.SITE_LAT, h.SITE_LON, 43.47, -70.38), 1)


if __name__ == "__main__":
    unittest.main()
