import datetime as dt, importlib.util, pathlib, unittest
P=pathlib.Path(__file__).resolve().parents[1]/"scripts"/"fetch_briefing.py"
S=importlib.util.spec_from_file_location("fb",P); fb=importlib.util.module_from_spec(S); S.loader.exec_module(fb)
class T(unittest.TestCase):
 def test_history(self):
  n=dt.datetime(2026,9,27,12,tzinfo=dt.timezone.utc)
  seed=[{"generated_at":"2026-09-26T12:22:00Z","model_peak_ft":11.88},{"generated_at":"2026-09-25T17:20:00Z","model_peak_ft":11.38}]
  cur={"generated_at":fb.iso(n),"model_peak_ft":11.95,"source":"live_noaa_ofs_snapshot"}
  h=fb.merge_history(seed,[],cur,n)
  self.assertEqual(fb.choose_baseline(h,n-dt.timedelta(hours=24),7)["model_peak_ft"],11.88)
  self.assertEqual(fb.choose_baseline(h,n-dt.timedelta(hours=48),9)["model_peak_ft"],11.38)
if __name__=="__main__": unittest.main()
