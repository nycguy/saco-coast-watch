#!/usr/bin/env python3
"""Browser smoke for the single Create/Manage Alerts entry point and modal alert manager."""
import json
import os
from playwright.sync_api import sync_playwright
from browser_runtime import launch_chromium

BASE = os.environ.get('SACOCAST_SMOKE_URL', 'http://127.0.0.1:8765/index.html')
LIVE = os.environ.get('SACOCAST_LIVE_SMOKE') == '1'
WORKER = 'https://saco-coastal-alerts.mikewiley-nyc.workers.dev'
PUBLIC_KEY = 'B' + 'A' * 86
DEVICE_ID = '12345678-1234-4234-8234-123456789abc'
TOKEN = 'a' * 64

INIT = r"""
(() => {
  window.__permissionCalls = 0;
  window.__registerCalls = 0;
  Object.defineProperty(window, 'Notification', {configurable:true, value:{permission:'default', requestPermission:async()=>{window.__permissionCalls++;return 'granted';}}});
  Object.defineProperty(window, 'PushManager', {configurable:true, value:function PushManager(){}});
  const subscription={toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/test-device',keys:{p256dh:'BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU',auth:'BwcHBwcHBwcHBwcHBwcHBw'}}),unsubscribe:async()=>true};
  let current=localStorage.getItem('sacocast.test-existing')==='true'?subscription:null;
  const manager={getSubscription:async()=>current,subscribe:async()=>{current=subscription;return subscription;}};
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{
    getRegistration:async()=>({pushManager:manager}),
    register:async()=>{window.__registerCalls++;return {pushManager:manager};}
  }});
})();
"""

def worker_mock(calls, state=None):
    if state is None:
        state = {}
    state.setdefault('eventPreferences', {'starts': True, 'ends': True, 'changes': True})
    state.setdefault('threshold', {
        "preferences":{"metrics":{
            "waterObserved":{"enabled":False,"threshold":12},
            "waterForecast":{"enabled":False,"threshold":12},
            "wind":{"enabled":False,"threshold":30},
            "gust":{"enabled":False,"threshold":45},
            "tempHigh":{"enabled":False,"threshold":90},
            "tempLow":{"enabled":False,"threshold":32}
        },"channels":{"push":False,"email":False}},
        "linkedEmail":None
    })
    def handle(route):
        request = route.request
        calls.append(request.url)
        cors = {
            'Access-Control-Allow-Origin': request.headers.get('origin','http://127.0.0.1:8765'),
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'authorization, content-type'
        }
        if request.method == 'OPTIONS':
            route.fulfill(status=204, headers=cors)
            return
        if request.url.endswith('/push/config'):
            route.fulfill(status=200, headers={**cors,'content-type':'application/json'},
                          body='{"enabled":true,"publicKey":"'+PUBLIC_KEY+'","thresholdsEnabled":true}')
            return
        if '/push/devices/thresholds?' in request.url and request.method == 'GET':
            route.fulfill(status=200, headers={**cors,'content-type':'application/json'}, body=json.dumps(state['threshold']))
            return
        if request.url.endswith('/push/devices/thresholds') and request.method == 'PUT':
            payload=json.loads(request.post_data or '{}')
            state['threshold']['preferences']=payload.get('preferences',{})
            wants_email=state['threshold']['preferences'].get('channels',{}).get('email') is True
            route.fulfill(status=200, headers={**cors,'content-type':'application/json'},
                          body=json.dumps({"updated":True,"linkedEmail":state['threshold']['linkedEmail'],"emailConfirmationRequired":wants_email and not state['threshold']['linkedEmail']}))
            return
        if request.url.endswith('/push/devices/thresholds/email') and request.method == 'POST':
            route.fulfill(status=202, headers={**cors,'content-type':'application/json'},
                          body='{"confirmationSent":true,"maskedEmail":"t***@example.com"}')
            return
        if request.url.endswith('/push/devices/test'):
            route.fulfill(status=200, headers={**cors,'content-type':'application/json'}, body='{"sent":true}')
            return
        if '/push/devices/preferences?' in request.url and request.method == 'GET':
            route.fulfill(status=200, headers={**cors,'content-type':'application/json'},
                          body=json.dumps({"preferences":state['eventPreferences']}))
            return
        if request.url.endswith('/push/devices/preferences') and request.method == 'PUT':
            state['eventPreferences']=json.loads(request.post_data or '{}').get('preferences',{})
            route.fulfill(status=200, headers={**cors,'content-type':'application/json'},
                          body=json.dumps({"updated":True,"preferences":state['eventPreferences']}))
            return
        status = 201 if request.url.endswith('/push/devices') and request.method == 'POST' else 200
        route.fulfill(status=status, headers={**cors,'content-type':'application/json'},
                      body='{"deviceId":"'+DEVICE_ID+'","token":"'+TOKEN+'","updated":true,"disabled":true}')
    return handle

