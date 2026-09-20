import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import map from '../src/data/intersection.json' with {type:'json'};
import { INTERSECTIONS } from '../src/intersections.js';
import { createUpgrade, placementFor, disposeUpgrade } from '../src/infrastructure.js';
import { roadPoint } from '../src/campus-geometry.js';
import { nearestIntersection } from '../src/road-layout.js';
import { createTraffic } from '../src/traffic.js';
import { TOOLS, COST_DATA, exportScenario, DEFAULT_SETTINGS } from '../src/model.js';

test('mapped street furniture retains source IDs, shelter tags and field coverage',()=>{
 for(const kind of ['bench','bicycle_parking','waste_basket'])assert.ok(map.points.some(p=>p.tags.amenity===kind&&p.id));
 const stops=map.points.filter(p=>p.tags.highway==='bus_stop');assert.ok(stops.length>2);assert.ok(stops.some(p=>p.tags.shelter==='yes'));assert.ok(stops.some(p=>p.tags.shelter==='no'));
 const traffic=createTraffic(map.features);for(const route of traffic.routes)for(const p of route.path){assert.ok(p.x>=map.bounds.minX&&p.x<=map.bounds.maxX);assert.ok(p.z>=map.bounds.minZ&&p.z<=map.bounds.maxZ);}
});
test('curved protected lanes follow the mapped road at their surface vertices',()=>{
 for(const site of INTERSECTIONS)for(const zone of ['north','east','south','west']){
  const group=createUpgrade('bike',zone,{intersection:site.id}),anchor=placementFor('bike',zone,site.id),surface=group.children[0],vertices=surface.geometry.attributes.position;
  for(let i=0;i<vertices.count;i++){
   const p=new THREE.Vector3().fromBufferAttribute(vertices,i).applyMatrix4(surface.matrixWorld);
   // Closest centerline point has a bounded lateral offset matching the curbside lane.
   const center=roadPoint(map.features,anchor.name,anchor.axis,anchor.axis==='x'?p.x:p.z);
   assert.ok(center);assert.ok(Math.hypot(p.x-center.x,p.z-center.z)<anchor.width/2+1);
  }disposeUpgrade(group);
 }
});
test('camera proximity selects each junction and the catalog replaces duplicate signals',()=>{
 for(const site of INTERSECTIONS)assert.equal(nearestIntersection(...site.origin,INTERSECTIONS).id,site.id);
 assert.ok(!TOOLS.some(t=>t.id==='signal'));assert.ok(TOOLS.some(t=>t.id==='shelter'));
 assert.equal(COST_DATA.area,'Oakland, Pittsburgh, Pennsylvania');assert.equal(COST_DATA.sources.find(s=>s.reportedProjectTotal).reportedProjectTotal,110000);
 assert.equal(exportScenario([],DEFAULT_SETTINGS,null).costBasis.status,'planning-estimates-not-bid-prices');
});
test('mixed traffic has buses and bicycles with appropriate dimensions; buses dwell at OSM stops',()=>{
 const traffic=createTraffic(map.features,42,map.points);assert.deepEqual(new Set(traffic.vehicles.map(v=>v.kind)),new Set(['car','bus','bike']));
 const bus=traffic.vehicles.find(v=>v.kind==='bus'&&v.route.busStops.length);assert.ok(bus);assert.ok(bus.length>10);assert.ok(traffic.vehicles.find(v=>v.kind==='bike').desired<bus.desired);
 for(const v of traffic.vehicles)v.enabled=v===bus;
 const stop=bus.route.busStops[0];bus.s=stop.s-.7;bus.speed=0;
 traffic.update(.02,{penn:'green',cross:'green'});assert.ok(bus.dwell>0);const position=bus.s;
 traffic.update(2,{penn:'green',cross:'green'});assert.equal(bus.s,position);
 traffic.update(6,{penn:'green',cross:'green'});assert.ok(bus.s>position);assert.ok(bus.served.includes(stop.id));
});
