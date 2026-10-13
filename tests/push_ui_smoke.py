#!/usr/bin/env python3
"""Browser smoke for explicit opt-in, preference controls, disable, and iPhone guidance."""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SACOCAST_SMOKE_URL', 'http://127.0.0.1:8765/index.html')
LIVE = os.environ.get('SACOCAST_LIVE_SMOKE') == '1'
WORKER = 'https://saco-coastal-alerts.mikewiley-nyc.workers.dev'
PUBLIC_KEY = 'B' + 'A' * 86
DEVICE_ID = '12345678-1234-4234-8234-123456789abc'
TOKEN = 'a' * 64
INIT = r"""
(() => {
  window.__permissionCalls = 0;
  Object.defineProperty(window, 'Notification', {configurable:true, value:{permission:'default', requestPermission:async()=>{window.__permissionCalls++;return 'granted';}}});
  Object.defineProperty(window, 'PushManager', {configurable:true, value:function PushManager(){}});
  const subscription={toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/test-device',keys:{p256dh:'BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU',auth:'BwcHBwcHBwcHBwcHBwcHBw'}}),unsubscribe:async()=>true};
  let current=null;
  const manager={getSubscription:async()=>current,subscribe:async()=>{current=subscription;return subscription;}};
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:async()=>({pushManager:manager}),register:async()=>({pushManager:manager})}});
})();
"""

def main():
    calls=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.add_init_script(INIT)
        browser_errors=[]
        page.on('pageerror',lambda err: browser_errors.append(str(err)))
        def mock_worker(route):
            request=route.request
            calls.append(request.url)
            cors={'Access-Control-Allow-Origin':request.headers.get('origin','http://127.0.0.1:8765'),'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type'}
            if request.method=='OPTIONS':
                route.fulfill(status=204,headers=cors)
            elif request.url.endswith('/push/config'):
                route.fulfill(status=200,headers={**cors,'content-type':'application/json'},body='{"enabled":true,"publicKey":"'+PUBLIC_KEY+'"}')
            elif request.url.endswith('/push/devices/test'):
                route.fulfill(status=200,headers={**cors,'content-type':'application/json'},body='{"sent":true}')
            else:
                status=201 if request.url.endswith('/push/devices') and request.method=='POST' else 200
                route.fulfill(status=status,headers={**cors,'content-type':'application/json'},body='{"deviceId":"'+DEVICE_ID+'","token":"'+TOKEN+'","updated":true,"disabled":true}')
        if not LIVE:
            page.route(WORKER+'/**',mock_worker)
        page.goto(BASE,wait_until='domcontentloaded',timeout=45000)
        panel=page.locator('.push-panel')
        panel.wait_for(state='visible',timeout=10000)
        assert page.evaluate('window.__permissionCalls')==0, 'Permission was requested on page load'
        assert page.locator('#pushEnable').is_enabled()
        target=page.locator('#pushEnable').bounding_box()
        assert target and target['width']>=44 and target['height']>=44, f'desktop tap target too small: {target}'
        assert not any(url.endswith('/push/config') for url in calls), 'Page load contacted push enrollment config'
        if LIVE:
            assert not any(url.endswith('/push/config') for url in calls), 'Live page requested push enrollment config on load'
        else:
            page.locator('#pushEnable').click()
            try:
                page.locator('#pushPreferences').wait_for(state='visible',timeout=10000)
            except Exception as exc:
                raise AssertionError(f"explicit opt-in failed: {page.locator('#pushStatus').inner_text()}; worker calls={calls}; page errors={browser_errors}") from exc
            assert page.evaluate('window.__permissionCalls')==1, 'Permission should be requested only after the explicit click'
            assert all(page.locator(f'[name="{name}"]').is_checked() for name in ('pushStarts','pushEnds','pushChanges'))
            page.locator('#pushTest').click()
            page.get_by_text('Test notification sent. Check this device’s notification center.').wait_for(timeout=10000)
            page.locator('[name="pushEnds"]').uncheck()
            page.get_by_text('Notification preferences updated.').wait_for(timeout=10000)
            assert page.locator('#pushDisable').is_visible()
            page.locator('#pushDisable').click()
            page.get_by_text('Notifications are off for this device.').wait_for(timeout=10000)
            assert page.locator('#pushPreferences').is_hidden()
        box=panel.bounding_box()
        assert box and box['width']>500
        panel.screenshot(path='push-notifications-smoke-desktop.png')

        mobile=browser.new_page(viewport={'width':390,'height':844},user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
        mobile.add_init_script(INIT)
        mobile.on('pageerror',lambda err: browser_errors.append('mobile: '+str(err)))
        mobile.goto(BASE,wait_until='domcontentloaded',timeout=45000)
        mobile.locator('#pushStatus').wait_for()
        mobile_status=mobile.locator('#pushStatus').inner_text()
        assert 'add sacocast to your home screen' in mobile_status.lower(), f'iPhone status: {mobile_status}'
        assert mobile.locator('#pushEnable').is_disabled()
        touch_target=mobile.locator('#pushEnable').bounding_box()
        assert touch_target and touch_target['width']>=44 and touch_target['height']>=44, f'mobile tap target too small: {touch_target}'
        mobile_panel=mobile.locator('.push-panel').bounding_box()
        assert mobile_panel and mobile_panel['x']>=0 and mobile_panel['x']+mobile_panel['width']<=390
        mobile.locator('.push-panel').screenshot(path='push-notifications-smoke-iphone-guidance.png')
        mobile.evaluate("document.documentElement.style.fontSize='200%'")
        expanded=mobile.locator('.push-panel').bounding_box()
        overflow=mobile.evaluate('document.documentElement.scrollWidth-window.innerWidth')
        assert expanded and expanded['x']>=0 and expanded['x']+expanded['width']<=390 and overflow<=3, f'expanded text overflows: {expanded}, {overflow}px'
        assert not browser_errors, f'browser errors: {browser_errors}'
        browser.close()
    print('PASS: '+('live desktop/mobile layout with no enrollment prompt' if LIVE else 'desktop opt-in/preferences, permission only after tap, and iPhone Home Screen guidance'))

if __name__=='__main__':
    main()
