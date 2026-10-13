import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from browser_runtime import DEFAULT_LAUNCH_TIMEOUT_MS, launch_chromium


class FakeBrowser:
    version = "test-browser"


class FakeChromium:
    executable_path = "/managed/chromium"

    def __init__(self, error=None):
        self.error = error
        self.calls = []

    def launch(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return FakeBrowser()


class BrowserRuntimeTests(unittest.TestCase):
    def test_launches_managed_headless_browser_with_timeout_and_diagnostics(self):
        chromium = FakeChromium()
        output = io.StringIO()
        with patch.dict("os.environ", {}, clear=True), redirect_stdout(output):
            browser = launch_chromium(chromium, "unit", extra_args=("--disable-dev-shm-usage",))

        self.assertEqual(browser.version, "test-browser")
        self.assertEqual(
            chromium.calls,
            [{"headless": True, "channel": "chromium", "timeout": DEFAULT_LAUNCH_TIMEOUT_MS,
              "args": ["--disable-dev-shm-usage"]}],
        )
        records = [json.loads(line.split(" ", 1)[1]) for line in output.getvalue().splitlines()]
        self.assertEqual([line.split(" ", 1)[0] for line in output.getvalue().splitlines()],
                         ["BROWSER_LAUNCH", "BROWSER_LAUNCHED"])
        self.assertEqual(records[0]["executable"], "/managed/chromium")
        self.assertTrue(records[0]["headless"])
        self.assertEqual(records[1]["browserVersion"], "test-browser")

    def test_launch_failure_is_diagnosed_and_propagated(self):
        chromium = FakeChromium(RuntimeError("browser unavailable"))
        output = io.StringIO()
        with patch.dict("os.environ", {"SACOCAST_BROWSER_LAUNCH_TIMEOUT_MS": "1234"}), redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, "browser unavailable"):
                launch_chromium(chromium, "unit")

        self.assertEqual(chromium.calls[0]["timeout"], 1234)
        line = output.getvalue().splitlines()[-1]
        self.assertTrue(line.startswith("BROWSER_LAUNCH_FAILED "))
        failure = json.loads(line.split(" ", 1)[1])
        self.assertEqual(failure["error"], "RuntimeError: browser unavailable")


if __name__ == "__main__":
    unittest.main()
