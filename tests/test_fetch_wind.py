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

if __name__=='__main__':
 unittest.main()
