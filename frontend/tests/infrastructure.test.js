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
  assert.deepEqual(placementFor('crosswalk','north'),{x:0,z:-12,rotation:Math.PI/2,axis:'z'});
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
