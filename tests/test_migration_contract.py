"""Migration contracts for the public SacoCast source of truth."""
import pathlib
import re
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class MigrationContractTests(unittest.TestCase):
    def test_frontend_script_dependencies_are_present_and_ordered(self):
        html = (ROOT / 'index.html').read_text(encoding='utf-8')
        scripts = re.findall(r'<script\s+src="(js/[^"]+)"', html)
        self.assertGreaterEqual(len(scripts), 10)
        for script in scripts:
            with self.subTest(script=script): self.assertTrue((ROOT / script).is_file(), script)
        self.assertLess(scripts.index('js/config.js'), scripts.index('js/app.js'))
        self.assertLess(scripts.index('js/hazards.js'), scripts.index('js/app.js'))
        self.assertTrue((ROOT / 'js/push-ui.mjs').is_file())
        self.assertTrue((ROOT / 'js/push-subscriptions.mjs').is_file())
        for control in ('pushStarts', 'pushEnds', 'pushChanges'):
            self.assertIn(f'id=\"{control}\"', html)
        self.assertTrue((ROOT / 'push-sw.js').is_file())

    def test_critical_portland_thresholds_remain_unchanged(self):
        config = (ROOT / 'js/config.js').read_text(encoding='utf-8')
        for threshold in ("name:'Minor',value:12", "name:'Moderate',value:13", "name:'Major',value:14"):
            self.assertIn(threshold, config)

    def test_existing_worker_email_service_remains_intact_and_push_is_gated(self):
        worker = (ROOT / 'alerts/src/worker.mjs').read_text(encoding='utf-8')
        self.assertIn('async function liveEmailChecks(e)', worker)
        self.assertIn('async scheduled(_event,env,ctx)', worker)
        self.assertIn("purpose='alerts-delivery-quota'", worker)
        self.assertIn('const liveAlerts=', worker)
        self.assertIn("env.PUSH_EVENTS_ENABLED==='true'?processCoastalPushEvents(env)", worker)
        self.assertIn('handlePushApi', worker)
        self.assertIn('push_device_deliveries', worker)

    def test_migrations_are_additive_preserve_subscribers_and_create_expected_indexes(self):
        db = sqlite3.connect(':memory:')
        db.executescript((ROOT / 'alerts/migrations/0001_init.sql').read_text(encoding='utf-8'))
        db.execute("INSERT INTO subscribers(id,email,email_confirmed,prefs_json,unsubscribed,created_at,updated_at) VALUES('existing','preserve@example.org',1,'{}',0,1,1)")
        for name in ('0002_event_notifications.sql', '0003_push_devices.sql', '0004_push_delivery_queue.sql'):
            sql=(ROOT / 'alerts/migrations' / name).read_text(encoding='utf-8')
            self.assertNotRegex(sql, r'(?im)^\s*(DROP|DELETE|UPDATE|ALTER)\s')
            db.executescript(sql)
        self.assertEqual(db.execute('SELECT id,email,email_confirmed FROM subscribers').fetchone(), ('existing','preserve@example.org',1))
        objects={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type IN ('table','index')")}
        self.assertTrue({'coastal_event_snapshots','coastal_event_deliveries','push_devices','push_device_deliveries','push_delivery_queue'} <= objects)
        self.assertTrue({'coastal_event_deliveries_subscriber_idx','coastal_event_deliveries_pending_idx','push_devices_enabled_idx','push_device_deliveries_pending_idx','push_delivery_queue_pending_idx','push_delivery_queue_device_idx'} <= objects)
        db.close()

    def test_production_schema_snapshot_query_covers_tables_columns_and_indexes(self):
        db = sqlite3.connect(':memory:')
        for name in ('0001_init.sql', '0002_event_notifications.sql', '0003_push_devices.sql', '0004_push_delivery_queue.sql', '0005_push_threshold_preferences.sql'):
            db.executescript((ROOT / 'alerts/migrations' / name).read_text(encoding='utf-8'))
        sql=(ROOT / 'scripts/d1_schema_snapshot.sql').read_text(encoding='utf-8')
        rows=set()
        for statement in sql.split(';'):
            if statement.strip():
                rows.update(row[0] for row in db.execute(statement))
        self.assertIn('object:table:subscribers', rows)
        self.assertIn('subscribers.email', rows)
        self.assertIn('object:index:push_delivery_queue_device_idx', rows)
        self.assertIn('push_delivery_queue.next_attempt_at', rows)
        self.assertIn('object:table:push_threshold_preferences', rows)
        self.assertIn('push_threshold_preferences.prefs_json', rows)
        db.close()

    def test_release_workflow_is_manual_and_requires_explicit_apply_input(self):
        workflow=(ROOT / '.github/workflows/release-worker.yml').read_text(encoding='utf-8')
        self.assertIn('workflow_dispatch:', workflow)
        self.assertIn('apply_migrations_and_deploy:', workflow)
        self.assertIn('default: false', workflow)
        self.assertNotRegex(workflow, r'(?m)^\s*(push|pull_request|schedule):')
        self.assertNotIn('PAGES_REPO_TOKEN', workflow)

if __name__ == '__main__': unittest.main()
