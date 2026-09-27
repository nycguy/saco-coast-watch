import importlib.util, pathlib, sys, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT/'scripts'))
P=ROOT/'scripts'/'capture_history.py'; S=importlib.util.spec_from_file_location('capture_history',P); c=importlib.util.module_from_spec(S); S.loader.exec_module(c)
class CaptureTests(unittest.TestCase):
 def test_ndbc_parser(self):
  raw='''#YY MM DD hh mm WDIR WSPD GST WVHT DPD
#yr mo dy hr mn degT m/s m/s m sec
2026 09 27 12 00 090 5.0 7.0 1.2 8
2026 09 27 11 50 999 4.0 99.0 1.1 8
'''
  rows=c.parse_ndbc(raw,'44007'); self.assertEqual(len(rows),2); self.assertEqual(rows[0]['speed_mph'],8.9); self.assertIsNone(rows[0]['gust_mph']); self.assertEqual(rows[1]['gust_mph'],15.7)
 def test_thresholds_on_seed(self):
  ft=11.82; self.assertEqual(c.hc.threshold_margins(ft),{'minor':0.18,'moderate':1.18,'major':2.18})
 def test_local_classification(self):
  t='Camp Ellis road closed after high surf and flooding'; self.assertEqual(c.event_location(t),'Camp Ellis'); self.assertEqual(c.event_category(t),'flooding')
 def test_weather_topic_rejects_general_local_events(self):
  for title in ('Monmouth Academy Girls Varsity Soccer @ Old Orchard Beach','Biddeford Primary School celebrates new wing','Old Orchard Beach football wins showdown with Old Town','Local Flavor: Biddeford arcade reopening and burger night'):
   self.assertFalse(c.coastal_topic(title),title)
  self.assertTrue(c.coastal_topic('Camp Ellis road closed after high surf and coastal flooding'))
  self.assertTrue(c.coastal_topic('Old Orchard Beach sees rough seas and gusty winds'))
 def test_compact_history_filters_old(self):
  hist={'generated_at':'2026-09-27T12:00:00Z','window_basis':'fixed','station':'8418150','thresholds_ft_mllw':{},'snapshots':[{'snapshot_at':'2026-09-10T12:00:00Z'},{'snapshot_at':'2026-09-27T11:00:00Z'}],'daily_rollups':[],'alert_events':[],'local_events':[],'backfill':{},'provenance_notes':{}}
  self.assertEqual(len(c.compact_history(hist,7)['snapshots']),1)
 def test_ndbc_parser_retains_sea_state_and_storm_reasons(self):
  raw='''#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
#yr mo dy hr mn degT m/s m/s m sec sec degT hPa degC degC degC nmi hPa ft
26 09 27 15 00 090 12.0 18.0 2.0 12.0 8.0 100 985.5 10.0 12.0 8.0 MM -3.2 MM
'''
  row=c.parse_ndbc(raw,'44007')[0]
  self.assertEqual(row['wave_height_ft'],6.6)
  self.assertEqual(row['pressure_mb'],985.5)
  self.assertEqual(row['pressure_tendency_mb'],-3.2)
  snap={'water':{'forecast_peak_72h_ft':11.0,'residual_current_ft':0.8},'marine':{'stations':{'44007':row}},'alerts':[]}
  reasons=c.storm_reasons(snap)
  self.assertTrue(any('residual' in x.lower() for x in reasons))
  self.assertTrue(any('wave' in x.lower() for x in reasons))
 def test_storm_reasons_include_adaptive_mode(self):
  snap={'water':{},'marine':{'stations':{}},'alerts':[],'hazards':{'active_modes':[{'code':'winter','label':'Winter Storm'}]}}
  self.assertTrue(any('Winter Storm' in x for x in c.storm_reasons(snap)))
if __name__=='__main__': unittest.main()
