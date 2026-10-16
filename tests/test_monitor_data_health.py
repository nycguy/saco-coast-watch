import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('monitor_data_health', ROOT / 'scripts/monitor_data_health.py')
MONITOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MONITOR)
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 15, 12, tzinfo=UTC)


def iso(value):
    return value.isoformat().replace('+00:00', 'Z')


class DataHealthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.data = self.root / 'data'
        self.data.mkdir()
        self.history_path = self.root / 'durable-history.json'
        self._write_fixtures()

    def tearDown(self):
        self.temp.cleanup()

    def _write(self, name, value):
        (self.data / name).write_text(json.dumps(value), encoding='utf-8')

    def _write_fixtures(self):
        stamp = iso(NOW - dt.timedelta(minutes=5))
        snapshot = {'snapshot_at': stamp, 'water': {'forecast_peak_72h_ft': 12.0}}
        history = {'schema_version': 2, 'generated_at': stamp, 'thresholds_ft_mllw': MONITOR.THRESHOLDS, 'snapshots': [snapshot]}
        self._write('wind.json', {'generated_at': stamp, 'stations': {
            '44007': {'observed_at': stamp, 'wave_observed_at': stamp, 'speed_mph': 5.0, 'gust_mph': 8.0, 'wave_height_ft': 2.0, 'direction_deg': 180},
            'WEXM1': {'observed_at': stamp, 'wave_height_ft': None, 'speed_mph': 3.0, 'gust_mph': None, 'direction_deg': 200},
        }})
        self._write('coastal-alerts.json', {'generatedAt': stamp, 'features': [], 'error': None})
        self._write('hazards.json', {'schema_version': 1, 'generated_at': stamp, 'active_modes': [], 'alerts': [], 'marine_alerts': [], 'hourly': [{'start': iso(NOW + dt.timedelta(hours=i))} for i in range(1, 25)], 'hourly_full': [], 'errors': {}})
        self._write('coastal-briefing.json', {'schema_version': 2, 'generated_at': stamp, 'current_snapshot': {'water': {
            'station': '8418150', 'latest_observed_ft': 12.0, 'latest_observed_at': stamp,
            'observed_24h_max_ft': 12.0, 'forecast_peak_24h_ft': 12.0, 'forecast_peak_72h_ft': 12.0,
            'threshold_margins_ft': {'minor': 0.0, 'moderate': 1.0, 'major': 2.0}, 'source_errors': {},
        }, 'hazards': {'errors': {}}}})
        self._write('coastal-history.json', history)
        self.history_path.write_text(json.dumps(history), encoding='utf-8')

    def test_healthy_empty_alerts_and_threshold_boundary_pass(self):
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertEqual(health.errors, [])
        self.assertTrue(any('0 active features' in row for row in health.ok))

    def test_expected_noaa_delay_is_reported_without_failing_publication(self):
        doc = json.loads((self.data / 'coastal-briefing.json').read_text())
        doc['current_snapshot']['water']['latest_observed_at'] = iso(NOW - dt.timedelta(hours=2))
        self._write('coastal-briefing.json', doc)
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertFalse(health.errors)
        self.assertTrue(any('NOAA Portland observation: stale' in item for item in health.warnings))

    def test_missing_observations_are_not_converted_to_zero_or_all_clear(self):
        doc = json.loads((self.data / 'coastal-briefing.json').read_text())
        doc['current_snapshot']['water']['latest_observed_ft'] = None
        doc['current_snapshot']['water']['latest_observed_at'] = None
        self._write('coastal-briefing.json', doc)
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertFalse(health.errors)
        self.assertTrue(any('not treated as zero or an all-clear' in item for item in health.warnings))

    def test_malformed_json_and_future_timestamps_fail(self):
        (self.data / 'wind.json').write_text('{bad json', encoding='utf-8')
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertTrue(any('wind.json: data file cannot be read' in item for item in health.errors))
        self._write_fixtures()
        doc = json.loads((self.data / 'wind.json').read_text())
        doc['generated_at'] = iso(NOW + dt.timedelta(minutes=11))
        self._write('wind.json', doc)
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertTrue(any('more than 10 minutes in the future' in item for item in health.errors))

    def test_upstream_failure_and_absent_station_are_transparent_warnings(self):
        alerts = json.loads((self.data / 'coastal-alerts.json').read_text())
        alerts['error'] = 'provider internal diagnostic'
        self._write('coastal-alerts.json', alerts)
        wind = json.loads((self.data / 'wind.json').read_text())
        wind['stations']['44007'] = None
        self._write('wind.json', wind)
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertFalse(health.errors)
        self.assertTrue(any('provider request failed' in item for item in health.warnings))
        self.assertTrue(any('NDBC 44007: request failed or no observation' in item for item in health.warnings))
        self.assertNotIn('provider internal diagnostic', str(health.warnings))

    def test_ndbc_malformed_response_is_separated_from_no_observation(self):
        wind = json.loads((self.data / 'wind.json').read_text())
        wind['stations']['44007'] = None
        wind['source_health'] = {'44007': {'status': 'malformed', 'checked_at': iso(NOW), 'observed_at': None}}
        self._write('wind.json', wind)
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertTrue(any('did not match the expected NDBC format' in item for item in health.warnings))
        wind['source_health']['44007']['status'] = 'missing'
        self._write('wind.json', wind)
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertTrue(any('feed responded but reported no usable observation' in item for item in health.warnings))

    def test_delayed_nws_forecast_is_warning_but_malformed_period_fails(self):
        hazards = json.loads((self.data / 'hazards.json').read_text())
        hazards['errors'] = {'nws_hourly': 'timeout'}
        hazards['hourly'] = []
        self._write('hazards.json', hazards)
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertFalse(health.errors)
        self.assertTrue(any('NWS/NHC nws_hourly' in item for item in health.warnings))
        self.assertTrue(any('no usable forecast periods' in item for item in health.warnings))
        hazards['hourly'] = [{'start': 'not-a-time'}]
        self._write('hazards.json', hazards)
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertTrue(any('missing or malformed start time' in item for item in health.errors))

    def test_implausible_metric_and_history_order_fail(self):
        wind = json.loads((self.data / 'wind.json').read_text())
        wind['stations']['44007']['speed_mph'] = 999
        self._write('wind.json', wind)
        history = json.loads(self.history_path.read_text())
        history['snapshots'] = [
            {'snapshot_at': iso(NOW - dt.timedelta(minutes=1))},
            {'snapshot_at': iso(NOW - dt.timedelta(minutes=2))},
        ]
        self.history_path.write_text(json.dumps(history), encoding='utf-8')
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertTrue(any('speed_mph is outside its valid range' in item for item in health.errors))
        self.assertTrue(any('not ordered by timestamp' in item for item in health.errors))

    def test_durable_history_gaps_and_stall_are_reported_without_backfill(self):
        history = json.loads(self.history_path.read_text())
        history['snapshots'] = [
            {'snapshot_at': iso(NOW - dt.timedelta(hours=3))},
            {'snapshot_at': iso(NOW - dt.timedelta(minutes=70))},
        ]
        self.history_path.write_text(json.dumps(history), encoding='utf-8')
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertFalse(health.errors)
        self.assertTrue(any('newest capture is 70 minutes old' in item for item in health.warnings))
        self.assertTrue(any('110-minute capture gap' in item for item in health.warnings))

    def test_threshold_contract_mismatch_fails(self):
        history = json.loads(self.history_path.read_text())
        history['thresholds_ft_mllw']['minor'] = 0
        self.history_path.write_text(json.dumps(history), encoding='utf-8')
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertTrue(any('threshold contract is invalid' in item for item in health.errors))

    def test_inconsistent_forecast_threshold_margin_fails_at_boundary(self):
        doc = json.loads((self.data / 'coastal-briefing.json').read_text())
        doc['current_snapshot']['water']['threshold_margins_ft']['minor'] = 0.5
        self._write('coastal-briefing.json', doc)
        health = MONITOR.inspect(self.data, self.history_path, NOW)
        self.assertTrue(any('minor threshold margin does not match' in item for item in health.errors))


if __name__ == '__main__':
    unittest.main()
