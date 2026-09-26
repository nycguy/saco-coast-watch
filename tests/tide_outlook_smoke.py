#!/usr/bin/env python3
"""Deterministic browser regression for the 14-day tide + NOAA OFS outlook."""
from datetime import datetime, timedelta, timezone
import json
from playwright.sync_api import sync_playwright

BASE="http://127.0.0.1:8765/index.html"
VALUES=[9.84,9.98,10.23,10.54,10.71,10.70,10.52,10.23,9.94,9.76,9.73,9.85,10.01,10.11,10.12,10.32,10.36,10.24,10.00,9.67,9.31,8.96,8.67,8.50,8.47,8.56,8.78,9.07,9.38,9.87]

def stamp(dt):
    return dt.strftime("%Y-%m-%d %H:%M")

def install_noaa_fixture(page):
    start=datetime.now(timezone.utc).date()
    highs=[]
    for i,value in enumerate(VALUES):
        dt=datetime.combine(start+timedelta(days=i),datetime.min.time(),tzinfo=timezone.utc)+timedelta(hours=16)
        highs.append({"t":stamp(dt),"v":f"{value:.2f}","type":"H"})

    # Six-hour tide samples are sufficient for unrelated dashboard components;
    # the 14-day trend itself is deliberately driven by NOAA-style H records.
    tide=[]
    for i,value in enumerate(VALUES):
        day=datetime.combine(start+timedelta(days=i),datetime.min.time(),tzinfo=timezone.utc)
        for hour,delta in ((4,-7.7),(10,-2.0),(16,0.0),(22,-6.5)):
            tide.append({"t":stamp(day+timedelta(hours=hour)),"v":f"{value+delta:.2f}"})

    now=datetime.now(timezone.utc).replace(second=0,microsecond=0)
    observed_values=[7.2,8.5,9.8,8.4,7.1,8.6,9.9,8.5,7.3]
    obs=[]
    for i,value in enumerate(observed_values):
        t=now-timedelta(hours=24-i*3)
        obs.append({"t":stamp(t),"v":f"{value:.2f}"})
    model=[]
    for h in range(0,73,3):
        t=now+timedelta(hours=h)
        # Stable synthetic total-water guidance.
        model.append({"t":stamp(t),"v":f"{9.2+1.4*((h%12)/12):.2f}"})
        # Add a tide sample at the same timestamp so the chart can verify the
        # model-vs-astronomical difference exactly as the real 6-minute feed does.
        tide.append({"t":stamp(t),"v":f"{9.00+0.20*((h%12)/12):.2f}"})

    def handler(route):
        from urllib.parse import urlparse, parse_qs
        q=parse_qs(urlparse(route.request.url).query)
        product=q.get("product",[""])[0]
        interval=q.get("interval",[""])[0]
        if product=="predictions" and interval=="hilo":
            route.fulfill(status=200,content_type="application/json",body=json.dumps({"predictions":highs}))
        elif product=="predictions":
            route.fulfill(status=200,content_type="application/json",body=json.dumps({"predictions":tide}))
        elif product=="water_level":
            route.fulfill(status=200,content_type="application/json",body=json.dumps({"data":obs}))
        elif product=="ofs_water_level":
            route.fulfill(status=200,content_type="application/json",body=json.dumps({"data":model}))
        else:
            route.continue_()
    page.route("**/api/prod/datagetter**",handler)

