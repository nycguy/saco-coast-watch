import importlib.util, pathlib, unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
P=ROOT/'scripts'/'fetch_wind.py'
S=importlib.util.spec_from_file_location('fetch_wind',P)
w=importlib.util.module_from_spec(S); S.loader.exec_module(w)

class FetchWindTests(unittest.TestCase):
 def test_parse_sea_state_pressure_and_temperature(self):
  raw='''#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
#yr mo dy hr mn degT m/s m/s m sec sec degT hPa degC degC degC nmi hPa ft
26 09 27 15 00 090 12.0 18.0 2.0 12.0 8.0 100 985.5 10.0 12.0 8.0 MM -3.2 MM
'''
  d=w.parse(raw,'44007')
  self.assertEqual(d['id'],'44007')
  self.assertEqual(d['wave_height_ft'],6.6)
  self.assertEqual(d['dominant_period_sec'],12.0)
  self.assertEqual(d['wave_direction_deg'],100)
  self.assertEqual(d['pressure_mb'],985.5)
  self.assertEqual(d['pressure_tendency_mb'],-3.2)
  self.assertEqual(d['water_temp_f'],53.6)
  self.assertEqual(d['air_temp_f'],50.0)
  self.assertAlmostEqual(d['speed_mph'],26.8,places=1)
 def test_latest_wave_sample_can_precede_latest_wind_sample(self):
  raw='''#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
#yr mo dy hr mn degT m/s m/s m sec sec degT hPa degC degC degC nmi hPa ft
2026 10 14 17 40 190 3.0 4.0 MM MM MM MM 1006.6 12.1 13.4 11.3 MM MM MM
2026 10 14 17 20 220 3.0 3.0 1.4 7 6.1 96 1006.5 12.1 13.4 11.2 MM MM MM
'''
  d=w.parse(raw,'44007')
  self.assertEqual(d['observed_at'],'2026-10-14T17:40:00Z')
  self.assertEqual(d['wave_observed_at'],'2026-10-14T17:20:00Z')
  self.assertEqual(d['wave_height_ft'],4.6)
  self.assertEqual(d['dominant_period_sec'],7.0)
 def test_parse_distinguishes_malformed_response_from_missing_observation(self):
  with self.assertRaises(w.MalformedFeedError):
   w.parse('<html>service unavailable</html>','44007')
  raw='''#YY MM DD hh mm WDIR WSPD GST WVHT
2026 10 14 17 40 190 MM MM MM
'''
  with self.assertRaises(w.NoWindObservation):
   w.parse(raw,'44007')

if __name__=='__main__':
 unittest.main()
