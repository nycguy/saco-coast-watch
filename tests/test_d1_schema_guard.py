"""Regression tests for fail-closed D1 preflight and migration-state checks."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / 'scripts' / 'verify_d1_schema.py'
BASE = {
    'subscribers': {'id','email','email_confirmed','prefs_json','unsubscribed','created_at','updated_at'},
    'push_subscriptions': {'id','subscriber_id','endpoint','p256dh','auth','expires_at','created_at','updated_at'},
    'tokens': {'hash','subscriber_id','email','purpose','payload_json','expires_at','used_at'},
    'alert_state': {'subscriber_id','channel','metric','active','last_sent'},
    'request_limits': {'ip_hash','until_ts'},
}
PUSH = {
    'coastal_event_snapshots': {'event_key','active','fingerprint','source_observed_at','updated_at'},
    'coastal_event_deliveries': {'id','subscriber_id','event_key','transition_kind','event_fingerprint','created_at','sent_at','status'},
    'push_devices': {'id','endpoint','p256dh','auth','token_hash','event_prefs_json','enabled','created_at','updated_at'},
    'push_device_deliveries': {'id','device_id','event_key','transition_kind','event_fingerprint','status','created_at','sent_at'},
    'push_delivery_queue': {'id','device_id','event_key','transition_kind','event_fingerprint','payload_json','status','attempts','next_attempt_at','created_at','sent_at','last_error'},
}
INDEXES = {'coastal_event_deliveries_subscriber_idx','coastal_event_deliveries_pending_idx','push_devices_enabled_idx','push_device_deliveries_pending_idx','push_delivery_queue_pending_idx','push_delivery_queue_device_idx'}

def schema_items(include_push=False):
    tables = dict(BASE)
    if include_push: tables.update(PUSH)
    items = ['object:table:' + table for table in tables]
    items += [f'{table}.{column}' for table, columns in tables.items() for column in columns]
    if include_push: items += ['object:index:' + name for name in INDEXES]
    return items

def output(items):
    return json.dumps({'results': [{'results': [{'schema_item': value} for value in items]}]})

class D1SchemaGuardTests(unittest.TestCase):
    def invoke(self, args, contents):
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', delete=False) as f:
            f.write(contents); name = f.name
        try: return subprocess.run([sys.executable, str(GUARD), *args, name], capture_output=True, text=True)
        finally: Path(name).unlink(missing_ok=True)

    def test_preflight_accepts_expected_email_schema(self):
        result = self.invoke(['--schema'], output(schema_items()))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_preflight_rejects_missing_subscriber_schema(self):
        result = self.invoke(['--schema'], output(['object:table:subscribers']))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('refusing Worker release', result.stderr)

    def test_push_schema_state_distinguishes_absent_and_complete(self):
        absent = self.invoke(['--migration-state'], output(schema_items()))
        complete = self.invoke(['--migration-state'], output(schema_items(include_push=True)))
        self.assertEqual(absent.returncode, 0, absent.stderr)
        self.assertIn('MIGRATION_STATE=absent', absent.stdout)
        self.assertEqual(complete.returncode, 0, complete.stderr)
        self.assertIn('MIGRATION_STATE=complete', complete.stdout)

    def test_partial_or_index_incomplete_push_schema_fails_closed(self):
        partial = self.invoke(['--migration-state'], output(schema_items() + ['object:table:push_devices']))
        incomplete = schema_items(include_push=True)
        incomplete.remove('object:index:push_delivery_queue_device_idx')
        no_index = self.invoke(['--migration-state'], output(incomplete))
        self.assertNotEqual(partial.returncode, 0)
        self.assertNotEqual(no_index.returncode, 0)
        self.assertIn('partial/incomplete', partial.stderr)
        self.assertIn('partial/incomplete', no_index.stderr)

    def test_count_check_fails_if_email_rows_change(self):
        before = output([]).replace('"results": []', '"results": [{"subscriber_count": 8}]')
        after = output([]).replace('"results": []', '"results": [{"subscriber_count": 7}]')
        with tempfile.TemporaryDirectory() as tmp:
            left, right = Path(tmp) / 'before.json', Path(tmp) / 'after.json'; left.write_text(before); right.write_text(after)
            result = subprocess.run([sys.executable, str(GUARD), '--before', str(left), '--after', str(right)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('subscriber count changed', result.stderr)

if __name__ == '__main__': unittest.main()
