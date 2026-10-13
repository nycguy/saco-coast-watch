import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../js/header-weather.js',import.meta.url),'utf8');
function setup({forecast=[],observation=null,hazards=null,alerts=[]}={}){
 const children=[];
 const host={hidden:true,replaceChildren(){children.length=0;},append(el){children.push(el);}};
 const document={
  getElementById(id){return id==='headerWeather'?host:null;},
  addEventListener(name,cb){if(name==='DOMContentLoaded')cb();},
  createElement(){return {attrs:{},setAttribute(k,v){this.attrs[k]=v;},append(node){this.caption=node.textContent;}};}
 };
 const state={weatherForecast:forecast,weatherObservation:observation,hazards,alerts};
 const window={};
 // Hold the clock fixed so an observation exactly at the freshness boundary
 // cannot become stale between fixture creation and render().
 const context={window,document,state,Date:{now:()=>now},setInterval(){}};
 vm.runInNewContext(script,context);
 return {host,children,api:window.SacoHeaderWeather,state};
}
const now=Date.now();
const period=summary=>({t:now-60000,end:now+3600000,summary});
const observed=(wind,age=60000)=>({t:now-age,wind});

test('rain and observed wind render distinct accessible graphics',()=>{
 const {host,children}=setup({forecast:[period('Rain Showers')],observation:observed(27)});
 assert.equal(host.hidden,false);
 assert.deepEqual(children.map(x=>x.caption),['Rain','Windy']);
 assert.match(children[0].attrs['aria-label'],/NWS hourly forecast/);
 assert.match(children[1].attrs['aria-label'],/Observed 27 mph/);
});
test('missing inputs show explicit unavailable state rather than an empty header',()=>{
 const {host,children}=setup();
 assert.equal(host.hidden,false);
 assert.equal(children.length,1);
 assert.equal(children[0].caption,'Weather Unavailable');
});
test('stale wind is not displayed as current observation',()=>{
 const {children}=setup({forecast:[period('Sunny')],observation:observed(40,3*3600000)});
 assert.deepEqual(children.map(x=>x.caption),['Clear / Sunny']);
});
test('forecast must cover the current time',()=>{
 const {children}=setup({forecast:[{t:now-7200000,end:now-3600000,summary:'Snow'}]});
 assert.equal(children[0].caption,'Weather Unavailable');
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
 const {children}=setup({forecast:[period('Cloudy')],hazards:{alerts:[{event:'Coastal Flood Warning'}]}});
 assert.deepEqual(children.map(x=>x.caption),['Cloudy','Coastal Flood']);
 assert.match(children[1].attrs['aria-label'],/Official NWS alert/);
});
test('direct browser NWS alerts remain visible when the published hazard snapshot has none',()=>{
 const {children}=setup({alerts:[{properties:{event:'High Surf Warning'}}]});
 assert.equal(children[0].caption,'High Surf');
 assert.match(children[0].attrs['aria-label'],/Official NWS alert/);
 assert.equal(children[0].attrs['aria-label'].includes('SacoCast hazard classification'),false);
});
test('derived event classification is labeled separately from an official alert',()=>{
 const {children}=setup({hazards:{active_modes:[{label:'High Surf / Wave Impact'}]}});
 assert.equal(children[0].caption,'High Surf');
 assert.match(children[0].attrs['aria-label'],/SacoCast hazard classification/);
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
 const {api,state,children}=setup();
 assert.equal(children[0].caption,'Weather Unavailable');
 state.weatherForecast=[period('Snow')];
 api.render();
 assert.equal(children[0].caption,'Snow');
});
test('wind threshold boundary and observation age boundary',()=>{
 const {children,state,api}=setup({forecast:[period('Cloudy')],observation:observed(7.9)});
 assert.equal(children.length,1);
 state.weatherObservation=observed(8,2*3600000);
 api.render();
 assert.equal(children.length,2);
});
