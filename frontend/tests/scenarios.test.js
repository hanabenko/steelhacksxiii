import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {makeScenario,DEFAULT_CONDITIONS} from '../src/scenarios.js';
import {simulateNetwork,DEFAULT_SETTINGS,addUpgrade,exportScenario} from '../src/model.js';
import {createTraffic} from '../src/traffic.js';
import {createEnvironment} from '../src/environment.js';
import map from '../src/data/intersection.json' with {type:'json'};
const hazard={intersection:'pitt-forbes-bigelow',zone:'east'};
test('random challenges cover weather, closures and potholes within valid budgets',()=>{
 const scenarios=[.05,.25,.45,.65,.85].map(n=>makeScenario(()=>n));
 assert.equal(new Set(scenarios.map(s=>s.id)).size,5);
 for(const s of scenarios){assert.ok(s.budget>=60000&&s.budget<=100000);assert.equal(s.settings.budget,s.budget);assert.doesNotThrow(()=>simulateNetwork([],s.settings));}
 assert.equal(scenarios[0].settings.conditions.weather,'rain');assert.equal(scenarios[1].settings.conditions.weather,'storm');assert.ok(scenarios[2].settings.conditions.closure);assert.ok(scenarios[3].settings.conditions.pothole);
});
test('custom budget is enforced and exported; hazards affect paired metrics and matching repairs',()=>{
 assert.ok(addUpgrade([],'bike','east',hazard.intersection,10000).error);
 const config={...DEFAULT_SETTINGS,budget:60000,conditions:{...DEFAULT_CONDITIONS,pothole:hazard}};
 const unchanged=simulateNetwork([],config);assert.deepEqual(unchanged.before,unchanged.after);
 const repaired=simulateNetwork([{type:'repair',...hazard}],config);assert.ok(repaired.after.risk.mean<repaired.before.risk.mean);assert.ok(repaired.after.delay.mean<repaired.before.delay.mean);
 assert.equal(exportScenario([],config,null).budget,60000);
 const closed=simulateNetwork([{type:'closure',...hazard}],DEFAULT_SETTINGS);assert.ok(closed.after.throughput.mean<closed.before.throughput.mean);
 const storm=simulateNetwork([],{...DEFAULT_SETTINGS,conditions:{...DEFAULT_CONDITIONS,weather:'storm'}});const dry=simulateNetwork([],DEFAULT_SETTINGS);assert.ok(storm.before.speed.mean<dry.before.speed.mean);
});
test('weather slows traffic and construction barriers divert approaching vehicles',()=>{
 const dry=createTraffic(map.features,1),wet=createTraffic(map.features,1),blocked=createTraffic(map.features,1);
 for(const traffic of [dry,wet,blocked]){const v=traffic.vehicles[0];v.s=v.route.path.find(p=>p.x>=-45).s;}
 for(let i=0;i<900;i++){dry.update(1/60,{penn:'green',cross:'green'});wet.update(1/60,{penn:'green',cross:'green'},[],null,[],{...DEFAULT_CONDITIONS,weather:'storm'});blocked.update(1/60,{penn:'green',cross:'green'},[{type:'closure',...hazard}]);}
 assert.ok(wet.vehicles[0].speed<dry.vehicles[0].speed);assert.equal(blocked.vehicles[0].detoured,true);assert.ok(blocked.vehicles[0].speed>1);
});
test('day/night clock starts on run, follows simulation time, pauses, and can be disabled',()=>{
 const scene=new THREE.Scene();scene.background=new THREE.Color();const sun=new THREE.DirectionalLight(),ambient=new THREE.HemisphereLight();const env=createEnvironment(scene,sun,ambient);
 env.setConditions({...DEFAULT_CONDITIONS,hour:23});assert.equal(env.update(30).hour,23);env.start();assert.equal(env.update(60).hour,1);assert.equal(env.update(0).hour,1);
 env.stop();assert.equal(env.update(600).hour,23);env.start();assert.equal(env.update(30).hour,0);
 env.setConditions({...DEFAULT_CONDITIONS,hour:12,dayNight:false});assert.equal(env.update(600).hour,12);env.dispose();
});

