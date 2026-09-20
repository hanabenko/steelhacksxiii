import * as THREE from 'three';
export function buildVehicleVariant(kind,g,{box,mat,textures}){
  const wheels=[],brakeLights=[],hazardLights=[];
  let pedalPhase=0,animateRider=()=>{};
  function wheel(x,z,r=.48){const pivot=new THREE.Group();pivot.position.set(x,r+.2,z);pivot.userData.radius=r;const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,.22,16),mat('#25313a'));mesh.rotation.z=Math.PI/2;pivot.add(mesh);g.add(pivot);wheels.push(pivot);}
  function tube(a,b,r,color,parent=g){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,1,8),mat(color));parent.add(mesh);setTube(mesh,a,b);return mesh;}
  function setTube(mesh,a,b){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);mesh.position.copy(start.add(end).multiplyScalar(.5));mesh.scale.y=delta.length();mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());}
  if(kind==='bus'){
    box(2.55,2.4,11.5,0,1.8,0,'#f1f0e7',g);box(2.58,.75,11.52,0,1,0,'#c82a43',g);box(2.5,.3,10.8,0,3.12,0,'#b6c2c8',g);
    for(const x of [-1.29,1.29])for(let z=-4.6;z<4.7;z+=1.55)box(.04,.95,1.28,x,2.3,z,'#294354',g);
    box(2.15,1.2,.05,0,2.25,5.79,'#294354',g);for(const x of [-1.25,1.25])for(const z of [-3.7,3.7])wheel(x,z);
    for(const z of [3.7,-1.4]){box(.05,1.95,1.2,1.31,1.6,z,'#233c4b',g);box(.06,1.95,.08,1.35,1.6,z,'#d5d9cf',g);}
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#c82a43';ctx.fillRect(0,0,512,128);ctx.fillStyle='white';ctx.font='bold 80px sans-serif';ctx.textAlign='center';ctx.fillText('PRT',256,95);const texture=new THREE.CanvasTexture(canvas);textures.push(texture);
    for(const side of [-1,1]){const label=new THREE.Mesh(new THREE.PlaneGeometry(3.1,.75),new THREE.MeshBasicMaterial({map:texture}));label.position.set(side*1.31,1.1,0);label.rotation.y=side*Math.PI/2;g.add(label);}
    for(const x of [-.95,.95]){const lamp=box(.3,.25,.08,x,1.1,-5.8,'#e84439',g);lamp.material=lamp.material.clone();brakeLights.push(lamp);for(const z of [-5.82,5.82]){const hazard=box(.2,.2,.08,x,1.55,z,'#ffb730',g);hazard.material=hazard.material.clone();hazard.material.emissive.setHex(0xff9400);hazard.material.emissiveIntensity=2;hazard.visible=false;hazardLights.push(hazard);}}
  }else{
    for(const z of [-.75,.75]){
      const pivot=new THREE.Group();pivot.position.set(0,.42,z);pivot.userData.radius=.42;
      const tire=new THREE.Mesh(new THREE.TorusGeometry(.38,.04,8,28),mat('#263543'));tire.rotation.y=Math.PI/2;pivot.add(tire);
      for(let i=0;i<8;i++){const a=i*Math.PI/4;tube([0,0,0],[0,Math.sin(a)*.35,Math.cos(a)*.35],.009,'#bdcbd5',pivot);}
      tube([-.09,0,0],[.09,0,0],.045,'#a9b8c2',pivot);g.add(pivot);wheels.push(pivot);
    }
    const rear=[0,.42,-.75],crank=[0,.48,-.08],seat=[0,1.03,-.3],headTube=[0,1.07,.56],front=[0,.42,.75];
    for(const [a,b] of [[rear,crank],[rear,seat],[seat,crank],[seat,headTube],[crank,headTube],[headTube,front]])tube(a,b,.035,'#efb93a');
    box(.3,.09,.3,0,1.1,-.3,'#25313a',g);tube(headTube,[0,1.22,.58],.03,'#485f71');tube([-.3,1.22,.58],[.3,1.22,.58],.03,'#485f71');
    const torso=box(.4,.57,.28,0,1.43,-.1,'#4baaa5',g);torso.rotation.x=.28;
    const head=new THREE.Mesh(new THREE.SphereGeometry(.19,12,8),mat('#c79d7c'));head.position.set(0,1.87,.08);g.add(head);
    const helmet=new THREE.Mesh(new THREE.SphereGeometry(.21,12,8,0,Math.PI*2,0,Math.PI/2),mat('#f1cb64'));helmet.position.set(0,1.91,.08);g.add(helmet);
    for(const side of [-1,1]){tube([side*.2,1.65,0],[side*.24,1.38,.28],.06,'#4baaa5');tube([side*.24,1.38,.28],[side*.28,1.22,.58],.045,'#c79d7c');}
    const limbs=[-1,1].map(side=>({side,thigh:tube([0,0,0],[0,1,0],.07,'#344358'),shin:tube([0,0,0],[0,1,0],.055,'#c79d7c'),pedal:box(.2,.05,.13,0,0,0,'#25313a',g),arm:tube([0,0,0],[0,1,0],.02,'#a9b8c2')}));
    animateRider=distance=>{
      pedalPhase+=distance/(.42*2.6);
      for(const limb of limbs){const a=pedalPhase+(limb.side===1?Math.PI:0),x=limb.side*.17;
        const foot=[x,.48+Math.cos(a)*.17,-.08+Math.sin(a)*.17],hip=[x,1.12,-.28];
        // Equal-length two-link leg, bent forward; feet remain attached to pedals.
        const dy=foot[1]-hip[1],dz=foot[2]-hip[2],d=Math.hypot(dy,dz),bend=Math.sqrt(Math.max(0,.43*.43-d*d/4));
        const knee=[x,(hip[1]+foot[1])/2+dz/d*bend,(hip[2]+foot[2])/2-dy/d*bend];
        setTube(limb.thigh,hip,knee);setTube(limb.shin,knee,foot);setTube(limb.arm,[x,.48,-.08],foot);limb.pedal.position.set(...foot);
      }
    };animateRider(0);
  }
  const avMarker=box(.35,.07,.35,0,kind==='bus'?3.35:2.4,0,'#74bec9',g);avMarker.visible=false;
  return{wheels,brakeLights,hazardLights,avMarker,animateRider};
}
export function animateVehicleWheels(model,distance){
  // Vehicle forward is local +Z; axles are local X. Rotate a stable axle pivot,
  // never the torus's local Y (which made the wheels wobble like coins).
  for(const wheel of model.wheels)wheel.rotation.x+=distance/(wheel.userData.radius||.48);
  model.animateRider?.(distance);
}
