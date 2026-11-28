#!/usr/bin/env python3
"""Deterministic product regression: containment, disclosures, provenance and input access."""
import json,os
from datetime import datetime,timedelta,timezone
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_runtime import launch_configured_browser
from tide_outlook_smoke import install_noaa_fixture
BASE=os.environ.get('SACOCAST_SMOKE_URL','http://127.0.0.1:8765/').rstrip('/')+'/'
OUT=Path(os.environ.get('SACOCAST_PRODUCT_SCREENSHOT_DIR','/tmp/sacocast-product-audit'))

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 errors=[]
 with sync_playwright() as p:
  browser=launch_configured_browser(p,'responsive-accessibility-product')
  for width in (320,375,390,430,768,1440):
   page=browser.new_page(viewport={'width':width,'height':900},has_touch=width<500,is_mobile=width<500)
   page.on('pageerror',lambda e:errors.append(str(e)))
   install_noaa_fixture(page)
   at=datetime.now(timezone.utc)
   frames=[{'file':'current.jpg','captured_at':(at-timedelta(hours=2)).isoformat()},{'file':'old.jpg','captured_at':(at-timedelta(hours=25)).isoformat()},{'file':'future.jpg','captured_at':(at+timedelta(hours=2)).isoformat()},{'file':'bad.jpg','captured_at':'not-a-time'}]
   page.route('**/data/webcams/ferry-history/index.json*',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps({'retention_hours':24,'frames':frames})))
   page.goto(BASE,wait_until='domcontentloaded')
   page.wait_for_function("state.lastFetched.model && state.lastFetched.weatherForecast && document.querySelector('#sourceTools')")
   page.wait_for_function("document.querySelector('#introQualifications summary')?.getAttribute('aria-expanded')==='false'")
   assert page.locator('#chart').bounding_box()['width']>page.locator('.main-grid').bounding_box()['width']*.85,'chart must occupy the intended column'
   assert page.locator('.coastal-briefing').evaluate("e=>e.compareDocumentPosition(document.querySelector('.camera-hub')) & Node.DOCUMENT_POSITION_FOLLOWING"),'briefing must precede camera block'
   assert not page.locator('#coastalToolsDetails').get_attribute('open')
   assert not page.locator('.coastal-map-panel').is_visible(),'collapsed tools must actually hide the map'
   assert not page.locator('.calendar-panel').is_visible(),'collapsed tools must actually hide the calendar'
   summary=page.locator('#introQualifications > summary')
   assert summary.bounding_box()['height']>=44
   assert summary.locator('.disclosure-chevron').count()==1
   assert summary.locator('.disclosure-action').count()==0
   summary.focus();summary.press('Enter')
   page.wait_for_function("document.querySelector('#introQualifications summary').getAttribute('aria-expanded')==='true'")
   assert page.locator('#introQualifications p').is_visible()
   # Chevron is immediately adjacent to the heading, not pushed to the opposite edge.
   gap=summary.evaluate("e=>{const r=document.createRange();r.selectNodeContents(e);const text=e.firstChild;const t=document.createRange();t.selectNodeContents(text);return e.querySelector('svg').getBoundingClientRect().left-t.getBoundingClientRect().right}")
   assert 0<=gap<=14,('disclosure gap',width,gap)
   summary.press('Space')
   page.wait_for_function("document.querySelector('#introQualifications summary').getAttribute('aria-expanded')==='false'")
   assert not page.locator('#introQualifications p').is_visible()
   page.wait_for_function("document.querySelectorAll('#ferryArchiveThumbs .ferry-archive-thumb').length===1")
   assert page.locator('#ferryArchiveCount').inner_text().startswith('1 saved image')
   assert page.locator('#ferryArchiveThumbs img').get_attribute('src').split('?')[0].endswith('current.jpg')
   assert 'Portland Water-Level Status' in page.locator('.status').inner_text()
   assert '✓' not in page.locator('#statusIcon').inner_text()
   assert 'Source Times' in page.locator('#syncTime').inner_text() or 'Sources' in page.locator('#syncTime').inner_text()
   assert page.locator('.metric p').first.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)')>=13
   page.locator('#chart').focus();page.locator('#chart').press('ArrowRight')
   assert 'ft' in page.locator('#chartSelection').inner_text() and 'ET' in page.locator('#chartSelection').inner_text()
   page.locator('#coastalToolsDetails > summary').click()
   page.locator('#mapTools > summary').click()
   assert page.locator('.coastal-map-panel').is_visible()
   page.locator('#mapTools > summary').click()
   assert not page.locator('.coastal-map-panel').is_visible()
   page.locator('#coastalToolsDetails > summary').click()
   # Negative departure wording must say below; no all-clear on missing model.
   page.evaluate("state.obs=[{t:Date.now(),v:2}];state.pred=[{t:Date.now(),v:3}];state.model=[];renderSummary()")
   assert 'below' in page.locator('#departureDetail').inner_text()
   assert 'observation only' in page.locator('#statusDescription').inner_text()
   page.evaluate("state.model=[{t:Date.now()+3600000,v:14.5}];renderSummary()")
   contrast=page.locator('.panel.status .statusbadge').evaluate("""e=>{const rgb=s=>s.match(/[0-9.]+/g).slice(0,3).map(Number),l=s=>rgb(s).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);const a=l(getComputedStyle(e).color),b=l(getComputedStyle(e).backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)}""")
   assert contrast>=4.5,('major status contrast',contrast)
   # Disclosure state survives repeated init and icons do not duplicate.
   page.evaluate("SacoDisclosures.init();SacoDisclosures.init();SacoIcons.init();SacoIcons.init()")
   assert summary.locator('.disclosure-chevron').count()==1
   assert page.locator('#refreshBtn .utility-icon').count()==1
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),('overflow',width)
   page.locator('#briefOpen').click()
   assert page.locator('#briefingDialog').is_visible()
   dialog=page.locator('#briefingDialog')
   assert dialog.bounding_box()['width']<=width
   assert dialog.evaluate('e=>getComputedStyle(e).overflowY')=='hidden','outer dialog must not create a second scrollbar'
   page.keyboard.press('Escape')
   assert not dialog.is_visible()
   assert page.locator('#briefOpen').evaluate('e=>e===document.activeElement'),'modal must restore focus'
   page.evaluate('scrollTo(0,0)')
   if width in (375,390,1440):page.screenshot(path=str(OUT/f'product-{width}.png'),full_page=True,animations='disabled')
   page.emulate_media(reduced_motion='reduce')
   assert page.locator('.header-weather-item svg').count()>0
   assert page.locator('.header-weather-item svg *').evaluate_all("nodes=>nodes.every(e=>getComputedStyle(e).animationName==='none')")
   if width==390:
    page.locator('body').evaluate("e=>e.style.fontSize='200%'")
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'text enlargement overflow'
   print(f'PASS product viewport {width}px',flush=True)
   page.close()
  browser.close()
 assert not errors,errors
 print('PASS: six viewport widths, real disclosure containment, keyboard/touch targets, chart source times, partial states, focus return, reduced motion and text enlargement')
if __name__=='__main__':main()
