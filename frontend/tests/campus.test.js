import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {clearOfSignals,clipSegment,containsPoint,roadPoint} from '../src/campus-geometry.js';
import {INTERSECTIONS} from '../src/intersections.js';
import {APPROACHES,placementFor} from '../src/infrastructure.js';
const map=JSON.parse(fs.readFileSync(new URL('../src/data/intersection.json',import.meta.url)));
test('campus retains Cathedral stepped heights, three dorm towers and El Jefes actual POI',()=>{
  const cathedral=map.features.find(f=>f.tags.name==='Cathedral of Learning');assert.ok(cathedral);
  const parts=map.features.filter(f=>f.tags['building:part']&&containsPoint(f.points[0],cathedral.points));
  assert.ok(parts.length>=8);assert.equal(Math.max(...parts.map(f=>Number.parseFloat(f.tags.height)||0)),163);
  for(const name of ['A','B','C'])assert.ok(map.features.some(f=>f.tags.name==='Litchfield Tower '+name&&+f.tags.height>50));
  const jefes=map.points.find(p=>/El Jefes/.test(p.tags.name||''));assert.equal(jefes.tags['addr:housenumber'],'3807');assert.equal(jefes.tags['addr:street'],'Forbes Avenue');
  assert.ok(map.features.some(f=>f.tags.building&&containsPoint(jefes.point,f.points)),'POI must sit on a retained building footprint');
  assert.ok(map.features.some(f=>f.tags.name==='Fifth Avenue'));assert.ok(map.features.some(f=>f.tags.name==='Forbes Avenue'));
});
test('tree canopy clearance applies to existing and every possible upgrade signal',()=>{
  const anchors=[[-8,-9],[8,9],[9,-8],[-9,8],...INTERSECTIONS.flatMap(site=>APPROACHES.map(zone=>{const p=placementFor('signal',zone,site.id);return[p.x,p.z];})),...map.points.filter(p=>p.tags.highway==='traffic_signals').map(p=>p.point)];
  assert.equal(clearOfSignals([-10,-10],anchors),false);
  const kept=map.points.filter(p=>p.tags.natural==='tree'&&clearOfSignals(p.point,anchors));assert.ok(kept.length>0);
  for(const tree of kept)for(const signal of anchors)assert.ok(Math.hypot(tree.point[0]-signal[0],tree.point[1]-signal[1])>=6);
});
test('road clipping keeps crossing segments and rejects out-of-map geometry',()=>{
  const bounds={minX:-10,maxX:10,minZ:-10,maxZ:10};assert.deepEqual(clipSegment([-20,0],[20,0],bounds),[[-10,0],[10,0]]);assert.equal(clipSegment([-20,20],[20,20],bounds),null);
  for(const distance of [-100,0,100]){const p=roadPoint(map.features,'Forbes Avenue','x',distance);assert.ok(p&&Number.isFinite(p.angle));assert.ok(Math.abs(p.x-distance)<.001);}
});
