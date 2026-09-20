import map from '../src/data/intersection.json' with {type:'json'};
import { roadPoint } from '../src/campus-geometry.js';
import { INTERSECTIONS } from '../src/intersections.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TOOLS } from '../src/model.js';
import { APPROACHES, placementFor, createUpgrade, disposeUpgrade } from '../src/infrastructure.js';

test('every blue preview has exactly the same meshes and world bounds as the placed upgrade',()=>{
  for(const tool of TOOLS) for(const zone of APPROACHES) {
    const preview=createUpgrade(tool.id,zone,{preview:true});
    const built=createUpgrade(tool.id,zone);
    assert.deepEqual(new THREE.Box3().setFromObject(preview),new THREE.Box3().setFromObject(built));
    assert.equal(preview.children.length,built.children.length);
    preview.children.forEach((child,index)=>{
      assert.deepEqual(child.matrixWorld.elements,built.children[index].matrixWorld.elements);
      assert.deepEqual(child.geometry.getAttribute('position').array,built.children[index].geometry.getAttribute('position').array);
      assert.equal(child.material.transparent,true);
    });
    disposeUpgrade(preview);disposeUpgrade(built);
  }
});
test('crosswalk picking hits the crossing itself and rejects the old offset target',()=>{
  const preview=createUpgrade('crosswalk','east',{preview:true});
  const ray=new THREE.Raycaster(new THREE.Vector3(12,100,0),new THREE.Vector3(0,-1,0));
  assert.ok(ray.intersectObject(preview,true).length>0);
  ray.set(new THREE.Vector3(23,100,0),new THREE.Vector3(0,-1,0));
  assert.equal(ray.intersectObject(preview,true).length,0);
  const anchor=placementFor('crosswalk','north'),road=roadPoint(map.features,'Bigelow Boulevard','z',-12);
  assert.equal(anchor.x,road.x);assert.equal(anchor.z,road.z);assert.equal(anchor.rotation,road.angle-Math.PI/2);
  disposeUpgrade(preview);
});
test('each infrastructure type is pickable on its own visible footprint',()=>{
  for(const tool of TOOLS)for(const zone of APPROACHES){
    const preview=createUpgrade(tool.id,zone,{preview:true}),p=placementFor(tool.id,zone);
    const ray=new THREE.Raycaster(new THREE.Vector3(p.x,100,p.z),new THREE.Vector3(0,-1,0));
    assert.ok(ray.intersectObject(preview,true).length>0,`${tool.id} ${zone}`);
    disposeUpgrade(preview);
  }
});


test('crossings are perpendicular to each mapped approach and reach both sidewalks',()=>{
 for(const site of INTERSECTIONS)for(const zone of APPROACHES){
  const anchor=placementFor('crosswalk',zone,site.id),mesh=createUpgrade('crosswalk',zone,{intersection:site.id});
  const direction=new THREE.Vector3(0,0,1).applyEuler(mesh.rotation);
  const tangent=new THREE.Vector3(Math.sin(anchor.angle),0,Math.cos(anchor.angle));assert.ok(Math.abs(direction.dot(tangent))<1e-10);
  assert.ok(mesh.children[0].geometry.parameters.depth>anchor.width);
  const center=roadPoint(map.features,anchor.name,anchor.axis,anchor.coordinate);assert.ok(Math.hypot(anchor.x-center.x,anchor.z-center.z)<1e-6);disposeUpgrade(mesh);
 }
});

test('all signal lenses face out of the intersection along their approach road',()=>{
 for(const site of INTERSECTIONS)for(const zone of APPROACHES){
  const anchor=placementFor('signal',zone,site.id),group=createUpgrade('signal',zone,{intersection:site.id});
  const lamp=group.children.find(child=>child.userData.signalIndex===0);
  const face=lamp.getWorldPosition(new THREE.Vector3()).sub(group.position);face.y=0;face.normalize();
  const outward=new THREE.Vector3(anchor.x-site.origin[0],0,anchor.z-site.origin[1]);
  assert.ok(face.dot(outward)>0,site.name+' '+zone+' must face away from center');
  assert.ok(Math.abs(face.x*Math.cos(anchor.angle)-face.z*Math.sin(anchor.angle))<1e-9,'face follows road tangent');
  disposeUpgrade(group);
 }
});