def assert_dialog_hidden(page):
    assert page.locator('#alertsButton').is_visible()
    assert page.locator('#alertsDialog').evaluate('(el)=>!el.open')
    assert page.locator('.push-panel').is_hidden()

def open_alerts(page):
    page.locator('#alertsButton').click()
    page.locator('#alertsDialog').wait_for(state='visible', timeout=5000)
    page.locator('.push-panel').wait_for(state='visible', timeout=5000)

def run_live(browser):
    page = browser.new_page(viewport={'width':1440,'height':1000})
    page.add_init_script(INIT)
    errors=[]
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    assert_dialog_hidden(page)
    assert page.locator('#alertsButton').inner_text() in ('Create Alerts','Manage Alerts')
    assert page.evaluate('window.__permissionCalls') == 0
    assert page.evaluate('window.__registerCalls') >= 1
    open_alerts(page)
    assert page.locator('#pushEnable').is_enabled()
    target=page.locator('#pushEnable').bounding_box()
    assert target and target['width'] >= 44 and target['height'] >= 44
    assert page.evaluate('document.documentElement.scrollWidth-window.innerWidth') <= 3

    preference_probe = page.evaluate("""async () => {
      const response = await fetch('https://saco-coastal-alerts.mikewiley-nyc.workers.dev/push/devices/preferences', {
        method: 'PUT',
        headers: {'content-type':'application/json','authorization':'Bearer ' + 'a'.repeat(64)},
        body: JSON.stringify({deviceId:'11111111-1111-4111-8111-111111111111',preferences:{starts:false,ends:false,changes:false}})
      });
      return {status:response.status, body:await response.json()};
    }""")
    assert preference_probe['status'] == 404, f"live preference PUT route failed: {preference_probe}"

    mobile = browser.new_page(
        viewport={'width':390,'height':844},
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    )
    mobile.add_init_script(INIT)
    mobile_errors=[]
    mobile.on('pageerror', lambda err: mobile_errors.append(str(err)))
    mobile.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    assert_dialog_hidden(mobile)
    open_alerts(mobile)
    mobile_status=mobile.locator('#pushStatus').inner_text()
    assert 'add sacocast to your home screen' in mobile_status.lower(), mobile_status
    assert mobile.locator('#pushEnable').is_disabled()
    box=mobile.locator('#alertsDialog').bounding_box()
    assert box and box['x'] >= 0 and box['x'] + box['width'] <= 390
    assert mobile.evaluate('document.documentElement.scrollWidth-window.innerWidth') <= 3
    assert mobile.evaluate('window.__permissionCalls') == 0
    assert not mobile_errors, f'live mobile browser errors: {mobile_errors}'
    assert not errors, f'live desktop browser errors: {errors}'
    mobile.close()
    page.close()
    print('PASS: live single Alerts entry point opens the modal manager; no alert workflow is visible in the dashboard body')

