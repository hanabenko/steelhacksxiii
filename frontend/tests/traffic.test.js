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
 const scene=new THREE.Scene(),preview=createCollisionPreview(scene,[new THREE.Group(),new THREE.Group()]);preview.start();assert.equal(preview.update(0),'approach');assert.equal(preview.update(1.3),'impact');assert.equal(preview.update(0),'impact');assert.equal(preview.update(.5),'fire');preview.update(0,false);assert.equal(scene.children[0].visible,false);assert.equal(preview.update(10),'idle');assert.equal(scene.children[0].visible,false);
});

import { updatePedestrianReaction } from '../src/pedestrian-reactions.js';
test('an incident stops an approaching queue on green, leaves distant traffic alone, and clears',()=>{
 const traffic=createTraffic(map.features,3),[lead,following,distant]=traffic.vehicles;
 following.route=lead.route;
 lead.s=lead.route.path.find(p=>p.x>=-40).s;following.s=lead.s-22;lead.speed=7;following.speed=7;
 const incident={x:0,z:0,radius:8,age:1};const distantStart=distant.s;
 for(let i=0;i<600;i++){
  const speed=lead.speed;traffic.update(1/60,green,[],incident);
  assert.ok(lead.pose.x< -10);assert.ok(lead.s-following.s>=5.9);assert.ok(Math.abs(speed-lead.speed)<=7/60+.00001);
 }
 assert.equal(lead.reacting,true);assert.ok(lead.speed<.2);assert.ok(distant.s>distantStart+20);assert.equal(distant.reacting,false);
 const stopped=lead.s;for(let i=0;i<300;i++)traffic.update(1/60,green);assert.ok(lead.s>stopped+8);assert.equal(lead.reacting,false);
});
test('pedestrians retreat on the sidewalk, wait, respect pause, and resume after clearance',()=>{
 const person={p:-4},incident={x:0,z:0,radius:8};
 for(let i=0;i<240;i++)updatePedestrianReaction(person,0,1/60,{x:person.p,z:9},incident);
 assert.ok(person.p< -8);assert.equal(person.reacting,true);assert.ok(person.velocity<0);
 const frozen=JSON.stringify(person);updatePedestrianReaction(person,0,0,{x:person.p,z:9},incident);assert.equal(JSON.stringify(person),frozen);
 for(let i=0;i<1200;i++)updatePedestrianReaction(person,0,1/60,{x:person.p,z:9},incident);
 assert.ok(Math.abs(person.velocity)<.01);const waiting=person.p;
 for(let i=0;i<360;i++)updatePedestrianReaction(person,0,1/60,{x:person.p,z:9},null);
 assert.ok(person.p>waiting+1);assert.equal(person.reacting,false);
 const far={p:-70};updatePedestrianReaction(far,1,1,{x:-70,z:9},incident);assert.equal(far.reacting,false);assert.ok(far.p> -70);
});

import {detourRoute,makeRoute} from '../src/traffic.js';
test('hazard detours join a clear forward lane and reject blocked alternatives',()=>{
 const line=(id,z)=>makeRoute(id,Array.from({length:101},(_,x)=>({x:x*2,z})),'x');
 const route=line('original',0),alternative=line('other',4),vehicle={route,s:0};
 const pothole={x:50,z:0};
 const detour=detourRoute(vehicle,[route,alternative],[pothole]);
 assert.ok(detour);assert.equal(detour.id,'other');assert.equal(poseAt(detour,detour.length).z,4);
 assert.equal(detourRoute(vehicle,[route,alternative],[pothole,{x:50,z:4}]),null);
 assert.equal(detourRoute(vehicle,[route],[pothole]),null);
});

test('collision clears two seconds after impact even while paused, and can restart',()=>{
 const scene=new THREE.Scene(),preview=createCollisionPreview(scene,[new THREE.Group(),new THREE.Group()]);
 preview.start();assert.equal(preview.update(1.2),'impact');assert.ok(preview.incident);
 assert.equal(preview.update(0,true,1.99),'fire');assert.ok(preview.incident);
 assert.equal(preview.update(0,true,.02),'idle');assert.equal(preview.incident,null);assert.equal(scene.children[0].visible,false);
 preview.start();assert.equal(preview.update(0),'approach');preview.clear();assert.equal(preview.incident,null);assert.equal(scene.children[0].visible,false);
});

test('short collision preview exposes a real obstacle to nearby traffic and pedestrians, then clears it',()=>{
 const scene=new THREE.Scene(),preview=createCollisionPreview(scene,[new THREE.Group(),new THREE.Group()]);
 const traffic=createTraffic(map.features,1),v=traffic.vehicles[0];v.speed=5;
 const ahead=poseAt(v.route,v.s+20);preview.start(ahead.x,ahead.z);preview.update(1.2);
 traffic.update(.1,green,[],preview.incident);assert.equal(v.reacting,true);
 const person={p:0};updatePedestrianReaction(person,0,.1,{x:ahead.x+3,z:ahead.z},preview.incident);
 assert.equal(person.reacting,true);
 preview.update(0,true,2.01);assert.equal(preview.incident,null);
 traffic.update(.1,green,[],preview.incident);assert.equal(v.reacting,false);
});
