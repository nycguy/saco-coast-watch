import {METRICS,normalizePreferences,isTriggered,thresholdLabel,unit} from "../logic.mjs";
const encoder=new TextEncoder();
const now=()=>Math.floor(Date.now()/1000);
function json(data,status=200,origin=""){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...(origin?{"access-control-allow-origin":origin,"vary":"Origin"}:{})}});}
function page(title,body,status=200){return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>'+escapeHtml(title)+'</title><style>body{background:#081824;color:#ebf7fc;font:16px/1.6 system-ui;max-width:680px;margin:8vh auto;padding:24px}a{color:#65e3ce}button{background:#36c8b3;color:#08202e;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}input{padding:8px}main{border:1px solid #385767;padding:24px;border-radius:16px;background:#132b3c}</style></head><body><main><h1>'+escapeHtml(title)+'</h1>'+body+'</main></body></html>',{status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});}
function escapeHtml(t){return String(t).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function token(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,"0")).join("");}
async function hash(s){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(s))),b=>b.toString(16).padStart(2,"0")).join("");}
async function hmac(secret,data){const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(data))),b=>b.toString(16).padStart(2,"0")).join("");}
function originFor(req,env){const origin=req.headers.get("Origin")||"";return origin===env.ALLOWED_ORIGIN?origin:"";}
function configured(env){return !!(env.DB&&env.PUBLIC_SITE&&env.ALLOWED_ORIGIN&&env.TURNSTILE_SECRET&&env.TURNSTILE_SITE_KEY&&env.RESEND_API_KEY&&env.FROM_EMAIL&&env.TOKEN_SECRET&&env.SUPPORT_EMAIL&&env.WORKER_PUBLIC_URL);}
function smsReady(env){return !!(env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN&&env.TWILIO_MESSAGING_SERVICE_SID);}
function baseUrl(req){return new URL(req.url).origin;}
function safeLink(link){return escapeHtml(link);}
async function emailSend(env,to,subject,text){
 const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.FROM_EMAIL,to:[to],subject,text})});
 if(!res.ok)throw Error("Email delivery error ("+res.status+")");
}
async function smsSend(env,phone,text){
 if(!smsReady(env))throw Error("SMS provider not configured");
 const params=new URLSearchParams({To:phone,MessagingServiceSid:env.TWILIO_MESSAGING_SERVICE_SID,Body:text});
 const res=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+encodeURIComponent(env.TWILIO_ACCOUNT_SID)+"/Messages.json",{method:"POST",headers:{"Authorization":"Basic "+btoa(env.TWILIO_ACCOUNT_SID+":"+env.TWILIO_AUTH_TOKEN),"Content-Type":"application/x-www-form-urlencoded"},body:params});
 if(!res.ok)throw Error("SMS delivery error ("+res.status+")");
}
async function verifyCaptcha(req,env,tokenValue){
 if(!tokenValue||typeof tokenValue!=="string"||tokenValue.length>2048)return false;
 const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({secret:env.TURNSTILE_SECRET,response:tokenValue,remoteip:req.headers.get("CF-Connecting-IP")||undefined})});
 if(!response.ok)return false;
 const result=await response.json();
 return result.success===true&&result.hostname===new URL(env.PUBLIC_SITE).hostname&&result.action==="subscribe";
}
async function makeToken(env,email,purpose,payload="",subscriberId=null,ttl=86400){
 const raw=token(),stamp=now();
 await env.DB.prepare("INSERT INTO tokens(hash,subscriber_id,email,purpose,payload_json,expires_at) VALUES(?,?,?,?,?,?)").bind(await hash(raw),subscriberId,email,purpose,payload,stamp+ttl).run();
 return raw;
}
async function takeToken(env,raw,purpose){
 if(typeof raw!=="string"||!/^[0-9a-f]{64}$/.test(raw))return null;
 const digest=await hash(raw),t=now();
 const row=await env.DB.prepare("SELECT * FROM tokens WHERE hash=? AND purpose=? AND used_at IS NULL AND expires_at>?").bind(digest,purpose,t).first();
 if(!row)return null;
 const result=await env.DB.prepare("UPDATE tokens SET used_at=? WHERE hash=? AND used_at IS NULL AND expires_at>?").bind(t,digest,t).run();
 return result.meta?.changes===1?row:null;
}
async function unsubLink(env,s){
 const mac=await hmac(env.TOKEN_SECRET,s.id+":"+s.email);
 return env.WORKER_PUBLIC_URL.replace(/\/$/,"")+"/unsubscribe?token="+encodeURIComponent(s.id+"."+mac);
}
async function confirmLink(env,request,type,raw){return baseUrl(request)+"/confirm/"+type+"?token="+raw;}
function validEmail(s){return typeof s==="string"&&s.length<255&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);}
function phoneNormalize(v){if(typeof v!=="string")return null;const p=v.replace(/[()\s.-]/g,"");return /^\+1[2-9]\d{9}$/.test(p)?p:null;}
function channels(body){return {email:body.emailAlerts===true,sms:body.smsAlerts===true};}
async function subscribe(request,env){
 const origin=originFor(request,env);if(!origin)return json({error:"Unauthorized origin"},403);
 if(!configured(env))return json({error:"Subscriptions are not configured"},503,origin);
 let body;try{body=await request.json();}catch{return json({error:"Invalid request"},400,origin);}
 const email=String(body.email||"").trim().toLowerCase(),ch=channels(body);
 if(!validEmail(email)||(!ch.email&&!ch.sms))return json({error:"Provide an email and select a notification method"},400,origin);
 const phone=ch.sms?phoneNormalize(body.phone):null;
 if(ch.sms&&(!smsReady(env)||!phone||body.smsConsent!==true))return json({error:"SMS requires a valid +1 phone number, explicit consent, and an active SMS provider"},400,origin);
 let prefs;try{prefs=normalizePreferences(body.preferences);}catch(e){return json({error:e.message},400,origin);}
 if(!(await verifyCaptcha(request,env,body.turnstile)))return json({error:"Human verification failed. Please retry."},403,origin);
 const ip=request.headers.get("CF-Connecting-IP")||"unknown",ipKey=await hmac(env.TOKEN_SECRET,ip),stamp=now();
 const locked=await env.DB.prepare("SELECT until_ts FROM request_limits WHERE ip_hash=?").bind(ipKey).first();
 if(locked&&locked.until_ts>stamp)return json({error:"Please wait ten minutes before another signup request."},429,origin);
 await env.DB.prepare("INSERT INTO request_limits(ip_hash,until_ts) VALUES(?,?) ON CONFLICT(ip_hash) DO UPDATE SET until_ts=excluded.until_ts").bind(ipKey,stamp+600).run();
 const payload=JSON.stringify({prefs,phone,channels:ch,smsConsent:ch.sms?stamp:null});
 const raw=await makeToken(env,email,"confirm-email",payload);
 try{
  await emailSend(env,email,"Confirm your Saco Coast Watch alerts","You requested coastal storm alerts. Confirm your email and preferences here:\n"+await confirmLink(env,request,"email",raw)+"\n\nIf you did not request this, ignore this message. No alerts are active until you confirm.\nFor questions: "+env.SUPPORT_EMAIL);
 }catch(e){console.error("Confirmation email failed",e.message);return json({error:"We could not send the confirmation email. Please try later."},503,origin);}
 return json({message:"Check your email for a confirmation link. No subscription is active yet."},202,origin);
}
async function handleConfirm(req,env,type){
 const url=new URL(req.url),purpose=type==="sms"?"confirm-sms":"confirm-email";
 if(req.method==="GET"){
  const raw=url.searchParams.get("token")||"";
  if(!/^[0-9a-f]{64}$/.test(raw))return page("Invalid confirmation link","<p>Request a new signup link.</p>",400);
  return page("Confirm "+(type==="sms"?"SMS":"email")+" alerts",'<p>Activate the notification preferences you requested?</p><form method="post" action="/confirm/'+type+'"><input type="hidden" name="token" value="'+escapeHtml(raw)+'"><button type="submit">Confirm '+(type==="sms"?"SMS":"email")+'</button></form>');
 }
 if(req.method!=="POST")return page("Method not allowed","",405);
 const input=await req.formData(),row=await takeToken(env,String(input.get("token")||""),purpose);
 if(!row)return page("Link expired or already used","<p>Return to Saco Coast Watch to request a new confirmation.</p>",400);
 if(type==="sms"){
  const s=await env.DB.prepare("SELECT * FROM subscribers WHERE id=? AND phone=? AND unsubscribed=0").bind(row.subscriber_id,row.payload_json).first();
  if(!s||!s.sms_consent_at)return page("SMS verification unavailable","<p>Request a new confirmation.</p>",400);
  await env.DB.prepare("UPDATE subscribers SET sms_confirmed=1,updated_at=? WHERE id=?").bind(now(),s.id).run();
  return page("SMS alerts activated","<p>Your verified number can now receive your selected Saco Coast Watch thresholds. Reply STOP to any message or use the unsubscribe link.</p>");
 }
 const pending=JSON.parse(row.payload_json),stamp=now();
 let s=await env.DB.prepare("SELECT * FROM subscribers WHERE email=?").bind(row.email).first();
 if(!s){
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO subscribers(id,email,phone,email_confirmed,sms_confirmed,sms_consent_at,prefs_json,unsubscribed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,row.email,pending.phone,1,0,pending.smsConsent,JSON.stringify({metrics:pending.prefs,channels:pending.channels}),0,stamp,stamp).run();
  s=await env.DB.prepare("SELECT * FROM subscribers WHERE id=?").bind(id).first();
 }else{
  const samePhone=s.phone===pending.phone;
  const keepSms=pending.channels.sms&&samePhone&&s.sms_confirmed?1:0;
  await env.DB.prepare("UPDATE subscribers SET phone=?,email_confirmed=1,sms_confirmed=?,sms_consent_at=?,prefs_json=?,unsubscribed=0,updated_at=? WHERE id=?").bind(pending.phone,keepSms,pending.smsConsent,JSON.stringify({metrics:pending.prefs,channels:pending.channels}),stamp,s.id).run();
  await env.DB.prepare("DELETE FROM alert_state WHERE subscriber_id=?").bind(s.id).run();
  s=await env.DB.prepare("SELECT * FROM subscribers WHERE id=?").bind(s.id).first();
 }
 if(pending.channels.sms&&pending.phone&&!s.sms_confirmed){
  const raw=await makeToken(env,row.email,"confirm-sms",pending.phone,s.id);
  try{await smsSend(env,pending.phone,"Saco Coast Watch: You requested SMS coastal alerts. Confirm this number: "+await confirmLink(env,req,"sms",raw)+" Reply STOP to opt out. Msg/data rates may apply.");}
  catch(err){console.error("SMS confirmation unavailable",err.message);return page("Email confirmed; SMS pending","<p>Your email is confirmed, but we could not send SMS verification. SMS alerts are not active. Please retry later.</p>");}
 }
 return page("Email alerts confirmed",'<p>Your selected alerts are now active on verified channels. If you requested SMS, click the separate verification link sent to your phone.</p><p><a href="'+safeLink(env.PUBLIC_SITE)+'">Back to Saco Coast Watch</a></p>');
}
async function handleUnsubscribe(req,env){
 const url=new URL(req.url);
 const raw=req.method==="POST"?String((await req.formData()).get("token")||""):url.searchParams.get("token")||"";
 const match=/^([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(raw);
 if(!match)return page("Invalid unsubscribe link","<p>This link is not valid.</p>",400);
 const s=await env.DB.prepare("SELECT * FROM subscribers WHERE id=?").bind(match[1]).first();
 if(!s||await hmac(env.TOKEN_SECRET,s.id+":"+s.email)!==match[2])return page("Invalid unsubscribe link","<p>This link is not valid.</p>",400);
 if(req.method==="GET")return page("Unsubscribe from coastal alerts",'<p>Stop both email and SMS storm alerts for '+escapeHtml(s.email)+'?</p><form method="post" action="/unsubscribe"><input type="hidden" name="token" value="'+escapeHtml(raw)+'"><button type="submit">Stop all alerts</button></form>');
 await env.DB.prepare("UPDATE subscribers SET unsubscribed=1,email_confirmed=0,sms_confirmed=0,updated_at=? WHERE id=?").bind(now(),s.id).run();
 await env.DB.prepare("DELETE FROM alert_state WHERE subscriber_id=?").bind(s.id).run();
 return page("Unsubscribed","<p>All Saco Coast Watch email and SMS alerts have been stopped for this subscription.</p>");
}
async function requestManage(req,env){
 const origin=originFor(req,env);if(!origin)return json({error:"Unauthorized origin"},403);
 if(!configured(env))return json({error:"Not configured"},503,origin);
 let data;try{data=await req.json();}catch{return json({error:"Invalid request"},400,origin);}
 if(!validEmail(data.email)||!await verifyCaptcha(req,env,data.turnstile))return json({error:"Provide a valid email and complete verification"},400,origin);
 const subscriber=await env.DB.prepare("SELECT * FROM subscribers WHERE email=? AND unsubscribed=0 AND email_confirmed=1").bind(data.email.trim().toLowerCase()).first();
 if(subscriber){
  const raw=await makeToken(env,subscriber.email,"manage","",subscriber.id,1800);
  await emailSend(env,subscriber.email,"Manage your coastal alerts","Open this one-time link to manage your alert preferences:\n"+baseUrl(req)+"/manage?token="+raw+"\n\nThis link expires in 30 minutes.");
 }
 return json({message:"If this email has an active subscription, a management link has been sent."},202,origin);
}
function field(k,v){return `<label style="display:block;margin:10px 0"><input type="checkbox" name="${k}_enabled" ${v.enabled?'checked':''}> ${escapeHtml(thresholdLabel(k))} <input type="number" step="0.1" style="width:80px" name="${k}_threshold" value="${escapeHtml(v.threshold)}"> ${escapeHtml(unit(k))}</label>`;}
async function manage(req,env){
 const url=new URL(req.url),raw=req.method==="POST"?String((await req.formData()).get("token")||""):url.searchParams.get("token")||"";
 if(!/^[0-9a-f]{64}$/.test(raw))return page("Management link invalid","<p>Request a fresh link from the dashboard.</p>",400);
 const t=await env.DB.prepare("SELECT * FROM tokens WHERE hash=? AND purpose='manage' AND used_at IS NULL AND expires_at>?").bind(await hash(raw),now()).first();
 if(!t)return page("Management link expired","<p>Request a fresh link from the dashboard.</p>",400);
 const s=await env.DB.prepare("SELECT * FROM subscribers WHERE id=? AND unsubscribed=0").bind(t.subscriber_id).first();
 if(!s)return page("Subscription unavailable","",404);
 const p=JSON.parse(s.prefs_json);
 if(req.method==="GET"){
  return page("Manage your coastal alerts",'<p>Changes will apply to both active delivery channels. Email: '+escapeHtml(s.email)+'</p><form method="post" action="/manage"><input type="hidden" name="token" value="'+escapeHtml(raw)+'">'+METRICS.map(k=>field(k,p.metrics[k])).join("")+'<button type="submit">Save preferences</button></form><p><a href="'+safeLink(await unsubLink(env,s))+'">Unsubscribe all</a></p>');
 }
 const data=await req.formData(),next={};
 for(const k of METRICS)next[k]={enabled:data.get(k+"_enabled")==="on",threshold:data.get(k+"_threshold")};
 let prefs;try{prefs=normalizePreferences(next);}catch(e){return page("Invalid preferences","<p>"+escapeHtml(e.message)+"</p>",400);}
 const taken=await takeToken(env,raw,"manage");if(!taken)return page("Link already used","<p>Request a new management link.</p>",409);
 await env.DB.prepare("UPDATE subscribers SET prefs_json=?,updated_at=? WHERE id=?").bind(JSON.stringify({metrics:prefs,channels:p.channels}),now(),s.id).run();
 await env.DB.prepare("DELETE FROM alert_state WHERE subscriber_id=?").bind(s.id).run();
 return page("Preferences saved","<p>Your new alert thresholds have been saved. Return to Saco Coast Watch to request another management link later.</p>");
}
async function readObserved(){
 const p=new URLSearchParams({station:"8418150",product:"water_level",date:"recent",datum:"MLLW",units:"english",time_zone:"gmt",format:"json",application:"saco-coast-watch"});
 const r=await fetch("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?"+p);if(!r.ok)throw Error("NOAA gauge "+r.status);
 const j=await r.json();if(j.error)throw Error("NOAA gauge error");const points=j.data||[];let last=null;
 for(const row of points){const time=Date.parse(String(row.t).replace(" ","T")+"Z"),value=Number(row.v);if(Number.isFinite(time)&&Number.isFinite(value)&&(!last||time>last.time))last={value,time};}
 if(!last||Math.abs(Date.now()-last.time)>45*60000)throw Error("Gauge reading stale");
 return {metric:"waterObserved",...last,source:"NOAA Portland gauge 8418150"};
}
async function readForecast(){
 const day=ms=>new Date(ms).toISOString().slice(0,10).replaceAll("-","");
 const p=new URLSearchParams({station:"8418150",product:"ofs_water_level",begin_date:day(Date.now()-86400000),end_date:day(Date.now()+4*86400000),datum:"MLLW",units:"english",time_zone:"gmt",format:"json",application:"saco-coast-watch"});
 const r=await fetch("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?"+p);if(!r.ok)throw Error("NOAA model "+r.status);
 const j=await r.json();if(j.error)throw Error("NOAA model error");
 const rows=Array.isArray(j.data)?j.data:Array.isArray(j.predictions)?j.predictions:Array.isArray(j.ofs_water_level)?j.ofs_water_level:Array.isArray(j.forecast)?j.forecast:[];
 let peak=null;const start=Date.now(),end=start+72*3600000;
 for(const row of rows){const time=Date.parse(String(row.t||row.time).replace(" ","T")+"Z"),value=Number(row.v??row.value);if(time>=start&&time<=end&&Number.isFinite(value)&&(!peak||value>peak.value))peak={value,time};}
 if(!peak)throw Error("No current 72-hour NOAA model guidance");
 return {metric:"waterForecast",...peak,source:"NOAA model guidance at Portland (forecast, not observed)"};
}
async function readBuoy(){
 const r=await fetch("https://www.ndbc.noaa.gov/data/realtime2/44007.txt");if(!r.ok)throw Error("NDBC "+r.status);
 const lines=(await r.text()).split(/\r?\n/),head=lines.find(l=>l.startsWith("#")&&l.includes("WSPD")&&l.includes("GST"));
 if(!head)throw Error("Buoy wind columns unavailable");
 const cols=head.trim().split(/\s+/).map(x=>x.replace(/^#/,""));
 for(const line of lines){
  if(!line||line.startsWith("#"))continue;
  const parts=line.trim().split(/\s+/);if(parts.length<cols.length)continue;
  const obj=Object.fromEntries(cols.map((k,i)=>[k,parts[i]]));
  let year=Number(obj.YY??obj.YYYY);if(year<100)year+=2000;
  const time=Date.UTC(year,Number(obj.MM)-1,Number(obj.DD),Number(obj.hh),Number(obj.mm));
  const wind=Number(obj.WSPD),gust=Number(obj.GST);
  if(!Number.isFinite(time)||Math.abs(Date.now()-time)>90*60000)throw Error("Buoy readings stale");
  if(!(wind>=0&&wind<90))throw Error("Buoy wind missing");
  const observations=[{metric:"wind",value:Math.round(wind*2.2369362921*10)/10,time,source:"NOAA offshore buoy 44007"}];
  if(gust>=0&&gust<90)observations.push({metric:"gust",value:Math.round(gust*2.2369362921*10)/10,time,source:"NOAA offshore buoy 44007"});
  return observations;
 }
 throw Error("No valid buoy observations");
}
async function readTemp(){
 const r=await fetch("https://api.weather.gov/stations/KPWM/observations/latest",{headers:{"Accept":"application/geo+json","User-Agent":"Saco Coast Watch (public coastal alerts)"}});
 if(!r.ok)throw Error("NWS temperature "+r.status);
 const j=await r.json(),p=j.properties||{},time=Date.parse(p.timestamp),c=p.temperature?.value;
 if(typeof c!=="number"||!Number.isFinite(c)||Math.abs(Date.now()-time)>90*60000)throw Error("NWS air temperature unavailable/stale");
 const value=Math.round((c*9/5+32)*10)/10;
 return ["tempHigh","tempLow"].map(metric=>({metric,value,time,source:"NWS Portland Jetport KPWM (not the beach)"}));
}
async function measurements(){
 const results=await Promise.allSettled([readObserved(),readForecast(),readBuoy(),readTemp()]);
 const values={};for(const result of results){if(result.status==="fulfilled"){const v=result.value;for(const entry of Array.isArray(v)?v:[v])values[entry.metric]=entry;}
  else console.warn("Skipping stale/unavailable data source:",String(result.reason));}
 return values;
}
async function dispatchAlerts(env){
 if(!configured(env)){console.warn("Alerts backend setup incomplete: no subscriber checks");return;}
 const values=await measurements(),all=await env.DB.prepare("SELECT * FROM subscribers WHERE email_confirmed=1 AND unsubscribed=0 LIMIT 200").all(),stamp=now();
 for(const s of all.results){
  let p;try{p=JSON.parse(s.prefs_json);}catch{continue;}
  const deliveries=[...(p.channels.email?["email"]:[]),...(p.channels.sms&&s.sms_confirmed&&smsReady(env)?["sms"]:[])];
  for(const channel of deliveries)for(const metric of METRICS){
   const pref=p.metrics[metric],m=values[metric];if(!pref?.enabled||!m)continue;
   const active=isTriggered(metric,m.value,pref.threshold);
   const old=await env.DB.prepare("SELECT active,last_sent FROM alert_state WHERE subscriber_id=? AND channel=? AND metric=?").bind(s.id,channel,metric).first();
   if(!active){
    await env.DB.prepare("INSERT INTO alert_state(subscriber_id,channel,metric,active,last_sent) VALUES(?,?,?,0,?) ON CONFLICT(subscriber_id,channel,metric) DO UPDATE SET active=0").bind(s.id,channel,metric,old?.last_sent||0).run();
    continue;
   }
   if(old?.active===1)continue;
   if(old?.last_sent&&stamp-old.last_sent<3600)continue;
   const condition=metric==="tempLow"?"at or below":"at or above";
   const body=thresholdLabel(metric)+" is "+m.value+" "+unit(metric)+" ("+condition+" your "+pref.threshold+" "+unit(metric)+" threshold). Measured/forecast time: "+new Date(m.time).toISOString()+". Source: "+m.source+". Portland gauge levels do not predict flooding at individual Saco properties. Follow official NWS alerts.";
   const unsub=await unsubLink(env,s);
   try{
    if(channel==="email")await emailSend(env,s.email,"Saco Coast Watch threshold alert: "+thresholdLabel(metric),body+"\n\nManage or unsubscribe: "+unsub+"\nSupport: "+env.SUPPORT_EMAIL);
    else await smsSend(env,s.phone,"Saco Coast Watch: "+thresholdLabel(metric)+" "+m.value+unit(metric)+"; limit "+pref.threshold+unit(metric)+". "+(metric==="waterForecast"?"MODEL FORECAST. ":"")+"STOP to opt out. "+unsub);
    await env.DB.prepare("INSERT INTO alert_state(subscriber_id,channel,metric,active,last_sent) VALUES(?,?,?,1,?) ON CONFLICT(subscriber_id,channel,metric) DO UPDATE SET active=1,last_sent=excluded.last_sent").bind(s.id,channel,metric,stamp).run();
   }catch(e){console.error("Notification provider error",channel,metric,String(e));}
  }
 }
 await env.DB.prepare("DELETE FROM tokens WHERE expires_at<?").bind(stamp-86400).run();
 await env.DB.prepare("DELETE FROM request_limits WHERE until_ts<?").bind(stamp-86400).run();
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),origin=originFor(request,env);
  try{
   if(request.method==="OPTIONS"&&(url.pathname==="/subscribe"||url.pathname==="/manage/request")){
    if(!origin)return new Response(null,{status:403});
    return new Response(null,{status:204,headers:{"access-control-allow-origin":origin,"access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type","access-control-max-age":"7200","vary":"Origin"}});
   }
   if(url.pathname==="/config"&&request.method==="GET")return json({ready:configured(env),smsReady:configured(env)&&smsReady(env),siteKey:configured(env)?env.TURNSTILE_SITE_KEY:null},200,origin);
   if(url.pathname==="/subscribe"&&request.method==="POST")return subscribe(request,env);
   if(url.pathname==="/manage/request"&&request.method==="POST")return requestManage(request,env);
   if(url.pathname==="/manage"&&["GET","POST"].includes(request.method))return manage(request,env);
   if(url.pathname==="/unsubscribe"&&["GET","POST"].includes(request.method))return handleUnsubscribe(request,env);
   if(url.pathname.startsWith("/confirm/")&&["GET","POST"].includes(request.method)&&["email","sms"].includes(url.pathname.split("/")[2]))return handleConfirm(request,env,url.pathname.split("/")[2]);
   if(url.pathname==="/health"&&request.method==="GET")return json({service:"saco-coastal-alerts",configured:configured(env),smsReady:smsReady(env)},200,origin);
   return json({error:"Not found"},404,origin);
  }catch(e){console.error("Alerts service error",e?.message||e);return json({error:"Service unavailable. Please retry later."},503,origin);}
 },
 async scheduled(_event,env,ctx){ctx.waitUntil(dispatchAlerts(env));}
};
