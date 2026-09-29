import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/hazards.js',import.meta.url),'utf8');

function loadContext(state={hazards:{active_modes:[]},alerts:[]}){
  const context=vm.createContext({state,console,Date,Math,Number,Set});
  vm.runInContext(source,context,{filename:'js/hazards.js'});
  return context;
}

const mode=code=>({code,label:code,basis:'test'});

test('displayed event mode titles preserve priority and combinations',()=>{
  const {modeTitle}=loadContext();
  assert.equal(modeTitle([mode('tropical'),mode('winter')]),'Tropical Cyclone Mode');
  assert.equal(modeTitle([mode('winter'),mode('coastal_flood')]),'Winter Coastal Storm Mode');
  assert.equal(modeTitle([mode('winter')]),'Winter Storm Mode');
  assert.equal(modeTitle([mode('coastal_flood'),mode('high_wind')]),'Coastal Storm Mode');
  assert.equal(modeTitle([mode('heavy_rain')]),'Heavy Rain Mode');
  assert.equal(modeTitle([mode('high_wind')]),'High Wind Mode');
  assert.equal(modeTitle([mode('extreme_cold')]),'Extreme Cold Mode');
  assert.equal(modeTitle([mode('coastal_flood')]),'Coastal Storm Mode');
  assert.equal(modeTitle([]),'Coastal Storm Mode');
});

test('live NWS alerts augment backend modes without duplicates',()=>{
  const state={
    hazards:{active_modes:[{code:'winter',label:'Winter Storm',basis:'backend'}]},
    alerts:[
      {properties:{event:'Winter Storm Warning'}},
      {properties:{event:'Coastal Flood Watch'}},
      {properties:{event:'High Wind Warning'}},
      {properties:{event:'Tropical Storm Warning'}}
    ]
  };
  const {hazardModeList}=loadContext(state);
  const modes=hazardModeList();
  const codes=modes.map(item=>item.code);
  assert.deepEqual([...codes].sort(),['coastal_flood','high_wind','tropical','winter']);
  assert.equal(codes.filter(code=>code==='winter').length,1);
});

test('routine state has no adaptive backend modes',()=>{
  const {hazardModeList}=loadContext({hazards:{active_modes:[]},alerts:[]});
  assert.equal(hazardModeList().length,0);
});
