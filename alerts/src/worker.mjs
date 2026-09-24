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
  return json({service:"saco-coastal-alerts",phase:"owner-email-pilot",pilotBuild:"email-test-v3",configurationReady:configured(env)&&databaseConnected&&!missingTables.length,databaseConnected,missingSettings,missingTables,databaseError,publicSignupEnabled:false,ownerEmailPilotEnabled:configured(env),emailAlertsEnabled:false,webPushEnabled:false,scheduledAlertsEnabled:false});
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
export default{
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    try{
      if(path==="/health"&&req.method==="GET")return health(env);
      if(path==="/"&&req.method==="GET")return json({service:"Saco Coast Watch Alerts",status:"Owner-only email pilot; no public signup or active coastal notifications",pilot:"/pilot"});
      if(path==="/pilot"&&req.method==="GET")return landing(req,env);
      if(path==="/pilot/data"&&req.method==="GET")return pilotData();
      if(path==="/pilot/signup"&&req.method==="POST")return requestConfirmation(req,env);
      if(path==="/pilot/confirm"&&["GET","POST"].includes(req.method))return confirm(req,env);
      return json({error:"Not found; public signup and notifications are disabled."},404);
    }catch(e){console.error("Pilot Worker error",String(e));return json({error:"Service temporarily unavailable"},503);}
  },
  async scheduled(){/* Not enabled. No coastal alert notifications are sent. */}
};
