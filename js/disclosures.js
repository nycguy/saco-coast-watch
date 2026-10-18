'use strict';
(function(){
 function init(root=document){
  const details=[];
  if(root.matches?.('details'))details.push(root);
  details.push(...root.querySelectorAll('details'));
  for(const disclosure of details){
   const summary=disclosure.querySelector(':scope > summary');if(!summary)continue;
   summary.setAttribute('aria-expanded',String(disclosure.open));
   summary.classList.add('disclosure-summary');
   let state=summary.querySelector(':scope > .disclosure-action');
   if(!state){state=document.createElement('span');state.className='disclosure-action';summary.append(state);}
   state.textContent=disclosure.open?'Hide details':'Show details';
   if(disclosure.dataset.disclosureReady==='true')continue;
   disclosure.addEventListener('toggle',()=>{
    summary.setAttribute('aria-expanded',String(disclosure.open));
    state.textContent=disclosure.open?'Hide details':'Show details';
   });
   disclosure.dataset.disclosureReady='true';
  }
 }
 window.SacoDisclosures={init};
 document.addEventListener('DOMContentLoaded',()=>init());
})();
