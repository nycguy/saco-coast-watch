#!/usr/bin/env python3
"""Rendered responsive and keyboard-accessibility acceptance smoke.

Runs against the assembled Pages artifact before release and the live site after
release. It uses one Chromium process and does not request notification
permission, enroll a device, or send a push notification.
"""
import os

from playwright.sync_api import sync_playwright
from browser_runtime import launch_configured_browser


BASE = os.environ.get("SACOCAST_SMOKE_URL", "http://127.0.0.1:8765/index.html")
VIEWPORTS = [(320, 780), (375, 667), (390, 844), (430, 932), (768, 1024), (1440, 900)]
MAJOR_SECTIONS = [
    "#stormModePanel", "#impactTimelinePanel", "#winterWeatherPanel", "#tropicalPanel",
    ".metrics", ".status", ".coastal-intelligence", ".coastal-briefing", ".camera-hub",
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
        browser = launch_configured_browser(playwright, "responsive-accessibility")
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(BASE, wait_until="domcontentloaded", timeout=45000)
        page.locator(".coastal-briefing").wait_for(state="visible", timeout=20000)
        assert page.locator(".brief-row span").evaluate_all("els => els.every(el => getComputedStyle(el).webkitLineClamp === 'none' && getComputedStyle(el).overflow !== 'hidden')"), "briefing descriptions are clamped or clipped"
        page.locator("#coastalToolsDetails > summary").click()
        page.locator(".coastal-map-panel").wait_for(state="visible", timeout=10000)

        order = page.evaluate("""() => [
          '.alertpanel','.status','.metrics','.main-grid','.camera-hub','.coastal-briefing',
          '.coastal-intelligence','.event-history-panel','.weather-panel'
        ].map(selector => [...document.querySelector('main').children].indexOf(document.querySelector(selector)))""")
        assert all(a < b for a, b in zip(order, order[1:])), f"dashboard hierarchy is out of order: {order}"
        camera_buttons = page.locator(".camera-choice")
        assert camera_buttons.count() == 2
        assert page.locator(".camera-panels > .ferry-camera:visible").count() == 1
        assert page.locator("#abellonaPlayer").get_attribute("src") is None, "unselected Abellona video loaded early"
        page.locator(".camera-selector").get_by_role("button", name="Abellona Inn").click()
        assert page.locator(".camera-panels > .abellona-camera:visible").count() == 1
        player_box = page.locator("#abellonaPlayer").bounding_box()
        assert player_box and player_box["width"] > 0 and player_box["height"] > 0, f"Abellona iframe has no visible layout box: {player_box}"
        assert page.locator("#abellonaPlayer").get_attribute("src").startswith("https://www.youtube.com/embed/"), "selected Abellona iframe was not activated"
        try:
            page.wait_for_function("(() => {const video=document.querySelector('.camera-panels #ferryVideo');return video.paused&&!video.hasAttribute('src')})()",timeout=5000)
        except Exception:
            raise AssertionError("Ferry stream remained active after switching to Abellona: "+str(page.locator("#ferryVideo").evaluate("video=>({paused:video.paused,src:video.getAttribute('src'),currentSrc:video.currentSrc,networkState:video.networkState,readyState:video.readyState,sourceObject:!!video.srcObject})")))
        page.locator(".camera-selector").get_by_role("button", name="Ferry Beach").click()
        assert page.locator(".camera-panels > .ferry-camera:visible").count() == 1
        assert page.locator("#abellonaPlayer").get_attribute("src") == "about:blank", "unselected Abellona stream was not unloaded"
        page.wait_for_function("(() => {const video=document.querySelector('.camera-panels #ferryVideo');return video.hasAttribute('src')||Boolean(video.currentSrc)})()",timeout=5000)

        disclosures = page.locator("main details:visible")
        for index in range(disclosures.count()):
            detail = disclosures.nth(index)
            summary = detail.locator(":scope > summary")
            if not summary.is_visible():
                continue
            expanded = "true" if detail.evaluate("el => el.open") else "false"
            assert summary.get_attribute("aria-expanded") == expanded, f"disclosure state is not announced: {summary.inner_text()}"
            action = summary.locator(".disclosure-action").inner_text()
            assert action == ("Hide details" if expanded == "true" else "Show details"), f"missing disclosure action text: {summary.inner_text()}"
        keyboard_summary = page.locator("#introQualifications > summary")
        if keyboard_summary.count():
            keyboard_summary.focus();page.keyboard.press("Space")
            page.wait_for_function("document.querySelector('#introQualifications')?.open && document.querySelector('#introQualifications > summary')?.getAttribute('aria-expanded')==='true'")
            assert page.locator("#introQualifications").get_attribute("open") is not None
            assert keyboard_summary.get_attribute("aria-expanded") == "true"
            page.keyboard.press("Space")
            page.wait_for_function("!document.querySelector('#introQualifications')?.open && document.querySelector('#introQualifications > summary')?.getAttribute('aria-expanded')==='false'")
            assert page.locator("#introQualifications").get_attribute("open") is None

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
            page.locator("#alertsButton").click()
            dialog = page.locator("#alertsDialog")
            assert dialog.evaluate("el => el.open")
            dialog_name = page.locator("#alertsDialogTitle").inner_text()
            assert page.get_by_role("dialog", name=dialog_name).count() == 1, \
                f"alert dialog has no accessible name at {width}px"
            assert dialog.evaluate("el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1; }")
            assert dialog.evaluate("el => el.contains(document.activeElement)"), "alert dialog did not receive keyboard focus"
            assert_accessible_control_names(page)
            page.keyboard.press("Tab")
            assert dialog.evaluate("el => el.contains(document.activeElement)"), "alert dialog did not contain keyboard tab navigation"
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
            page.keyboard.press("Tab")
            assert briefing.evaluate("el => el.contains(document.activeElement)"), "briefing dialog did not contain keyboard tab navigation"
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
