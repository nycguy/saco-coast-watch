import datetime as dt, importlib.util, pathlib, unittest
P=pathlib.Path(__file__).resolve().parents[1]/"scripts"/"history_core.py"
S=importlib.util.spec_from_file_location("history_core",P); h=importlib.util.module_from_spec(S); S.loader.exec_module(h)
UTC=dt.timezone.utc

def snap(at,peak=None,ptime=None,kind="realtime"):
    return {"snapshot_at":at,"snapshot_kind":kind,"water":{"forecast_peak_72h_ft":peak,"forecast_peak_72h_time":ptime} if peak is not None else {}}

class HistoryCoreTests(unittest.TestCase):
    def test_storage_dedupes_realtime_hour_and_orders(self):
        now=dt.datetime(2026,9,27,15,tzinfo=UTC)
        rows=h.merge_snapshots([], [snap("2026-09-27T14:05:00Z",11.1),snap("2026-09-27T13:55:00Z",11.0),snap("2026-09-27T14:50:00Z",11.2)], now)
        self.assertEqual([r["snapshot_at"] for r in rows],["2026-09-27T13:55:00Z","2026-09-27T14:50:00Z"])
        self.assertEqual(rows[-1]["water"]["forecast_peak_72h_ft"],11.2)
    def test_backfill_and_realtime_do_not_collide(self):
        now=dt.datetime(2026,9,27,15,tzinfo=UTC)
        rows=h.merge_snapshots([], [snap("2026-09-27T12:00:00Z",11.1,kind="backfill_model_cycle"),snap("2026-09-27T12:20:00Z",11.2)], now)
        self.assertEqual(len(rows),2)
    def test_missing_data_baseline(self):
        target=dt.datetime(2026,9,26,12,tzinfo=UTC)
        self.assertIsNone(h.choose_baseline([snap("2026-09-26T12:00:00Z")],target))
    def test_24_hour_selection(self):
        target=dt.datetime(2026,9,26,12,tzinfo=UTC)
        rows=[snap("2026-09-26T08:00:00Z",10.0),snap("2026-09-26T12:40:00Z",11.0),snap("2026-09-26T15:00:00Z",12.0)]
        self.assertEqual(h.choose_baseline(rows,target)["water"]["forecast_peak_72h_ft"],11.0)
        self.assertIsNone(h.choose_baseline([snap("2026-09-26T08:00:00Z",10.0)],target,tolerance_hours=3.1))
    def test_peak_and_threshold_margin_changes(self):
        old=snap("2026-09-26T12:00:00Z",11.35,"2026-09-28T04:00:00Z")
        cur=snap("2026-09-27T12:00:00Z",11.82,"2026-09-28T04:30:00Z")
        c=h.compare_forecast(cur,old)
        self.assertEqual(c["peak_delta_ft"],0.47)
        self.assertEqual(c["threshold_margin_delta_ft"]["minor"],-0.47)
        self.assertEqual(c["current_threshold_margins_ft"]["minor"],0.18)
    def test_peak_time_change_crosses_midnight(self):
        old=snap("2026-09-26T12:00:00Z",11.5,"2026-09-28T23:30:00Z")
        cur=snap("2026-09-27T12:00:00Z",11.5,"2026-09-29T00:30:00Z")
        self.assertEqual(h.compare_forecast(cur,old)["time_shift_minutes"],60)
    def test_alert_issue_extend_expire(self):
        t=dt.datetime(2026,9,27,12,tzinfo=UTC)
        old=[{"id":"A","event":"Coastal Flood Advisory","expires":"2026-09-27T12:00:00Z","area":"Coastal York"}]
        cur=[{"id":"A","event":"Coastal Flood Advisory","expires":"2026-09-27T15:00:00Z","area":"Coastal York"},{"id":"B","event":"High Surf Advisory","expires":"2026-09-27T18:00:00Z"}]
        changes=h.diff_alerts(old,cur,t)
        self.assertEqual([x["change_type"] for x in changes],["extended","issued"])
        expired=h.diff_alerts(old,[],t)
        self.assertEqual(expired[0]["change_type"],"expired")
    def test_alert_upgrade_downgrade(self):
        t=dt.datetime(2026,9,27,12,tzinfo=UTC)
        old=[{"event":"Coastal Flood Advisory","area":"Coastal York"}]
        cur=[{"event":"Coastal Flood Warning","area":"Coastal York"}]
        self.assertEqual(h.diff_alerts(old,cur,t)[0]["change_type"],"upgraded")
        self.assertEqual(h.diff_alerts(cur,old,t)[0]["change_type"],"downgraded")
    def test_rollup_missing_data(self):
        rows=[snap("2026-09-27T10:00:00Z",11.1),snap("2026-09-27T11:00:00Z",11.3)]
        r=h.daily_rollups(rows)[0]
        self.assertEqual(r["snapshot_count"],2); self.assertEqual(r["max_forecast_peak_ft"],11.3); self.assertIsNone(r["max_observed_ft"])
if __name__=="__main__": unittest.main()
