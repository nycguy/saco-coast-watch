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

    def test_public_runner_and_existing_refresh_schedules_are_preserved(self):
        pages=(ROOT/'.github/workflows/update-wind-and-publish.yml').read_text(encoding='utf-8')
        history=(ROOT/'.github/workflows/capture-history.yml').read_text(encoding='utf-8')
        self.assertIn('runs-on: ubuntu-latest',pages)
        self.assertIn("cron: '*/10 * * * *'",pages)
        self.assertIn('runs-on: ubuntu-latest',history)
        self.assertIn("cron: '*/15 * * * *'",history)

if __name__=='__main__':
    unittest.main()
