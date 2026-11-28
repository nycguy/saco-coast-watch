/* Local SVG utility icons avoid font-dependent glyphs. */
'use strict';
(function(){
 const NS='http://www.w3.org/2000/svg';
 const paths={external:'M14 4h6v6 M20 4 10 14 M10 4H4v16h16v-6',refresh:'M20 7v5h-5 M19 12a7 7 0 1 0-2 5',close:'m6 6 12 12 M18 6 6 18',download:'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',home:'m3 11 9-8 9 8 M6 9v12h12V9 M10 21v-7h4v7',water:'M3 9c3-4 6 4 9 0s6 4 9 0 M3 15c3-4 6 4 9 0s6 4 9 0'};
 function icon(name){const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('utility-icon');const p=document.createElementNS(NS,'path');p.setAttribute('d',paths[name]);svg.append(p);return svg;}
 function clean(node){const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);for(const n of nodes)n.textContent=n.textContent.replace(/[↗↻×↓]/g,'').trim();}
 function init(root=document){
  root.querySelectorAll('a[target="_blank"]').forEach(link=>{if(link.querySelector('.utility-icon'))return;clean(link);link.append(icon('external'));});
  for(const [id,name] of [['refreshBtn','refresh'],['briefClose','close'],['exportBtn','download'],['mapHome','home']]){const button=document.getElementById(id);if(button&&!button.querySelector('.utility-icon')){clean(button);button.prepend(icon(name));}}
 }
 window.SacoIcons={init,icon};document.addEventListener('DOMContentLoaded',()=>init());
})();
