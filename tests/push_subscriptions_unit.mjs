import test from 'node:test';
import assert from 'node:assert/strict';
import { getCoastalNotificationHistory } from '../js/push-subscriptions.mjs';

const deviceId='12345678-1234-4234-8234-123456789abc';
const token='a'.repeat(64);
const storage={getItem:key=>key==='sacocast.push.device.v1'?JSON.stringify({deviceId,token}):null};

test('notification history uses the device owner credential and never puts it in the URL',async()=>{
  const original=globalThis.fetch;let request;
  globalThis.fetch=async(url,options)=>{request={url:String(url),options};return Response.json({items:[],retentionDays:30});};
  try{
    const result=await getCoastalNotificationHistory({storage});
    assert.equal(result.retentionDays,30);
    assert.match(request.url,/\/push\/devices\/history\?deviceId=/);
    assert.equal(request.url.includes(token),false);
    assert.equal(request.options.headers.Authorization,'Bearer '+token);
    assert.equal(request.options.cache,'no-store');
  }finally{globalThis.fetch=original;}
});

test('notification history is unavailable without a saved device credential',async()=>{
  await assert.rejects(()=>getCoastalNotificationHistory({storage:{getItem:()=>null}}),/saved notification control token/);
});
