'use strict';

const STORM_UI_THRESHOLDS={residualFt:0.75,waveFt:6,windMph:25,gustMph:35};

function residualSeries(hours=24){
  const start=now()-hours*3600000;
  const out=[];
  for(const o of state.obs){
    if(o.t<start)continue;
    const tide=nearest(state.pred,o.t,12*60000);
    if(tide)out.push({t:o.t,v:o.v-tide.v,observed:o.v,tide:tide.v});
  }
  return out;
}

function miniLine(svgId,points,valueKey='v',zeroLine=false,options={}){
  const svg=$(svgId); if(!svg)return;
  svg.replaceChildren();
  const ns='http://www.w3.org/2000/svg',W=420,H=120,pad=12;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.classList.toggle('mini-chart-interactive',Boolean(options.tooltip));
  if(options.tooltip){
    svg.setAttribute('tabindex','0');
    if(options.ariaLabel)svg.setAttribute('aria-label',options.ariaLabel);
  }else{
    svg.removeAttribute('tabindex');
  }
  const parent=svg.parentElement;
  let tip=parent?.querySelector(`.mini-chart-tooltip[data-for="${svgId}"]`)||null;
  if(tip)tip.hidden=true;
  if(!points.length){
    const t=document.createElementNS(ns,'text');t.setAttribute('x',W/2);t.setAttribute('y',H/2);t.setAttribute('text-anchor','middle');t.textContent='History building';svg.append(t);return;
  }
  const vals=points.map(p=>Number(p[valueKey])).filter(Number.isFinite);
  if(!vals.length)return;
  let lo=Math.min(...vals),hi=Math.max(...vals);
  if(zeroLine){lo=Math.min(lo,0);hi=Math.max(hi,0);}
  if(Math.abs(hi-lo)<0.05){hi+=0.05;lo-=0.05;}
  const first=points[0].t??0,last=points.at(-1).t??Math.max(1,points.length-1);
  const x=(p,i)=>last===first?pad+(W-2*pad)*(i/Math.max(1,points.length-1)):pad+(W-2*pad)*((p.t-first)/(last-first));
  const y=v=>pad+(H-2*pad)*(1-(v-lo)/(hi-lo));
  if(zeroLine&&lo<=0&&hi>=0){
    const z=document.createElementNS(ns,'line');z.setAttribute('x1',pad);z.setAttribute('x2',W-pad);z.setAttribute('y1',y(0));z.setAttribute('y2',y(0));z.setAttribute('class','mini-zero');svg.append(z);
  }
  const path=document.createElementNS(ns,'path');
  path.setAttribute('d',points.map((p,i)=>(i?'L':'M')+x(p,i).toFixed(1)+','+y(p[valueKey]).toFixed(1)).join(' '));
  path.setAttribute('class','mini-line');svg.append(path);
  for(let i=0;i<points.length;i++){
    const c=document.createElementNS(ns,'circle');c.setAttribute('cx',x(points[i],i));c.setAttribute('cy',y(points[i][valueKey]));c.setAttribute('r',points.length<8?4:2.5);c.setAttribute('class','mini-dot');svg.append(c);
  }
  if(!options.tooltip||!parent)return;

  if(!tip){
    tip=document.createElement('div');
    tip.className='mini-chart-tooltip';
    tip.dataset.for=svgId;
    tip.setAttribute('role','status');
    tip.hidden=true;
    parent.append(tip);
  }
  const guide=document.createElementNS(ns,'line');
  guide.setAttribute('class','mini-hover-guide');guide.setAttribute('y1',pad);guide.setAttribute('y2',H-pad);guide.hidden=true;svg.append(guide);
  const active=document.createElementNS(ns,'circle');
  active.setAttribute('class','mini-hover-dot');active.setAttribute('r','5');active.hidden=true;svg.append(active);
  const hit=document.createElementNS(ns,'rect');
  hit.setAttribute('x',pad);hit.setAttribute('y',pad);hit.setAttribute('width',W-2*pad);hit.setAttribute('height',H-2*pad);hit.setAttribute('fill','transparent');hit.setAttribute('pointer-events','all');svg.append(hit);

  let selected=-1,pinned=false;
  const nearestIndex=clientX=>{
    const box=svg.getBoundingClientRect();
    const px=(clientX-box.left)/Math.max(1,box.width)*W;
    let best=0,bestDistance=Infinity;
    for(let i=0;i<points.length;i++){
      const distance=Math.abs(x(points[i],i)-px);
      if(distance<bestDistance){best=i;bestDistance=distance;}
    }
    return best;
  };
  const hide=()=>{tip.hidden=true;guide.hidden=true;active.hidden=true;selected=-1;};
  const show=i=>{
    i=Math.max(0,Math.min(points.length-1,i));
    selected=i;
    const point=points[i],px=x(point,i),py=y(point[valueKey]);
    guide.setAttribute('x1',px);guide.setAttribute('x2',px);guide.hidden=false;
    active.setAttribute('cx',px);active.setAttribute('cy',py);active.hidden=false;
    const detail=options.tooltip(point,i)||{},rows=Array.isArray(detail.rows)?detail.rows:[];
    tip.replaceChildren();
    const title=document.createElement('time');title.textContent=detail.title||'Selected point';tip.append(title);
    for(const [label,value] of rows){
      const row=document.createElement('div');row.className='mini-tt-row';
      const name=document.createElement('span');name.textContent=label;
      const val=document.createElement('b');val.textContent=value;
      row.append(name,val);tip.append(row);
    }
    tip.hidden=false;
    const svgBox=svg.getBoundingClientRect(),parentBox=parent.getBoundingClientRect();
    const leftInParent=(svgBox.left-parentBox.left)+(px/W)*svgBox.width;
    const topInParent=(svgBox.top-parentBox.top)+(py/H)*svgBox.height;
    const half=Math.min(104,Math.max(82,(parent.clientWidth-24)/2));
    tip.style.left=Math.max(half,Math.min(parent.clientWidth-half,leftInParent))+'px';
    tip.style.top=Math.max(8,topInParent+(py>H/2?-92:13))+'px';
  };
  hit.addEventListener('pointermove',event=>{
    if(event.pointerType==='mouse'||event.pointerType==='pen'){pinned=false;show(nearestIndex(event.clientX));}
  });
  hit.addEventListener('pointerleave',()=>{if(!pinned)hide();});
  hit.addEventListener('pointerdown',event=>{pinned=true;show(nearestIndex(event.clientX));});
  svg.onkeydown=event=>{
    if(event.key==='Escape'){pinned=false;hide();return;}
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight'&&event.key!=='Enter'&&event.key!==' ')return;
    event.preventDefault();pinned=true;
    if(selected<0)selected=event.key==='ArrowLeft'?points.length-1:0;
    else if(event.key==='ArrowLeft')selected=Math.max(0,selected-1);
    else if(event.key==='ArrowRight')selected=Math.min(points.length-1,selected+1);
    show(selected);
  };
}

