import datetime as dt, importlib.util, pathlib, sys, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT/'scripts'))
P=ROOT/'scripts'/'fetch_briefing.py'; S=importlib.util.spec_from_file_location('fetch_briefing',P); f=importlib.util.module_from_spec(S); S.loader.exec_module(f)
UTC=dt.timezone.utc
class BriefingTests(unittest.TestCase):
 def test_fixed_24h_comparison_and_margin(self):
  now=dt.datetime(2026,9,27,12,tzinfo=UTC)
  old={'snapshot_at':'2026-09-26T12:00:00Z','snapshot_kind':'backfill_model_cycle','provenance':{'forecast':'NOAA CO-OPS archived GoMOFS station forecast NetCDF'},'water':{'forecast_peak_72h_ft':11.35,'forecast_peak_72h_time':'2026-09-28T04:00:00Z'},'alerts':[]}
  cur={'snapshot_at':'2026-09-27T12:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'observed_24h_max_ft':10.9,'observed_24h_max_time':'2026-09-27T04:00:00Z','forecast_peak_24h_ft':11.5,'forecast_peak_24h_time':'2026-09-28T04:00:00Z','forecast_peak_72h_ft':11.82,'forecast_peak_72h_time':'2026-09-28T16:00:00Z','astronomical_tide_at_peak_ft':10.7,'model_uplift_ft':1.12},'forecast_conditions':{},'marine':{'stations':{}},'alerts':[]}
  hist={'schema_version':2,'generated_at':'2026-09-27T11:00:00Z','window_basis':'fixed','station':'8418150','thresholds_ft_mllw':{},'snapshots':[old],'daily_rollups':[],'alert_events':[],'local_events':[],'backfill':{'water_observed_daily_peaks':[]},'provenance_notes':{}}
  d=f.build_payload(cur,hist,now); c=d['forecast_change_24h']['comparison']
  self.assertEqual(c['peak_delta_ft'],0.47); self.assertEqual(c['current_threshold_margins_ft']['minor'],0.18)
  self.assertIn('shrank by 0.47 ft',d['forecast_change_24h']['text']); self.assertIn('never based on a visitor',d['window_basis'])
 def test_local_pulse_excludes_non_weather_events(self):
  now=dt.datetime(2026,9,27,12,tzinfo=UTC)
  cur={'snapshot_at':'2026-09-27T12:00:00Z','water':{'forecast_peak_72h_ft':11.8,'forecast_peak_72h_time':'2026-09-28T16:00:00Z'},'forecast_conditions':{},'marine':{'stations':{}},'alerts':[]}
  hist={'schema_version':2,'generated_at':'2026-09-27T11:00:00Z','snapshots':[],'alert_events':[],'local_events':[
   {'published_at':'2026-09-27T10:00:00Z','source':'Local News','headline':'Old Orchard Beach football wins showdown with Old Town','summary':'Old Orchard Beach football wins showdown with Old Town','url':'https://example.test/sports'},
   {'published_at':'2026-09-27T09:00:00Z','source':'Local News','headline':'Camp Ellis sees high surf and coastal flooding','summary':'Camp Ellis sees high surf and coastal flooding','url':'https://example.test/weather'}
  ],'backfill':{},'daily_rollups':[]}
  d=f.build_payload(cur,hist,now)
  self.assertEqual(len(d['local_pulse']['items']),1)
  self.assertIn('high surf',d['local_pulse']['items'][0]['title'])
  self.assertIn('1 weather/coastal public report',d['local_pulse']['summary'])
 def test_unavailable_baseline_does_not_infer(self):
  now=dt.datetime(2026,9,27,12,tzinfo=UTC)
  cur={'snapshot_at':'2026-09-27T12:00:00Z','water':{'forecast_peak_72h_ft':11.8,'forecast_peak_72h_time':'2026-09-28T16:00:00Z'},'forecast_conditions':{},'marine':{'stations':{}},'alerts':[]}
  hist={'schema_version':2,'generated_at':'2026-09-27T11:00:00Z','snapshots':[],'alert_events':[],'local_events':[],'backfill':{},'daily_rollups':[]}
  d=f.build_payload(cur,hist,now)
  self.assertIsNone(d['forecast_change_24h']['comparison']); self.assertIn('not available',d['forecast_change_24h']['text'])
  self.assertIn('no forecast-change value is being inferred',d['forecast_change_24h']['text'])
 def test_forecast_evolution_storm_mode_and_timeline(self):
  now=dt.datetime(2026,9,27,12,tzinfo=UTC)
  old24={'snapshot_at':'2026-09-26T12:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':11.2,'forecast_peak_72h_time':'2026-09-28T04:00:00Z'},'alerts':[]}
  old12={'snapshot_at':'2026-09-27T00:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':11.5,'forecast_peak_72h_time':'2026-09-28T08:00:00Z'},'alerts':[]}
  old6={'snapshot_at':'2026-09-27T06:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':11.7,'forecast_peak_72h_time':'2026-09-28T10:00:00Z'},'alerts':[]}
  cur={'snapshot_at':'2026-09-27T12:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'observed_24h_max_ft':11.0,'observed_24h_max_time':'2026-09-27T10:00:00Z','residual_24h_max_ft':1.1,'residual_24h_max_time':'2026-09-27T09:00:00Z','forecast_peak_24h_ft':11.8,'forecast_peak_24h_time':'2026-09-28T10:00:00Z','forecast_peak_72h_ft':12.1,'forecast_peak_72h_time':'2026-09-28T12:00:00Z','astronomical_tide_at_peak_ft':10.8,'model_uplift_ft':1.3},'forecast_conditions':{},'marine':{'stations':{'44007':{'wave_height_ft':7.2,'max_24h_wave_height_ft':8.0,'max_24h_wave_at':'2026-09-27T08:00:00Z','max_24h_gust_mph':38.0,'max_24h_gust_at':'2026-09-27T07:00:00Z'}}},'alerts':[],'storm_mode':{'active':True,'reasons':['wave'],'basis':'test'}}
  hist={'schema_version':2,'generated_at':'2026-09-27T11:00:00Z','window_basis':'fixed','station':'8418150','thresholds_ft_mllw':{},'snapshots':[old24,old12,old6],'daily_rollups':[],'alert_events':[],'local_events':[],'backfill':{'water_observed_daily_peaks':[]},'provenance_notes':{}}
  d=f.build_payload(cur,hist,now)
  self.assertEqual([x['label'] for x in d['forecast_evolution']['items']],['24h ago','12h ago','6h ago','Now'])
  self.assertTrue(d['storm_mode']['active'])
  titles=[x['title'] for x in d['impact_timeline']]
  self.assertTrue(any('residual' in x.lower() for x in titles))
  self.assertTrue(any('wave' in x.lower() for x in titles))
if __name__=='__main__': unittest.main()
