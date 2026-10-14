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
  Object.defineProperty(window, 'Notification', {configurable:true, value:{permission:window.__testPermission||'default', requestPermission:async()=>{window.__permissionCalls++;return 'granted';}}});
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

def init_script(permission='default'):
    return f"window.__testPermission={json.dumps(permission)};\n" + INIT

def worker_mock(calls, state=None):
    if state is None:
        state = {}
    state.setdefault('eventPreferences', {'starts': True, 'ends': True, 'changes': True})
    state.setdefault('history', [{'kind':'start','title':'Coastal Flood Advisory','body':'Official event update','status':'delivered','createdAt':100,'sentAt':110}])
    state.setdefault('thresholdHistory', [
        {'kind':'threshold','channel':'app','metric':'waterObserved','title':'Observed water level threshold reached','status':'delivered','sentAt':120},
        {'kind':'threshold','channel':'email','metric':'wind','title':'Wind speed threshold reached','status':'delivered','sentAt':115}
    ])
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
        if '/push/devices/history?' in request.url and request.method == 'GET':
            route.fulfill(status=200, headers={**cors,'content-type':'application/json'},body=json.dumps({'items':state['history'],'thresholdItems':state['thresholdHistory'],'retentionDays':30}))
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
    page.add_init_script(init_script())
    errors=[]
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    assert_dialog_hidden(page)
    assert page.locator('#alertsButton').inner_text() in ('Alerts','Create Alerts','Manage Alerts')
    assert page.evaluate('window.__permissionCalls') == 0
    open_alerts(page)
    page.wait_for_function('window.__registerCalls >= 1', timeout=10000)
    assert page.evaluate('window.__registerCalls') >= 1
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
    mobile.add_init_script(init_script())
    mobile_errors=[]
    mobile.on('pageerror', lambda err: mobile_errors.append(str(err)))
    mobile.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    assert_dialog_hidden(mobile)
    open_alerts(mobile)
    mobile.wait_for_function("document.querySelector('#pushStatus').textContent.toLowerCase().includes('add sacocast to your home screen')", timeout=10000)
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
    deep_link=browser.new_page(viewport={'width':390,'height':844})
    deep_link.add_init_script("localStorage.setItem('sacocast.test-existing','true');localStorage.setItem('sacocast.push.device.v1',JSON.stringify({deviceId:'"+DEVICE_ID+"',token:'"+TOKEN+"'}));\n"+init_script())
    deep_link.route(WORKER+'/**', worker_mock([],{}))
    separator='&' if '?' in BASE else '?'
    deep_link.goto(BASE+separator+'openAlerts=1',wait_until='domcontentloaded',timeout=45000)
    deep_link.locator('#alertsDialog').wait_for(state='visible',timeout=10000)
    deep_link.locator('.push-panel').wait_for(state='visible',timeout=5000)
    assert 'openAlerts=1' not in deep_link.url
    assert deep_link.locator('#alertsButton').inner_text() == 'Manage Alerts'
    deep_link.close()

    calls=[]
    state={}
    page=browser.new_page(viewport={'width':1440,'height':1000})
    page.add_init_script(init_script())
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
    page.locator('#notificationHistory').wait_for(state='visible',timeout=5000)
    page.get_by_text('Coastal Flood Advisory').wait_for(timeout=5000)
    assert page.locator('#notificationHistory .history-delivered').count() >= 1
    assert 'latest successful custom-threshold delivery' in page.locator('#notificationHistory').inner_text()
    assert page.get_by_text('Observed water level threshold reached').is_visible()
    assert page.get_by_text('Wind speed threshold reached').is_visible()
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
    page.get_by_text('The push service accepted the test. Check this device’s notification center; acceptance does not confirm that it was displayed.').wait_for(timeout=10000)

    page.locator('#pushDisable').click()
    page.get_by_text('App notifications are off on this device.').wait_for(timeout=10000)
    assert page.locator('#pushSettings').is_hidden()
    assert page.locator('#notificationHistory').is_hidden()
    assert page.locator('#pushEnable').is_visible()
    assert page.locator('#emailOnlyEntry').is_visible()
    assert page.locator('#alertsButton').inner_text() == 'Create Alerts'
    assert state['threshold']['preferences']['channels']['email'] is True

    page.locator('#alertsClose').click()
    assert_dialog_hidden(page)

    unavailable=browser.new_page(viewport={'width':390,'height':844})
    unavailable.add_init_script(init_script())
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

    denied=browser.new_page(viewport={'width':390,'height':844})
    denied.add_init_script(init_script('denied'))
    denied.route(WORKER+'/**', worker_mock([]))
    denied.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    assert_dialog_hidden(denied)
    open_alerts(denied)
    assert denied.locator('#pushEnable').is_disabled()
    assert 'blocked in browser settings' in denied.locator('#pushStatus').inner_text().lower()
    assert denied.locator('#emailOnlyLink').is_visible()
    assert denied.evaluate('window.__permissionCalls') == 0
    denied.close()

    enrolled_denied=browser.new_page(viewport={'width':390,'height':844})
    enrolled_denied.add_init_script("localStorage.setItem('sacocast.test-existing','true');localStorage.setItem('sacocast.push.device.v1',JSON.stringify({deviceId:'"+DEVICE_ID+"',token:'"+TOKEN+"'}));\n"+init_script('denied'))
    enrolled_denied.route(WORKER+'/**', worker_mock([]))
    enrolled_denied.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    enrolled_denied.wait_for_function("document.querySelector('#alertsButton').textContent==='Manage Alerts'", timeout=5000)
    open_alerts(enrolled_denied)
    assert enrolled_denied.locator('#pushSettings').is_visible()
    assert enrolled_denied.locator('#pushEnable').is_hidden()
    assert enrolled_denied.locator('#pushTest').is_disabled()
    assert 'enrolled' in enrolled_denied.locator('#pushStatus').inner_text().lower()
    assert 'blocked in browser settings' in enrolled_denied.locator('#pushStatus').inner_text().lower()
    assert enrolled_denied.evaluate('window.__permissionCalls') == 0
    enrolled_denied.close()

    expired=browser.new_page(viewport={'width':390,'height':844})
    expired.add_init_script("localStorage.setItem('sacocast.test-existing','true');localStorage.setItem('sacocast.push.device.v1',JSON.stringify({deviceId:'"+DEVICE_ID+"',token:'"+TOKEN+"'}));\n"+init_script())
    expired_calls=[]
    normal_handler=worker_mock(expired_calls)
    def expired_worker(route):
        if route.request.url.endswith('/push/devices/test'):
            route.fulfill(status=410, headers={'Access-Control-Allow-Origin':route.request.headers.get('origin','http://127.0.0.1:8765'),'content-type':'application/json'}, body='{"error":"This browser subscription has expired"}')
        else:
            normal_handler(route)
    expired.route(WORKER+'/**', expired_worker)
    expired.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    expired.wait_for_function("document.querySelector('#alertsButton').textContent==='Manage Alerts'", timeout=5000)
    open_alerts(expired)
    expired.locator('#pushTest').click()
    expired.get_by_text('This browser subscription expired and was removed. Turn on App notifications again to create a fresh subscription.').wait_for(timeout=10000)
    assert expired.locator('#alertsButton').inner_text() == 'Create Alerts'
    assert expired.locator('#pushSettings').is_hidden()
    assert expired.locator('#pushEnable').is_visible()
    assert any(url.endswith('/push/devices/disable') for url in expired_calls)
    expired.close()

    failed_test=browser.new_page(viewport={'width':390,'height':844})
    failed_test.add_init_script("localStorage.setItem('sacocast.test-existing','true');localStorage.setItem('sacocast.push.device.v1',JSON.stringify({deviceId:'"+DEVICE_ID+"',token:'"+TOKEN+"'}));\n"+init_script())
    normal_handler=worker_mock([])
    def failed_test_worker(route):
        if route.request.url.endswith('/push/devices/test'):
            route.fulfill(status=502, headers={'Access-Control-Allow-Origin':route.request.headers.get('origin','http://127.0.0.1:8765'),'content-type':'application/json'}, body='{"error":"The push provider did not accept the test notification"}')
        else:
            normal_handler(route)
    failed_test.route(WORKER+'/**', failed_test_worker)
    failed_test.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    failed_test.wait_for_function("document.querySelector('#alertsButton').textContent==='Manage Alerts'", timeout=5000)
    open_alerts(failed_test)
    failed_test.locator('#pushTest').click()
    failed_test.get_by_text('The push provider did not accept the test notification').wait_for(timeout=10000)
    assert failed_test.locator('#pushTest').is_enabled()
    assert failed_test.locator('#alertsButton').inner_text() == 'Manage Alerts'
    failed_test.close()

    network_failure=browser.new_page(viewport={'width':390,'height':844})
    network_failure.add_init_script(init_script())
    network_failure.route(WORKER+'/**', lambda route: route.abort())
    network_failure.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    assert_dialog_hidden(network_failure)
    open_alerts(network_failure)
    assert network_failure.locator('#pushEnable').is_disabled()
    assert 'could not be checked' in network_failure.locator('#pushStatus').inner_text().lower()
    assert network_failure.locator('#emailOnlyLink').is_visible()
    assert network_failure.evaluate('window.__permissionCalls') == 0
    network_failure.close()

    mobile=browser.new_page(
        viewport={'width':390,'height':844},
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    )
    mobile.add_init_script(init_script())
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
    active.add_init_script("localStorage.setItem('sacocast.test-existing','true');localStorage.setItem('sacocast.push.device.v1',JSON.stringify({deviceId:'"+DEVICE_ID+"',token:'"+TOKEN+"'}));\n"+init_script())
    active.route(WORKER+'/**', worker_mock([]))
    active.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    active.wait_for_function("document.querySelector('#alertsButton').textContent==='Manage Alerts'", timeout=5000)
    open_alerts(active)
    assert active.locator('#pushEnable').is_hidden()
    assert active.locator('#pushSettings').is_visible()
    assert active.locator('#emailOnlyEntry').is_visible()
    active.locator('#notificationHistory').wait_for(state='visible',timeout=5000)
    active.get_by_text('Coastal Flood Advisory').wait_for(timeout=5000)
    history_box=active.locator('#notificationHistory').bounding_box()
    active_dialog=active.locator('#alertsDialog').bounding_box()
    assert history_box and active_dialog and history_box['x']>=active_dialog['x'] and history_box['x']+history_box['width']<=active_dialog['x']+active_dialog['width']
    assert active.evaluate('document.documentElement.scrollWidth-window.innerWidth')<=3
    active.close()

    stale=browser.new_page(viewport={'width':390,'height':844})
    stale.add_init_script("localStorage.setItem('sacocast.push.device.v1',JSON.stringify({deviceId:'"+DEVICE_ID+"',token:'"+TOKEN+"'}));\n"+init_script())
    stale.route(WORKER+'/**', worker_mock([]))
    stale.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    stale.wait_for_function("document.querySelector('#alertsButton').textContent==='Create Alerts'", timeout=5000)
    open_alerts(stale)
    assert stale.locator('#pushEnable').is_visible()
    stale.close()

    unverifiable=browser.new_page(viewport={'width':390,'height':844})
    unverifiable.add_init_script("localStorage.setItem('sacocast.test-existing','true');localStorage.setItem('sacocast.push.device.v1',JSON.stringify({deviceId:'"+DEVICE_ID+"',token:'"+TOKEN+"'}));\n"+init_script())
    unchanged=[]
    def preferences_unavailable(route):
        request=route.request
        if request.method=='OPTIONS':
            route.fulfill(status=204,headers={'Access-Control-Allow-Origin':request.headers.get('origin','http://127.0.0.1:8765'),'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type'})
        elif request.url.endswith('/push/config'):
            route.fulfill(status=200,headers={'Access-Control-Allow-Origin':request.headers.get('origin','http://127.0.0.1:8765'),'content-type':'application/json'},body='{"enabled":true,"publicKey":"'+PUBLIC_KEY+'","thresholdsEnabled":true}')
        elif '/push/devices/preferences?' in request.url:
            route.fulfill(status=503,headers={'Access-Control-Allow-Origin':request.headers.get('origin','http://127.0.0.1:8765'),'content-type':'application/json'},body='{"error":"temporarily unavailable"}')
        else:
            unchanged.append(request.url)
            route.fulfill(status=500,headers={'content-type':'application/json'},body='{}')
    unverifiable.route(WORKER+'/**',preferences_unavailable)
    unverifiable.goto(BASE,wait_until='domcontentloaded',timeout=45000)
    unverifiable.wait_for_function("document.querySelector('#alertsButton').textContent==='Alerts'",timeout=5000)
    open_alerts(unverifiable)
    assert unverifiable.locator('#pushEnable').is_disabled()
    assert 'existing subscription was left unchanged' in unverifiable.locator('#pushStatus').inner_text().lower()
    assert unverifiable.locator('#emailOnlyEntry').is_visible()
    assert not any(url.endswith('/push/devices/disable') for url in unchanged)
    unverifiable.close()

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
