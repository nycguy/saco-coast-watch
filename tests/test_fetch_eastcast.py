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

if __name__ == "__main__":
    unittest.main()
