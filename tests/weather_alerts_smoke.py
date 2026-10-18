#!/usr/bin/env python3
"""Render mocked NWS alert feeds at desktop and phone sizes."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_runtime import launch_configured_browser

BASE=os.environ.get('SACOCAST_SMOKE_URL','http://127.0.0.1:8765/').rstrip('/')+'/'
OUT=Path(os.environ.get('SACOCAST_ALERT_SCREENSHOT_DIR','/tmp/sacocast-alert-audit'))
OUT.mkdir(parents=True,exist_ok=True)

def alert(severity,event):
    now=datetime.now(timezone.utc)
    return {'properties':{'event':event,'severity':severity,'effective':(now-timedelta(minutes=10)).isoformat(),'expires':(now+timedelta(hours=2)).isoformat(),'headline':f'Official {event} headline','description':f'Full official {event} details.'}}

def main():
    fixture={'features':[]}
    def fulfill(route):
        route.fulfill(status=200,content_type='application/geo+json',body=json.dumps(fixture))
    with sync_playwright() as playwright:
        browser=launch_configured_browser(playwright,'weather-alerts-responsive-smoke')
        for width,height,name,mobile in [(1440,900,'desktop',False),(390,844,'iphone',True),(375,667,'iphone-small',True)]:
            page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=3 if mobile else 1,is_mobile=mobile,has_touch=mobile)
            page.route('**/api.weather.gov/alerts/active?point=*',fulfill)
            page.goto(BASE,wait_until='domcontentloaded',timeout=45000)
            badge=page.locator('#healthAlerts')
            badge.wait_for(timeout=30000)
            page.wait_for_function("document.querySelector('#healthAlerts')?.textContent==='0 active'",timeout=30000)
            panel=page.locator('.alertpanel')
            assert panel.evaluate('(el)=>getComputedStyle(el).display')=='none','zero-alert panel must be removed from layout'
            assert panel.locator('.empty').count()==0,'zero alerts must not show a placeholder'
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),f'horizontal overflow at {width}px'

            fixture['features']=[alert('Minor','Minor coastal wind alert'),alert('Extreme','Extreme wind alert'),alert('Severe','Severe coastal storm alert')]
            page.reload(wait_until='domcontentloaded',timeout=45000)
            page.wait_for_function("document.querySelector('#healthAlerts')?.textContent==='3 active'",timeout=30000)
            assert panel.is_visible()
            assert panel.evaluate("el=>el.classList.contains('alertpanel--extreme')")
            assert panel.locator('.alert').count()==3,'all alerts must remain available'
            assert panel.locator('.alert').nth(0).locator('strong').inner_text()=='Extreme wind alert','most severe alert must appear first'
            assert 'Highest NWS severity · Extreme' in panel.locator('.alert-severity').inner_text()
            appearance=panel.evaluate("el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopColor,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})")
            assert appearance['width']<=width and appearance['height']>0,appearance
            assert appearance['background']=='rgb(51, 11, 23)',appearance
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),f'horizontal overflow at {width}px with alerts'
            page.screenshot(path=str(OUT/f'active-alert-{name}.png'),full_page=True)
            print(f'PASS weather alert panel {name} {width}x{height}: {appearance}')
            page.close()
        browser.close()
    print(f'Alert screenshots saved to {OUT}')

if __name__=='__main__':
    main()
