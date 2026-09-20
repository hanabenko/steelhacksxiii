import * as THREE from 'three';
import {blockEnds} from './road-blocks.js';
const material=color=>new THREE.MeshStandardMaterial({color,roughness:1});
export function createBlockClosure(block){
  const group=new THREE.Group();group.userData.blockId=block.id;
  for(const end of blockEnds(block)){
    const gate=new THREE.Group();gate.position.set(end.x,0,end.z);gate.rotation.y=end.angle;group.add(gate);
    for(let x=-block.width/2+1;x<block.width/2;x+=2){
      for(const [w,h,d,y,color] of [[1.9,.16,.8,.25,'#555b62'],[1.85,1.1,.22,.9,'#fff8ee']]){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));m.position.set(x,y,0);gate.add(m);}
      for(let offset=-.6;offset<=.6;offset+=.6){const stripe=new THREE.Mesh(new THREE.BoxGeometry(.32,.95,.25),material('#f58330'));stripe.position.set(x+offset,.9,0);stripe.rotation.z=-.3;gate.add(stripe);}
    }
  }
  return group;
}
export function createPothole(x,z){
  const group=new THREE.Group();group.position.set(x,.16,z);
  const shape=new THREE.Shape(),rim=[];
  for(let i=0;i<15;i++){const a=i/15*Math.PI*2,r=1.4+(i*7%5)*.15;const point=[Math.cos(a)*r,Math.sin(a)*r*.72];rim.push(point);i?shape.lineTo(...point):shape.moveTo(...point);}shape.closePath();
  const floor=new THREE.Mesh(new THREE.ShapeGeometry(shape),material('#171b1c'));floor.rotation.x=-Math.PI/2;group.add(floor);
  for(let i=0;i<rim.length;i++){
    const a=rim[i],b=rim[(i+1)%rim.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const broken=new THREE.Mesh(new THREE.BoxGeometry(len,.22,.28),material(i%2?'#62666a':'#858581'));broken.position.set((a[0]+b[0])/2,.1,-(a[1]+b[1])/2);broken.rotation.y=Math.atan2(b[1]-a[1],b[0]-a[0]);broken.rotation.z=(i%3-1)*.1;group.add(broken);
  }
  const water=new THREE.Mesh(new THREE.CircleGeometry(.75,24),new THREE.MeshStandardMaterial({color:'#445461',roughness:.3,transparent:true,opacity:.65}));water.rotation.x=-Math.PI/2;water.position.y=.025;group.add(water);
  const ripple=new THREE.Mesh(new THREE.RingGeometry(.3,.34,32),new THREE.MeshBasicMaterial({color:'#b2c8d0',transparent:true,opacity:.3,side:THREE.DoubleSide}));ripple.rotation.x=-Math.PI/2;ripple.position.y=.035;group.add(ripple);group.userData.ripple=ripple;
  return group;
}
export function roadFootprint(block){
  const group=new THREE.Group();group.userData.blockId=block.id;
  for(let i=1;i<block.points.length;i++){
    const a=block.points[i-1],b=block.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(block.width-.7,length),new THREE.MeshBasicMaterial({color:'#338bff',transparent:true,opacity:.24,depthWrite:false,side:THREE.DoubleSide}));
    mesh.rotation.set(-Math.PI/2,0,Math.atan2(b[0]-a[0],b[1]-a[1]));mesh.position.set((a[0]+b[0])/2,.25,(a[1]+b[1])/2);group.add(mesh);
  }return group;
}
