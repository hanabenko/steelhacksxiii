import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { vehicleBlocksWalk, pedestrianContact, recordPedestrianContact } from '../src/pedestrian-safety.js';
import { updatePedestrianReaction } from '../src/pedestrian-reactions.js';
import { buildVehicleVariant, animateVehicleWheels } from '../src/vehicle-variants.js';
import { createTraffic, poseAt } from '../src/traffic.js';
import map from '../src/data/intersection.json' with {type:'json'};
const car=(z=-12)=>({kind:'car',length:4.5,enabled:true,speed:7,pose:{x:0,z,angle:0}});

test('pedestrians wait outside a moving vehicle corridor, then resume after a clear gap',()=>{
 const person={p:-3},v=car();
 for(let i=0;i<120;i++)updatePedestrianReaction(person,0,1/60,{x:person.p,z:0},null,[v],{x:person.p+2,z:0});
 assert.equal(person.p,-3);assert.equal(person.waitingForTraffic,true);assert.equal(person.velocity,0);
 v.pose.z=20;
 for(let i=0;i<240;i++)updatePedestrianReaction(person,0,1/60,{x:person.p,z:0},null,[v],{x:person.p+2,z:0});
 assert.ok(person.p>-2);assert.equal(person.waitingForTraffic,false);
 assert.equal(vehicleBlocksWalk({x:8,z:0},{x:10,z:0},car()),false);
});

test('swept contact catches a vehicle passing through a person and records one accident per injury',()=>{
 const v=car(8);v.previousPose={x:0,z:-8,angle:0};const person={p:0};
 assert.equal(pedestrianContact({x:0,z:0},{x:0,z:0},v),true);
 assert.equal(pedestrianContact({x:4,z:0},{x:4,z:0},v),false);
 assert.equal(recordPedestrianContact(person,{x:0,z:0},{x:0,z:0},[v]),v);
 assert.equal(person.injured,true);assert.equal(v.speed,0);assert.equal(v.crashWait,2);
 assert.equal(recordPedestrianContact(person,{x:0,z:0},{x:0,z:0},[v]),null);
 const frozen=JSON.stringify(person);updatePedestrianReaction(person,0,0,{x:0,z:0},null);assert.equal(JSON.stringify(person),frozen);
});

test('vehicle braking yields to a pedestrian without crossing their position',()=>{
 const traffic=createTraffic(map.features,1),v=traffic.vehicles[0];v.speed=7;
 const person=poseAt(v.route,v.s+24),start=v.s;
 for(let i=0;i<600;i++)traffic.update(1/60,{penn:'green',cross:'green'},[],null,[person]);
 assert.ok(v.s<start+24-v.length/2);assert.ok(v.speed<.1);assert.equal(v.reacting,true);
 const stopped=v.s;for(let i=0;i<180;i++)traffic.update(1/60,{penn:'green',cross:'green'});assert.ok(v.s>stopped+1);
});

test('bicycle wheels rotate around a fixed axle, roll by distance/radius, and freeze with zero travel',()=>{
 const g=new THREE.Group(),mat=color=>new THREE.MeshStandardMaterial({color});
 const box=(w,h,d,x,y,z,color,parent)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);parent.add(m);return m;};
 const bike=buildVehicleVariant('bike',g,{box,mat,textures:[]});
 const before=bike.wheels.map(w=>w.position.clone());animateVehicleWheels(bike,.42*Math.PI);
 for(const [i,w] of bike.wheels.entries()){assert.ok(Math.abs(w.rotation.x-Math.PI)<1e-10);assert.equal(w.rotation.y,0);assert.equal(w.rotation.z,0);assert.deepEqual(w.position,before[i]);assert.ok(w.children.length>8);}
 const rotations=bike.wheels.map(w=>w.rotation.x);animateVehicleWheels(bike,0);assert.deepEqual(bike.wheels.map(w=>w.rotation.x),rotations);
});
