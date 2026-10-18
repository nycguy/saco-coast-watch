import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from browser_runtime import DEFAULT_LAUNCH_TIMEOUT_MS, launch_chromium, launch_configured_browser


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


class FakeBrowserType(FakeChromium):
    name = "webkit"


class FakePlaywright:
    def __init__(self):
        self.chromium = FakeChromium()
        self.webkit = FakeBrowserType()


class BrowserRuntimeTests(unittest.TestCase):
    def test_webkit_override_uses_playwright_managed_webkit(self):
        playwright = FakePlaywright()
        output = io.StringIO()
        with patch.dict("os.environ", {"SACOCAST_BROWSER_ENGINE": "webkit"}, clear=True), redirect_stdout(output):
            browser = launch_configured_browser(playwright, "unit")

        self.assertEqual(browser.version, "test-browser")
        self.assertEqual(playwright.webkit.calls, [{"headless": True, "timeout": DEFAULT_LAUNCH_TIMEOUT_MS}])
        self.assertEqual(playwright.chromium.calls, [])
        record = json.loads(output.getvalue().splitlines()[0].split(" ", 1)[1])
        self.assertEqual(record["browser"], "Playwright-managed WebKit")

    def test_configured_browser_defaults_to_chromium(self):
        playwright = FakePlaywright()
        with patch.dict("os.environ", {}, clear=True), redirect_stdout(io.StringIO()):
            launch_configured_browser(playwright, "unit")
        self.assertEqual(playwright.chromium.calls[0]["channel"], "chromium")
        self.assertEqual(playwright.webkit.calls, [])

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

    def test_uses_only_explicit_browser_override_without_path_search(self):
        chromium = FakeChromium()
        output = io.StringIO()
        with patch.dict("os.environ", {"SACOCAST_BROWSER_EXECUTABLE": "/Applications/Chrome"}, clear=True), redirect_stdout(output):
            launch_chromium(chromium, "unit")

        self.assertEqual(chromium.calls[0]["executable_path"], "/Applications/Chrome")
        self.assertNotIn("channel", chromium.calls[0])
        record = json.loads(output.getvalue().splitlines()[0].split(" ", 1)[1])
        self.assertEqual(record["browser"], "Explicit Chromium executable")
        self.assertEqual(record["executable"], "/Applications/Chrome")

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
