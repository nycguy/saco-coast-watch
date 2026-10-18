#!/usr/bin/env python3
"""Capture rendered production baseline and release screenshots in Pages CI."""
import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright
from browser_runtime import launch_chromium


VIEWPORTS = (
    ("desktop", 1440, 900, False),
    ("iphone", 390, 844, True),
    ("iphone-small", 375, 667, True),
)


def save(page, path, *, full_page=False):
    page.screenshot(path=str(path), type="jpeg", quality=76, full_page=full_page,
                    animations="disabled", timeout=60000)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--prefix", required=True, choices=("baseline", "after"))
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
        errors = []

    with sync_playwright() as playwright:
        browser = launch_chromium(playwright.chromium, "ui-audit-" + args.prefix)
        pages = {}
        for name, width, height, mobile in VIEWPORTS:
            page = browser.new_page(viewport={"width": width, "height": height},
                                    device_scale_factor=1,
                                    is_mobile=mobile, has_touch=mobile)
            page.on("pageerror", lambda error, device=name: errors.append(f"{device}: {error}"))
            page.goto(args.base_url, wait_until="domcontentloaded", timeout=60000)
            page.locator(".coastal-briefing").wait_for(state="visible", timeout=30000)
            page.wait_for_timeout(3000)
            save(page, args.output_dir / f"{args.prefix}-{name}-full.jpg", full_page=True)
            pages[name] = page
            print(f"Captured {args.prefix} {name} {width}x{height}; scrollHeight="
                  f"{page.locator('body').evaluate('el => el.scrollHeight')}")

        phone = pages["iphone"]
        phone.locator("#alertsButton").click()
        save(phone, args.output_dir / f"{args.prefix}-iphone-alert-settings.jpg")
        phone.keyboard.press("Escape")

        phone.locator(".controls [data-days='1']").click()
        phone.locator(".chart-panel").scroll_into_view_if_needed()
        save(phone, args.output_dir / f"{args.prefix}-iphone-chart-24h.jpg")

        phone.locator("#coastalToolsDetails > summary").click()
        phone.locator(".coastal-map-panel").scroll_into_view_if_needed()
        save(phone, args.output_dir / f"{args.prefix}-iphone-map.jpg")

        camera = phone.locator(".camera-hub")
        if camera.count():
            phone.get_by_role("button", name="Abellona Inn").click()
            camera.scroll_into_view_if_needed()
            save(phone, args.output_dir / f"{args.prefix}-iphone-camera-selector.jpg")
        else:
            phone.locator(".abellona-camera").scroll_into_view_if_needed()
            save(phone, args.output_dir / f"{args.prefix}-iphone-abellona-camera.jpg")

        if errors:
            print("Captured browser page errors for audit review: " + repr(errors))
        browser.close()
    print(f"Captured complete pages and interaction states for {args.prefix}.")


if __name__ == "__main__":
    main()
