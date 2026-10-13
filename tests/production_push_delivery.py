#!/usr/bin/env python3
"""End-to-end production check: real browser subscription, Worker, push provider, service worker."""
from playwright.sync_api import sync_playwright

SITE='https://nycguy.github.io/saco-coast-watch/'
SCRIPT=r"""
async () => {
  const worker='https://saco-coastal-alerts.mikewiley-nyc.workers.dev';
  let registration=null, subscription=null, device=null, token=null;
  const decodeKey=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
  const api=async(path,method='GET',body=null,auth=null)=>{
    const response=await fetch(worker+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+auth}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(`${path} returned ${response.status}: ${data.error||'no detail'}`);
    return data;
  };
  try {
    const config=await api('/push/config');
    if(!config.enabled||!config.publicKey)throw Error('Production push configuration is disabled');
    registration=await navigator.serviceWorker.register('./push-sw.js',{scope:'./'});
    await navigator.serviceWorker.ready;
    subscription=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(config.publicKey)});
    const registered=await api('/push/devices','POST',{subscription:subscription.toJSON(),preferences:{starts:true,ends:true,changes:true}});
    device=registered.deviceId; token=registered.token;
    const sent=await api('/push/devices/test','POST',{deviceId:device},token);
    if(!sent.sent)throw Error('Worker did not confirm test push acceptance');
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){
      const items=await registration.getNotifications();
      const found=items.find(item=>item.title==='SacoCast Test Notification');
      if(found){found.close();return {delivered:true,deviceRegistered:true,serviceWorkerReceived:true};}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw Error('Push provider accepted the test but the service worker did not receive a notification within 45 seconds');
  } finally {
    if(device&&token){try{await api('/push/devices/disable','POST',{deviceId:device},token);}catch(e){console.warn('Test device disable cleanup failed:',String(e));}}
    if(subscription){try{await subscription.unsubscribe();}catch(e){console.warn('Browser subscription cleanup failed:',String(e));}}
  }
}
"""

def main():
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        context=browser.new_context(viewport={'width':1280,'height':900})
        context.grant_permissions(['notifications'],origin='https://nycguy.github.io')
        page=context.new_page()
        page.goto(SITE,wait_until='domcontentloaded',timeout=60000)
        result=page.evaluate(SCRIPT)
        browser.close()
    assert result=={'delivered':True,'deviceRegistered':True,'serviceWorkerReceived':True},result
    print('PASS: real Web Push delivered through the production Worker and received by the service worker; temporary device removed')

if __name__=='__main__':
    main()
