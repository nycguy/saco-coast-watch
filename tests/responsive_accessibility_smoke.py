#!/usr/bin/env python3
"""Rendered responsive and keyboard-accessibility acceptance smoke.

Runs against the assembled Pages artifact before release and the live site after
release. It uses one Chromium process and does not request notification
permission, enroll a device, or send a push notification.
"""
import os

from playwright.sync_api import sync_playwright
from browser_runtime import launch_chromium


BASE = os.environ.get("SACOCAST_SMOKE_URL", "http://127.0.0.1:8765/index.html")
VIEWPORTS = [(320, 780), (375, 812), (390, 844), (430, 932), (1440, 1000)]
MAJOR_SECTIONS = [
    "#stormModePanel", "#impactTimelinePanel", "#winterWeatherPanel", "#tropicalPanel",
    ".metrics", ".status", ".coastal-intelligence", ".coastal-briefing",
    "#eventHistoryPanel", ".ferry-camera", ".comparison-panel", ".chart-panel",
    ".threshold-reference", ".weather-panel", ".alertpanel", ".hourly-panel",
    ".calendar-panel", ".coastal-map-panel",
]


def assert_accessible_control_names(page):
    unnamed_buttons = page.locator("button:visible").evaluate_all("""els => els.filter(el => {
      const name = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.innerText;
      return !name || !name.trim();
    }).map(el => el.outerHTML.slice(0,180))""")
    assert not unnamed_buttons, f"visible buttons without an accessible name: {unnamed_buttons}"
    unnamed_fields = page.locator("input:visible, select:visible, textarea:visible").evaluate_all("""els => els.filter(el => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
      if (el.labels && [...el.labels].some(label => label.innerText.trim())) return false;
      return true;
    }).map(el => el.outerHTML.slice(0,180))""")
    assert not unnamed_fields, f"visible form controls without an accessible name: {unnamed_fields}"


def assert_contained(page, width):
    metrics = page.evaluate("""() => ({
      overflow:document.documentElement.scrollWidth-window.innerWidth,
      bodyWidth:document.body.scrollWidth,
      offenders:[...document.body.querySelectorAll('*')].map(el=>({
        tag:el.tagName,id:el.id,className:typeof el.className==='string'?el.className:'',
        left:Math.round(el.getBoundingClientRect().left),right:Math.round(el.getBoundingClientRect().right),
        scroll:el.scrollWidth,client:el.clientWidth,overflow:getComputedStyle(el).overflowX
      })).filter(x=>x.left < -1 || x.right > innerWidth+1).slice(0,12)
    })""")
    assert metrics["overflow"] <= 2 and metrics["bodyWidth"] <= width + 2, \
        f"{width}px page has horizontal overflow: {metrics}"
    for selector in MAJOR_SECTIONS:
        element = page.locator(selector).first
        if not element.count() or not element.is_visible():
            continue
        box = element.bounding_box()
        assert box and box["x"] >= -1 and box["x"] + box["width"] <= width + 1, \
            f"{width}px section escapes viewport: {selector} {box}"


def main():
    page_errors = []
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright.chromium, "responsive-accessibility")
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(BASE, wait_until="domcontentloaded", timeout=45000)
        page.locator(".coastal-briefing").wait_for(state="visible", timeout=20000)
        page.locator(".coastal-map-panel").wait_for(state="visible", timeout=10000)

        for width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(100)
            assert_contained(page, width)
            assert_accessible_control_names(page)
            if width <= 620:
                for selector in ("#alertsButton", "#refreshBtn", "#briefOpen"):
                    box = page.locator(selector).bounding_box()
                    assert box and box["width"] >= 44 and box["height"] >= 44, \
                        f"{width}px primary touch target too small: {selector} {box}"
                segments = page.locator(".controls .segment")
                for index in range(segments.count()):
                    box = segments.nth(index).bounding_box()
                    assert box and box["height"] >= 44, f"{width}px chart period target too small: {box}"

            # Dialogs must fit the viewport, retain native keyboard dismissal,
            # and return focus to their opening control.
            page.locator("#alertsButton").focus()
            page.keyboard.press("Enter")
            dialog = page.locator("#alertsDialog")
            assert dialog.evaluate("el => el.open")
            dialog_name = page.locator("#alertsDialogTitle").inner_text()
            assert page.get_by_role("dialog", name=dialog_name).count() == 1, \
                f"alert dialog has no accessible name at {width}px"
            assert dialog.evaluate("el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1; }")
            assert dialog.evaluate("el => el.contains(document.activeElement)"), "alert dialog did not receive keyboard focus"
            assert_accessible_control_names(page)
            page.keyboard.press("Escape")
            assert not dialog.evaluate("el => el.open")
            assert page.evaluate("document.activeElement === document.querySelector('#alertsButton')"), "alert dialog did not restore focus"

            page.locator("#briefOpen").focus()
            page.keyboard.press("Enter")
            briefing = page.locator("#briefingDialog")
            assert briefing.evaluate("el => el.open")
            assert page.get_by_role("dialog", name="Southern Maine coastal briefing").count() == 1, \
                f"briefing dialog has no accessible name at {width}px"
            assert briefing.evaluate("el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1; }")
            assert briefing.evaluate("el => el.contains(document.activeElement)"), "briefing dialog did not receive keyboard focus"
            page.keyboard.press("Escape")
            assert not briefing.evaluate("el => el.open")
            assert page.evaluate("document.activeElement === document.querySelector('#briefOpen')"), "briefing dialog did not restore focus"

        page.locator(".controls .segment[data-days='1']").click()
        assert page.locator(".controls .segment[data-days='1']").get_attribute("aria-pressed") == "true"
        assert page.locator(".controls .segment[data-days='3']").get_attribute("aria-pressed") == "false"
        for selector in ("#pushStatus", "#thresholdStatus", "#notificationHistoryStatus", "#ferryStatus", "#abellonaStatus"):
            node = page.locator(selector)
            assert node.count() == 1 and node.get_attribute("role") == "status", f"missing status announcement contract: {selector}"

        # Flood level labels remain explicit text as well as colored bands.
        for label in ("Minor flooding", "Moderate flooding", "Major flooding"):
            assert page.get_by_text(label, exact=True).count() >= 1, f"hazard severity missing text label: {label}"
        assert not page_errors, "browser JavaScript errors: " + repr(page_errors)
        browser.close()
    print("PASS: responsive and keyboard accessibility smoke at 320, 375, 390, 430, and 1440px")


if __name__ == "__main__":
    main()
