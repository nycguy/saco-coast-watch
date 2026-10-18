import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const now=Date.UTC(2026,9,18,16,0,0),fresh=now-60_000;
class FixedDate extends Date {static now(){return now;}}
class Element {
 constructor(){this.children=[];this.hidden=false;this.className='';this.textContent='';this.style={};this.attributes={};const classes=new Set();this.classList={add(...items){items.forEach(x=>classes.add(x));},remove(...items){items.forEach(x=>classes.delete(x));},contains(item){return classes.has(item);}};}
 append(child){this.children.push(child);}
 replaceChildren(...children){this.children=[...children];}
 setAttribute(name,value){this.attributes[name]=value;}
}
const section=new Element(),list=new Element();
const context={Date:FixedDate,Number,Math,String,Array,Object,document:{querySelector:()=>section,createElement:()=>new Element()},$:()=>list,now:()=>now,dayTime:()=> 'Oct 18, 12:00 PM'};
vm.runInNewContext(readFileSync(new URL('../js/alerts.js',import.meta.url),'utf8')+'\nglobalThis.api={assessNwsAlertFeed,renderAlerts,NWS_SEVERITY_CLASS};',context);
const {assessNwsAlertFeed:assess,renderAlerts:render}=context.api;
function alert(severity='Minor',overrides={}){return{properties:{event:`${severity||'Unspecified'} alert`,severity,expires:new Date(now+60*60_000).toISOString(),effective:new Date(now-60*60_000).toISOString(),headline:'Official NWS alert headline',...overrides}};}
function feed(features,opts={}){return assess({features},{nowMs:now,fetchedAtMs:fresh,...opts});}
function setState({alerts=[],lastFetched=fresh,error=null}={}){context.state={alerts,lastFetched:{alerts:lastFetched},errors:error?{alerts:error}:{}};section.hidden=false;section.className='panel alertpanel';list.replaceChildren();}

test('a valid zero-alert response hides the entire card without a placeholder',()=>{
 setState();context.state.alerts=[];render();
 assert.equal(section.hidden,true);assert.equal(list.children.length,0);
 assert.equal(feed([]).status,'none');
});

for(const [severity,css] of Object.entries({Minor:'minor',Moderate:'moderate',Severe:'severe',Extreme:'extreme'}))test(`${severity} NWS alert selects its own full-card severity class`,()=>{
 const result=feed([alert(severity)]);assert.equal(result.status,'active');assert.equal(result.severity,severity);
 setState({alerts:[alert(severity)]});render();assert.equal(section.classList.contains(`alertpanel--${css}`),true);
 assert.match(list.children[0].textContent,new RegExp(severity));
});

test('multiple active alerts remain accessible and sort most severe first',()=>{
 const alerts=[alert('Minor'),alert('Extreme'),alert('Moderate'),alert('Severe')];
 const result=feed(alerts);assert.deepEqual(Array.from(result.alerts,x=>x.severity),['Extreme','Severe','Moderate','Minor']);
 setState({alerts});render();assert.equal(list.children.length,5);assert.equal(list.children[1].children[0].textContent,'Extreme alert');
});

test('expired, future, and canceled alerts do not appear active',()=>{
 const rows=[alert('Severe',{expires:new Date(now-1).toISOString()}),alert('Extreme',{effective:new Date(now+1).toISOString()}),alert('Moderate',{messageType:'Cancel'})];
 assert.equal(feed(rows).status,'none');
});

test('an active alert without severity is retained and labeled unknown without fabricating a level',()=>{
 const unknown=alert(null,{severity:null});const result=feed([unknown]);
 assert.equal(result.status,'active');assert.equal(result.severity,null);assert.equal(result.alerts[0].severity,null);
 setState({alerts:[unknown]});render();assert.equal(section.classList.contains('alertpanel--unknown'),true);
 assert.match(list.children[0].textContent,/Severity unavailable/);assert.match(list.children[1].children[1].textContent,/severity unavailable/i);
});

test('a failed alert feed stays visible as unavailable rather than claiming no alerts',()=>{
 setState({error:'network failure'});render();
 assert.equal(section.hidden,false);assert.equal(section.classList.contains('alertpanel--unknown'),true);
 assert.match(list.children[0].textContent,/status unavailable/i);assert.doesNotMatch(list.children[0].textContent,/no active alerts/i);
 assert.equal(feed([],{error:'network failure'}).status,'unavailable');
});

test('stale, future-dated, or malformed feed data is unavailable, not an all-clear',()=>{
 assert.equal(feed([],{fetchedAtMs:now-6*60_000}).status,'unavailable');
 assert.equal(feed([],{fetchedAtMs:now+11*60_000}).status,'unavailable');
 assert.equal(assess({features:'bad'},{nowMs:now,fetchedAtMs:fresh}).status,'unavailable');
 assert.equal(feed([{properties:{event:'Malformed with no expiration',severity:'Extreme'}}]).status,'unavailable');
});

test('a fresh valid active response restores the card after a valid empty response',()=>{
 setState();render();assert.equal(section.hidden,true);
 setState({alerts:[alert('Severe')]});render();assert.equal(section.hidden,false);assert.equal(section.classList.contains('alertpanel--severe'),true);
});
