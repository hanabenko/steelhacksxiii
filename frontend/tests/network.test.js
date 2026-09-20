import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {INTERSECTIONS} from '../src/intersections.js';
import {addUpgrade,simulateNetwork,DEFAULT_SETTINGS,exportScenario,costOf} from '../src/model.js';
import {createUpgrade,placementFor,disposeUpgrade} from '../src/infrastructure.js';
import {runSimulation} from '../src/simulation.js';
test('identical upgrades coexist at three sites while duplicates and shared overspending are rejected',()=>{
 let items=[];for(const site of INTERSECTIONS){items=addUpgrade(items,'crosswalk','north',site.id).items;assert.ok(addUpgrade(items,'crosswalk','north',site.id).error);}assert.equal(items.length,3);assert.equal(costOf(items),36000);assert.ok(addUpgrade(items,'bike','east','unknown').error);
 items=addUpgrade(items,'diet','east',INTERSECTIONS[0].id).items;items=addUpgrade(items,'diet','east',INTERSECTIONS[1].id).items;assert.equal(costOf(items),92000);assert.match(addUpgrade(items,'crosswalk','east',INTERSECTIONS[2].id).error,/budget/);
 const exported=exportScenario(items,DEFAULT_SETTINGS,null);assert.equal(exported.intersections.length,3);assert.equal(exported.upgrades[2].intersection,INTERSECTIONS[2].id);
});
test('multi-site paired trials isolate edits and combine per-site metrics reproducibly',()=>{
 const items=[{type:'crosswalk',zone:'east',intersection:INTERSECTIONS[1].id},{type:'bike',zone:'west',intersection:INTERSECTIONS[2].id}];const r=simulateNetwork(items);assert.deepEqual(r,simulateNetwork(items));assert.deepEqual(r.intersections[0].before,r.intersections[0].after);assert.ok(r.intersections[1].after.risk.mean<r.intersections[1].before.risk.mean);assert.ok(r.intersections[2].after.risk.mean<r.intersections[2].before.risk.mean);
 for(const phase of ['before','after']){assert.ok(Math.abs(r[phase].throughput.mean-r.intersections.reduce((n,s)=>n+s[phase].throughput.mean,0))<1e-8);assert.ok(Math.abs(r[phase].risk.mean-r.intersections.reduce((n,s)=>n+s[phase].risk.mean,0)/3)<1e-8);}
 assert.deepEqual(simulateNetwork([]).before,simulateNetwork([]).after);assert.throws(()=>simulateNetwork([{type:'crosswalk',zone:'north',intersection:'missing'}]));
});
test('every site uses identical preview/built transforms at distinct mapped locations',()=>{
 for(const site of INTERSECTIONS)for(const type of ['crosswalk','bike','curb','signal','diet'])for(const zone of ['north','south','east','west']){const preview=createUpgrade(type,zone,{preview:true,intersection:site.id}),built=createUpgrade(type,zone,{intersection:site.id});assert.deepEqual(new THREE.Box3().setFromObject(preview),new THREE.Box3().setFromObject(built));const p=placementFor(type,zone,site.id);assert.ok(Math.hypot(p.x-site.origin[0],p.z-site.origin[1])<65);disposeUpgrade(preview);disposeUpgrade(built);}
 assert.notDeepEqual(placementFor('crosswalk','north',INTERSECTIONS[0].id),placementFor('crosswalk','north',INTERSECTIONS[1].id));
});
test('network adapter rejects a backend that silently returns only one site',async()=>{
 const incomplete=simulateNetwork([]);incomplete.intersections.pop();await assert.rejects(runSimulation([],DEFAULT_SETTINGS,{endpoint:'/simulate',fetchImpl:async()=>({ok:true,json:async()=>incomplete})}),/all three/);
});