def assert_common(page):
    page.goto(BASE,wait_until="domcontentloaded",timeout=30000)
    page.wait_for_function("document.querySelector('#tideOutlookPeak').textContent.includes('10.71')",timeout=20000)
    section=page.locator(".calendar-panel")
    section.scroll_into_view_if_needed()
    page.wait_for_timeout(300)

    assert page.locator("#tideOutlookPeak").inner_text().strip()=="10.71 ft"
    assert page.locator("#tideOutlookChange").inner_text().strip()=="+0.87 ft"
    assert page.locator("#tideOutlookMinorGap").inner_text().strip()=="1.29 ft below"
    assert page.locator("#tideTrend .tide-point").count()==14
    assert page.locator("#tideTrend .tide-value").count()==14
    ofs_points=page.locator("#tideTrend .ofs-trend-point").count()
    assert ofs_points>=3,f"expected NOAA OFS daily peaks for the available ~72h model window, got {ofs_points}"
    assert page.locator("#tideTrend .ofs-trend-value").count()==ofs_points
    assert page.locator("#tideTrend .ofs-trend-line").count()==1
    assert page.locator("#tideTrend .zone-label").count()==3
    labels=page.eval_on_selector_all("#tideTrend .zone-label","els => els.map(el => el.textContent)")
    assert labels==["Minor 12–13 ft","Moderate 13–14 ft","Major 14+ ft"],labels

    initial=page.locator("#tideTrendSelection").inner_text()
    assert "astronomical high 10.71 ft MLLW" in initial,initial
    page.locator('#tideTrend .tide-hit[data-index="0"]').click()
    selected=page.locator("#tideTrendSelection").inner_text()
    assert "astronomical high 9.84 ft MLLW" in selected,selected
    assert "NOAA OFS forecast peak" in selected,selected
    assert "vs astronomical tide at that time" in selected,selected
    assert page.locator("#tideTrend .tide-point.selected").count()==1
    assert page.locator("#tideTrend .ofs-trend-point.selected").count()==1
    assert "NOAA OFS total-water peak" in section.inner_text()

    # Short-range water-level outlook restores continuous tide-cycle lines,
    # clips the lower part of each cycle, and does not plot astronomical tide.
    chart_period=page.locator("#chartPeriod").inner_text()
    assert "observed + NOAA model lines" in chart_period,chart_period
    assert "clipped below 8 ft" in chart_period,chart_period
    flood_control=page.locator("label.check").filter(has=page.locator("#showFlood")).inner_text()
    assert "Flood thresholds" in flood_control and "Flood zones" not in flood_control,flood_control

    y_labels=page.eval_on_selector_all("#chart .y-axis-label","els => els.map(el => Number(el.textContent))")
    assert y_labels and min(y_labels)==8,y_labels
    assert 0 not in y_labels and 2 not in y_labels and 4 not in y_labels and 6 not in y_labels,y_labels
    assert page.locator("#chart path.obs").count()==1
    assert page.locator("#chart path.ofs").count()==1
    assert page.locator("#chart path.pred").count()==0
    assert page.locator("#chart .short-tide-point").count()==0
    assert page.locator("#chart .short-model-point").count()>=3
    chart_text=page.locator("#chart").text_content() or ""
    assert "Astronomical high" not in chart_text,chart_text

    threshold_fills=page.eval_on_selector_all("#chart .threshold-band","els => els.map(el => el.getAttribute('fill'))")
    assert threshold_fills==["#FFFF00","#FFA500","#FF0000"],threshold_fills
    threshold_names=page.eval_on_selector_all("#chart .threshold-band","els => els.map(el => el.getAttribute('data-threshold'))")
    assert threshold_names==["minor","moderate","major"],threshold_names
    threshold_labels=page.eval_on_selector_all("#chart .zone-label","els => els.map(el => el.textContent)")
    assert threshold_labels==["Minor flood 12–13 ft","Moderate flood 13–14 ft","Major flood 14+ ft"],threshold_labels
    threshold_label_fills=page.eval_on_selector_all("#chart .zone-label","els => els.map(el => getComputedStyle(el).fill)")
    assert threshold_label_fills==["rgb(7, 24, 36)","rgb(7, 24, 36)","rgb(255, 255, 255)"],threshold_label_fills
    peak_points=page.locator("#chart [data-series='noaa-model-high']").count()
    peak_guides=page.locator("#chart [data-peak-guide='true']").count()
    peak_ticks=page.locator("#chart [data-peak-tick='true']").count()
    assert peak_points>=2,peak_points
    assert peak_guides==peak_points,(peak_guides,peak_points)
    assert peak_ticks==peak_points,(peak_ticks,peak_points)
    assert "exact ET time" in page.locator("#chartPeriod").inner_text()

    # App-wide readability: proper-case labels, higher contrast, and undistorted SVG text.
    assert page.locator(".brand h1").inner_text().strip()=="Saco Coast Watch"
    label_style=page.locator(".metric .label").first.evaluate("el => ({transform:getComputedStyle(el).textTransform,color:getComputedStyle(el).color,fontWeight:getComputedStyle(el).fontWeight})")
    assert label_style["transform"]=="none",label_style
    eyebrow_style=page.locator(".eyebrow").first.evaluate("el => ({transform:getComputedStyle(el).textTransform,letter:getComputedStyle(el).letterSpacing})")
    assert eyebrow_style["transform"]=="none",eyebrow_style
    th_style=page.locator("th").first.evaluate("el => ({transform:getComputedStyle(el).textTransform,color:getComputedStyle(el).color})")
    assert th_style["transform"]=="none",th_style
    chart_dims=page.locator("#chart").evaluate("el => ({cw:el.clientWidth,ch:el.clientHeight,vw:el.viewBox.baseVal.width,vh:el.viewBox.baseVal.height})")
    rendered_ratio=chart_dims["cw"]/chart_dims["ch"]
    view_ratio=chart_dims["vw"]/chart_dims["vh"]
    assert abs(rendered_ratio-view_ratio)<0.03,(rendered_ratio,view_ratio,chart_dims)

    reference=page.locator(".threshold-reference")
    assert reference.locator("#thresholdHeading").inner_text().strip()=="Flood thresholds"
    assert reference.locator(".threshold").count()==3
    rail_colors=reference.locator(".rail").evaluate_all("els => els.map(el => getComputedStyle(el).backgroundColor)")
    assert rail_colors==["rgb(255, 255, 0)","rgb(255, 165, 0)","rgb(255, 0, 0)"],rail_colors
    history=reference.locator(".history-reference")
    assert not history.evaluate("el => el.open")
    assert "January 2024 historical reference" in reference.inner_text()
    collapsed_height=reference.bounding_box()["height"]
    assert collapsed_height<360,f"threshold reference should stay compact when history is collapsed: {collapsed_height}px"
    history.locator("summary").click()
    assert history.evaluate("el => el.open")
    assert reference.locator(".history").count()==2
    history.locator("summary").click()
    assert not history.evaluate("el => el.open")

    details=page.locator(".full-calendar")
    assert not details.evaluate("el => el.open")
    assert page.locator("#highTideCalendar .daytile").count()==30
    assert "Higher predicted tide" not in section.inner_text()
    page.locator(".full-calendar summary").click()
    assert details.evaluate("el => el.open")
    assert page.locator("#highTideCalendar .daytile").first.is_visible()
    return section

