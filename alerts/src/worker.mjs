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
  return json({service:"saco-coastal-alerts",phase:"owner-email-pilot",configurationReady:configured(env)&&databaseConnected&&!missingTables.length,databaseConnected,missingSettings,missingTables,databaseError,publicSignupEnabled:false,ownerEmailPilotEnabled:configured(env),emailAlertsEnabled:false,webPushEnabled:false,scheduledAlertsEnabled:false});
}
function workerOrigin(request){return new URL(request.url).origin;}
function isOwnerPilotSubmission(request){
  // Same-origin HTML form POSTs may omit Origin in some browsers or extensions.
  // Reject an explicit foreign Origin; otherwise require same-origin fetch metadata
  // or a matching Referer for the /pilot form.
  const ownOrigin=workerOrigin(request);
  const origin=request.headers.get("Origin");
  if(origin && origin!==ownOrigin)return false;
  const fetchSite=request.headers.get("Sec-Fetch-Site");
  if(fetchSite && fetchSite!=="same-origin")return false;
  const referer=request.headers.get("Referer");
  if(referer){
    try{const url=new URL(referer);if(url.origin!==ownOrigin||url.pathname!=="/pilot")return false;}
    catch(_){return false;}
  }
  return fetchSite==="same-origin"||(!!origin&&origin===ownOrigin)||(!!referer);
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
  if(!isOwnerPilotSubmission(req))return html("Request rejected","<p>Open the pilot form directly on the Worker URL.</p>",403);
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
export default{
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    try{
      if(path==="/health"&&req.method==="GET")return health(env);
      if(path==="/"&&req.method==="GET")return json({service:"Saco Coast Watch Alerts",status:"Owner-only email pilot; no public signup or active coastal notifications",pilot:"/pilot"});
      if(path==="/pilot"&&req.method==="GET")return landing(req,env);
      if(path==="/pilot/signup"&&req.method==="POST")return requestConfirmation(req,env);
      if(path==="/pilot/confirm"&&["GET","POST"].includes(req.method))return confirm(req,env);
      return json({error:"Not found; public signup and notifications are disabled."},404);
    }catch(e){console.error("Pilot Worker error",String(e));return json({error:"Service temporarily unavailable"},503);}
  },
  async scheduled(){/* Not enabled. No coastal alert notifications are sent. */}
};
