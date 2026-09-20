import * as THREE from 'three';
import { INTERSECTIONS } from './intersections.js';
import { roadAnchor, roadWidth } from './road-layout.js';

export function addStreetFurniture({parent,map,box,mat,textures}){
  function board(text,width,height,x,y,z,rotation=0,color='#236859'){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,512,128);ctx.strokeStyle='#ffffff';ctx.lineWidth=5;ctx.strokeRect(8,8,496,112);ctx.fillStyle='#ffffff';ctx.font='bold 45px Cantarell, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,64,475);
    const texture=new THREE.CanvasTexture(canvas);textures.push(texture);const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshStandardMaterial({map:texture,side:THREE.DoubleSide}));mesh.position.set(x,y,z);mesh.rotation.y=rotation;parent.add(mesh);return mesh;
  }
  function bench(x,z){const group=new THREE.Group();group.position.set(x,0,z);parent.add(group);box(2.1,.16,.65,0,.65,0,'#b58a56',group);box(2.1,.65,.12,0,1,.3,'#b58a56',group);for(const side of [-.8,.8])box(.12,.6,.6,side,.3,0,'#364b5e',group);return group;}
  const ids=[];
  for(const point of map.points){const {tags}=point,[x,z]=point.point;
    if(tags.amenity==='bench'){bench(x,z);ids.push(point.id);}
    if(tags.amenity==='waste_basket'){box(.6,1,.6,x,.5,z,'#354f5b',parent);box(.7,.08,.7,x,1.04,z,'#72828c',parent);ids.push(point.id);}
    if(tags.amenity==='bicycle_parking'){for(let i=0;i<3;i++){const rack=new THREE.Mesh(new THREE.TorusGeometry(.5,.07,5,12,Math.PI),mat('#708498'));rack.position.set(x+i*.8,.65,z);parent.add(rack);for(const side of [-.5,.5])box(.1,.65,.1,x+i*.8+side,.32,z,'#708498',parent);}ids.push(point.id);}
    if(tags.highway==='bus_stop'){
      box(.12,3.5,.12,x,1.75,z,'#526577',parent);board('PRT · '+(tags.ref||'BUS'),1.7,.55,x,3.3,z,0,'#d5293f');
      if(tags.shelter==='yes'){box(4.8,.2,2.2,x,2.9,z+1.3,'#355777',parent);for(const dx of [-2,2])box(.12,2.8,.12,x+dx,1.4,z+2,'#50677a',parent);box(4.3,1.8,.08,x,1.65,z+2.2,'#b6d0db',parent);}
      if(tags.bench==='yes'&&!map.points.some(p=>p.tags.amenity==='bench'&&Math.hypot(p.point[0]-x,p.point[1]-z)<5))bench(x,z+1.2);
      ids.push(point.id);
    }
  }
  // Street names come from OSM; sign hardware is an illustrative addition at mapped junctions.
  for(const site of INTERSECTIONS){const a=roadAnchor('signal','north',site.id);box(.14,4.6,.14,a.x,2.3,a.z,'#506677',parent);board(site.primaryRoad,5,.55,a.x,4.35,a.z,a.rotation);board(site.crossRoad.replace('South ','S '),5,.55,a.x,3.75,a.z,a.rotation+Math.PI/2);}
  parent.userData.osmFurnitureIds=ids;
  return ids;
}
