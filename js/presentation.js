/* Source-aware display helpers. No network calls or synthetic measurements. */
(function(root){
 'use strict';
 const HOUR=3600000,ZONE='America/New_York';
 const numeric=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
 const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
 const localFormatter=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 function localKey(t){return dayFormatter.format(t);}
 function midnight(key){
  const [year,month,day]=key.split('-').map(Number),target=Date.UTC(year,month-1,day);
  let guess=target;
  for(let i=0;i<3;i++){
   const p=Object.fromEntries(localFormatter.formatToParts(guess).map(x=>[x.type,x.value]));
   const local=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
   guess+=target-local;
  }
  return guess;
 }
 function dailyModelGuidance(series,at=Date.now()){
  const rows=(Array.isArray(series)?series:[]).filter(p=>p&&numeric(p.t)&&numeric(p.v)&&p.t>=at-10*60000&&p.t<=at+72*HOUR).sort((a,b)=>a.t-b.t);
  const groups=new Map();
  for(const p of rows){const key=localKey(p.t);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
  const out=new Map();
  for(const [key,points] of groups){
   const first=points[0],last=points.at(-1),start=midnight(key),date=new Date(key+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);
   const end=midnight(date.toISOString().slice(0,10)),expectedStart=Math.max(start,at);
   const partial=first.t>expectedStart+HOUR||last.t<end-HOUR||points.some((p,i)=>i&&p.t-points[i-1].t>90*60000);
   const peak=points.reduce((best,p)=>p.v>best.v?p:best,first);
   out.set(key,{peak,partial,first:first.t,last:last.t});
  }
  return out;
 }
 function recentArchiveFrames(doc,at=Date.now()){
  const hours=numeric(doc?.retention_hours)&&Number(doc.retention_hours)>0?Math.min(24,Number(doc.retention_hours)):24;
  const frames=(Array.isArray(doc?.frames)?doc.frames:[]).filter(frame=>{
   const t=Date.parse(frame?.captured_at||'');
   return typeof frame?.file==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:jpg|jpeg|png|webp)$/i.test(frame.file)&&Number.isFinite(t)&&t<=at&&t>=at-hours*HOUR;
  }).sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at));
  const seen=new Set();return {hours,frames:frames.filter(f=>{const key=f.file+'|'+f.captured_at;if(seen.has(key))return false;seen.add(key);return true;})};
 }
 function validReport(item,at=Date.now()){
  const title=String(item?.title||item?.headline||''),text=title+' '+String(item?.summary||''),published=Date.parse(item?.published_at||'');
  let url;try{url=new URL(item?.url);}catch(_){return false;}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname)return false;
  if(!Number.isFinite(published)||published>at||published<at-7*24*HOUR||!/^https?:\/\//i.test(item?.url||''))return false;
  if(/\b(?:volleyball|football|soccer|basketball|varsity|real estate|realtor|luxury home|coastal living|homes? for sale|surf comp|surf competition)\b/i.test(title))return false;
  if(/\b(?:perth|yorkshire|ontario|toronto|queensland|western australia)\b/i.test(text)||/this is the coast|perth is ok/i.test(item?.source||''))return false;
  const precise=/\b(?:saco|biddeford(?: pool)?|camp ellis|ferry beach|old orchard beach)\b/i.test(text);
  const scarborough=/\bscarborough\b/i.test(text)&&(/\bmaine\b/i.test(text)||/press herald|newscentermaine|wgme|wmtw|saco bay news|bangor daily/i.test(item?.source||''));
  return (precise||scarborough)&&/\b(?:surf|waves?|swell|flood(?:ing|ed|s)?|erosion|winds?|gusts?|rain(?:fall)?|storm(?:s)?|tides?|weather|overwash|snow(?:fall)?|blizzard|hurricane|rip currents?|rough seas|seawall|dunes?)\b/i.test(text);
 }
 function localReports(items,at=Date.now()){
  const seenUrls=new Set(),seenTitles=new Set();
  return (Array.isArray(items)?items:[]).filter(item=>validReport(item,at)).sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)).filter(item=>{
   const url=new URL(item.url);url.hash='';['utm_source','utm_medium','utm_campaign','oc'].forEach(k=>url.searchParams.delete(k));
   const key=url.href,title=String(item.title||item.headline).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
   if(seenUrls.has(key)||seenTitles.has(title))return false;seenUrls.add(key);seenTitles.add(title);return true;
  });
 }
 root.SacoPresentation={localKey,midnight,dailyModelGuidance,recentArchiveFrames,localReports,validReport};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.SacoPresentation;
})(typeof window!=='undefined'?window:globalThis);