function renderResidualIntelligence(){
  const rows=residualSeries(24),latest=rows.at(-1)||null,max=rows.reduce((a,b)=>!a||b.v>a.v?b:a,null);
  $('residualNow').textContent=latest?(latest.v>=0?'+':'')+fmtN(latest.v)+' ft':'--';
  $('residualMax').textContent=max?(max.v>=0?'+':'')+fmtN(max.v)+' ft':'--';
  $('residualMeta').textContent=max?'24h max at '+dayTime(max.t)+' ET. Positive values mean observed water was above the astronomical prediction.':'Needs matching Portland observations and astronomical tide predictions.';
  miniLine('residualSpark',rows,'v',true,{
    ariaLabel:'Interactive Portland water-level residual over the past 24 hours. Hover, tap, or use the left and right arrow keys to inspect exact values.',
    tooltip:point=>({
      title:dayTime(point.t)+' ET',
      rows:[
        ['Storm surge residual',(point.v>=0?'+':'')+fmtN(point.v)+' ft'],
        ['Observed water level',fmtN(point.observed)+' ft MLLW'],
        ['Astronomical tide',fmtN(point.tide)+' ft MLLW']
      ]
    })
  });
}

function modelWindowForHigh(high){
  const candidates=state.model.filter(p=>p.t>=high.t-2*3600000&&p.t<=high.t+2*3600000);
  const model=candidates.reduce((a,b)=>!a||b.v>a.v?b:a,null);
  if(!model)return {high,model:null};
  const tideAtModel=nearest(state.pred,model.t,25*60000);
  return {high,model,contribution:tideAtModel?model.v-tideAtModel.v:null,margin:12-model.v};
}

function renderHighWaterWindows(){
  const root=$('highWaterWindows');if(!root)return;root.replaceChildren();
  const sourceHighs=state.highs.length?state.highs:highTides();
  const highs=sourceHighs.filter(x=>x.t>=now()-10*60000).slice(0,3);
  if(!highs.length){root.innerHTML='<div class="intel-empty">Upcoming high-water windows are unavailable.</div>';return;}
  for(const high of highs){
    const w=modelWindowForHigh(high),card=document.createElement('article');
    const band=riskBand(w.model?.v);card.className='high-window risk-'+band;
    const title=document.createElement('div');title.className='high-window-time';title.textContent=dayTime(high.t)+' ET';
    const grid=document.createElement('div');grid.className='high-window-grid';
    const pairs=[
      ['Astronomical tide',fmtN(high.v)+' ft'],
      ['NOAA modeled peak',w.model?fmtN(w.model.v)+' ft':'Unavailable'],
      ['Weather contribution',w.contribution===null||w.contribution===undefined?'Unavailable':(w.contribution>=0?'+':'')+fmtN(w.contribution)+' ft'],
      ['Margin to Minor Flood',w.margin===null||w.margin===undefined?'Unavailable':Math.abs(w.margin).toFixed(2)+' ft '+(w.margin>=0?'below':'above')]
    ];
    for(const [label,value] of pairs){const d=document.createElement('div');d.innerHTML='<span></span><strong></strong>';d.querySelector('span').textContent=label;d.querySelector('strong').textContent=value;grid.append(d);}
    card.append(title,grid);root.append(card);
  }
}

