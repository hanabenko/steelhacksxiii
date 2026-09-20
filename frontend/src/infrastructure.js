import { roadAnchor, sampleAnchor } from './road-layout.js';
import { DEFAULT_INTERSECTION, intersectionById } from './intersections.js';
import { roadPoint } from './campus-geometry.js';
import map from './data/intersection.json' with { type: 'json' };
import * as THREE from 'three';

export const APPROACHES = ['north', 'east', 'south', 'west'];

// These anchors describe actual street features, not nearby drop targets.
// Preview, picking, and construction all use the same geometry and transform.
export function placementFor(type, zone, intersection = DEFAULT_INTERSECTION) {
  if (!APPROACHES.includes(zone)) throw new Error('Unknown approach');
  if (!intersectionById(intersection)) throw new Error('Unknown intersection');
  return roadAnchor(type,zone,intersection);
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
  const box = (w,h,d,x,y,z,color) => mesh(new THREE.BoxGeometry(w,h,d,['bike','diet'].includes(type)?Math.max(1,Math.ceil(w/2)):1),color,x,y,z);
  if(type==='closure'){
    for(let z=-anchor.width/2+1;z<anchor.width/2;z+=2){
      box(.7,.18,1.9,0,.25,z,'#535a62');box(.28,1.2,1.85,0,.95,z,'#fff5e8');
      for(let stripe=-.65;stripe<=.65;stripe+=.65)box(.31,.75,.3,0,1,z+stripe,'#f57b26');
    }
  }
  if(type==='repair')box(6,.04,anchor.width-1,0,.17,0,'#53565b');
  if (type === 'crosswalk') {
    const span=anchor.width+1;
    box(3.5,.25,span,0,.24,0,'#e4d9bd');
    for(let z=-span/2+1;z<span/2-.4;z+=1.4) box(3,.06,.8,0,.39,z,'#fff6de');
  }
  if (type === 'shelter') {
    box(5,.15,2,0,.25,0,'#d1d8df');box(5,.2,2.3,0,3,0,'#335477');
    for(const x of [-2.2,2.2])box(.12,2.8,.12,x,1.6,.8,'#547086');
    box(4.6,1.8,.08,0,1.7,.85,'#aac8d6');box(3,.12,.6,0,.9,.3,'#d5aa69');
    for(const x of [-1,1])box(.12,.7,.4,x,.52,.3,'#344559');
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
  // Deform long upgrades onto the same curved centerline used by the roadway.
  if(['bike','diet'].includes(type))for(const child of group.children){
    const vertices=child.geometry.attributes.position,c=Math.cos(anchor.rotation),s=Math.sin(anchor.rotation);
    for(let i=0;i<vertices.count;i++){
      const point=sampleAnchor(anchor,vertices.getX(i)+child.position.x,vertices.getZ(i)+child.position.z);if(!point)continue;
      const dx=point.x-anchor.x,dz=point.z-anchor.z;
      vertices.setX(i,c*dx-s*dz-child.position.x);vertices.setZ(i,s*dx+c*dz-child.position.z);
    }
    vertices.needsUpdate=true;child.geometry.computeVertexNormals();child.geometry.computeBoundingSphere();
  }
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