def main():
    errors=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=["--no-sandbox"])

        desktop=browser.new_page(viewport={"width":1440,"height":1000},device_scale_factor=1)
        desktop.on("pageerror",lambda exc: errors.append("desktop pageerror: "+str(exc)))
        install_noaa_fixture(desktop)
        section=assert_common(desktop)
        desktop_overflow=desktop.evaluate("document.documentElement.scrollWidth-window.innerWidth")
        assert desktop_overflow<=3,f"desktop horizontal overflow: {desktop_overflow}px"
        section.screenshot(path="tide-outlook-smoke-desktop.png")
        desktop.locator(".threshold-reference").screenshot(path="tide-outlook-smoke-threshold-desktop.png")
        desktop.close()

        mobile=browser.new_page(viewport={"width":390,"height":844},device_scale_factor=2)
        mobile.on("pageerror",lambda exc: errors.append("mobile pageerror: "+str(exc)))
        install_noaa_fixture(mobile)
        section=assert_common(mobile)
        scroll=mobile.locator("#tideTrendScroll").evaluate("el => ({client:el.clientWidth,scroll:el.scrollWidth})")
        assert scroll["scroll"]>scroll["client"],f"mobile trend should use local horizontal scrolling: {scroll}"
        page_overflow=mobile.evaluate("document.documentElement.scrollWidth-window.innerWidth")
        assert page_overflow<=3,f"mobile page overflow: {page_overflow}px"
        mobile.locator(".full-calendar summary").click()  # close full calendar for compact screenshot
        section.screenshot(path="tide-outlook-smoke-mobile.png")
        mobile.locator(".threshold-reference").screenshot(path="tide-outlook-smoke-threshold-mobile.png")
        mobile.close()

        browser.close()

    if errors:
        raise AssertionError("\n".join(errors))
    print("PASS: 14-day tide + NOAA OFS daily peaks, semantic bands, tap detail, 30-day expansion, desktop + mobile containment")

if __name__=="__main__":
    main()
