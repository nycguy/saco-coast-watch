import datetime as dt
import importlib.util
import pathlib
import sys
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT/"scripts"))
P=ROOT/"scripts"/"fetch_hazards.py"; S=importlib.util.spec_from_file_location("fetch_hazards",P); h=importlib.util.module_from_spec(S); S.loader.exec_module(h)
UTC=dt.timezone.utc
class HazardTests(unittest.TestCase):
 def test_grid_accumulation_and_average_rate(self):
  now=dt.datetime(2026,1,1,0,tzinfo=UTC); prop={"uom":"wmoUnit:m","values":[{"validTime":"2026-01-01T00:00:00+00:00/PT6H","value":0.1524},{"validTime":"2026-01-01T06:00:00+00:00/PT6H","value":0.0762}]}
  self.assertAlmostEqual(h.grid_total_inches(prop,now,now+dt.timedelta(hours=12)),9.0,places=1); self.assertAlmostEqual(h.grid_max_average_rate(prop,now,now+dt.timedelta(hours=12)),1.0,places=1)
 def test_precip_category(self):
  self.assertEqual(h.precip_category("Heavy Snow"),"Snow"); self.assertEqual(h.precip_category("Freezing Rain and Sleet"),"Wintry Mix"); self.assertEqual(h.precip_category("Rain Showers"),"Rain")
 def test_surf_zone_parser_coastal_york(self):
  doc={"issuanceTime":"2026-09-29T12:00:00+00:00","productText":"SRFGYX\nMEZ023-292000-\nCoastal York-\n.TODAY...\nSurf Height.................6 to 8 feet.\nRip Current Risk*...........High.\n.WEDNESDAY...\nSurf Height.................Around 5 feet.\nMEZ024-292000-\nCoastal Cumberland-\n"}
  surf=h.surf_zone_snapshot(doc); self.assertTrue(surf["available"]); self.assertEqual(surf["max_surf_height_ft"],8.0); self.assertEqual(surf["rip_current_risk"],"High")
 def test_modes_separate_coastal_surf_marine_and_land_wind(self):
  alerts=[{"event":"Coastal Flood Watch"},{"event":"High Surf Advisory"}]; marine=[{"event":"Gale Warning"}]
  codes=[m["code"] for m in h.detect_modes(alerts,{"snowfall_72h_in":0,"ice_72h_in":0},{"max_gust_72h_mph":20,"max_sustained_72h_mph":15},{"qpf_72h_in":0.2},{"min_temp_24h_f":30},{"active":False},{"max_surf_height_ft":8,"rip_current_risk":"High"},marine)]
  for code in ("coastal_flood","high_surf","beach_hazard","marine_hazard"): self.assertIn(code,codes)
  self.assertNotIn("high_wind",codes)
 def test_heavy_rain_and_flooding_are_distinct(self):
  codes=[m["code"] for m in h.detect_modes([{"event":"Flood Watch"}],{"snowfall_72h_in":0,"ice_72h_in":0},{"max_gust_72h_mph":10,"max_sustained_72h_mph":10},{"qpf_72h_in":2.1},{"min_temp_24h_f":40},{"active":False},{},[])]
  self.assertIn("heavy_rain",codes); self.assertIn("flooding",codes)
 def test_recent_residual_does_not_keep_active_event_focus(self):
  now=dt.datetime(2026,9,29,18,tzinfo=UTC); hazards={"active_modes":[],"alerts":[],"marine_alerts":[],"winter":{},"rain":{},"wind":{},"cold":{},"tropical":{},"surf":{}}
  water={"forecast_peak_24h_ft":11.4,"forecast_peak_72h_ft":11.6,"latest_observed_ft":10.9,"residual_24h_max_ft":1.11,"residual_24h_max_time":"2026-09-29T08:00:00Z"}
  state=h.derive_event_state(hazards,water=water,marine={"stations":{}},now=now); self.assertEqual(state["phase"],"Recent"); self.assertFalse(state["show_focus"]); self.assertEqual(state["impact"]["label"],"Routine"); self.assertEqual(state["recent_impact"]["label"],"Elevated")
 def test_portland_thresholds_drive_coastal_impact(self):
  now=dt.datetime(2026,9,29,18,tzinfo=UTC); hazards={"active_modes":[],"alerts":[],"marine_alerts":[],"winter":{},"rain":{},"wind":{},"cold":{},"tropical":{},"surf":{}}
  state=h.derive_event_state(hazards,water={"forecast_peak_24h_ft":13.2,"forecast_peak_72h_ft":13.2,"latest_observed_ft":11.0},marine={"stations":{}},now=now)
  self.assertEqual(state["phase"],"Approaching"); self.assertEqual(state["impact"]["label"],"Significant"); self.assertIn("coastal_flood",[m["code"] for m in state["active_hazards"]])
 def test_official_tropical_identity_becomes_display_name(self):
  hazards={"active_modes":[{"code":"tropical","label":"Tropical Cyclone","basis":"test"}],"alerts":[],"marine_alerts":[],"winter":{},"rain":{},"wind":{},"cold":{},"surf":{},"tropical":{"storms":[{"id":"AL012026","name":"Arthur","classification":"HU","label":"Hurricane Arthur","min_forecast_track_distance_mi":220}]}}
  state=h.derive_event_state(hazards,now=dt.datetime(2026,8,1,tzinfo=UTC)); self.assertEqual(state["primary_display"],"Hurricane Arthur"); self.assertEqual(state["event_identity"]["storm_id"],"AL012026"); self.assertEqual(state["event_identity"]["naming_authority"],"National Hurricane Center / WMO")
 def test_event_state_can_be_enriched_twice(self):
  now=dt.datetime(2026,9,29,18,tzinfo=UTC)
  hazards={"active_modes":[{"code":"high_surf","label":"High Surf / Wave Impact","basis":"NWS High Surf Advisory"}],"alerts":[{"event":"High Surf Advisory"}],"marine_alerts":[],"winter":{},"rain":{},"wind":{},"cold":{},"tropical":{},"surf":{"max_surf_height_ft":8}}
  first=h.derive_event_state(hazards,now=now)
  hazards["active_modes"]=first["active_hazards"]
  second=h.derive_event_state(hazards,now=now)
  self.assertEqual(second["active_hazards"][0]["basis"],["NWS High Surf Advisory"])
 def test_haversine_local_reference(self): self.assertLess(h.haversine_miles(h.SITE_LAT,h.SITE_LON,43.47,-70.38),1)
if __name__=="__main__": unittest.main()
