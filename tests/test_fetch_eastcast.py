import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_eastcast", ROOT / "scripts" / "fetch_eastcast.py")
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

class EastCastFetchTests(unittest.TestCase):
    def feature(self,event,state="NY",severity="Moderate"):
        return {
            "id":event+state,
            "properties":{
                "event":event,
                "severity":severity,
                "geocode":{"UGC":[state+"Z001"]},
                "headline":event+" headline",
            }
        }

    def test_extract_states_from_ugc(self):
        f=self.feature("Coastal Flood Warning","NJ")
        self.assertEqual(mod.extract_states(f),["NJ"])

    def test_dedupe_features(self):
        f=self.feature("Wind Advisory","NY")
        self.assertEqual(len(mod.dedupe_features([f,f])),1)

    def test_summary_counts_and_top_state(self):
        fs=[
            self.feature("Coastal Flood Warning","NJ","Severe"),
            self.feature("Wind Advisory","NJ","Moderate"),
            self.feature("High Wind Watch","NY","Moderate"),
        ]
        s=mod.summarize_alerts(fs)
        self.assertEqual(s["active_alerts"],3)
        self.assertEqual(s["warnings"],1)
        self.assertEqual(s["states_affected"],2)
        self.assertEqual(s["top_states"][0]["code"],"NJ")

    def test_parse_ndfd_times(self):
        xml=b"""<?xml version='1.0'?>
        <WMS_Capabilities><Capability><Layer>
          <Layer><Name>ndfd.conus.qpf</Name><Dimension name='VTIT'>2026-09-25T12:00,2026-09-25T18:00</Dimension></Layer>
          <Layer><Name>ndfd.conus.wgust</Name><Extent name='vtit'>2026-09-25T13:00,2026-09-25T14:00</Extent></Layer>
        </Layer></Capability></WMS_Capabilities>"""
        out=mod.parse_ndfd_times(xml)
        self.assertEqual(out["ndfd.conus.qpf"],["2026-09-25T12:00","2026-09-25T18:00"])
        self.assertEqual(out["ndfd.conus.wgust"],["2026-09-25T13:00","2026-09-25T14:00"])

    def test_compact_alert_keeps_timing_and_states(self):
        f=self.feature("High Wind Warning","MA","Severe")
        f["properties"]["ends"]="2026-09-25T20:00:00Z"
        c=mod.compact_alert(f)
        self.assertEqual(c["event"],"High Wind Warning")
        self.assertEqual(c["states"],["MA"])
        self.assertEqual(c["ends"],"2026-09-25T20:00:00Z")

    def test_parse_ndbc_latest_converts_units(self):
        text = """#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP
#yr mo dy hr mn degT m/s m/s m sec sec degT hPa degC degC degC
26 09 25 11 00 045 10.0 15.0 2.0 8 7 090 1005.0 20.0 19.0 18.0
"""
        out=mod.parse_ndbc_latest(text)
        self.assertAlmostEqual(out["wind_kt"],19.4,places=1)
        self.assertAlmostEqual(out["gust_kt"],29.2,places=1)
        self.assertAlmostEqual(out["wave_ft"],6.6,places=1)
        self.assertEqual(out["dominant_period_s"],8.0)

    def test_tide_departure_uses_nearest_prediction(self):
        obs={"t":"2026-09-25 12:04","v":"11.20"}
        preds=[
            {"t":"2026-09-25 12:00","v":"10.50"},
            {"t":"2026-09-25 12:06","v":"10.60"},
        ]
        self.assertEqual(mod.tide_departure(obs,preds),0.60)

    def test_next_high_tide_finds_first_future_local_maximum(self):
        now=mod.dt.datetime(2026,9,25,12,0,tzinfo=mod.dt.timezone.utc)
        preds=[
            {"t":"2026-09-25 12:00","v":"8.0"},
            {"t":"2026-09-25 12:06","v":"8.5"},
            {"t":"2026-09-25 12:12","v":"9.0"},
            {"t":"2026-09-25 12:18","v":"8.7"},
            {"t":"2026-09-25 18:00","v":"8.2"},
        ]
        high=mod.next_high_tide(preds,now)
        self.assertEqual(high["time"],"2026-09-25T12:12:00Z")
        self.assertEqual(high["ft"],9.0)

if __name__ == "__main__":
    unittest.main()
