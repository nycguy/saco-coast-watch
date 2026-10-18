import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../js/header-weather.js',import.meta.url),'utf8');
const weatherCss=readFileSync(new URL('../css/header-weather.css',import.meta.url),'utf8');
function setup({forecast=[],observation=null,hazards=null,alerts=[]}={}){
 const children=[];
 const host={hidden:true,replaceChildren(){children.length=0;},append(el){children.push(el);}};
 const document={
  getElementById(id){return id==='headerWeather'?host:null;},
  addEventListener(name,cb){if(name==='DOMContentLoaded')cb();},
  createElement(){return {attrs:{},children:[],className:'',innerHTML:'',textContent:'',setAttribute(k,v){this.attrs[k]=v;},append(...nodes){this.children.push(...nodes);},};}
 };
 const state={weatherForecast:forecast,weatherObservation:observation,hazards,alerts};
 const window={};
 // Hold the clock fixed so an observation exactly at the freshness boundary
 // cannot become stale between fixture creation and render().
 const context={window,document,state,Date:{now:()=>now},setInterval(){}};
 vm.runInNewContext(script,context);
 return {host,children,icons:()=>children.flatMap(row=>row.children||[]).filter(x=>x.attrs?.['aria-label']),readout:()=>children.find(x=>x.className==='header-weather-readout'),api:window.SacoHeaderWeather,state};
}
const now=Date.now();
const period=summary=>({t:now-60000,end:now+3600000,summary});
const observed=(wind,age=60000)=>({t:now-age,wind});

test('rain and observed wind render distinct accessible graphics',()=>{
 const {host,children,icons}=setup({forecast:[period('Rain Showers')],observation:observed(27)});
 assert.equal(host.hidden,false);
 assert.deepEqual(icons().map(x=>x.children[0].textContent),['Rain','Windy']);
 assert.match(icons()[0].attrs['aria-label'],/NWS hourly forecast/);
 assert.match(icons()[1].attrs['aria-label'],/Observed 27 mph/);
});
test('missing inputs show explicit unavailable state rather than an empty header',()=>{
 const {host,icons}=setup();
 assert.equal(host.hidden,false);
 assert.equal(icons().length,1);
 assert.equal(icons()[0].children[0].textContent,'Weather Unavailable');
});
test('stale wind is not displayed as current observation',()=>{
 const {icons}=setup({forecast:[period('Sunny')],observation:observed(40,3*3600000)});
 assert.deepEqual(icons().map(x=>x.children[0].textContent),['Clear / Sunny']);
});
test('forecast must cover the current time',()=>{
 const {icons}=setup({forecast:[{t:now-7200000,end:now-3600000,summary:'Snow'}]});
 assert.equal(icons()[0].children[0].textContent,'Weather Unavailable');
});
test('precipitation classification is exclusive and prioritizes hazards',()=>{
 const {api}=setup();
 assert.equal(api.classify('Thunderstorms and rain'),'thunder');
 assert.equal(api.classify('Freezing Rain and Snow'),'freezing');
 assert.equal(api.classify('Wintry Mix of Rain and Snow'),'sleet');
 assert.equal(api.classify('Fog'),'fog');
 assert.equal(api.classify('Blizzard'),'blizzard');
 assert.equal(api.classify('Sleet'),'sleet');
 assert.equal(api.classify('Heavy Rain'),'rain');
 assert.equal(api.classify('Mostly Cloudy'),'cloud');
 assert.equal(api.classify('Sunny'),'sun');
 assert.equal(api.classify(''),null);
});
test('official storm event is a separate graphic with official provenance',()=>{
 const {icons}=setup({forecast:[period('Cloudy')],hazards:{alerts:[{event:'Coastal Flood Warning'}]}});
 assert.deepEqual(icons().map(x=>x.children[0].textContent),['Cloudy','Coastal Flood']);
 assert.match(icons()[1].attrs['aria-label'],/Official NWS alert/);
});
test('direct browser NWS alerts remain visible when the published hazard snapshot has none',()=>{
 const {icons}=setup({alerts:[{properties:{event:'High Surf Warning'}}]});
 assert.equal(icons()[0].children[0].textContent,'High Surf');
 assert.match(icons()[0].attrs['aria-label'],/Official NWS alert/);
 assert.equal(icons()[0].attrs['aria-label'].includes('SacoCast hazard classification'),false);
});
test('derived event classification is labeled separately from an official alert',()=>{
 const {icons}=setup({hazards:{active_modes:[{label:'High Surf / Wave Impact'}]}});
 assert.equal(icons()[0].children[0].textContent,'High Surf');
 assert.match(icons()[0].attrs['aria-label'],/SacoCast hazard classification/);
});
test('official coastal event labels remain distinct across hazard families',()=>{
 const {api}=setup();
 for(const [event,label] of [
  ['High Surf Warning','High Surf'],['Storm Surge Warning','Storm Surge'],
  ['Hurricane Warning','Hurricane'],['Tropical Storm Warning','Tropical Storm'],
  ['Blizzard Warning','Blizzard'],['Nor’easter Statement','Nor’easter'],
 ]) assert.equal(api.stormLabel([{event}]),label,event);
 assert.deepEqual([
  api.stormIcon('Blizzard'),api.stormIcon('Hurricane'),api.stormIcon('Tropical Storm'),
  api.stormIcon('Nor’easter'),api.stormIcon('Coastal Flood'),api.stormIcon('High Surf'),
  api.stormIcon('Storm Surge'),api.stormIcon('Winter Storm')
 ],['blizzard','storm','storm','noreaster','coastal','surf','surge','blizzard']);
});
test('render updates when forecast becomes available',()=>{
 const {api,state,icons}=setup();
 assert.equal(icons()[0].children[0].textContent,'Weather Unavailable');
 state.weatherForecast=[period('Snow')];
 api.render();
 assert.equal(icons()[0].children[0].textContent,'Snow');
});
test('wind threshold boundary and observation age boundary',()=>{
 const {icons,state,api}=setup({forecast:[period('Cloudy')],observation:observed(7.9)});
 assert.equal(icons().length,1);
 state.weatherObservation=observed(8,2*3600000);
 api.render();
 assert.equal(icons().length,2);
});

