'use strict';
function renderChart(){
const svg=$('chart'),tip=$('tooltip'),renderedW=Math.max(svg.clientWidth||920,1),renderedH=Math.max(svg.clientHeight||410,1),H=410,W=Math.max(300,Math.round(H*renderedW/renderedH));svg.setAttribute('viewBox','0 0 '+W+' '+H);const margin={top:36,right:16,bottom:76,left:42},cw=W-margin.left-margin.right,ch=H-margin.top-margin.bottom;
const current=now(),longMode=state.days>3,start=longMode?current:current-24*3600000,end=current+state.days*86400000;
const futureModel=state.model.filter(p=>p.t>=current-10*60000&&p.t<=Math.min(end,current+72*3600000));
const modelPeak=peak(futureModel,current-10*60000,Math.min(end,current+72*3600000));
const tideAtPeak=modelPeak?nearest(state.pred,modelPeak.t,25*60000):null;
const uplift=modelPeak&&tideAtPeak?modelPeak.v-tideAtPeak.v:null;
const thresholdGap=modelPeak?THRESHOLDS[0].value-modelPeak.v:null;
if(modelPeak){
 $('chartHeadline').textContent='NOAA peak: '+fmtN(modelPeak.v)+' ft · '+dayTime(modelPeak.t)+' ET · '+(thresholdGap>0?fmtN(thresholdGap)+' ft below Minor Flood':thresholdGap===0?'at the Minor Flood threshold':fmtN(Math.abs(thresholdGap))+' ft above Minor Flood');
 $('chartHeadlineSub').textContent=uplift===null?'Astronomical-tide comparison unavailable at that time.':'For context: '+(uplift>=0?'+':'')+fmtN(uplift)+' ft versus astronomical tide at the forecast peak.';
}else{
 $('chartHeadline').textContent='NOAA model peak unavailable';
 $('chartHeadlineSub').textContent='No NOAA total-water model peak is currently available.';
}
const ns='http://www.w3.org/2000/svg';svg.replaceChildren();tip.hidden=true;
function el(tag,attrs={},content){const item=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))item.setAttribute(k,v);if(content!==undefined)item.textContent=content;svg.append(item);return item;}
const defs=el('defs');const clip=document.createElementNS(ns,'clipPath');clip.setAttribute('id','plotClip');const rect=document.createElementNS(ns,'rect');Object.entries({x:margin.left,y:margin.top,width:cw,height:ch}).forEach(([k,v])=>rect.setAttribute(k,v));clip.append(rect);defs.append(clip);

function localPeaks(series,from,to,minGap=4*3600000){
 const valid=series.filter(p=>p.t>=from&&p.t<=to);const result=[];
 for(let i=1;i<valid.length-1;i++){const a=valid[i-1],b=valid[i],c=valid[i+1];if(!(b.v>=a.v&&b.v>c.v))continue;const prev=result.at(-1);if(prev&&b.t-prev.t<minGap){if(b.v>prev.v)result[result.length-1]=b;}else result.push(b);}
 return result;
}
function dailyMax(series,from,to){
 const groups=new Map();for(const p of series){if(p.t<from||p.t>to)continue;const key=localParts(p.t).key;const old=groups.get(key);if(!old||p.v>old.v)groups.set(key,p);}
 return [...groups.values()].sort((a,b)=>a.t-b.t);
}
const highSource=state.highs.length?state.highs:extractHighsFromCurve(state.pred);
const dailyTides=dailyMax(highSource,current-30*60000,end);
const dailyModels=dailyMax(futureModel,current-10*60000,end);
const observedSeries=state.obs.filter(p=>p.t>=start&&p.t<=Math.min(current,end));
const modelSeries=state.model.filter(p=>p.t>=Math.max(current-10*60000,start)&&p.t<=Math.min(end,current+72*3600000));
const shortValues=[...observedSeries,...(state.showModel?modelSeries:[])].map(p=>p.v);
const longValues=[...dailyTides,...(state.showModel?dailyModels:[])].map(p=>p.v);
const dataMax=Math.max(14,...(longMode?longValues:shortValues));
const lo=longMode?Math.max(6,Math.min(11,Math.floor(((longValues.length?Math.min(...longValues):9)-.75)*2)/2)):8;
const hi=Math.max(15,Math.ceil((dataMax+.25)*2)/2);
const x=t=>margin.left+(t-start)/(end-start)*cw,y=v=>margin.top+(hi-v)/(hi-lo)*ch;

const modelEnd=futureModel.length?futureModel.at(-1).t:current;
if(!longMode&&end>modelEnd+20*60000){const sx=x(Math.max(current,modelEnd));el('rect',{x:sx,y:margin.top,width:Math.max(0,W-margin.right-sx),height:ch,fill:'#d6b4770b','clip-path':'url(#plotClip)'});if(W-margin.right-sx>135)el('text',{x:sx+8,y:H-margin.bottom-9,fill:'#d9bd89',class:'axis-note'},'Model guidance ends');}

