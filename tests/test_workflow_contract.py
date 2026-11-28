import pathlib
import re
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]

class WorkflowContractTests(unittest.TestCase):
    def test_actions_use_node_24_compatible_maintained_releases(self):
        workflows='\n'.join(path.read_text(encoding='utf-8') for path in sorted((ROOT/'.github/workflows').glob('*.yml')))
        refs=re.findall(r'uses:\s*(actions/[\w-]+)@(v?\d+)',workflows)
        self.assertTrue(refs)
        expected={
            'actions/checkout':'7',
            'actions/setup-node':'7',
            'actions/upload-artifact':'7',
            'actions/configure-pages':'6',
            'actions/upload-pages-artifact':'5',
            'actions/deploy-pages':'5',
        }
        for action,major in refs:
            self.assertEqual(action in expected,True,f'unreviewed GitHub action: {action}')
            self.assertEqual(major.lstrip('v'),expected[action],action)

    def test_pages_environment_url_is_a_github_expression(self):
        workflow=(ROOT/'.github/workflows/update-wind-and-publish.yml').read_text(encoding='utf-8')
        self.assertIn('url: ${{ steps.deployment.outputs.page_url }}',workflow)
        self.assertNotIn(r'\${{ steps.deployment.outputs.page_url }}',workflow)

    def test_pages_artifact_registration_is_verified_before_deployment(self):
        workflow=(ROOT/'.github/workflows/update-wind-and-publish.yml').read_text(encoding='utf-8')
        self.assertIn('actions: read',workflow)
        self.assertIn('Wait for Pages artifact registration',workflow)
        self.assertIn('actions/runs/${GITHUB_RUN_ID}/artifacts?name=github-pages',workflow)
        self.assertLess(workflow.index('Wait for Pages artifact registration'),workflow.index('Publish GitHub Pages'))
        self.assertIn('sleep 5',workflow)

    def test_public_runner_and_existing_refresh_schedules_are_preserved(self):
        pages=(ROOT/'.github/workflows/update-wind-and-publish.yml').read_text(encoding='utf-8')
        history=(ROOT/'.github/workflows/capture-history.yml').read_text(encoding='utf-8')
        self.assertIn('runs-on: ubuntu-24.04',pages)
        self.assertIn("cron: '*/10 * * * *'",pages)
        self.assertIn('runs-on: ubuntu-24.04',history)
        self.assertIn("cron: '*/15 * * * *'",history)

    def test_debug_screenshot_artifacts_expire_after_one_day(self):
        pages=(ROOT/'.github/workflows/update-wind-and-publish.yml').read_text(encoding='utf-8')
        block=pages.split('name: Save map test screenshot',1)[1].split('- uses: actions/configure-pages',1)[0]
        self.assertIn('retention-days: 1',block)
        self.assertIn('if: failure() && github.event_name != \'schedule\'',pages.split('name: Save map test screenshot',1)[1].split('uses: actions/upload-artifact',1)[0])
        self.assertIn('uses: actions/upload-pages-artifact@v5.0.0',pages)
        self.assertIn('uses: actions/deploy-pages@v5.0.1',pages)

    def test_existing_workflows_publish_data_health_without_adding_schedules(self):
        pages=(ROOT/'.github/workflows/update-wind-and-publish.yml').read_text(encoding='utf-8')
        history=(ROOT/'.github/workflows/capture-history.yml').read_text(encoding='utf-8')
        self.assertIn('scripts/monitor_data_health.py',pages)
        self.assertIn('--durable-history .history-store/data/history/coastal-history.json',pages)
        self.assertIn('--history-only',history)
        self.assertEqual(pages.count("cron: '*/10 * * * *'"),1)
        self.assertEqual(history.count("cron: '*/15 * * * *'"),1)

    def test_responsive_acceptance_runs_before_and_after_pages_publish(self):
        pages=(ROOT/'.github/workflows/update-wind-and-publish.yml').read_text(encoding='utf-8')
        self.assertEqual(pages.count('tests/responsive_accessibility_smoke.py'),2)
        self.assertLess(pages.index('tests/responsive_accessibility_smoke.py'),pages.index('Publish GitHub Pages'))
        self.assertGreater(pages.rindex('tests/responsive_accessibility_smoke.py'),pages.index('Publish GitHub Pages'))

    def test_independent_data_publication_is_validated_atomic_and_duplicate_safe(self):
        pages=(ROOT/'.github/workflows/update-wind-and-publish.yml').read_text(encoding='utf-8')
        self.assertIn('contents: write',pages)
        self.assertIn('scripts/build_data_manifest.py',pages)
        self.assertIn('data-delivery',pages)
        self.assertIn('git -C "$publish_dir" push',pages)
        self.assertIn('dataset hashes are unchanged',pages)
        self.assertLess(pages.index('Build independently delivered data manifest'),pages.index('Verify EastCast'))

    def test_notification_worker_release_workflow_remains_separate(self):
        worker=(ROOT/'.github/workflows/release-worker.yml').read_text(encoding='utf-8')
        self.assertIn('wrangler',worker)
        self.assertNotIn('data-delivery',worker)

    def test_data_delivery_health_monitor_is_low_noise_and_free(self):
        monitor=(ROOT/'.github/workflows/data-delivery-health.yml').read_text(encoding='utf-8')
        self.assertIn("cron: '*/15 * * * *'",monitor)
        self.assertIn('workflow_dispatch:',monitor)
        self.assertIn('contents: read',monitor)
        self.assertIn('timeout-minutes: 5',monitor)
        self.assertIn('cancel-in-progress: true',monitor)
        self.assertIn('check_data_delivery_health.py',monitor)
        self.assertNotIn('resend',monitor.lower())
        self.assertIn("'.github/workflows/data-delivery-health.yml'",monitor)
        self.assertIn("'scripts/check_data_delivery_health.py'",monitor)
        self.assertIn("'scripts/verify_data_delivery.py'",monitor)

if __name__=='__main__':
    unittest.main()