function renderForecastEvolution(){
  const items=state.briefing?.forecast_evolution?.items||[];
  const root=$('forecastEvolutionRows');if(!root)return;root.replaceChildren();
  if(!items.length){root.innerHTML='<div class="intel-empty">Forecast history is still building.</div>';miniLine('forecastEvolutionSpark',[]);return;}
  const pts=items.map((item,i)=>({t:i,v:Number(item.peak_ft),label:item.label})).filter(p=>Number.isFinite(p.v));
  miniLine('forecastEvolutionSpark',pts,'v',false);
  for(const item of items){
    const row=document.createElement('div');row.className='evolution-row';
    const margin=Number(item.minor_margin_ft);
    row.innerHTML='<span class="evolution-when"></span><strong></strong><span class="evolution-margin"></span>';
    row.querySelector('.evolution-when').textContent=item.label;
    row.querySelector('strong').textContent=Number.isFinite(Number(item.peak_ft))?Number(item.peak_ft).toFixed(2)+' ft':'--';
    row.querySelector('.evolution-margin').textContent=Number.isFinite(margin)?Math.abs(margin).toFixed(2)+' ft '+(margin>=0?'below Minor':'above Minor'):'';
    root.append(row);
  }
  const basis=$('forecastEvolutionBasis');if(basis)basis.textContent=state.briefing?.forecast_evolution?.basis||'Captured forecast snapshots.';
}

function liveStormReasons(){
  const reasons=[];
  const {nextPeak}=currentStatus();
  if(nextPeak?.v>=12)reasons.push('NOAA modeled peak reaches Portland Minor Flood');
  const residual=residualSeries(24),latest=residual.at(-1),max=residual.reduce((a,b)=>!a||b.v>a.v?b:a,null);
  if(latest?.v>=STORM_UI_THRESHOLDS.residualFt)reasons.push('Portland residual '+(latest.v>=0?'+':'')+fmtN(latest.v)+' ft');
  else if(max?.v>=1)reasons.push('24h Portland residual reached +'+fmtN(max.v)+' ft');
  const buoy=state.marine?.['44007']||{};
  if(Number.isFinite(buoy.wave_height_ft)&&buoy.wave_height_ft>=STORM_UI_THRESHOLDS.waveFt)reasons.push('Buoy 44007 waves '+buoy.wave_height_ft.toFixed(1)+' ft');
  if(Number.isFinite(buoy.gust_mph)&&buoy.gust_mph>=STORM_UI_THRESHOLDS.gustMph)reasons.push('Buoy 44007 gust '+Math.round(buoy.gust_mph)+' mph');
  else if(Number.isFinite(buoy.speed_mph)&&buoy.speed_mph>=STORM_UI_THRESHOLDS.windMph)reasons.push('Buoy 44007 wind '+Math.round(buoy.speed_mph)+' mph');
  const alert=state.alerts.find(a=>/coastal|high surf|storm surge|flood|gale|storm warning|high wind/i.test(a?.properties?.event||''));
  if(alert)reasons.push('Active NWS '+alert.properties.event);
  for(const r of state.briefing?.storm_mode?.reasons||[])if(!reasons.includes(r))reasons.push(r);
  return reasons;
}

function renderStormMode(){
  if(typeof renderEventFocus==='function'){renderEventFocus();return;}
  const panel=$('stormModePanel');if(!panel)return;
  const reasons=liveStormReasons(),active=reasons.length>0;
  panel.hidden=!active;document.body.classList.toggle('storm-mode',active);
  if(!active)return;
  $('eventFocusTitle').textContent='Coastal Storm Mode';$('eventFocusBadge').textContent='Elevated conditions';
  const reasonRoot=$('stormModeReasons');reasonRoot.replaceChildren();
  for(const r of reasons.slice(0,5)){const span=document.createElement('span');span.textContent=r;reasonRoot.append(span);}
  const root=$('eventFocusMetrics');root.replaceChildren();
  const {nextPeak}=currentStatus(),sourceHighs=state.highs.length?state.highs:highTides(),high=sourceHighs.find(x=>x.t>=now()-10*60000),res=residualSeries(24).at(-1),buoy=state.marine?.['44007']||{};
  const pairs=[['NOAA 72h peak',nextPeak?fmtN(nextPeak.v)+' ft':'--'],['Next high tide',high?dayTime(high.t)+' ET':'--'],['Portland residual',res?(res.v>=0?'+':'')+fmtN(res.v)+' ft':'--'],['Buoy 44007 sea state',Number.isFinite(buoy.wave_height_ft)?buoy.wave_height_ft.toFixed(1)+' ft':'--']];
  for(const [label,value] of pairs){const d=document.createElement('div'),s=document.createElement('span'),strong=document.createElement('strong');s.textContent=label;strong.textContent=value;d.append(s,strong);root.append(d);}
}
function renderCoastalIntelligence(){
  renderResidualIntelligence();
  renderHighWaterWindows();
  renderForecastEvolution();
  renderStormMode();
}