test('humidity appears at 80 percent and above while 79 percent stays hidden',()=>{
 for(const humidity of [79,80,81]){
  const {api}=setup();
  const shown=api.observationDisplay({t:now,station:'KPWM',temp:61,humidity},now);
  assert.equal(shown.humidity,humidity>=80?humidity:null,`${humidity}%`);
 }
});

test('temperature and humidity availability are independent and stale values are withheld',()=>{
 const {api}=setup();
 assert.equal(api.observationDisplay({t:now,station:'KSFM',temp:null,humidity:81},now).temp,null);
 assert.equal(api.observationDisplay({t:now,station:'KSFM',temp:64,humidity:null},now).temp,64);
 assert.equal(api.observationDisplay({t:now-2*3600000-1,station:'KSFM',temp:64,humidity:95},now).humidity,null);
 assert.equal(api.observationDisplay({t:now+11*60000,station:'KSFM',temp:64,humidity:95},now).temp,null);
 assert.equal(api.observationDisplay({t:now,station:'KSFM',temp:'64',humidity:150},now).humidity,null);
});

test('render places current measured temperature, forecast condition, and qualified humidity together',()=>{
 const {readout}=setup({forecast:[period('Partly Cloudy')],observation:{t:now,station:'KPWM',temp:61.4,humidity:94}});
 const lines=readout().children.map(x=>x.textContent);
 assert.equal(lines[0],'61°F · Partly Cloudy · Humidity 94%');
 assert.match(lines[1],/KPWM/);
 assert.match(lines[1],/condition from NWS hourly forecast/i);
});

test('fog graphic uses layered muted mist motion with a static reduced-motion fallback',()=>{
 assert.match(script,/wx-fog-back/);
 assert.match(script,/wx-fog-front/);
 assert.match(weatherCss,/\.wx-fog-back[^\{]*\{[^}]*22s/);
 assert.match(weatherCss,/\.wx-fog-front[^\{]*\{[^}]*28s/);
 assert.match(weatherCss,/prefers-reduced-motion:reduce\)\{\.header-weather-item \*\{animation:none!important\}\}/);
});
