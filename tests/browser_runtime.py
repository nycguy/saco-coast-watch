"""Shared Playwright launch policy for SacoCast browser regression suites."""

import json
import os
import sys
from importlib.metadata import PackageNotFoundError, version


DEFAULT_LAUNCH_TIMEOUT_MS = 30_000


def launch_chromium(chromium, suite, extra_args=()):
    """Launch the Playwright-managed headless Chromium with bounded diagnostics.

    Do not discover or substitute a machine-installed Chrome. A consistent
    Playwright browser avoids host-version drift and macOS app registration
    crashes seen with the user's system Chrome installation.
    """
    timeout_ms = int(os.environ.get("SACOCAST_BROWSER_LAUNCH_TIMEOUT_MS", DEFAULT_LAUNCH_TIMEOUT_MS))
    try:
        playwright_version = version("playwright")
    except PackageNotFoundError:
        playwright_version = "unknown"

    diagnostic = {
        "suite": suite,
        "browser": "Playwright-managed Chromium",
        "executable": chromium.executable_path,
        "headless": True,
        "launchTimeoutMs": timeout_ms,
        "playwrightVersion": playwright_version,
        "python": sys.executable,
    }
    print("BROWSER_LAUNCH " + json.dumps(diagnostic, sort_keys=True), flush=True)
    try:
        browser = chromium.launch(
            headless=True,
            timeout=timeout_ms,
            args=["--no-sandbox", *extra_args],
        )
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
