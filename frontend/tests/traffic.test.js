import test from 'node:test';
import assert from 'node:assert/strict';
import map from '../src/data/intersection.json' with {type:'json'};
import { createTraffic, campusRoutes, poseAt } from '../src/traffic.js';
import { createCollisionPreview } from '../src/collision-preview.js';
import * as THREE from 'three';
const green={penn:'green',cross:'green'};
test('campus routes follow one-way avenues and connect both Bigelow intersections',()=>{
 const routes=campusRoutes(map.features);
 for(const route of routes){assert.ok(route.length>100);for(const p of route.path)assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z));}
 for(const r of routes.filter(r=>r.id.startsWith('forbes')))assert.ok(poseAt(r,50).x<poseAt(r,100).x);
 for(const r of routes.filter(r=>r.id.startsWith('fifth')))assert.ok(poseAt(r,50).x>poseAt(r,100).x);
 const bigelow=routes.find(r=>r.id==='bigelow-south');assert.equal(bigelow.stops.length,2);
 const turn=routes.find(r=>r.id==='bigelow-to-forbes');assert.ok(turn.turnEnd>turn.turnStart);assert.ok(Math.abs(poseAt(turn,turn.length-10).angle-poseAt(routes[1],routes[1].length-10).angle)<.001);
});
test('cars accelerate gradually, brake for red, queue with a gap, and resume on green',()=>{
 const traffic=createTraffic(map.features,2),[a,b]=traffic.vehicles;
 b.route=a.route;const stop=a.route.stops[0].s;a.s=stop-35;b.s=stop-65;a.speed=7;b.speed=7;
 for(let i=0;i<1200;i++){const before=a.speed;traffic.update(1/60,{penn:'red',cross:'red'});assert.ok(Math.abs(a.speed-before)<=4.5/60+.00001);assert.ok(a.s<=stop+.6);assert.ok(a.s-b.s>=5.9);}
 assert.ok(a.speed<.1);const position=a.s;for(let i=0;i<300;i++)traffic.update(1/60,green);assert.ok(a.s>position+8);
});
test('traffic is frozen by zero dt and timestep subdivision is reproducible',()=>{
 const a=createTraffic(map.features,8),b=createTraffic(map.features,8);const initial=JSON.stringify(a.vehicles);a.update(0,green);assert.equal(JSON.stringify(a.vehicles),initial);
 for(let i=0;i<100;i++)a.update(.1,green);for(let i=0;i<300;i++)b.update(1/30,green);
 a.vehicles.forEach((v,i)=>{assert.ok(Math.abs(v.s-b.vehicles[i].s)<.00001);assert.ok(v.speed>=0);});
});
test('scripted collision progresses through impact and fire, pauses, hides and clears',()=>{
 const scene=new THREE.Scene(),preview=createCollisionPreview(scene,[new THREE.Group(),new THREE.Group()]);preview.start();assert.equal(preview.update(0),'approach');assert.equal(preview.update(1.3),'impact');assert.equal(preview.update(0),'impact');assert.equal(preview.update(2),'fire');preview.update(0,false);assert.equal(scene.children[0].visible,false);assert.equal(preview.update(10),'idle');assert.equal(scene.children[0].visible,false);
});
