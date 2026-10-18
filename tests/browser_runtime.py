"""Shared Playwright launch policy for SacoCast browser regression suites."""

import json
import os
import sys
from importlib.metadata import PackageNotFoundError, version


DEFAULT_LAUNCH_TIMEOUT_MS = 30_000


def launch_chromium(chromium, suite, extra_args=()):
    """Launch headless Chromium with bounded diagnostics.

    CI and default local runs use Playwright's pinned browser. Hosts that cannot
    launch the managed macOS app bundle may provide an explicit executable path
    in SACOCAST_BROWSER_EXECUTABLE; the launcher never searches PATH.
    """
    timeout_ms = int(os.environ.get("SACOCAST_BROWSER_LAUNCH_TIMEOUT_MS", DEFAULT_LAUNCH_TIMEOUT_MS))
    executable_override = os.environ.get("SACOCAST_BROWSER_EXECUTABLE")
    try:
        playwright_version = version("playwright")
    except PackageNotFoundError:
        playwright_version = "unknown"

    diagnostic = {
        "suite": suite,
        "browser": "Explicit Chromium executable" if executable_override else "Playwright-managed Chromium",
        "executable": executable_override or chromium.executable_path,
        "headless": True,
        "launchTimeoutMs": timeout_ms,
        "playwrightVersion": playwright_version,
        "python": sys.executable,
    }
    print("BROWSER_LAUNCH " + json.dumps(diagnostic, sort_keys=True), flush=True)
    try:
        launch_options = {
            "headless": True,
            "timeout": timeout_ms,
            "args": list(extra_args),
        }
        if executable_override:
            launch_options["executable_path"] = executable_override
        else:
            launch_options["channel"] = "chromium"
        browser = chromium.launch(**launch_options)
    except Exception as error:
        print(
            "BROWSER_LAUNCH_FAILED "
            + json.dumps({**diagnostic, "error": f"{type(error).__name__}: {error}"}, sort_keys=True),
            flush=True,
        )
        raise

    print(
        "BROWSER_LAUNCHED "
        + json.dumps({**diagnostic, "browserVersion": browser.version}, sort_keys=True),
        flush=True,
    )
    return browser
