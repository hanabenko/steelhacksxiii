import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {replaySample,createReplayLayer} from '../src/replay.js';
const agent=(id,lon,heading=0)=>({id,type:'vehicle',longitude:lon,latitude:40,heading});
const replay={duration_s:10,frames:[{t:0,agents:[agent('a',-80,350)]},{t:10,agents:[agent('a',-79,10),agent('b',-79)]}]};
test('replay interpolates existing actors without spawning future vehicles early',()=>{
 const values=replaySample(replay,5);assert.equal(values.length,1);assert.equal(values[0].longitude,-79.5);assert.equal(values[0].heading,360);
 assert.equal(replaySample(replay,10).length,2);
});
test('replay clock pauses, wraps and can return to local preview',()=>{
 const layer=createReplayLayer(new THREE.Scene(),{center:{lon:-80,lat:40},rotation:0});
 layer.set(replay);assert.equal(layer.update(5).time,5);assert.equal(layer.update(0).time,5);assert.equal(layer.update(7).time,2);
 layer.set(null);assert.equal(layer.active,false);layer.dispose();
});
