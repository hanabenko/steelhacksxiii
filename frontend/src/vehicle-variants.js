import * as THREE from 'three';
export function buildVehicleVariant(kind,g,{box,mat,textures}){
  const wheels=[],brakeLights=[],hazardLights=[];
  function wheel(x,z,r=.48){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,.22,12),mat('#25313a'));mesh.rotation.z=Math.PI/2;mesh.position.set(x,r+.2,z);g.add(mesh);wheels.push(mesh);}
  if(kind==='bus'){
    box(2.55,2.4,11.5,0,1.8,0,'#f1f0e7',g);box(2.58,.75,11.52,0,1,0,'#c82a43',g);box(2.5,.3,10.8,0,3.12,0,'#b6c2c8',g);
    for(const x of [-1.29,1.29])for(let z=-4.6;z<4.7;z+=1.55)box(.04,.95,1.28,x,2.3,z,'#294354',g);
    box(2.15,1.2,.05,0,2.25,5.79,'#294354',g);for(const x of [-1.25,1.25])for(const z of [-3.7,3.7])wheel(x,z);
    for(const z of [3.7,-1.4]){box(.05,1.95,1.2,1.31,1.6,z,'#233c4b',g);box(.06,1.95,.08,1.35,1.6,z,'#d5d9cf',g);}
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#c82a43';ctx.fillRect(0,0,512,128);ctx.fillStyle='white';ctx.font='bold 80px sans-serif';ctx.textAlign='center';ctx.fillText('PRT',256,95);const texture=new THREE.CanvasTexture(canvas);textures.push(texture);
    for(const side of [-1,1]){const label=new THREE.Mesh(new THREE.PlaneGeometry(3.1,.75),new THREE.MeshBasicMaterial({map:texture}));label.position.set(side*1.31,1.1,0);label.rotation.y=side*Math.PI/2;g.add(label);}
    for(const x of [-.95,.95]){const lamp=box(.3,.25,.08,x,1.1,-5.8,'#e84439',g);lamp.material=lamp.material.clone();brakeLights.push(lamp);for(const z of [-5.82,5.82]){const hazard=box(.2,.2,.08,x,1.55,z,'#ffb730',g);hazard.material=hazard.material.clone();hazard.material.emissive.setHex(0xff9400);hazard.material.emissiveIntensity=2;hazard.visible=false;hazardLights.push(hazard);}}
  }else{
    for(const z of [-.75,.75]){const tire=new THREE.Mesh(new THREE.TorusGeometry(.38,.065,6,16),mat('#263543'));tire.rotation.y=Math.PI/2;tire.position.set(0,.58,z);g.add(tire);wheels.push(tire);box(.06,.65,.06,0,.58,z,'#b9c7d0',g);}
    box(.12,.12,1.35,0,.78,0,'#efb93a',g);box(.12,.6,.12,0,1,.2,'#efb93a',g);box(.65,.08,.08,0,1.35,.65,'#485f71',g);box(.35,.1,.35,0,1.1,-.3,'#25313a',g);
    box(.48,.62,.35,0,1.68,-.1,'#4baaa5',g);const head=new THREE.Mesh(new THREE.SphereGeometry(.23,10,8),mat('#f1cb64'));head.position.set(0,2.13,.04);g.add(head);
    for(const x of [-.18,.18])box(.14,.6,.17,x,1.06,0,'#344358',g);
  }
  const avMarker=box(.35,.07,.35,0,kind==='bus'?3.35:2.4,0,'#74bec9',g);avMarker.visible=false;
  return{wheels,brakeLights,hazardLights,avMarker};
}