import {ROAD_BLOCKS,blockEnds,nearestRoadPoint} from '../src/road-blocks.js';
import {createBlockClosure,createPothole} from '../src/hazard-meshes.js';
test('mapped blocks include Forbes/Fifth and closures have a barrier at each distinct end',()=>{
 for(const name of ['Forbes Avenue','Fifth Avenue'])assert.ok(ROAD_BLOCKS.some(b=>b.name===name));
 const block=ROAD_BLOCKS.find(b=>b.name==='Forbes Avenue'&&b.length>100),ends=blockEnds(block),mesh=createBlockClosure(block);
 assert.equal(mesh.children.length,2);assert.ok(Math.hypot(ends[0].x-ends[1].x,ends[0].z-ends[1].z)>50);
 for(let i=0;i<2;i++){assert.equal(mesh.children[i].position.x,ends[i].x);assert.equal(mesh.children[i].position.z,ends[i].z);assert.ok(mesh.children[i].children.length>5);}
 assert.equal(nearestRoadPoint(5000,5000),null);
 const pothole=createPothole(5,7);assert.ok(pothole.children.length>15);assert.ok(pothole.userData.ripple);assert.deepEqual(pothole.position.toArray(),[5,.16,7]);
});
test('multiple block closures and potholes persist in conditions; AV coefficients are disabled',()=>{
 const block=ROAD_BLOCKS.find(b=>b.name==='Forbes Avenue'),point=block.points[1];
 const settings={...DEFAULT_SETTINGS,conditions:{...DEFAULT_CONDITIONS,closures:[block.id],potholes:[{id:'a',x:point[0],z:point[1],intersection:block.intersection}]}};
 const base=simulateNetwork([],settings);assert.deepEqual(base,simulateNetwork([],{...settings,av:100}));
 const exported=exportScenario([],settings,null);assert.equal(exported.settings.conditions.closures.length,1);assert.equal(exported.settings.conditions.potholes.length,1);
 assert.throws(()=>simulateNetwork([],{...settings,conditions:{...settings.conditions,closures:['not-a-block']}}),/closure/);
});

test('every challenge has an actionable road hazard and matching repairs reopen only damaged closures',()=>{
 for(const n of [.05,.25,.45,.65,.85]){
  const challenge=makeScenario(()=>n),c=challenge.settings.conditions;
  assert.ok(c.pothole||c.closure?.repairable);assert.match(challenge.description,/\$8,000/);
 }
 const config={...DEFAULT_SETTINGS,demand:1200,conditions:{...DEFAULT_CONDITIONS,closure:{...hazard,repairable:true}}};
 const base=simulateNetwork([],config),fixed=simulateNetwork([{type:'repair',...hazard}],config);
 assert.ok(fixed.after.throughput.mean>base.after.throughput.mean);assert.ok(fixed.after.delay.mean<base.after.delay.mean);
 for(const wrong of [{type:'repair',...hazard,zone:'west'},{type:'repair',...hazard,intersection:'pitt-fifth-bigelow'}])assert.deepEqual(simulateNetwork([wrong],config).after,base.after);
 const workzone={...config,conditions:{...config.conditions,closure:hazard}};
 assert.deepEqual(simulateNetwork([{type:'repair',...hazard}],workzone).after,simulateNetwork([],workzone).after);
 assert.equal(config.conditions.closure.repairable,true);
});

test('matching road repair clears visible scenario barriers and restores live traffic behavior',()=>{
 const conditions={...DEFAULT_CONDITIONS,closure:{...hazard,repairable:true}},repair={type:'repair',...hazard};
 const scene=new THREE.Scene();scene.background=new THREE.Color();const env=createEnvironment(scene,new THREE.DirectionalLight(),new THREE.HemisphereLight());
 env.setConditions(conditions);const hazards=scene.children.find(c=>c.isGroup);assert.equal(hazards.children.length,1);
 env.setUpgrades([repair]);assert.equal(hazards.children.length,0);env.setUpgrades([]);assert.equal(hazards.children.length,1);env.dispose();
 const fixed=createTraffic(map.features,2),normal=createTraffic(map.features,2);
 for(let i=0;i<180;i++){fixed.update(1/60,{penn:'green',cross:'green'},[repair],null,[],conditions);normal.update(1/60,{penn:'green',cross:'green'},[],null,[],DEFAULT_CONDITIONS);}
 for(let i=0;i<2;i++){assert.equal(fixed.vehicles[i].s,normal.vehicles[i].s);assert.equal(fixed.vehicles[i].speed,normal.vehicles[i].speed);assert.equal(fixed.vehicles[i].route.id,normal.vehicles[i].route.id);}
});
