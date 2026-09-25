import test from "node:test";
import assert from "node:assert/strict";
import {METRICS,normalizePreferences,isTriggered,DEFAULTS,evaluate} from "../logic.mjs";
import worker from "../src/worker.mjs";

test("every metric has default and validation",()=>{
 assert.equal(METRICS.length,6);
 const prefs=normalizePreferences(Object.fromEntries(METRICS.map(k=>[k,{enabled:true,threshold:DEFAULTS[k]}])));
 assert.equal(Object.keys(prefs).length,6);
 assert.throws(()=>normalizePreferences({wind:{enabled:true,threshold:1000}}),/range/);
 assert.throws(()=>normalizePreferences({}),/Select at least one/);
});
test("both observed and forecast water level cross at threshold",()=>{
 for(const name of ["waterObserved","waterForecast"]){
  assert.equal(isTriggered(name,11.99,12),false);
  assert.equal(isTriggered(name,12,12),true);
 }
});
test("temperature below is distinct from temperature above",()=>{
 assert.equal(isTriggered("tempLow",31,32),true);
 assert.equal(isTriggered("tempLow",33,32),false);
 assert.equal(isTriggered("tempHigh",91,90),true);
 assert.equal(isTriggered("tempHigh",89,90),false);
});
test("wind and gusts compare independently",()=>{
 assert.equal(isTriggered("wind",29.9,30),false);
 assert.equal(isTriggered("wind",30,30),true);
 assert.equal(isTriggered("gust",44.9,45),false);
 assert.equal(isTriggered("gust",45,45),true);
});
test("first active observation alerts and continued threshold does not repeat",()=>{
 assert.equal(evaluate(null,"wind",30,30,1000).send,true);
 assert.equal(evaluate({active:1,last_sent:1000},"wind",31,30,1100).send,false);
 assert.equal(evaluate({active:1,last_sent:1000},"wind",25,30,1100).active,false);
 assert.equal(evaluate({active:0,last_sent:0},"wind",32,30,5000).send,true);
});
test("health and signup follow the current release contract",async()=>{
 const response=await worker.fetch(new Request("https://example.workers.dev/health"),{});
 assert.equal(response.status,200);
 const health=await response.json();
 assert.equal(health.configurationReady,false);
 assert.equal(health.databaseConnected,false);
 assert.equal(health.publicSignupEnabled,false);
 assert.equal(health.emailAlertsEnabled,false);
 assert.equal(health.webPushEnabled,false);
 assert.ok(health.missingSettings.includes("DB"));
 const signup=await worker.fetch(new Request("https://example.workers.dev/alerts/subscribe",{method:"POST"}),{});
 assert.equal(signup.status,503);
});