def run_mocked(browser):
    calls=[]
    state={}
    page=browser.new_page(viewport={'width':1440,'height':1000})
    page.add_init_script(INIT)
    errors=[]
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.route(WORKER+'/**', worker_mock(calls,state))
    page.goto(BASE, wait_until='domcontentloaded', timeout=45000)

    assert_dialog_hidden(page)
    assert page.locator('#alertsButton').inner_text() == 'Create Alerts'
    assert page.evaluate('window.__permissionCalls') == 0
    assert page.evaluate('window.__registerCalls') >= 1
    assert calls.count(WORKER+'/push/config') == 1

    open_alerts(page)
    assert page.locator('#pushEnable').is_enabled()
    target=page.locator('#pushEnable').bounding_box()
    assert target and target['width'] >= 44 and target['height'] >= 44
    assert page.locator('#emailOnlyLink').is_visible()

    page.locator('#pushEnable').click()
    page.get_by_text('App notifications are on for this device.').wait_for(timeout=10000)
    assert page.evaluate('window.__permissionCalls') == 1
    assert page.locator('#alertsButton').inner_text() == 'Manage Alerts'
    assert page.locator('#pushEnable').is_hidden()
    page.locator('#pushSettings').wait_for(state='visible', timeout=5000)
    assert page.locator('#emailOnlyEntry').is_visible()
    assert page.locator('#emailOnlyLink').inner_text() == 'Email Alerts (Create or Manage) ↗'
    assert all(page.locator(f'[name="{name}"]').is_checked() for name in ('pushStarts','pushEnds','pushChanges'))

    page.locator('#thresholdPreferences').wait_for(state='visible', timeout=5000)
    page.locator('#threshold-tempHigh-enabled').check()
    page.locator('#threshold-tempHigh-value').fill('85')
    page.locator('#thresholdChannelPush').check()
    page.locator('#thresholdSave').click()
    page.get_by_text('Custom alert preferences saved.').wait_for(timeout=10000)

    page.locator('#thresholdChannelEmail').check()
    page.locator('#thresholdEmailAddress').fill('test@example.com')
    page.locator('#thresholdSave').click()
    page.get_by_text('Check t***@example.com to confirm Email delivery.').wait_for(timeout=10000)
    assert state['threshold']['preferences']['channels'] == {'push': True, 'email': True}
    assert page.locator('#thresholdEmailField').is_visible()

    # Confirmation happens on the Worker origin. Returning focus to SacoCast
    # refreshes the verified linked-email state without requiring a page reload.
    state['threshold']['linkedEmail']='test@example.com'
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    page.locator('#thresholdLinkedEmail').wait_for(state='visible', timeout=5000)
    page.locator('#thresholdEmailField').wait_for(state='hidden', timeout=5000)

    page.locator('#thresholdChannelPush').uncheck()
    page.locator('#thresholdSave').click()
    page.get_by_text('Custom alert preferences saved.').wait_for(timeout=10000)
    assert state['threshold']['preferences']['channels'] == {'push': False, 'email': True}
    page.locator('#thresholdChannelPush').check()
    page.locator('#thresholdSave').click()
    page.get_by_text('Custom alert preferences saved.').wait_for(timeout=10000)
    assert state['threshold']['preferences']['channels'] == {'push': True, 'email': True}

    for name in ('pushStarts','pushEnds','pushChanges'):
        page.locator(f'[name="{name}"]').uncheck()
        page.get_by_text('Notification preferences updated.').wait_for(timeout=10000)
        assert not page.locator(f'[name="{name}"]').is_checked()

    page.locator('#pushTest').click()
    page.get_by_text('Test notification sent. Check this device’s notification center.').wait_for(timeout=10000)

    page.locator('#pushDisable').click()
    page.get_by_text('App notifications are off on this device.').wait_for(timeout=10000)
    assert page.locator('#pushSettings').is_hidden()
    assert page.locator('#pushEnable').is_visible()
    assert page.locator('#emailOnlyEntry').is_visible()
    assert page.locator('#alertsButton').inner_text() == 'Create Alerts'
    assert state['threshold']['preferences']['channels']['email'] is True

    page.locator('#alertsClose').click()
    assert_dialog_hidden(page)

    unavailable=browser.new_page(viewport={'width':390,'height':844})
    unavailable.add_init_script(INIT)
    unavailable_calls=[]
    def unavailable_worker(route):
        unavailable_calls.append(route.request.url)
        route.fulfill(status=200,headers={
            'Access-Control-Allow-Origin':route.request.headers.get('origin','http://127.0.0.1:8765'),
            'content-type':'application/json'
        },body='{"enabled":false}')
    unavailable.route(WORKER+'/**', unavailable_worker)
    unavailable.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    assert_dialog_hidden(unavailable)
    open_alerts(unavailable)
    assert unavailable.locator('#pushEnable').is_disabled()
    assert unavailable.locator('#emailOnlyLink').is_visible()
    assert unavailable_calls == [WORKER+'/push/config']
    assert unavailable.evaluate('window.__permissionCalls') == 0
    unavailable.close()

    mobile=browser.new_page(
        viewport={'width':390,'height':844},
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    )
    mobile.add_init_script(INIT)
    mobile.route(WORKER+'/**', worker_mock([]))
    mobile_errors=[]
    mobile.on('pageerror', lambda err: mobile_errors.append(str(err)))
    mobile.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    assert_dialog_hidden(mobile)
    open_alerts(mobile)
    mobile_status=mobile.locator('#pushStatus').inner_text()
    assert 'add sacocast to your home screen' in mobile_status.lower(), mobile_status
    assert mobile.locator('#pushEnable').is_disabled()
    touch=mobile.locator('#pushEnable').bounding_box()
    assert touch and touch['width'] >= 44 and touch['height'] >= 44
    dialog_box=mobile.locator('#alertsDialog').bounding_box()
    assert dialog_box and dialog_box['x'] >= 0 and dialog_box['x'] + dialog_box['width'] <= 390
    mobile.evaluate("document.documentElement.style.fontSize='200%'")
    expanded=mobile.locator('#alertsDialog').bounding_box()
    overflow=mobile.evaluate('document.documentElement.scrollWidth-window.innerWidth')
    assert expanded and expanded['x'] >= 0 and expanded['x'] + expanded['width'] <= 390 and overflow <= 3
    assert not mobile_errors, f'mobile browser errors: {mobile_errors}'
    mobile.close()

    # A local credential only produces Manage Alerts after the Worker confirms
    # that the matching push device still exists.
    active=browser.new_page(viewport={'width':390,'height':844})
    active.add_init_script("localStorage.setItem('sacocast.test-existing','true');localStorage.setItem('sacocast.push.device.v1',JSON.stringify({deviceId:'"+DEVICE_ID+"',token:'"+TOKEN+"'}));\n"+INIT)
    active.route(WORKER+'/**', worker_mock([]))
    active.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    active.wait_for_function("document.querySelector('#alertsButton').textContent==='Manage Alerts'", timeout=5000)
    open_alerts(active)
    assert active.locator('#pushEnable').is_hidden()
    assert active.locator('#pushSettings').is_visible()
    assert active.locator('#emailOnlyEntry').is_visible()
    active.close()

    stale=browser.new_page(viewport={'width':390,'height':844})
    stale.add_init_script("localStorage.setItem('sacocast.push.device.v1',JSON.stringify({deviceId:'"+DEVICE_ID+"',token:'"+TOKEN+"'}));\n"+INIT)
    stale.route(WORKER+'/**', worker_mock([]))
    stale.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    stale.wait_for_function("document.querySelector('#alertsButton').textContent==='Create Alerts'", timeout=5000)
    assert stale.locator('#pushEnable').is_visible()
    stale.close()

    assert not errors, f'desktop browser errors: {errors}'
    page.close()
    print('PASS: Create/Manage Alerts is the only dashboard entry; settings stay in the modal and work on desktop/mobile')

def main():
    with sync_playwright() as p:
        browser=launch_chromium(p.chromium,"push-ui")
        try:
            run_live(browser) if LIVE else run_mocked(browser)
        finally:
            browser.close()

if __name__=='__main__':
    main()
