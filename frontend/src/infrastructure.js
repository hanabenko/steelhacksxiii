import { DEFAULT_INTERSECTION, intersectionById } from './intersections.js';
import { roadPoint } from './campus-geometry.js';
import map from './data/intersection.json' with { type: 'json' };
import * as THREE from 'three';

export const APPROACHES = ['north', 'east', 'south', 'west'];

// These anchors describe actual street features, not nearby drop targets.
// Preview, picking, and construction all use the same geometry and transform.
export function placementFor(type, zone, intersection = DEFAULT_INTERSECTION) {
  if (!APPROACHES.includes(zone)) throw new Error('Unknown approach');
  const horizontal = zone === 'east' || zone === 'west';
  const sign = zone === 'east' || zone === 'south' ? 1 : -1;
  const along = distance => horizontal ? [sign * distance, 0] : [0, sign * distance];
  let center;
  if (type === 'crosswalk') center = along(12);
  else if (type === 'bike' || type === 'diet') {
    center = along(34);
    center[horizontal ? 1 : 0] = type === 'bike' ? 5.2 : -2.2;
  } else if (type === 'curb') {
    center = { north: [7, -12], east: [12, 7], south: [-7, 12], west: [-12, -7] }[zone];
  } else if (type === 'signal') {
    center = { north: [9, -8], east: [8, 9], south: [-9, 8], west: [-8, -9] }[zone];
  } else throw new Error('Unknown upgrade');
  const site=intersectionById(intersection);if(!site)throw new Error('Unknown intersection');
  let x=center[0]+site.origin[0],z=center[1]+site.origin[1],rotation=horizontal?0:Math.PI/2;
  if(site.id!==DEFAULT_INTERSECTION){const road=roadPoint(map.features,horizontal?site.primaryRoad:site.crossRoad,horizontal?'x':'z',horizontal?x:z);if(road){if(horizontal)z=road.z+center[1];else x=road.x+center[0];rotation=road.angle+(horizontal?-Math.PI/2:Math.PI/2);}}
  return {x,z,rotation,axis:horizontal?'x':'z'};
}

export function createUpgrade(type, zone, { preview = false, intersection = DEFAULT_INTERSECTION } = {}) {
  const anchor = placementFor(type, zone, intersection);
  const group = new THREE.Group();
  group.position.set(anchor.x, 0, anchor.z);
  group.rotation.y = anchor.rotation;
  group.userData = { type, zone, preview, intersection };
  const materials = new Map();
  function material(color) {
    const key = preview ? 'preview' : color;
    if (!materials.has(key)) materials.set(key, preview
      ? new THREE.MeshBasicMaterial({ color: 0x438aff, transparent: true, opacity: .36, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      : new THREE.MeshStandardMaterial({ color, roughness: .8 }));
    return materials.get(key);
  }
  function mesh(geometry, color, x, y, z) {
    const object = new THREE.Mesh(geometry, material(color));
    object.position.set(x, y, z);
    object.castShadow = !preview; object.receiveShadow = !preview;
    if (preview) object.renderOrder = 3;
    group.add(object); return object;
  }
  const box = (w,h,d,x,y,z,color) => mesh(new THREE.BoxGeometry(w,h,d),color,x,y,z);
  if (type === 'crosswalk') {
    const site=intersectionById(intersection),horizontal=zone==='east'||zone==='west';
    const span=horizontal?(site.primaryRoad==='Fifth Avenue'?15:13):(site.crossRoad==='South Bouquet Street'?7:13);
    box(3.5,.25,span,0,.24,0,'#e4d9bd');
    for(let z=-span/2+1;z<span/2-.4;z+=1.4) box(3,.06,.8,0,.39,z,'#fff6de');
  }
  if (type === 'bike') {
    box(36,.09,2.3,0,.32,0,'#4fbaa4');
    box(36,.03,.12,0,.39,-1.05,'#e6fff0');
    for(let x=-17;x<=17;x+=4) box(.2,.9,.2,x,.85,-1.35,'#fff4d6');
  }
  if (type === 'diet') {
    box(36,.16,3.2,0,.34,0,'#b2c79d');
    for(let x=-15;x<=15;x+=5) {
      box(2,.6,1.5,x,.72,0,'#738c77');
      box(1.65,.3,1.2,x,1.14,0,'#71ae72');
    }
  }
  if (type === 'curb') {
    const outline = new THREE.Shape();
    outline.moveTo(-2.5,-2.1);outline.lineTo(1.5,-2.1);outline.lineTo(2.5,-1.1);
    outline.lineTo(2.5,1.1);outline.lineTo(1.5,2.1);outline.lineTo(-2.5,2.1);outline.closePath();
    const geometry = new THREE.ExtrudeGeometry(outline,{depth:.45,bevelEnabled:false});
    geometry.rotateX(-Math.PI/2);
    mesh(geometry,'#d7d8bf',0,.25,0);
    box(1.4,.03,2.4,-.9,.73,0,'#e9c86b');
  }
  if (type === 'signal') {
    box(.8,.3,.8,0,.38,0,'#8b99a7');
    box(.28,7,.28,0,3.5,0,'#425368');
    box(.8,2.8,1.3,0,6.6,0,'#263445');
    for(let i=0;i<3;i++) {
      const lamp = mesh(new THREE.SphereGeometry(.39,12,8),'#172231',-.48,7.48-i*.87,0);
      lamp.userData.signalIndex = i;
      if (!preview) { lamp.material = lamp.material.clone(); lamp.material.emissiveIntensity=1.4; }
    }
  }
  if (!preview && type === 'signal') materials.get('#172231').dispose();
  group.updateMatrixWorld(true);
  return group;
}

export function colorPreview(group, { hovered = false, invalid = false } = {}) {
  group.traverse(object => {
    if (!object.isMesh) return;
    object.material.color.setHex(invalid ? 0xef685e : 0x438aff);
    object.material.opacity = hovered ? .72 : invalid ? .17 : .32;
  });
}

export function disposeUpgrade(group) {
  const materials = new Set();
  group.traverse(object => { object.geometry?.dispose(); if(object.material) materials.add(object.material); });
  materials.forEach(material=>material.dispose());
  group.removeFromParent();
}
