'use strict';
(function(){
 const NS='http://www.w3.org/2000/svg';
 function chevron(){const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('disclosure-chevron');const path=document.createElementNS(NS,'path');path.setAttribute('d','m6 9 6 6 6-6');svg.append(path);return svg;}
 function init(root=document){
  const details=[];
  if(root.matches?.('details'))details.push(root);
  details.push(...root.querySelectorAll('details'));
  for(const disclosure of details){
   const summary=disclosure.querySelector(':scope > summary');if(!summary)continue;
   summary.setAttribute('aria-expanded',String(disclosure.open));
   summary.classList.add('disclosure-summary');
   summary.querySelectorAll(':scope > .disclosure-action').forEach(node=>node.remove());
   if(!summary.querySelector(':scope > .disclosure-chevron'))summary.append(chevron());
   if(disclosure.dataset.disclosureReady==='true')continue;
   disclosure.addEventListener('toggle',()=>{
    summary.setAttribute('aria-expanded',String(disclosure.open));
    document.dispatchEvent(new CustomEvent('sacocast:section-toggle'));
   });
   disclosure.dataset.disclosureReady='true';
  }
 }
 window.SacoDisclosures={init};
 document.addEventListener('DOMContentLoaded',()=>init());
})();