if(state.showFlood){
 const bands=[
  {name:'minor',from:12,to:13,fill:'#FFFF00',text:'#071824',label:'Minor flood 12–13 ft'},
  {name:'moderate',from:13,to:14,fill:'#FFA500',text:'#071824',label:'Moderate flood 13–14 ft'},
  {name:'major',from:14,to:hi,fill:'#FF0000',text:'#FFFFFF',label:'Major flood 14+ ft'}
 ];
 for(const b of bands){if(hi<=b.from)continue;const top=Math.min(hi,b.to),bottom=Math.max(lo,b.from);if(top<=bottom)continue;const yy=y(top),hh=Math.max(0,y(bottom)-yy);el('rect',{x:margin.left,y:yy,width:cw,height:hh,fill:b.fill,class:'threshold-band '+b.name,'data-threshold':b.name,'clip-path':'url(#plotClip)'});if(hh>15)el('text',{x:W-margin.right-6,y:yy+Math.min(hh-4,14),'text-anchor':'end',fill:b.text,class:'zone-label '+b.name},b.label);}
}
for(let n=Math.ceil(lo);n<=hi;n+=1){el('line',{x1:margin.left,x2:W-margin.right,y1:y(n),y2:y(n),class:'gridline'});el('text',{x:margin.left-11,y:y(n)+4,'text-anchor':'end',class:'y-axis-label'},String(n));}

if(longMode){
 const dayStep=state.days<=7?1:state.days<=14?2:5,step=dayStep*86400000;
 for(let tick=current;tick<=end;tick+=step){const tx=x(tick);el('line',{x1:tx,x2:tx,y1:margin.top,y2:H-margin.bottom,class:'gridline'});el('text',{x:tx,y:H-14,'text-anchor':tick===current?'start':'middle'},fmt(tick,{month:'short',day:'numeric'}));}
 el('text',{x:margin.left+4,y:margin.top+13,class:'axis-note',fill:'#a7e5d8'},'Daily high-water peaks');
}else{
 // Day headings at the top; exact high-water times align below each crest.
 const dayKeys=[];for(let t=start;t<=end;t+=6*3600000){const p=localParts(t);if(!dayKeys.some(k=>k.key===p.key))dayKeys.push({...p,sample:t});}
 for(const d of dayKeys){const pts=modelSeries.filter(p=>localParts(p.t).key===d.key);if(!pts.length)continue;const left=Math.max(margin.left,x(pts[0].t)),right=Math.min(W-margin.right,x(pts.at(-1).t));if(right-left>28)el('text',{x:(left+right)/2,y:margin.top-10,'text-anchor':'middle',class:'day-heading'},fmt(d.sample,{weekday:'short',month:'short',day:'numeric'}));}
 const nowX=x(current);el('line',{x1:nowX,x2:nowX,y1:margin.top,y2:H-margin.bottom,class:'now'});el('text',{x:Math.min(W-margin.right-24,nowX+5),y:margin.top+12,fill:'#dcf8ee'},'Now');
}

function clippedPath(series,cls,gapMinutes=150){
 let d='',last=null,count=0;
 for(const p of series){
  if(p.t<start||p.t>end)continue;
  if(p.v<lo){last=null;continue;}
  d+=(last&&p.t-last.t<=gapMinutes*60000?'L':'M')+x(p.t).toFixed(2)+','+y(p.v).toFixed(2)+' ';last=p;count++;
 }
 if(count>=2)el('path',{d,fill:'none',class:cls,'clip-path':'url(#plotClip)','stroke-linecap':'round','stroke-linejoin':'round'});
}
function peakPath(points,cls){if(points.length<2)return;const d=points.map((p,i)=>(i?'L':'M')+x(p.t).toFixed(2)+','+y(p.v).toFixed(2)).join(' ');el('path',{d,fill:'none',class:cls,'clip-path':'url(#plotClip)','stroke-linecap':'round','stroke-linejoin':'round'});}
function dot(p,cls,r=4,attrs={}){if(!p||p.t<start||p.t>end||p.v<lo||p.v>hi)return null;return el('circle',{cx:x(p.t),cy:y(p.v),r,class:cls,'clip-path':'url(#plotClip)',...attrs});}
function labelAt(p,text,color,dy=0,anchor='start',cls='series-label'){if(!p||p.t<start||p.t>end||p.v<lo||p.v>hi)return;let xx=x(p.t)+(anchor==='start'?8:-8);xx=Math.max(margin.left+4,Math.min(W-margin.right-4,xx));el('text',{x:xx,y:y(p.v)+dy,fill:color,'text-anchor':anchor,class:cls},text);}
function lastVisible(series){return series.filter(p=>p.t>=start&&p.t<=end&&p.v>=lo&&p.v<=hi).at(-1)||null;}

