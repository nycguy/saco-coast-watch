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
 def test_forecast_evolution_recent_event_and_timeline(self):
  now=dt.datetime(2026,9,27,12,tzinfo=UTC)
  old24={'snapshot_at':'2026-09-26T12:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':11.2,'forecast_peak_72h_time':'2026-09-28T04:00:00Z'},'alerts':[]}
  old12={'snapshot_at':'2026-09-27T00:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':11.5,'forecast_peak_72h_time':'2026-09-28T08:00:00Z'},'alerts':[]}
  old6={'snapshot_at':'2026-09-27T06:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':11.7,'forecast_peak_72h_time':'2026-09-28T10:00:00Z'},'alerts':[]}
  cur={'snapshot_at':'2026-09-27T12:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'observed_24h_max_ft':11.0,'observed_24h_max_time':'2026-09-27T10:00:00Z','residual_24h_max_ft':1.1,'residual_24h_max_time':'2026-09-27T09:00:00Z','forecast_peak_24h_ft':11.8,'forecast_peak_24h_time':'2026-09-28T10:00:00Z','forecast_peak_72h_ft':12.1,'forecast_peak_72h_time':'2026-09-28T12:00:00Z','astronomical_tide_at_peak_ft':10.8,'model_uplift_ft':1.3},'forecast_conditions':{},'marine':{'stations':{'44007':{'wave_height_ft':7.2,'max_24h_wave_height_ft':8.0,'max_24h_wave_at':'2026-09-27T08:00:00Z','max_24h_gust_mph':38.0,'max_24h_gust_at':'2026-09-27T07:00:00Z'}}},'alerts':[],'event_state':{'phase':'Recent','show_focus':False,'primary_display':'Routine Coastal Conditions','impact':{'label':'Routine','level':'green','rank':0},'recent_impact':{'label':'Elevated','level':'yellow','rank':1},'active_hazards':[],'official_alerts':[],'recent_impacts':[{'label':'Portland water-level residual'}],'reasons':[]}}
  hist={'schema_version':2,'generated_at':'2026-09-27T11:00:00Z','window_basis':'fixed','station':'8418150','thresholds_ft_mllw':{},'snapshots':[old24,old12,old6],'daily_rollups':[],'alert_events':[],'local_events':[],'backfill':{'water_observed_daily_peaks':[]},'provenance_notes':{}}
  d=f.build_payload(cur,hist,now)
  self.assertEqual([x['label'] for x in d['forecast_evolution']['items']],['24h ago','12h ago','6h ago','Now'])
  self.assertTrue(d['recent_event']['active']); self.assertEqual(d['event_state']['phase'],'Recent')
  titles=[x['title'] for x in d['impact_timeline']]
  self.assertTrue(any('above the predicted tide' in x.lower() for x in titles))
  self.assertTrue(any('wave' in x.lower() for x in titles))
 def test_event_briefing_compares_winter_guidance(self):
  now=dt.datetime(2026,1,10,12,tzinfo=UTC)
  old={'snapshot_at':'2026-01-09T12:00:00Z','water':{'forecast_peak_72h_ft':11.0},'hazards':{'winter':{'snowfall_72h_in':5.0},'rain':{'qpf_72h_in':1.0},'wind':{'max_gust_72h_mph':35}},'alerts':[]}
  cur={'snapshot_at':'2026-01-10T12:00:00Z','water':{'forecast_peak_72h_ft':11.2,'forecast_peak_24h_ft':11.1},'forecast_conditions':{},'marine':{'stations':{}},'alerts':[],'event_state':{'phase':'Approaching','show_focus':True,'primary_display':'Winter Storm','impact':{'label':'Significant','level':'orange','rank':2},'recent_impact':{'label':'Routine','level':'green','rank':0},'active_hazards':[{'code':'winter','label':'Winter Storm'}],'official_alerts':[],'recent_impacts':[],'reasons':[]},'hazards':{'active_modes':[{'code':'winter','label':'Winter Storm'}],'severity':{'level':'orange'},'winter':{'snowfall_24h_in':6.0,'snowfall_72h_in':9.0,'precip_transition_24h':'Snow'},'rain':{'qpf_72h_in':1.2},'wind':{'max_gust_24h_mph':40,'max_gust_72h_mph':45},'cold':{'min_temp_24h_f':22}}}
  hist={'schema_version':2,'generated_at':'2026-01-10T11:00:00Z','snapshots':[old],'alert_events':[],'local_events':[],'backfill':{},'daily_rollups':[]}
  data=f.build_payload(cur,hist,now)
  self.assertTrue(data['event_briefing']['active'])
  self.assertEqual(data['event_briefing']['title'],'Winter Storm Briefing')
  self.assertIn('increased by 4.0 in',data['event_briefing']['change_text'])
 def test_event_history_builds_retrospective_from_captured_states(self):
  now=dt.datetime(2026,9,29,18,tzinfo=UTC)
  state={'phase':'Recent','show_focus':False,'primary_display':'High Surf / Wave Impact','impact':{'rank':0,'label':'Routine','level':'green'},'recent_impact':{'rank':2,'label':'Significant','level':'orange'},'active_hazards':[],'official_alerts':[{'event':'High Surf Advisory'}],'recent_impacts':[],'reasons':[]}
  snap1={'snapshot_at':'2026-09-29T12:00:00Z','event_state':{**state,'phase':'Ongoing','show_focus':True,'impact':{'rank':2,'label':'Significant','level':'orange'}},'water':{'observed_24h_max_ft':11.4,'residual_24h_max_ft':1.2,'forecast_peak_72h_ft':11.9},'marine':{'stations':{'44007':{'max_24h_wave_height_ft':8.4,'max_24h_gust_mph':42}}},'hazards':{'surf':{'max_surf_height_ft':9}},'alerts':[{'event':'High Surf Advisory'}]}
  snap2={'snapshot_at':'2026-09-29T18:00:00Z','event_state':state,'water':{'observed_24h_max_ft':11.5,'residual_24h_max_ft':1.1,'forecast_peak_72h_ft':11.6},'marine':{'stations':{'44007':{'max_24h_wave_height_ft':8.0,'max_24h_gust_mph':38}}},'hazards':{'surf':{'max_surf_height_ft':7}},'alerts':[]}
  events=f._event_history([snap1],snap2,now)
  self.assertEqual(len(events),1); self.assertEqual(events[0]['title'],'High Surf / Wave Impact'); self.assertEqual(events[0]['highest_impact']['label'],'Significant'); self.assertEqual(events[0]['max_wave_ft'],8.4)
 def test_retrospective_excludes_superseded_parse_for_same_surf_product(self):
  now=dt.datetime(2026,9,29,20,tzinfo=UTC)
  bad_state={'phase':'Approaching','show_focus':True,'primary_display':'High Surf / Wave Impact','impact':{'rank':3,'label':'High Impact','level':'red'},'recent_impact':{'rank':1,'label':'Elevated','level':'yellow'},'active_hazards':[{'code':'high_surf','label':'High Surf / Wave Impact','impact_rank':3}],'official_alerts':[],'recent_impacts':[],'reasons':[]}
  good_state={'phase':'Recent','show_focus':False,'primary_display':'Routine Coastal Conditions','impact':{'rank':0,'label':'Routine','level':'green'},'recent_impact':{'rank':1,'label':'Elevated','level':'yellow'},'active_hazards':[],'official_alerts':[],'recent_impacts':[],'reasons':[]}
  snap1={'snapshot_at':'2026-09-29T18:57:39Z','event_state':bad_state,'water':{'observed_24h_max_ft':11.34,'residual_24h_max_ft':1.11,'forecast_peak_72h_ft':11.58},'marine':{'stations':{'44007':{'max_24h_wave_height_ft':6.6,'max_24h_gust_mph':26.8}}},'hazards':{'surf':{'product_id':'same-product','issued_at':'2026-09-29T18:41:00Z','max_surf_height_ft':60}},'alerts':[]}
  snap2={'snapshot_at':'2026-09-29T19:29:39Z','event_state':good_state,'water':{'observed_24h_max_ft':11.34,'residual_24h_max_ft':1.11,'forecast_peak_72h_ft':11.58},'marine':{'stations':{'44007':{'max_24h_wave_height_ft':6.6,'max_24h_gust_mph':26.8}}},'hazards':{'surf':{'product_id':'same-product','issued_at':'2026-09-29T18:41:00Z','max_surf_height_ft':5}},'alerts':[]}
  events=f._event_history([snap1],snap2,now)
  self.assertEqual(events[0]['max_surf_ft'],5.0)
  self.assertEqual(events[0]['highest_impact']['label'],'Elevated')
  self.assertEqual(events[0]['data_quality'][0]['type'],'superseded_surf_parse')
  self.assertEqual(events[0]['data_quality'][0]['count'],1)
  self.assertEqual(events[0]['captured_coverage_hours'],0.5)
  self.assertIn('not how long the storm itself lasted',events[0]['coverage_basis'])
  self.assertNotIn('event-state snapshots',events[0]['coverage_basis'])
  self.assertIn('One earlier surf value was corrected',events[0]['data_quality'][0]['message'])
  self.assertNotIn('superseded',events[0]['data_quality'][0]['message'].lower())
  self.assertNotIn('parse',events[0]['data_quality'][0]['message'].lower())
  self.assertEqual(snap1['hazards']['surf']['max_surf_height_ft'],60)
 def test_retrospective_preserves_valid_extreme_surf_from_distinct_products(self):
  now=dt.datetime(2026,9,29,20,tzinfo=UTC)
  state={'phase':'Ongoing','show_focus':True,'primary_display':'High Surf / Wave Impact','impact':{'rank':3,'label':'High Impact','level':'red'},'recent_impact':{'rank':0,'label':'Routine','level':'green'},'active_hazards':[{'code':'high_surf','label':'High Surf / Wave Impact','impact_rank':3}],'official_alerts':[{'event':'High Surf Warning'}],'recent_impacts':[],'reasons':[]}
  snap1={'snapshot_at':'2026-09-29T18:00:00Z','event_state':state,'water':{},'marine':{'stations':{}},'hazards':{'surf':{'product_id':'product-a','max_surf_height_ft':35}},'alerts':[{'event':'High Surf Warning'}]}
  snap2={'snapshot_at':'2026-09-29T19:00:00Z','event_state':state,'water':{},'marine':{'stations':{}},'hazards':{'surf':{'product_id':'product-b','max_surf_height_ft':28}},'alerts':[{'event':'High Surf Warning'}]}
  events=f._event_history([snap1],snap2,now)
  self.assertEqual(events[0]['max_surf_ft'],35.0)
  self.assertEqual(events[0]['highest_impact']['label'],'High Impact')
  self.assertEqual(events[0]['data_quality'],[])
 def test_coastal_impact_change_attributes_available_drivers(self):
  base={'event_state':{'coastal_impact':{'impact':{'score':30,'label':'Routine'},'peak_window':{'modeled_total_ft':11.4,'surf_context_ft':5,'onshore_component_mph':10}}}}
  cur={'event_state':{'coastal_impact':{'impact':{'score':48,'label':'Elevated'},'peak_window':{'modeled_total_ft':11.8,'surf_context_ft':8,'onshore_component_mph':24}}}}
  change=f._coastal_impact_change(cur,base)
  self.assertEqual(change['score_delta'],18); self.assertEqual(len(change['drivers']),3)
  self.assertEqual([driver['label'] for driver in change['drivers']],['NOAA forecast water level','NWS surf forecast','wind pushing toward shore'])
if __name__=='__main__': unittest.main()
