import datetime as dt, importlib.util, pathlib, sys, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT/'scripts'))
P=ROOT/'scripts'/'fetch_briefing.py'; S=importlib.util.spec_from_file_location('fetch_briefing',P); f=importlib.util.module_from_spec(S); S.loader.exec_module(f)
UTC=dt.timezone.utc
class BriefingTests(unittest.TestCase):
 def test_briefing_priorities_lead_with_high_water_and_forecast_change(self):
  now=dt.datetime(2026,10,14,12,tzinfo=UTC)
  state={'coastal_impact':{'windows':[
   {'high_tide_at':'2026-10-14T18:00:00Z','modeled_total_ft':11.8,'astronomical_ft':10.7,'impact':{'score':45,'label':'Elevated'}},
   {'high_tide_at':'2026-10-15T06:00:00Z','modeled_total_ft':11.5,'impact':{'score':20,'label':'Routine'}}
  ]}}
  change={'peak_delta_ft':0.4,'threshold_margin_delta_ft':{'minor':-0.4}}
  items=f._briefing_priorities({'forecast_peak_72h_ft':11.8},change,state,now)
  self.assertEqual([item['kind'] for item in items],['high_water','forecast_change'])
  self.assertIn('higher-impact high-water',items[0]['title'].lower())
  self.assertIn('0.20 ft below',items[0]['text'])
  self.assertIn('decreased by 0.40 ft',items[1]['text'])

 def test_tide_only_priority_does_not_claim_surge_or_include_past_window(self):
  now=dt.datetime(2026,10,14,12,tzinfo=UTC)
  state={'coastal_impact':{'windows':[{'high_tide_at':'2026-10-14T11:00:00Z','astronomical_ft':11.7,'impact':{'score':2}}]}}
  items=f._briefing_priorities({},None,state,now)
  self.assertEqual(items,[])
  state['coastal_impact']['windows'][0]['high_tide_at']='2026-10-14T18:00:00Z'
  items=f._briefing_priorities({},None,state,now)
  self.assertEqual(items[0]['title'],'Next high tide')
  self.assertNotIn('highest-impact',items[0]['title'].lower())
  self.assertIn('does not include storm surge',items[0]['text'])

 def test_consequential_forecast_change_precedes_routine_high_tide(self):
  now=dt.datetime(2026,10,14,12,tzinfo=UTC)
  state={'coastal_impact':{'windows':[{'high_tide_at':'2026-10-14T18:00:00Z','astronomical_ft':10.7,'impact':{'score':0,'label':'Routine','rank':0}}]}}
  change={'previous_peak_ft':11.7,'current_peak_ft':12.2,'peak_delta_ft':0.5,'threshold_margin_delta_ft':{'minor':-0.5}}
  items=f._briefing_priorities({'forecast_peak_72h_ft':12.2},change,state,now)
  self.assertEqual([item['kind'] for item in items],['forecast_change','high_water'])
  self.assertEqual(items[1]['title'],'Next high tide')

 def test_consequential_high_water_stays_ahead_of_smaller_forecast_change(self):
  now=dt.datetime(2026,10,14,12,tzinfo=UTC)
  state={'coastal_impact':{'windows':[{'high_tide_at':'2026-10-14T18:00:00Z','modeled_total_ft':11.8,'impact':{'score':45,'label':'Elevated','rank':1}}]}}
  change={'previous_peak_ft':10.0,'current_peak_ft':10.2,'peak_delta_ft':0.2,'threshold_margin_delta_ft':{'minor':-0.2}}
  items=f._briefing_priorities({},change,state,now)
  self.assertEqual([item['kind'] for item in items],['high_water','forecast_change'])

 def test_historical_event_episodes_split_when_official_storm_identity_changes(self):
  now=dt.datetime(2026,10,14,12,tzinfo=UTC)
  def event(at,storm_id,label):
   return {'snapshot_at':at,'event_state':{'phase':'Ongoing','show_focus':True,'primary_display':label,'event_identity':{'storm_id':storm_id,'label':label},'impact':{'rank':1,'label':'Elevated'},'recent_impact':{'rank':0},'active_hazards':[],'official_alerts':[]},'water':{},'marine':{}}
  first=event('2026-10-14T10:00:00Z','AL012026','Tropical Storm A')
  second=event('2026-10-14T11:00:00Z','AL022026','Tropical Storm B')
  events=f._event_history([first],second,now)
  self.assertEqual(len(events),2)
  self.assertEqual({item['title'] for item in events},{'Tropical Storm A','Tropical Storm B'})
 def test_forecast_evolution_uses_only_matching_model_provenance(self):
  now=dt.datetime(2026,9,27,12,tzinfo=UTC)
  current={'snapshot_at':'2026-09-27T12:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':11.6}}
  archived={'snapshot_at':'2026-09-26T12:00:00Z','snapshot_kind':'backfill_model_cycle','provenance':{'forecast':'NOAA CO-OPS archived GoMOFS station forecast NetCDF'},'water':{'forecast_peak_72h_ft':10.9}}
  incompatible=f._forecast_evolution([archived],current,now)
  self.assertEqual([x['label'] for x in incompatible['items']],['Now'])
  briefing=f.build_payload(current,{'snapshots':[archived],'alert_events':[],'local_events':[],'backfill':{}},now)
  self.assertIsNone(briefing['forecast_change_24h']['comparison'])
  self.assertIn('no forecast-change value is being inferred',briefing['forecast_change_24h']['text'])
  live={'snapshot_at':'2026-09-26T14:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':11.3}}
  compatible=f._forecast_evolution([archived,live],current,now)
  self.assertEqual([x['label'] for x in compatible['items']],['24h ago','Now'])
  self.assertEqual(compatible['items'][0]['peak_ft'],11.3)

 def test_browser_briefing_does_not_duplicate_durable_history_payload(self):
  now=dt.datetime(2026,9,27,12,tzinfo=UTC)
  current={'snapshot_at':'2026-09-27T12:00:00Z','water':{'forecast_peak_72h_ft':11.8},'forecast_conditions':{},'marine':{'stations':{}},'alerts':[]}
  snapshot={'snapshot_at':'2026-09-27T11:00:00Z','water':{'forecast_peak_72h_ft':11.5},'alerts':[]}
  hist={'schema_version':2,'generated_at':'2026-09-27T11:00:00Z','snapshots':[snapshot],'alert_events':[],'local_events':[],'backfill':{},'daily_rollups':[]}
  briefing=f.build_payload(current,hist,now)
  durable=f.compact_history_payload(current,hist,now)
  self.assertNotIn('history',briefing)
  self.assertNotIn('history_compact',briefing)
  self.assertIn('current_snapshot',briefing)
  self.assertGreaterEqual(len(durable['snapshots']),1)

 def test_fixed_24h_comparison_and_margin(self):
  now=dt.datetime(2026,9,27,12,tzinfo=UTC)
  old={'snapshot_at':'2026-09-26T12:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':11.35,'forecast_peak_72h_time':'2026-09-28T04:00:00Z'},'alerts':[]}
  cur={'snapshot_at':'2026-09-27T12:00:00Z','snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'observed_24h_max_ft':10.9,'observed_24h_max_time':'2026-09-27T04:00:00Z','forecast_peak_24h_ft':11.5,'forecast_peak_24h_time':'2026-09-28T04:00:00Z','forecast_peak_72h_ft':11.82,'forecast_peak_72h_time':'2026-09-28T16:00:00Z','astronomical_tide_at_peak_ft':10.7,'model_uplift_ft':1.12},'forecast_conditions':{},'marine':{'stations':{}},'alerts':[]}
  hist={'schema_version':2,'generated_at':'2026-09-27T11:00:00Z','window_basis':'fixed','station':'8418150','thresholds_ft_mllw':{},'snapshots':[old],'daily_rollups':[],'alert_events':[],'local_events':[],'backfill':{'water_observed_daily_peaks':[]},'provenance_notes':{}}
  d=f.build_payload(cur,hist,now); c=d['forecast_change_24h']['comparison']
  self.assertEqual(c['peak_delta_ft'],0.47); self.assertEqual(c['current_threshold_margins_ft']['minor'],0.18)
  self.assertIn('shrank by 0.47 ft',d['forecast_change_24h']['text']); self.assertIn('never based on a visitor',d['window_basis'])
 def test_small_forecast_variation_does_not_claim_risk_is_increasing(self):
  text=f._forecast_change_text({'previous_peak_ft':10.14,'current_peak_ft':10.17,'peak_delta_ft':0.03,'time_shift_minutes':-6})
  self.assertIn('essentially unchanged',text)
  self.assertIn('under 0.15 ft',text)
  self.assertIn('less than one hour',text)
  self.assertNotIn('risk is increasing',text.lower())
 def test_small_forecast_change_that_crosses_a_portland_threshold_is_called_out(self):
  text=f._forecast_change_text({'previous_peak_ft':11.98,'current_peak_ft':12.02,'peak_delta_ft':0.04,'time_shift_minutes':0})
  self.assertIn('crossed',text.lower())
  self.assertIn('Minor Flood',text)
  self.assertIn('11.98 to 12.02 ft MLLW',text)
 def test_meaningful_marine_comparison_requires_fresh_same_station_samples(self):
  now=dt.datetime(2026,10,15,12,tzinfo=UTC)
  old={'snapshot_at':'2026-10-14T12:00:00Z','marine':{'stations':{'44007':{'observed_at':'2026-10-14T11:30:00Z','wave_observed_at':'2026-10-14T11:30:00Z','speed_mph':12.0,'gust_mph':20.0,'wave_height_ft':4.0,'dominant_period_sec':9.0,'pressure_mb':1008.0}}}}
  current={'snapshot_at':'2026-10-15T12:00:00Z','marine':{'stations':{'44007':{'observed_at':'2026-10-15T11:30:00Z','wave_observed_at':'2026-10-15T11:30:00Z','speed_mph':13.0,'gust_mph':31.0,'wave_height_ft':2.5,'dominant_period_sec':12.0,'pressure_mb':1002.0}}}}
  changes=f._observed_marine_changes(current,old)
  self.assertEqual([item['metric'] for item in changes],['gust_mph','wave_height_ft','dominant_period_sec','pressure_mb'])
  self.assertIn('not a local surf measurement',next(item['text'] for item in changes if item['metric']=='wave_height_ft'))
  old.update({'snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':10.2},'alerts':[]})
  current.update({'snapshot_kind':'realtime','provenance':{'forecast':'live_noaa_ofs_capture'},'water':{'forecast_peak_72h_ft':10.2},'forecast_conditions':{},'alerts':[]})
  payload=f.build_payload(current,{'snapshots':[old],'alert_events':[],'local_events':[],'backfill':{}},now)
  self.assertEqual(len(payload['past_24h']['marine_changes']),4)
  self.assertIn('NOAA/NDBC offshore buoy 44007',payload['past_24h']['text'])
  stale={'snapshot_at':'2026-10-14T12:00:00Z','marine':{'stations':{'44007':{'observed_at':'2026-10-14T09:00:00Z','wave_observed_at':'2026-10-14T09:00:00Z','gust_mph':20.0,'wave_height_ft':4.0}}}}
  self.assertEqual(f._observed_marine_changes(current,stale),[])
 def test_event_transitions_use_plain_fixed_window_language(self):
  old={'event_state':{'phase':'Recent','impact':{'label':'Elevated'}}}
  current={'event_state':{'phase':'Routine','impact':{'label':'Routine'}}}
  text=f._event_transition_text(current,old)
  self.assertIn('conditions around 24 hours ago',text)
  self.assertIn('recently ended to routine conditions',text)
  self.assertIn("SacoCast's local impact rating",text)
  self.assertNotIn('stored state nearest',text)
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
 def test_local_pulse_reports_failed_sources_without_claiming_empty_means_safe(self):
  now=dt.datetime(2026,9,27,12,tzinfo=UTC)
  cur={'snapshot_at':'2026-09-27T12:00:00Z','water':{},'forecast_conditions':{},'marine':{'stations':{}},'alerts':[]}
  hist={'schema_version':2,'generated_at':'2026-09-27T11:00:00Z','snapshots':[],'alert_events':[],'local_events':[],'source_health':{'checked_at':'2026-09-27T11:00:00Z','feeds':[
   {'name':'Local news search','status':'unavailable','message':'The source request failed.'},
   {'name':'Public community search','status':'available','item_count':0,'message':'Feed responded; no matching items were found.'},
   {'name':'Public Facebook posts','status':'not_checked','message':'Not comprehensive.'}
  ]},'backfill':{},'daily_rollups':[]}
  pulse=f.build_payload(cur,hist,now)['local_pulse']
  self.assertEqual(pulse['errors'],[{'name':'Local news search','status':'unavailable'}])
  self.assertIn('An empty scan is not proof',pulse['summary'])
  self.assertEqual([source['status'] for source in pulse['sources']],['unavailable','available','not_checked'])
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