if(longMode){
 peakPath(dailyTides,'daily-pred');for(const p of dailyTides)dot(p,'tide-dot',4);
 if(state.showModel&&dailyModels.length){peakPath(dailyModels,'daily-ofs');for(const p of dailyModels)dot(p,'peak-dot',4.8);}
 const tideLast=lastVisible(dailyTides);if(tideLast)labelAt(tideLast,'Daily astronomical high','#f6cf6b',-9,'end');
 const modelLast=state.showModel?lastVisible(dailyModels):null;if(modelLast)labelAt(modelLast,'NOAA model high','#d9a3ff',15,'end');
}else{
 clippedPath(observedSeries,'obs',45);
 if(state.showModel)clippedPath(modelSeries,'ofs',150);
 const obsLast=lastVisible(observedSeries);if(obsLast){dot(obsLast,'obs-marker',5.2);labelAt(obsLast,'Observed','#63eee0',-10,'start','short-series-label');}
 const modelLast=state.showModel?lastVisible(modelSeries):null;if(modelLast)labelAt(modelLast,'NOAA total-water forecast','#d9a3ff',-11,'end','short-series-label');
 if(state.showModel){
  const peaks=localPeaks(modelSeries,Math.max(current,start),Math.min(end,current+72*3600000),5*3600000);
  const top=peak(peaks,-Infinity,Infinity)||modelPeak;
  el('line',{x1:margin.left,x2:W-margin.right,y1:H-margin.bottom+12,y2:H-margin.bottom+12,class:'timing-rail'});
  el('text',{x:margin.left,y:H-6,class:'timing-title'},'Forecast high-water peaks · ET');
  peaks.forEach((p,i)=>{
   const isTop=top&&p.t===top.t,px=x(p.t),py=y(p.v);
   dot(p,'short-model-point'+(isTop?' top':''),isTop?6.2:4.8,{ 'data-series':'noaa-model-high' });
   el('line',{x1:px,x2:px,y1:Math.min(H-margin.bottom,py+7),y2:H-margin.bottom+12,class:'peak-guide','data-peak-guide':'true'});
   el('circle',{cx:px,cy:H-margin.bottom+12,r:isTop?3.5:2.5,fill:isTop?'#f5ddff':'#d59bf7','data-peak-tick':'true'});
   el('text',{x:px,y:Math.max(margin.top+18,py-(isTop?15:11)),'text-anchor':'middle',class:'peak-label'},fmtN(p.v)+"'");
   const base=H-margin.bottom+27+(i%2)*17;
   el('text',{x:px,y:base,'text-anchor':'middle',class:'peak-time-label'},fmt(p.t,{hour:'numeric',minute:'2-digit'}));
   el('text',{x:px,y:base+10,'text-anchor':'middle',class:'peak-date-label'},fmt(p.t,{weekday:'short'}));
  });
 }
}
if(!(longMode?longValues:shortValues).length)el('text',{x:W/2,y:H/2,'text-anchor':'middle'},'No water-level data available. Use the direct source links below.');

const hoverObserved=longMode?[]:observedSeries,hoverModels=longMode?dailyModels:modelSeries,hoverTides=longMode?dailyTides:[];
const overlay=el('rect',{x:margin.left,y:margin.top,width:cw,height:ch,fill:'transparent','pointer-events':'all',style:'cursor:crosshair'});
overlay.addEventListener('pointermove',event=>{
 const box=svg.getBoundingClientRect(),px=(event.clientX-box.left)/box.width*W,t=start+(px-margin.left)/cw*(end-start);
 const tol=longMode?(state.days>=30?18:state.days>=14?12:8)*3600000:60*60000;
 const o=longMode?null:nearest(hoverObserved,t,tol),m=state.showModel?nearest(hoverModels,t,longMode?14*3600000:tol):null,p=longMode?nearest(hoverTides,t,tol):null;
 if(!o&&!p&&!m){tip.hidden=true;return;}
 const rows=(longMode?[['Daily astronomical high',p],['NOAA model high',m]]:[['Observed',o],['NOAA total-water',m]]).filter(a=>a[1]&&a[1].v>=lo);
 tip.replaceChildren();const tm=document.createElement('time');tm.textContent=dayTime(t)+' ET';tip.append(tm);
 for(const [name,point] of rows){const row=document.createElement('div');row.className='ttrow';const n=document.createElement('span');n.textContent=name;const val=document.createElement('b');val.textContent=fmtN(point.v)+' ft';row.append(n,val);tip.append(row);}
 if(!rows.length){tip.hidden=true;return;}
 tip.hidden=false;const w=box.width,left=px/W*w;tip.style.left=Math.max(0,Math.min(w-228,left+12))+'px';tip.style.top=event.clientY-box.top>box.height/2?'9px':Math.max(0,box.height-110)+'px';
});
overlay.addEventListener('pointerleave',()=>tip.hidden=true);
$('chart').setAttribute('aria-label',longMode?'Daily high-water peaks in feet MLLW for the selected outlook period, with available NOAA model peaks and Portland flood threshold bands':'Observed and NOAA total-water guidance in feet MLLW. Each forecast high-water peak has a vertical guide to an exact Eastern Time label. Continuous tide-cycle lines are shown only above 8 feet; lower portions are clipped.');
$('chartPeriod').textContent=longMode?'Next '+state.days+' days · daily high-water peaks · NOAA model overlay where available':'Past 24h · next '+(state.days===1?'24h':'72h')+' · each forecast high aligned to exact ET time · chart clipped below 8 ft';
}
