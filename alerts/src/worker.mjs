// Saco Coast Watch: owner-only email confirmation pilot.
// No public signup, Web Push, or scheduled threshold notifications are enabled.
const NEEDED=["DB","PUBLIC_SITE","ALLOWED_ORIGIN","WORKER_PUBLIC_URL","FROM_EMAIL","SUPPORT_EMAIL","RESEND_API_KEY","TURNSTILE_SITE_KEY","TURNSTILE_SECRET","TOKEN_SECRET"];
const TABLES=["subscribers","push_subscriptions","tokens","alert_state","request_limits"];
const encoder=new TextEncoder();
const stamp=()=>Math.floor(Date.now()/1000);
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function html(title,content,status=200){return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>'+escapeHtml(title)+'</title><style>body{margin:6vh auto;padding:18px;max-width:660px;font:16px/1.55 system-ui;background:#081824;color:#e9f7ff}main{padding:25px;border:1px solid #385767;border-radius:16px;background:#132b3c}a{color:#7eead9}input,button{font:inherit;padding:9px;margin:8px 0}button{background:#26ceb7;color:#061b20;border:0;border-radius:7px;cursor:pointer}label{display:block}</style><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head><body><main><h1>'+escapeHtml(title)+'</h1>'+content+'</main></body></html>',{status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});}
function rawToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,"0")).join("");}
async function digest(s){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(s))),x=>x.toString(16).padStart(2,"0")).join("");}
async function hmac(secret,msg){const k=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",k,encoder.encode(msg))),x=>x.toString(16).padStart(2,"0")).join("");}
function configured(e){return NEEDED.every(k=>!!e[k])&&e.TOKEN_SECRET.length>=32;}
async function health(env){
  const missingSettings=NEEDED.filter(k=>!env[k]);
  let databaseConnected=false,missingTables=TABLES,databaseError=null;
  try{if(env.DB){const q=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();const found=(q.results||[]).map(x=>x.name);databaseConnected=true;missingTables=TABLES.filter(x=>!found.includes(x));}}
  catch(_){databaseError="Could not query the D1 database";}
  return json({service:"saco-coastal-alerts",phase:"email-release",pilotBuild:"email-release-v1",configurationReady:configured(env)&&databaseConnected&&!missingTables.length,databaseConnected,missingSettings,missingTables,databaseError,publicSignupEnabled:liveAlerts(env),ownerEmailPilotEnabled:configured(env),emailAlertsEnabled:liveAlerts(env),webPushEnabled:false,cronRequiresSetup:true});
}
function emailIsOwner(email,env){return typeof email==="string"&&email.trim().toLowerCase()===env.SUPPORT_EMAIL.trim().toLowerCase();}
async function validateTurnstile(req,env,responseToken){
  if(typeof responseToken!=="string"||!responseToken||responseToken.length>2048)return false;
  const resp=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({secret:env.TURNSTILE_SECRET,response:responseToken,remoteip:req.headers.get("CF-Connecting-IP")||undefined})});
  if(!resp.ok)return false;
  const result=await resp.json();
  return result.success===true&&result.hostname===new URL(req.url).hostname&&result.action==="subscribe";
}
async function sendEmail(env,to,subject,text){
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"authorization":"Bearer "+env.RESEND_API_KEY,"content-type":"application/json"},body:JSON.stringify({from:env.FROM_EMAIL,to:[to],subject,text,reply_to:env.SUPPORT_EMAIL})});
  if(!response.ok)throw Error("Resend returned "+response.status);
}
function landing(req,env){
  if(!configured(env))return html("Pilot unavailable","<p>Worker configuration is incomplete. Check /health.</p>",503);
  return html("Owner email test",'<p>This private-pilot form only accepts the configured owner support address. It tests an email confirmation; coastal alert delivery remains disabled.</p><form action="/pilot/signup" method="post"><label>Your email <input type="email" name="email" required maxlength="254" autocomplete="email"></label><div class="cf-turnstile" data-sitekey="'+escapeHtml(env.TURNSTILE_SITE_KEY)+'" data-action="subscribe"></div><button type="submit">Send confirmation email</button></form><p><a href="'+escapeHtml(env.PUBLIC_SITE)+'">Back to Saco Coast Watch</a></p>');
}
async function requestConfirmation(req,env){
  if(!configured(env))return html("Pilot unavailable","<p>Worker configuration is incomplete.</p>",503);
  // No Origin/Referer header requirement: some valid browser form submissions omit them.
  // Owner-email restriction and server-side Turnstile verification remain mandatory.
  const form=await req.formData(),email=String(form.get("email")||"").trim().toLowerCase();
  if(!emailIsOwner(email,env))return html("Pilot restricted","<p>Only the site owner's support email can enroll in this test.</p>",403);
  const ok=await validateTurnstile(req,env,form.get("cf-turnstile-response"));
  if(!ok)return html("Verification failed","<p>Return to the pilot form and complete the human verification.</p>",403);
  const ip=req.headers.get("CF-Connecting-IP")||"unknown";
  const ipKey=await hmac(env.TOKEN_SECRET,"pilot-email:"+ip);
  const emailKey=await hmac(env.TOKEN_SECRET,"pilot-owner-email:"+email);
  const current=stamp();
  const rows=await env.DB.prepare("SELECT ip_hash,until_ts FROM request_limits WHERE ip_hash IN (?,?)").bind(ipKey,emailKey).all();
  if((rows.results||[]).some(r=>r.until_ts>current))return html("Please wait","<p>A pilot confirmation has already been requested. Please wait 10 minutes before retrying.</p>",429);
  await env.DB.prepare("INSERT INTO request_limits(ip_hash,until_ts) VALUES(?,?) ON CONFLICT(ip_hash) DO UPDATE SET until_ts=excluded.until_ts").bind(ipKey,current+600).run();
  await env.DB.prepare("INSERT INTO request_limits(ip_hash,until_ts) VALUES(?,?) ON CONFLICT(ip_hash) DO UPDATE SET until_ts=excluded.until_ts").bind(emailKey,current+600).run();
  const raw=rawToken();
  await env.DB.prepare("INSERT INTO tokens(hash,subscriber_id,email,purpose,payload_json,expires_at) VALUES(?,?,?,?,?,?)").bind(await digest(raw),null,email,"confirm-email","{}",current+3600).run();
  const link=env.WORKER_PUBLIC_URL.replace(/\/$/,"")+"/pilot/confirm?token="+raw;
  try{
    await sendEmail(env,email,"Confirm your Saco Coast Watch email pilot","You requested an owner-only email delivery test for Saco Coast Watch. Confirm here:\n"+link+"\n\nThis link expires in one hour. Coastal alerts are not yet active.\n\nIf you did not request this, ignore this message. Contact: "+env.SUPPORT_EMAIL);
  }catch(e){console.error("Pilot email send failed",String(e));return html("Email test failed","<p>The email provider did not accept the test message. Check Cloudflare Worker logs; no alerts have been activated.</p>",503);}
  return html("Check your inbox","<p>We sent a one-time confirmation link to the owner support address. No coastal notifications are enabled.</p>");
}
async function confirm(req,env){
  if(!configured(env))return html("Pilot unavailable","<p>Worker configuration is incomplete.</p>",503);
  const url=new URL(req.url);
  const raw=req.method==="GET"?url.searchParams.get("token"):String((await req.formData()).get("token")||"");
  if(!/^[a-f0-9]{64}$/.test(raw||""))return html("Invalid link","<p>Request a new pilot email.</p>",400);
  const tokenHash=await digest(raw);
  const row=await env.DB.prepare("SELECT email,expires_at FROM tokens WHERE hash=? AND purpose='confirm-email' AND used_at IS NULL AND expires_at>?").bind(tokenHash,stamp()).first();
  if(!row||!emailIsOwner(row.email,env))return html("Link unavailable","<p>This link is expired or has already been used.</p>",400);
  if(req.method==="GET")return html("Confirm pilot email",'<p>Confirm the test email for '+escapeHtml(row.email)+'? Coastal alert delivery will remain disabled.</p><form method="post" action="/pilot/confirm"><input type="hidden" name="token" value="'+escapeHtml(raw)+'"><button type="submit">Confirm email</button></form>');
  const ts=stamp();
  const consumed=await env.DB.prepare("UPDATE tokens SET used_at=? WHERE hash=? AND used_at IS NULL AND expires_at>?").bind(ts,tokenHash,ts).run();
  if(consumed.meta?.changes!==1)return html("Link already used","<p>Request a new pilot email if needed.</p>",409);
  const previous=await env.DB.prepare("SELECT id FROM subscribers WHERE email=?").bind(row.email).first();
  if(previous){
    await env.DB.prepare("UPDATE subscribers SET email_confirmed=1,unsubscribed=0,updated_at=? WHERE id=?").bind(ts,previous.id).run();
  }else{
    await env.DB.prepare("INSERT INTO subscribers(id,email,email_confirmed,prefs_json,unsubscribed,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),row.email,1,JSON.stringify({metrics:{},channels:{email:true,push:false}}),0,ts,ts).run();
  }
  return html("Email test complete",'<p>Your confirmation worked and your verified email was recorded in D1. <strong>No coastal alerts are being sent yet.</strong></p><p><a href="'+escapeHtml(env.PUBLIC_SITE)+'">Back to Saco Coast Watch</a></p>');
}

const DATA_TIMEOUT_MS = 12000;
function dataFetch(url, options={}) {
  return fetch(url, {...options, signal: AbortSignal.timeout(DATA_TIMEOUT_MS)});
}
function utcObservation(ts) {
  if (typeof ts!=="string" || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(ts)) return NaN;
  // NOAA CO-OPS data requests use GMT; NOAA's JSON timestamps have no timezone suffix.
  return Date.parse(ts.replace(" ","T").replace(/(?:Z|\+\d\d:\d\d)?$/,"Z"));
}
function sourceValue(metric,value,timeMs,source,kind="observation") {
  return {metric,value,time:new Date(timeMs).toISOString(),ageMinutes:Math.round((Date.now()-timeMs)/60000),source,kind};
}
async function sourceObservedWater() {
  const p=new URLSearchParams({station:"8418150",product:"water_level",date:"recent",datum:"MLLW",units:"english",time_zone:"gmt",format:"json",application:"saco-coast-watch"});
  const res=await dataFetch("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?"+p);
  if(!res.ok)throw Error("NOAA water level HTTP "+res.status);
  const body=await res.json();
  if(body.error)throw Error("NOAA water level response error");
  const rows=Array.isArray(body.data)?body.data:[];
  const points=rows.map(r=>({timeMs:utcObservation(r.t),value:Number(r.v),raw:r})).filter(r=>Number.isFinite(r.timeMs)&&Number.isFinite(r.value)&&r.value>=-20&&r.value<=35).sort((a,b)=>b.timeMs-a.timeMs);
  if(!points.length)throw Error("No valid water observations");
  const latest=points[0];
  if(Math.abs(Date.now()-latest.timeMs)>45*60000)throw Error("Latest water observation is stale");
  return sourceValue("waterObserved",latest.value,latest.timeMs,"NOAA Portland station 8418150; ft MLLW");
}
async function sourceForecastWater() {
  const day=ms=>new Date(ms).toISOString().slice(0,10).replaceAll("-","");
  const p=new URLSearchParams({station:"8418150",product:"ofs_water_level",begin_date:day(Date.now()-86400000),end_date:day(Date.now()+4*86400000),datum:"MLLW",units:"english",time_zone:"gmt",format:"json",application:"saco-coast-watch"});
  const res=await dataFetch("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?"+p);
  if(!res.ok)throw Error("NOAA forecast model HTTP "+res.status);
  const body=await res.json();
  if(body.error)throw Error("NOAA forecast model response error");
  const rows=[body.data,body.predictions,body.ofs_water_level,body.forecast].find(Array.isArray)||[];
  const start=Date.now(),end=start+72*3600000;
  const upcoming=rows.map(r=>({timeMs:utcObservation(r.t||r.time),value:Number(r.v??r.value)})).filter(r=>Number.isFinite(r.timeMs)&&r.timeMs>=start&&r.timeMs<=end&&Number.isFinite(r.value)&&r.value>=-20&&r.value<=35).sort((a,b)=>b.value-a.value);
  if(!upcoming.length)throw Error("No usable 72-hour model guidance (not a tide prediction)");
  const peak=upcoming[0];
  return sourceValue("waterForecastPeak72h",peak.value,peak.timeMs,"NOAA Portland station 8418150; ft MLLW","model forecast peak, next 72 hours");
}
async function sourceBuoy() {
  const res=await dataFetch("https://www.ndbc.noaa.gov/data/realtime2/44007.txt");
  if(!res.ok)throw Error("NDBC buoy HTTP "+res.status);
  const lines=(await res.text()).split(/\r?\n/);
  const head=lines.find(x=>x.startsWith("#")&&x.includes("WSPD")&&x.includes("GST"));
  if(!head)throw Error("Wind column headers unavailable");
  const cols=head.trim().split(/\s+/).map(x=>x.replace(/^#/,""));
  const results=[];
  for(const line of lines){
    if(!line.trim()||line.startsWith("#"))continue;
    const parts=line.trim().split(/\s+/);if(parts.length<cols.length)continue;
    const record=Object.fromEntries(cols.map((c,i)=>[c,parts[i]]));
    let yr=Number(record.YY??record.YYYY);if(yr<100)yr+=2000;
    const timeMs=Date.UTC(yr,Number(record.MM)-1,Number(record.DD),Number(record.hh),Number(record.mm));
    if(!Number.isFinite(timeMs)||Math.abs(Date.now()-timeMs)>90*60000)continue;
    const wspd=Number(record.WSPD),gust=Number(record.GST);
    const mph=ms=>Math.round(ms*2.2369362921*10)/10;
    if(wspd>=0&&wspd<90)results.push(sourceValue("wind",mph(wspd),timeMs,"NOAA/NDBC buoy 44007; mph"));
    if(gust>=0&&gust<90)results.push(sourceValue("gust",mph(gust),timeMs,"NOAA/NDBC buoy 44007; mph"));
    if(results.length)return results;
  }
  throw Error("No fresh valid buoy wind observations");
}
async function sourceAirTemp() {
  const res=await dataFetch("https://api.weather.gov/stations/KPWM/observations/latest",{headers:{"accept":"application/geo+json","user-agent":"Saco Coast Watch (public coastal conditions; contact: mikewiley.nyc@gmail.com)"}});
  if(!res.ok)throw Error("NWS airport temperature HTTP "+res.status);
  const p=(await res.json()).properties||{};
  const timeMs=Date.parse(p.timestamp),c=p.temperature?.value;
  if(!Number.isFinite(timeMs)||Math.abs(Date.now()-timeMs)>90*60000||typeof c!=="number"||!Number.isFinite(c))throw Error("Latest airport air temperature is missing or stale");
  return sourceValue("airTemp",Math.round((c*9/5+32)*10)/10,timeMs,"NWS Portland Jetport KPWM; °F (not beach temperature)");
}
async function pilotData() {
  // Read-only diagnostic; never sends email or activates a coastal alert.
  const providers=[
    ["observedWater",sourceObservedWater],
    ["forecastWater",sourceForecastWater],
    ["buoyWind",sourceBuoy],
    ["airportTemperature",sourceAirTemp],
  ];
  const entries=await Promise.all(providers.map(async ([name,fn])=>{
    try{return [name,{available:true,data:await fn()}];}
    catch(e){console.warn("Pilot weather feed unavailable",name,String(e));return [name,{available:false,error:String(e?.message||e)}];}
  }));
  return json({phase:"read-only-feed-diagnostics",checkedAt:new Date().toISOString(),locationNote:"Portland tide and forecast and offshore buoy/airport conditions are proxies, not property-level flood predictions.",alertsSent:false,sources:Object.fromEntries(entries)});
}

// Read-only threshold demonstration. Values and defaults are illustrative until
// opt-in preferences, durable crossing state, and scheduled delivery are implemented.
async function pilotThresholds() {
  const defaults=[
    {name:"observedWater",label:"Observed Portland water level",threshold:12,unit:"ft MLLW",direction:"at or above",load:sourceObservedWater},
    {name:"forecastWater",label:"Highest Portland model water level over the next 72 hours",threshold:12,unit:"ft MLLW",direction:"at or above",load:sourceForecastWater},
    {name:"wind",label:"Observed offshore sustained wind",threshold:30,unit:"mph",direction:"at or above",load:sourceBuoy},
    {name:"gust",label:"Observed offshore wind gust",threshold:45,unit:"mph",direction:"at or above",load:sourceBuoy},
    {name:"tempHigh",label:"Observed Portland Jetport air temperature",threshold:90,unit:"°F",direction:"at or above",load:sourceAirTemp},
    {name:"tempLow",label:"Observed Portland Jetport air temperature",threshold:32,unit:"°F",direction:"at or below",load:sourceAirTemp}
  ];
  // Fetch each provider only once per dry-run request.
  const [water,forecast,buoy,temp]=await Promise.allSettled([
    sourceObservedWater(),sourceForecastWater(),sourceBuoy(),sourceAirTemp()
  ]);
  const resultFor={
    observedWater:water,forecastWater:forecast,
    wind:buoy,gust:buoy,tempHigh:temp,tempLow:temp
  };
  const tests=defaults.map(spec=>{
    const result=resultFor[spec.name];
    if(result.status!=="fulfilled")
      return {metric:spec.name,label:spec.label,threshold:spec.threshold,unit:spec.unit,status:"source-unavailable",wouldTrigger:null,reason:String(result.reason?.message||result.reason)};
    const raw=Array.isArray(result.value)?result.value.find(x=>x.metric===spec.name):result.value;
    if(!raw||!Number.isFinite(raw.value))
      return {metric:spec.name,label:spec.label,threshold:spec.threshold,unit:spec.unit,status:"source-unavailable",wouldTrigger:null,reason:"Measurement missing"};
    const exceeds=spec.direction==="at or below"?raw.value<=spec.threshold:raw.value>=spec.threshold;
    return {metric:spec.name,label:spec.label,threshold:spec.threshold,unit:spec.unit,direction:spec.direction,value:raw.value,readingTime:raw.time,source:raw.source,status:"evaluated",wouldTrigger:exceeds};
  });
  return json({
    phase:"read-only-threshold-dry-run",checkedAt:new Date().toISOString(),
    note:"Illustrative threshold comparisons only. This does not track threshold crossings, send notifications, or predict flooding at individual Saco properties.",
    alertsSent:false,databaseWrites:false,automatedChecksEnabled:false,tests
  });
}

/**
 * Pure crossing-decision function. It never sends email or writes to D1.
 * The caller must retain per-subscriber/channel/metric state and persist it
 * after successful delivery when real notifications are enabled.
 */
function decideAlert(previous, value, threshold, metric, checkedAtSeconds) {
  if (!Number.isFinite(value) || !Number.isFinite(threshold))
    return {send:false,active:previous?.active===1?1:0,lastSent:previous?.lastSent||0,reason:"invalid-input"};
  const lastSent=previous?.lastSent||0;
  const triggered=metric==="tempLow"?value<=threshold:value>=threshold;
  if (!triggered)
    return {send:false,active:0,lastSent,reason:"below-trigger"};
  if (previous?.active===1)
    return {send:false,active:1,lastSent,reason:"already-active"};
  if (lastSent && checkedAtSeconds-lastSent<3600)
    return {send:false,active:1,lastSent,reason:"one-hour-cooldown"};
  return {send:true,active:1,lastSent:checkedAtSeconds,reason:"new-crossing"};
}
/**
 * Deterministic demonstration of future deduplication behavior; no real
 * measurements, subscriber data, D1 changes, or notification providers.
 */
function pilotEngineCheck() {
  const t=2000000000,threshold=12;
  const step=(prev,value,at,metric="waterObserved")=>decideAlert(prev,value,threshold,metric,at);
  const first=step(null,13,t);
  const repeat=step(first,13,t+300);
  const reset=step(repeat,11,t+600);
  const cooldown=step(reset,13,t+900);
  const resetAgain=step(cooldown,11,t+1200);
  const second=step(resetAgain,13,t+4500);
  const tempLow=decideAlert(null,31,32,"tempLow",t);
  const tempHigh=decideAlert(null,55,90,"tempHigh",t);
  const cases=[
    {name:"initial crossing sends once",pass:first.send===true,decision:first},
    {name:"remaining above does not resend",pass:repeat.send===false&&repeat.reason==="already-active",decision:repeat},
    {name:"falling below resets the crossing",pass:reset.active===0&&!reset.send,decision:reset},
    {name:"recrossing during cooldown does not resend",pass:cooldown.send===false&&cooldown.reason==="one-hour-cooldown",decision:cooldown},
    {name:"new crossing after cooldown can send",pass:second.send===true&&second.reason==="new-crossing",decision:second},
    {name:"low temperature checks the correct direction",pass:tempLow.send===true&&tempHigh.send===false,decision:tempLow},
  ];
  return json({
    phase:"in-memory-alert-engine-check",
    build:"email-test-v5",
    passed:cases.every(c=>c.pass),testCount:cases.length,
    simulationsOnly:true,realAlertsSent:false,databaseWrites:false,
    message:"This checks crossing/cooldown logic only. Real alert delivery, scheduled checking, preferences and unsubscribe are not enabled.",
    cases
  },cases.every(c=>c.pass)?200:500);
}

// Manually triggered, owner-only simulated message to verify end-to-end email sending.
// This is not an automatic alert and does not modify subscription or alert history.
function testAlertForm(env) {
  if(!configured(env))return html("Email test unavailable","<p>Worker configuration is incomplete.</p>",503);
  return html("Send a simulated alert email",
    '<p><strong>TEST ONLY.</strong> This sends one clearly labeled example email to the verified site owner. It uses invented water-level data and does not activate storm alerts.</p>'+
    '<form method="post" action="/pilot/test-alert-email">'+
    '<div class="cf-turnstile" data-sitekey="'+escapeHtml(env.TURNSTILE_SITE_KEY)+'" data-action="subscribe"></div>'+
    '<button type="submit">Send TEST email</button></form>'+
    '<p><a href="'+escapeHtml(env.PUBLIC_SITE)+'">Return to Saco Coast Watch</a></p>');
}
async function sendSimulatedOwnerAlert(req,env) {
  if(!configured(env))return html("Email test unavailable","<p>Worker configuration is incomplete.</p>",503);
  const owner=env.SUPPORT_EMAIL.trim().toLowerCase();
  const verified=await env.DB.prepare("SELECT id FROM subscribers WHERE email=? AND email_confirmed=1 AND unsubscribed=0").bind(owner).first();
  if(!verified)return html("Email not verified","<p>Finish the owner email confirmation test before sending a simulated alert.</p>",403);
  const form=await req.formData();
  if(!await validateTurnstile(req,env,form.get("cf-turnstile-response")))
    return html("Verification failed","<p>Go back and complete the Turnstile check before trying again.</p>",403);
  const current=stamp(),ip=req.headers.get("CF-Connecting-IP")||"unknown";
  const ipKey=await hmac(env.TOKEN_SECRET,"simulated-alert:ip:"+ip);
  const emailKey=await hmac(env.TOKEN_SECRET,"simulated-alert:owner:"+owner);
  const limits=await env.DB.prepare("SELECT ip_hash,until_ts FROM request_limits WHERE ip_hash IN (?,?)").bind(ipKey,emailKey).all();
  if((limits.results||[]).some(row=>row.until_ts>current))
    return html("Please wait","<p>A test email was requested recently. Try again in 10 minutes; no automated alert was enabled.</p>",429);
  // Reserve the cooldown before calling Resend, limiting repeated sends on rapid retries.
  await env.DB.prepare("INSERT INTO request_limits(ip_hash,until_ts) VALUES(?,?) ON CONFLICT(ip_hash) DO UPDATE SET until_ts=excluded.until_ts").bind(ipKey,current+600).run();
  await env.DB.prepare("INSERT INTO request_limits(ip_hash,until_ts) VALUES(?,?) ON CONFLICT(ip_hash) DO UPDATE SET until_ts=excluded.until_ts").bind(emailKey,current+600).run();
  const subject="[TEST ONLY] Saco Coast Watch simulated water-level threshold alert";
  const message=[
    "TEST ONLY — SIMULATED READING — NOT A REAL WEATHER OR FLOOD ALERT",
    "",
    "This is a one-time, owner-requested test of the email delivery system.",
    "SIMULATED observed Portland water level: 13.0 ft MLLW.",
    "SIMULATED threshold: 12.0 ft MLLW.",
    "Simulated result: a new upward crossing would qualify for an email.",
    "",
    "The 13.0 ft figure is invented for testing. It is not a live NOAA reading.",
    "No coastal warning or public signup has been activated. No ongoing notifications will be sent.",
    "This message is not a flood prediction for Saco properties. Follow official NWS warnings for safety decisions.",
    "",
    "Questions: "+env.SUPPORT_EMAIL
  ].join("\n");
  try{
    await sendEmail(env,owner,subject,message);
  }catch(e){
    console.error("Owner simulated alert delivery failed",String(e));
    return html("Test email failed","<p>Resend did not accept this simulated message. Check the Worker logs and try again after the cooldown. No actual coastal alerts are active.</p>",503);
  }
  return html("Test email submitted","<p>Resend accepted the clearly labeled <strong>TEST ONLY</strong> message for delivery to the verified owner address. Check your inbox. Actual coastal alerts, public signup, and Web Push remain disabled.</p>");
}

// Public email release is gated; pilot-verified email alone does NOT imply alert consent.
const ALERTS=[
 ["waterObserved","Observed Portland water level","ft MLLW",12,0,30],
 ["waterForecast","Forecast Portland peak in next 72 hours","ft MLLW",12,0,30],
 ["wind","Offshore sustained wind","mph",30,0,180],
 ["gust","Offshore wind gust","mph",45,0,220],
 ["tempHigh","Portland airport temperature above","°F",90,-40,140],
 ["tempLow","Portland airport temperature below","°F",32,-40,140]
];
const liveAlerts=e=>configured(e)&&e.LIVE_ALERTS==="true";
const siteUrl=e=>e.WORKER_PUBLIC_URL.replace(/\/$/,"");
function publicPage(e,title,body,status=200){return html(title,body+'<p><a href="'+escapeHtml(e.PUBLIC_SITE)+'">Back to Saco Coast Watch</a></p><p>Support: '+escapeHtml(e.SUPPORT_EMAIL)+'</p>',status);}
function alertFields(values={}){
 return ALERTS.map(([id,label,unit,def,low,high])=>{
 const p=values[id]||{enabled:id==="waterObserved"||id==="waterForecast",threshold:def};
 return '<label style="display:block;margin:14px 0"><input type="checkbox" name="'+id+'_enabled" '+(p.enabled?'checked':'')+'> '+escapeHtml(label)+' <input type="number" style="width:80px" name="'+id+'_threshold" min="'+low+'" max="'+high+'" step="0.1" value="'+escapeHtml(p.threshold)+'"> '+unit+'</label>';
 }).join("");
}
function alertForm(e){
 if(!liveAlerts(e))return publicPage(e,"Alerts not yet open","<p>The email notification service is being prepared.</p>",503);
 return publicPage(e,"Subscribe to coastal email alerts",
 '<p>Select custom thresholds for Portland gauge water level, offshore wind and airport temperature. Not a property-level flood prediction or official NWS warning. Notifications may be delayed or unavailable.</p>'+
 '<form action="/alerts/subscribe" method="post"><label>Your email <input type="email" name="email" maxlength="254" required></label>'+alertFields()+
 '<label><input type="checkbox" name="consent" required> I request emails about my selected thresholds and agree to the <a href="/alerts/terms">terms</a> and <a href="/alerts/privacy">privacy information</a>.</label>'+
 '<div class="cf-turnstile" data-sitekey="'+escapeHtml(e.TURNSTILE_SITE_KEY)+'" data-action="subscribe"></div>'+
 '<button type="submit">Email me a confirmation link</button></form><p><a href="/alerts/manage">Manage existing alerts</a></p><p>Browser push is not yet available.</p>');
}
function validAddress(s){return typeof s==="string"&&s.length<255&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);}
function thresholds(form){
 let selected=0,metrics={};
 for(const [id,label,unit,def,low,high] of ALERTS){
   const raw=String(form.get(id+"_threshold")??def).trim(),threshold=Number(raw);
   if(!raw||!Number.isFinite(threshold)||threshold<low||threshold>high)throw Error("Invalid "+label+" threshold");
   const enabled=form.get(id+"_enabled")==="on";
   metrics[id]={enabled,threshold};if(enabled)selected++;
 }
 if(!selected)throw Error("Choose at least one threshold.");
 return metrics;
}
async function rateCheck(e,tag){
 const h=await hmac(e.TOKEN_SECRET,"alert-rate:"+tag),t=stamp();
 const result=await e.DB.prepare("INSERT INTO request_limits(ip_hash,until_ts) VALUES(?,?) ON CONFLICT(ip_hash) DO UPDATE SET until_ts=excluded.until_ts WHERE request_limits.until_ts<?").bind(h,t+600,t).run();
 return result.meta?.changes===1;
}
async function issueToken(e,email,purpose,payload,ttl=3600,id=null){
 const raw=rawToken();
 await e.DB.prepare("INSERT INTO tokens(hash,subscriber_id,email,purpose,payload_json,expires_at) VALUES(?,?,?,?,?,?)").bind(await digest(raw),id,email,purpose,JSON.stringify(payload),stamp()+ttl).run();
 return raw;
}
async function lookToken(e,raw,purpose){
 if(typeof raw!=="string"||!/^[a-f0-9]{64}$/.test(raw))return null;
 return e.DB.prepare("SELECT * FROM tokens WHERE hash=? AND purpose=? AND used_at IS NULL AND expires_at>?").bind(await digest(raw),purpose,stamp()).first();
}
async function takePublicToken(e,raw){
 const t=stamp(),result=await e.DB.prepare("UPDATE tokens SET used_at=? WHERE hash=? AND used_at IS NULL AND expires_at>?").bind(t,await digest(raw),t).run();
 return result.meta?.changes===1;
}
async function subscribeEmail(req,e){
 if(!liveAlerts(e))return publicPage(e,"Unavailable","<p>Signups are not open.</p>",503);
 let form,metrics;
 try{form=await req.formData();metrics=thresholds(form);}catch(err){return publicPage(e,"Invalid thresholds","<p>"+escapeHtml(err.message)+"</p>",400);}
 const email=String(form.get("email")||"").trim().toLowerCase();
 if(!validAddress(email)||form.get("consent")!=="on")return publicPage(e,"Invalid request","<p>Provide a valid email and consent to alerts.</p>",400);
 if(!await validateTurnstile(req,e,form.get("cf-turnstile-response")))return publicPage(e,"Verification failed","<p>Please retry Turnstile.</p>",403);
 const ip=req.headers.get("CF-Connecting-IP")||"unknown";
 if(!await rateCheck(e,"signup-ip:"+ip)||!await rateCheck(e,"signup-email:"+email))return publicPage(e,"Please wait","<p>Try again in ten minutes.</p>",429);
 const raw=await issueToken(e,email,"alerts-confirm",{metrics,requestedAt:stamp(),termsVersion:"2026-09"});
 try{await sendEmail(e,email,"Confirm your Saco Coast Watch coastal email alerts",
  "Confirm your requested custom threshold emails:\n"+siteUrl(e)+"/alerts/confirm?token="+raw+
  "\n\nExpires in 1 hour. No alerts are sent until you confirm. This is not an official weather-warning service. Contact "+e.SUPPORT_EMAIL);}
 catch(err){console.error("Confirmation send failed",String(err));return publicPage(e,"Email unavailable","<p>Try again later.</p>",503);}
 return publicPage(e,"Check your inbox","<p>Follow the verification link to activate your chosen alerts.</p>");
}
async function confirmEmail(req,e){
 if(!liveAlerts(e))return publicPage(e,"Unavailable","<p>Contact support.</p>",503);
 const raw=req.method==="GET"?new URL(req.url).searchParams.get("token"):String((await req.formData()).get("token")||"");
 const row=await lookToken(e,raw,"alerts-confirm");
 if(!row)return publicPage(e,"Invalid confirmation link","<p>Request a new signup link.</p>",400);
 if(req.method==="GET")return publicPage(e,"Confirm coastal email alerts",
  '<p>Activate email alerts for '+escapeHtml(row.email)+'?</p><form method="post" action="/alerts/confirm"><input type="hidden" name="token" value="'+escapeHtml(raw)+'"><button type="submit">Confirm and activate</button></form>');
 let payload;try{payload=JSON.parse(row.payload_json);if(!payload.metrics||!payload.requestedAt)throw Error("Invalid");}catch(_){return publicPage(e,"Invalid link","<p>Request another.</p>",400);}
 if(!await takePublicToken(e,raw))return publicPage(e,"Link already used","<p>Request another.</p>",409);
 const now=stamp(),prefs=JSON.stringify({metrics:payload.metrics,channels:{email:true,push:false},emailOptInAt:now,termsVersion:payload.termsVersion});
 const prior=await e.DB.prepare("SELECT id FROM subscribers WHERE email=?").bind(row.email).first();
 if(prior){
  await e.DB.prepare("UPDATE subscribers SET email_confirmed=1,unsubscribed=0,prefs_json=?,updated_at=? WHERE id=?").bind(prefs,now,prior.id).run();
  await e.DB.prepare("DELETE FROM alert_state WHERE subscriber_id=? AND channel='email'").bind(prior.id).run();
 }else{
  await e.DB.prepare("INSERT INTO subscribers(id,email,email_confirmed,prefs_json,unsubscribed,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),row.email,1,prefs,0,now,now).run();
 }
 return publicPage(e,"Email alerts activated","<p>Your selected thresholds are active for scheduled checks. Delivery is best effort, not an emergency warning system.</p>");
}
async function unsubscribeLink(e,s){
 const sig=await hmac(e.TOKEN_SECRET,"unsub:"+s.id+":"+s.email);
 return siteUrl(e)+"/alerts/unsubscribe?token="+s.id+"."+sig;
}
async function unsubscribeEmail(req,e){
 if(!configured(e))return html("Unavailable","<p>Contact the site owner to stop alerts.</p>",503);
 const raw=req.method==="GET"?new URL(req.url).searchParams.get("token"):String((await req.formData()).get("token")||"");
 const m=/^([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(raw||"");
 if(!m)return publicPage(e,"Invalid link","<p>Contact support to unsubscribe.</p>",400);
 const s=await e.DB.prepare("SELECT * FROM subscribers WHERE id=?").bind(m[1]).first();
 if(!s||await hmac(e.TOKEN_SECRET,"unsub:"+s.id+":"+s.email)!==m[2])return publicPage(e,"Invalid link","<p>Contact support to unsubscribe.</p>",400);
 if(req.method==="GET")return publicPage(e,"Stop coastal alerts",
  '<p>Stop all alert emails to '+escapeHtml(s.email)+'?</p><form method="post" action="/alerts/unsubscribe"><input type="hidden" name="token" value="'+escapeHtml(raw)+'"><button type="submit">Stop alerts</button></form>');
 await e.DB.prepare("UPDATE subscribers SET unsubscribed=1,email_confirmed=0,updated_at=? WHERE id=?").bind(stamp(),s.id).run();
 await e.DB.prepare("DELETE FROM alert_state WHERE subscriber_id=?").bind(s.id).run();
 await e.DB.prepare("DELETE FROM push_subscriptions WHERE subscriber_id=?").bind(s.id).run();
 return publicPage(e,"Unsubscribed","<p>Alerts to this address have been stopped.</p>");
}
function alertLegal(e,privacy){
 return publicPage(e,privacy?"Privacy information":"Terms of email alerts",privacy?
 "<p>We store email, selected thresholds, confirmation and alert state in Cloudflare D1. Short-lived hashed IP addresses reduce abuse. Resend sends email messages. Unsubscribing stops emails but does not immediately delete records; contact support to request deletion. We do not collect phone numbers or sell subscription information.</p>":
 "<p>Emails are optional, best-effort custom threshold notices based on the Portland gauge, forecast model, offshore buoy and airport. These are not property-specific flooding forecasts or official emergency warnings. Consult the National Weather Service and local authorities for safety decisions. You may unsubscribe using links in messages.</p>");
}
export default{
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    try{
      if(path==="/health"&&req.method==="GET")return health(env);
      if(path==="/"&&req.method==="GET")return json({service:"Saco Coast Watch Alerts",status:"Owner-only email pilot; no public signup or active coastal notifications",pilot:"/pilot"});
      if(path==="/alerts"&&req.method==="GET")return alertForm(env);
      if(path==="/alerts/subscribe"&&req.method==="POST")return subscribeEmail(req,env);
      if(path==="/alerts/confirm"&&["GET","POST"].includes(req.method))return confirmEmail(req,env);
      if(path==="/alerts/unsubscribe"&&["GET","POST"].includes(req.method))return unsubscribeEmail(req,env);
      if(path==="/alerts/privacy"&&req.method==="GET")return alertLegal(env,true);
      if(path==="/alerts/terms"&&req.method==="GET")return alertLegal(env,false);
      if(path==="/pilot"&&req.method==="GET")return landing(req,env);
      if(path==="/pilot/data"&&req.method==="GET")return pilotData();
      if(path==="/pilot/thresholds"&&req.method==="GET")return pilotThresholds();
      if(path==="/pilot/engine-check"&&req.method==="GET")return pilotEngineCheck();
      if(path==="/pilot/test-alert-email"&&req.method==="GET")return testAlertForm(env);
      if(path==="/pilot/test-alert-email"&&req.method==="POST")return sendSimulatedOwnerAlert(req,env);
      if(path==="/pilot/signup"&&req.method==="POST")return requestConfirmation(req,env);
      if(path==="/pilot/confirm"&&["GET","POST"].includes(req.method))return confirm(req,env);
      return json({error:"Not found; public signup and notifications are disabled."},404);
    }catch(e){console.error("Pilot Worker error",String(e));return json({error:"Service temporarily unavailable"},503);}
  },
  async scheduled(){/* Not enabled. No coastal alert notifications are sent. */}
};
