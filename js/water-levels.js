'use strict';
const RISK_CLASSES=['risk-below','risk-minor','risk-moderate','risk-major','risk-unavailable'];
function riskBand(value){
 if(!Number.isFinite(value))return 'unavailable';
 if(value>=THRESHOLDS[2].value)return 'major';
 if(value>=THRESHOLDS[1].value)return 'moderate';
 if(value>=THRESHOLDS[0].value)return 'minor';
 return 'below';
}
function applyRiskBand(node,band){node.classList.remove(...RISK_CLASSES);node.classList.add('risk-'+band);}
function renderSummary(){const {latest,nextPeak,gaugeFresh,source}=currentStatus();$('observedValue').innerHTML=(latest?fmtN(latest.v):'--')+'<em> ft</em>';$('observedDetail').textContent=latest?'Recorded '+dayTime(latest.t)+' ET · '+relative(latest.t):'No Portland gauge data returned.';$('obsBadge').textContent=gaugeFresh?'Current':latest?'Stale':'Offline';$('obsBadge').style.color=gaugeFresh?'#b7e27b':'#ffd19e';
 const predicted=latest?nearest(state.pred,latest.t,12*60000):null;const residual=latest&&predicted?latest.v-predicted.v:null;$('departureValue').innerHTML=(residual!==null?(residual>0?'+':'')+fmtN(residual):'--')+'<em> ft</em>';$('departureDetail').textContent=residual!==null?'At '+time(latest.t)+' ET. Observed '+fmtN(latest.v)+' ft vs. tide-only '+fmtN(predicted.v)+' ft.':'Needs current gauge data and matching astronomical tide.';
 const high=highTides()[0];$('nextHighValue').innerHTML=(high?fmtN(high.v):'--')+'<em> ft</em>';$('nextHighDetail').textContent=high?dayTime(high.t)+' ET · tide only, excludes storm surge.':'No upcoming tide predictions returned.';
 $('modelValue').innerHTML=(nextPeak?fmtN(nextPeak.v):'--')+'<em> ft</em>';
 const modelBand=riskBand(nextPeak?.v);
 applyRiskBand($('modelValue').closest('.model-hero'),modelBand);
 $('modelRiskLabel').textContent=({below:'Below minor flood threshold · Portland gauge',minor:'Minor flood threshold · Portland gauge',moderate:'Moderate flood threshold · Portland gauge',major:'Major flood threshold · Portland gauge',unavailable:'Model guidance unavailable · no forecast category'})[modelBand];

 const modelCoverage=state.model.filter(p=>p.t>=now()).at(-1);const sameTimeTide=nextPeak?nearest(state.pred,nextPeak.t,18*60000):null;
 const uplift=nextPeak&&sameTimeTide?nextPeak.v-sameTimeTide.v:null;
 $('modelPeakTime').textContent=nextPeak?dayTime(nextPeak.t)+' ET':'Peak time unavailable';
 $('modelDetail').textContent=nextPeak?'Model checked '+(state.lastFetched.model?time(state.lastFetched.model)+' ET':'recently')+' · '+(uplift===null?'astronomical comparison unavailable':(uplift>=0?'+':'')+fmtN(uplift)+' ft vs tide-only at that time')+'. '+(modelCoverage&&modelCoverage.t<now()+70*3600000?'Guidance currently ends '+dayTime(modelCoverage.t)+' ET.':''):'Unavailable: no NOAA forecast peak. Astronomical tide is not a substitute.';
 const statusPanel=$('statusHeading').closest('.status');
 const statusTitle=$('statusHeading'), desc=$('statusDescription'), icon=$('statusIcon');if(!source){applyRiskBand(statusPanel,'unavailable');statusTitle.textContent='Live flood status unavailable';desc.textContent='Neither a recent gauge reading nor near-term model guidance is available. Use the official NOAA and NWS links before making decisions.';icon.textContent='?';return;}
 const useModel=!!nextPeak&&(!gaugeFresh||nextPeak.v>latest.v),decision=useModel?nextPeak:latest;const value=decision.v,which=useModel?'Highest available NOAA model guidance':'Latest Portland observation';let level=value>=14?3:value>=13?2:value>=12?1:0;const context=useModel?'indicated by model guidance':'observed at Portland';statusTitle.textContent=level===3?'Major flood threshold '+context:level===2?'Moderate flood threshold '+context:level===1?'Minor flood threshold '+context:'Below the Portland minor flooding threshold';icon.textContent=level>0?'!':'✓';applyRiskBand(statusPanel,riskBand(value));desc.textContent=which+': '+fmtN(value)+' ft MLLW. '+(level?'Portland threshold conditions are '+(useModel?'suggested by model guidance, not confirmed by observation.':'met in a recent gauge observation.')+' ':'This does not rule out waves, erosion or flooding in Saco. ')+(gaugeFresh&&nextPeak?'Latest observed '+fmtN(latest.v)+' ft; highest model guidance '+fmtN(nextPeak.v)+' ft in the next 72 hours. ':'')+'See NWS alerts for locally expected impacts.';
}
function renderTable(){
const highs=highTides(),body=$('highTides');body.replaceChildren();$('highTidesPeriod').textContent='Next '+(state.days===1?'24h':state.days===3?'72h':state.days+' days')+' · Eastern time · Portland gauge';
if(!highs.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.className='empty';td.textContent='No high tides available. Check the NOAA tide tables link.';tr.append(td);body.append(tr);return;}
for(const tide of highs){const model=nearest(state.model,tide.t,45*60000);const label=model?(model.v>=14?'Major (model)':model.v>=13?'Moderate (model)':model.v>=12?'Minor (model)':'Below minor (model)'):'Tide only · no model';const row=document.createElement('tr');const cells=[dayTime(tide.t),fmtN(tide.v)+' ft',model?fmtN(model.v)+' ft':'—',label];cells.forEach((value,i)=>{const td=document.createElement('td');if(i===1||i===2){const b=document.createElement('b');b.textContent=value;td.append(b);}else if(i===3){const span=document.createElement('span');span.className='tabletag'+(model?'':' tide-only-tag');span.textContent=value;td.append(span);}else td.textContent=value;row.append(td);});body.append(row);}
}
function dailyHighTides(days=30){
 const t=now(),start=localParts(t),startUTC=Date.UTC(start.year,start.month-1,start.day);
 const highData=state.highs.length?state.highs:extractHighsFromCurve(state.pred);
 const groups=new Map();
 for(const high of highData){const k=localParts(high.t).key;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(high);}
 return Array.from({length:days},(_,i)=>{
   const d=new Date(startUTC+i*86400000),key=localParts(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),16)).key,arr=groups.get(key)||[];
   return {date:d,key,peak:arr.reduce((a,b)=>!a||b.v>a.v?b:a,null),today:i===0};
 });
}
function renderTideTrend(daily){
 const svg=$('tideTrend'),selection=$('tideTrendSelection'),W=980,H=390,margin={top:48,right:28,bottom:62,left:50},cw=W-margin.left-margin.right,ch=H-margin.top-margin.bottom;
 const ns='http://www.w3.org/2000/svg';svg.replaceChildren();
 function el(tag,attrs={},content,parent=svg){const item=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))item.setAttribute(k,v);if(content!==undefined)item.textContent=content;parent.append(item);return item;}
 const valid=daily.filter(d=>d.peak);if(!valid.length){el('text',{x:W/2,y:H/2,'text-anchor':'middle'},'No 14-day tide predictions available.');selection.textContent='NOAA astronomical tide predictions are currently unavailable.';return;}
 const validKeys=new Set(daily.map(d=>d.key)),modelByKey=new Map(),current=now();
 for(const p of state.model||[]){if(p.t<current)continue;const key=localParts(p.t).key;if(!validKeys.has(key))continue;const old=modelByKey.get(key);if(!old||p.v>old.v)modelByKey.set(key,p);}
 const chartValues=[...valid.map(d=>d.peak.v),...Array.from(modelByKey.values()).map(p=>p.v)];
 const minValue=Math.min(...chartValues),yMin=Math.max(0,Math.min(8,Math.floor((minValue-.35)*2)/2)),yMax=Math.max(15,Math.ceil(Math.max(...chartValues)+.35));
 const x=i=>margin.left+(daily.length===1?cw/2:i/(daily.length-1)*cw),y=v=>margin.top+(yMax-v)/(yMax-yMin)*ch;
 const defs=el('defs'),clip=el('clipPath',{id:'tideTrendClip'},undefined,defs);el('rect',{x:margin.left,y:margin.top,width:cw,height:ch},undefined,clip);
 const zones=[{name:'minor',from:12,to:13,fill:'#FFFF001d',text:'#071824',label:'Minor 12–13 ft'},{name:'moderate',from:13,to:14,fill:'#FFA50024',text:'#071824',label:'Moderate 13–14 ft'},{name:'major',from:14,to:yMax,fill:'#FF000029',text:'#FFFFFF',label:'Major 14+ ft'}];
 for(const z of zones){if(z.from>=yMax)continue;const top=Math.min(z.to,yMax),yy=y(top),hh=y(z.from)-yy;el('rect',{x:margin.left,y:yy,width:cw,height:Math.max(0,hh),fill:z.fill,'clip-path':'url(#tideTrendClip)'});el('text',{x:W-margin.right-5,y:yy+13,'text-anchor':'end',fill:z.text,class:'zone-label '+z.name},z.label);}
 for(let n=Math.ceil(yMin);n<=yMax;n++){el('line',{x1:margin.left,x2:W-margin.right,y1:y(n),y2:y(n),class:'gridline'});if(n%2===0||n>=12)el('text',{x:margin.left-10,y:y(n)+4,'text-anchor':'end','font-size':'10'},String(n));}
 const todayX=x(0);el('line',{x1:todayX,x2:todayX,y1:margin.top,y2:H-margin.bottom,class:'today-line'});el('text',{x:todayX+5,y:margin.top+12,class:'today-label'},'Today');
 let d='';for(let i=0;i<daily.length;i++){const p=daily[i].peak;if(!p)continue;d+=(d?' L':'M')+x(i).toFixed(2)+','+y(p.v).toFixed(2);}if(d)el('path',{d,class:'tide-line','clip-path':'url(#tideTrendClip)'});
 let md='',lastModelIndex=null;
 for(let i=0;i<daily.length;i++){const p=modelByKey.get(daily[i].key);if(!p)continue;md+=(lastModelIndex===i-1?' L':' M')+x(i).toFixed(2)+','+y(p.v).toFixed(2);lastModelIndex=i;}
 if(md)el('path',{d:md.trim(),class:'ofs-trend-line','clip-path':'url(#tideTrendClip)'});
 function describe(day){const dateText=fmt(day.date.getTime()+12*3600000,{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'});let text=day.peak?dateText+' · astronomical high '+fmtN(day.peak.v)+' ft MLLW at '+time(day.peak.t)+' ET':dateText+' · astronomical tide unavailable';const mp=modelByKey.get(day.key);if(mp){const tideAtModel=nearest(state.pred,mp.t,25*60000),delta=tideAtModel?mp.v-tideAtModel.v:null;text+=' · NOAA OFS forecast peak '+fmtN(mp.v)+' ft MLLW at '+time(mp.t)+' ET'+(delta===null?'':(' · '+(delta>=0?'+':'')+fmtN(delta)+' ft vs astronomical tide at that time'));}if(day.peak){const gap=THRESHOLDS[0].value-day.peak.v;text+=' · tide-only '+(gap>0?fmtN(gap)+' ft below Minor Flood':gap===0?'at Minor Flood level':fmtN(Math.abs(gap))+' ft above Minor Flood level');}return text+'.';}
 function selectPoint(index){svg.querySelectorAll('.tide-point,.ofs-trend-point').forEach(n=>n.classList.toggle('selected',Number(n.dataset.index)===index));selection.textContent=describe(daily[index]);}
 for(let i=0;i<daily.length;i++){
   const day=daily[i],xx=x(i),dateLabel=fmt(day.date.getTime()+12*3600000,{month:'short',day:'numeric',timeZone:'UTC'}),mp=modelByKey.get(day.key);
   el('text',{x:xx,y:H-24,'text-anchor':'middle',class:'date-label'},dateLabel);
   if(day.peak){const yy=y(day.peak.v);el('circle',{cx:xx,cy:yy,r:5,class:'tide-point','data-index':i,'clip-path':'url(#tideTrendClip)'});el('text',{x:xx,y:yy-12,'text-anchor':'middle',class:'tide-value'},fmtN(day.peak.v));}
   if(mp){const my=y(mp.v),ty=day.peak?y(day.peak.v):null,labelY=ty!==null&&Math.abs(my-ty)<28?my+21:my-12;el('circle',{cx:xx,cy:my,r:5.5,class:'ofs-trend-point','data-index':i,'clip-path':'url(#tideTrendClip)'});el('text',{x:xx,y:labelY,'text-anchor':'middle',class:'ofs-trend-value'},fmtN(mp.v));}
   if(!day.peak&&!mp)continue;
   const hitY=day.peak?y(day.peak.v):y(mp.v),hit=el('circle',{cx:xx,cy:hitY,r:20,class:'tide-hit','data-index':i,tabindex:'0',role:'button','aria-label':describe(day)});
   const activate=e=>{e.preventDefault();selectPoint(i);};hit.addEventListener('click',activate);hit.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){activate(e);}});
 }
 const topIndex=daily.reduce((best,d,i)=>d.peak&&(!daily[best]?.peak||d.peak.v>daily[best].peak.v)?i:best,0);selectPoint(topIndex);
}
function renderCalendar(){
 const daily=dailyHighTides(30),outlook=daily.slice(0,14),cal=$('highTideCalendar');cal.replaceChildren();
 const valid=outlook.filter(d=>d.peak),top=valid.reduce((a,b)=>!a||b.peak.v>a.peak.v?b:a,null),today=daily[0]?.peak||null;
 if(top){
   $('tideOutlookPeak').textContent=fmtN(top.peak.v)+' ft';
   $('tideOutlookPeakTime').textContent=fmt(top.date.getTime()+12*3600000,{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'})+' · '+time(top.peak.t)+' ET';
   const gap=THRESHOLDS[0].value-top.peak.v;$('tideOutlookMinorGap').textContent=gap>0?fmtN(gap)+' ft below':gap===0?'At threshold':fmtN(Math.abs(gap))+' ft above';
 }else{$('tideOutlookPeak').textContent='Unavailable';$('tideOutlookPeakTime').textContent='No 14-day tide predictions returned';$('tideOutlookMinorGap').textContent='--';}
 if(top&&today){const diff=top.peak.v-today.v;$('tideOutlookChange').textContent=(diff>=0?'+':'')+fmtN(diff)+' ft';$('tideOutlookChangeNote').textContent='Highest 14-day tide vs. today’s '+fmtN(today.v)+' ft high';}
 else{$('tideOutlookChange').textContent='--';$('tideOutlookChangeNote').textContent='Today’s daily high is unavailable';}
 renderTideTrend(outlook);
 for(const d of daily){
   const cell=document.createElement('div');cell.className='daytile'+(d.today?' today':'')+(d.peak&&d.peak.v>=THRESHOLDS[0].value?' tide-threshold':'')+(!d.peak?' no-tide':'');
   const date=document.createElement('div');date.className='daydate';date.textContent=fmt(d.date.getTime()+12*3600000,{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'});cell.append(date);
   const height=document.createElement('strong');height.textContent=d.peak?fmtN(d.peak.v)+' ft':'—';cell.append(height);
   const at=document.createElement('span');at.textContent=d.peak?'High at '+time(d.peak.t)+' ET':'No tide data';cell.append(at);
   if(d.today){const flag=document.createElement('small');flag.textContent='Today';cell.append(flag);}
   if(d.peak&&d.peak.v>=THRESHOLDS[0].value){const flag=document.createElement('small');flag.textContent='Tide-only ≥ minor gauge level';cell.append(flag);}
   cal.append(cell);
 }
 const count=daily.filter(x=>x.peak).length;
 $('calendarNote').textContent=(count===30?'All 30 days populated.':count+' of 30 days have tide data; open NOAA if dates are missing.')+(state.highs.length?' Daily values use NOAA high/low tide predictions.':' Daily highs are approximated from sampled astronomical tide predictions.')+(state.errors.longTide?' The long-range tide feed is currently unavailable.':'')+' Astronomical tides exclude storm surge, wind, waves and runup.';
 $('tideOutlookNote').textContent='Turquoise shows the astronomical tide baseline. Purple shows NOAA OFS total-water daily peaks only for dates covered by current model guidance; it stops where that guidance ends. '+(state.errors.longTide?'Long-range NOAA tide data are partially unavailable. ':'')+'Later dates are tide-only, not a storm or flood forecast.';
}
function extractHighsFromCurve(p){const result=[];for(let i=1;i<p.length-1;i++){const a=p[i-1],b=p[i],c=p[i+1];if(b.t-a.t>32*60000||c.t-b.t>32*60000)continue;if(b.v>=a.v&&b.v>c.v&&(!result.length||b.t-result.at(-1).t>3*3600000))result.push(b);}return result;}

function renderHistoricalComparison(){
 const future=state.model.filter(p=>p.t>=now()&&p.t<=now()+72*3600000);
 const highest=peak(future,-Infinity,Infinity),ending=future.at(-1);
 const summary=$('compareSummary'),foot=$('compareFootnote');
 if(!highest){
   summary.textContent='No current NOAA model peak is available.';
   $('comparePeakValue').textContent='Unavailable';
   $('comparePeakTime').textContent='Peak time unavailable';
   $('comparePeakUplift').textContent='A tide-only height is not being substituted for storm guidance.';
   for(const id of ['Jan10','Jan13']){$('compare'+id).textContent='Forecast unavailable';$('compare'+id).className='compare-delta';$('compare'+id+'Detail').textContent='Historical observed peak remains a reference, not a forecast.';}
   foot.textContent='These are historical Portland gauge observations; no current NOAA model forecast is being substituted or estimated.';return;
 }
 const predicted=nearest(state.pred,highest.t,18*60000);
 const uplift=predicted?highest.v-predicted.v:null;
 summary.textContent='Current NOAA model guidance for Portland station 8418150.';
 $('comparePeakValue').textContent=fmtN(highest.v)+' ft MLLW';
 $('comparePeakTime').textContent=dayTime(highest.t)+' ET';
 $('comparePeakUplift').textContent=uplift===null?'Astronomical-tide comparison unavailable.':(uplift>=0?'+':'')+fmtN(uplift)+' ft versus astronomical tide at that time.';
 for(const mark of JAN2024){const diff=highest.v-mark.value,el=$('compare'+mark.date);el.className='compare-delta '+(Math.abs(diff)<.005?'same':diff<0?'below':'above');el.textContent=Math.abs(diff)<.005?'At the historical peak':fmtN(Math.abs(diff))+' ft '+(diff<0?'below':'above')+' the 2024 peak';$('compare'+mark.date+'Detail').textContent='Current modeled peak '+fmtN(highest.v)+' ft vs. observed '+fmtN(mark.value)+' ft (MLLW).';}
 foot.textContent='Peak uses available model points through '+dayTime(ending.t)+' ET'+(ending.t<now()+70*3600000?' (partial 72-hour coverage)':'')+'. Last retrieved '+(state.lastFetched.model?dayTime(state.lastFetched.model)+' ET':'time unavailable')+'; retrieval time is not model issuance time. The 2024 levels are observed Portland peaks, not damage thresholds; waves, runup and local conditions in Saco can produce different impacts.';
}
