import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import map from './data/intersection.json';
import { random } from './model.js';
import { createArchitecture } from './architecture.js';
import { signalState } from './signals.js';

export function createIntersection(container, onPlace, onEvent) {
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#d8e7f0');
  const camera=new THREE.OrthographicCamera(-110,110,85,-85,.1,1000);
  camera.position.set(130,155,150); camera.lookAt(0,0,0);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label','Interactive 3D model of Penn Avenue and 21st Street. Use approach buttons to place selected upgrades with a keyboard.');
  container.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI/2.2;controls.minZoom=.55;controls.maxZoom=3;controls.target.set(0,0,0);
  scene.add(new THREE.HemisphereLight(0xffffff,0xb5bea8,1.7));
  const sun=new THREE.DirectionalLight(0xfffaf1,2);sun.position.set(-80,140,70);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-180,right:180,top:180,bottom:-180,far:400});sun.shadow.bias=-.001;scene.add(sun);
  const materials=new Map();
  const mat=color=>{if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.85}));return materials.get(color);};
  function box(w,h,d,x,y,z,color,parent=scene){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function line(points,color,width=1,parent=scene){for(let i=1;i<points.length;i++){const [x,z]=points[i-1],[xx,zz]=points[i],len=Math.hypot(xx-x,zz-z);const m=box(width,.045,len,(x+xx)/2,.12,(z+zz)/2,color,parent);m.rotation.y=Math.atan2(xx-x,zz-z);}}
  box(380,1,310,0,-1,0,'#c5dacd');
  const roads=new THREE.Group();scene.add(roads);
  const roadFeatures=map.features.filter(f=>f.tags.highway);
  for(const f of roadFeatures){line(f.points,'#e7e3d7',20,roads);line(f.points,'#65758a',13.5,roads);}
  // Layer street surfaces slightly above sidewalks to avoid coplanar flicker.
  roads.children.forEach((mesh,i)=>{mesh.position.y=mesh.material.color.getHexString()==='65758a'?.19:.08;mesh.receiveShadow=true;mesh.castShadow=false;});
  const rng=random(14), buildings=new THREE.Group();scene.add(buildings);
  const colors=['#8babcd','#df9586','#e8c36c','#b4c8dc','#e4d4ba','#7cb5bb'];
  const architecture=createArchitecture(buildings,mat);
  let buildingIndex=0;
  for(const f of map.features.filter(f=>f.tags.building)){
    if(f.points.length<4)continue;
    const shape=new THREE.Shape();f.points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));
    const height=Number.parseFloat(f.tags.height)||Number.parseFloat(f.tags['building:levels'])*3.2||6+rng()*9;
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});geometry.rotateX(-Math.PI/2);
    const color=colors[Math.floor(rng()*colors.length)];
    const building=new THREE.Mesh(geometry,[mat('#aeb9c1'),mat(color)]);building.castShadow=true;building.receiveShadow=true;buildings.add(building);
    architecture.add(f.points,height,['#3864b1','#cd6958','#d5a22d','#427f84'][buildingIndex%4],buildingIndex++);
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,35),new THREE.LineBasicMaterial({color:0xaab2a1,transparent:true,opacity:.3}));buildings.add(edge);
    const center=f.points.reduce((a,p)=>[a[0]+p[0]/f.points.length,a[1]+p[1]/f.points.length],[0,0]);
    box(3,1.1,2,center[0],height+.5,center[1],'#8e9ca7',buildings);
    for(const offset of [-.7,.7]){
      const fan=new THREE.Mesh(new THREE.CylinderGeometry(.48,.48,.08,12),mat('#4d626f'));
      fan.position.set(center[0]+offset,height+1.09,center[1]);buildings.add(fan);
    }
    if(buildingIndex%3===0){for(let j=0;j<3;j++){const solar=box(2.3,.14,1.65,center[0]-3.5,height+.3,center[1]+(j-1)*2,'#405b80',buildings);solar.rotation.z=.12;box(.07,.04,1.65,center[0]-3.5,height+.41,center[1]+(j-1)*2,'#a3bfda',buildings);}}
  }
  architecture.finish();
  const details=new THREE.Group();scene.add(details);
  const labelTextures=[];
  function streetLabel(text,x,z,rotation=0){const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d');ctx.font='500 65px sans-serif';ctx.fillStyle='#f1f0df';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,64);const texture=new THREE.CanvasTexture(canvas);labelTextures.push(texture);const label=new THREE.Mesh(new THREE.PlaneGeometry(30,3.75),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));label.rotation.x=-Math.PI/2;label.rotation.z=rotation;label.position.set(x,.34,z);details.add(label);}
  streetLabel('PENN AVENUE',-44,-4.8);streetLabel('21ST STREET',-4.8,44,Math.PI/2);
  for(let x=-125;x<130;x+=7){if(Math.abs(x)<13)continue;box(3,.04,.15,x,.26,0,'#e4e1c3',details);}
  for(let z=-95;z<95;z+=7){if(Math.abs(z)<13)continue;box(.15,.04,3,0,.27,z,'#e4e1c3',details);}
  const crosswalk=(parent,zone,raised=false)=>{
    const g=new THREE.Group();parent.add(g);const horizontal=zone==='east'||zone==='west';
    g.position.set(horizontal?(zone==='east'?12:-12):0,raised?.36:.28,horizontal?0:(zone==='north'?-12:12));if(horizontal)g.rotation.y=Math.PI/2;
    if(raised)box(13,.25,3.5,0,-.12,0,'#e4d9bd',g);
    for(let x=-5.5;x<6;x+=1.4)box(.8,.06,3,x,0,0,'#f2f0e4',g);
  };
  ['north','east','south','west'].forEach(z=>crosswalk(details,z));
  for(const [x,z] of [[-10,-10],[10,-10],[-10,10],[10,10],[-42,-10],[42,10],[-75,10],[72,-10],[-10,45],[10,-44]]){
    box(.45,3,.45,x,1.5,z,'#8d927a',details);
    const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(3.2,1),mat('#59a47f'));crown.position.set(x,5,z);crown.castShadow=true;details.add(crown);
    box(3.7,.35,3.7,x,.25,z,'#a4c6b0',details);
  }
  const signalLamps=[];
  function trafficSignal(parent,x,z,axis){
    box(.28,7,.28,x,3.5,z,'#425368',parent);
    const housing=box(1.3,2.8,.8,x,6.6,z,'#263445',parent);if(axis==='x')housing.rotation.y=Math.PI/2;
    for(let i=0;i<3;i++){
      const lamp=new THREE.Mesh(new THREE.SphereGeometry(.39,12,8),new THREE.MeshStandardMaterial({color:0x172231,emissiveIntensity:1.4}));
      lamp.position.set(x+(axis==='x'?-.48:0),7.48-i*.87,z+(axis==='z'?.48:0));parent.add(lamp);signalLamps.push({lamp,axis,index:i});
    }
  }
  for(const [x,z,axis] of [[-8,-9,'x'],[8,9,'x'],[9,-8,'z'],[-9,8,'z']])trafficSignal(details,x,z,axis);
  const permanentSignalCount=signalLamps.length;
  const upgrades=new THREE.Group();scene.add(upgrades);
  const zones=new THREE.Group();scene.add(zones);
  const zonePositions={north:[0,-22],east:[23,0],south:[0,22],west:[-23,0]};
  const zoneLabels=new Map();
  const labelLayer=document.createElement('div');labelLayer.className='placement-labels';container.append(labelLayer);
  for(const name of Object.keys(zonePositions)){const label=document.createElement('span');label.className='placement-target';label.textContent=`${name[0].toUpperCase()+name.slice(1)} · drop here`;label.dataset.approach=name;label.hidden=true;labelLayer.append(label);zoneLabels.set(name,label);}
  const ghost=new THREE.Mesh(new THREE.BoxGeometry(12,.15,3.2),new THREE.MeshBasicMaterial({color:0x3864ed,transparent:true,opacity:.45,depthWrite:false}));ghost.visible=false;scene.add(ghost);
  let hovered=null,validatePlacement=()=>null,lastSignal='';
  for(const [name,[x,z]] of Object.entries(zonePositions)){
    const target=new THREE.Mesh(new THREE.CircleGeometry(7,48),new THREE.MeshBasicMaterial({color:0x3864ed,transparent:true,opacity:.12,depthWrite:false}));target.rotation.x=-Math.PI/2;target.position.set(x,.5,z);target.userData.zone=name;zones.add(target);
    const ring=new THREE.Mesh(new THREE.RingGeometry(6.7,7,48),new THREE.MeshBasicMaterial({color:0x3864ed,transparent:true,opacity:.55,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(x,.51,z);zones.add(ring);
  }zones.visible=false;
  const cars=[];
  for(let i=0;i<22;i++){
    const g=new THREE.Group(),color=['#f3ca49','#3f79d3','#ea665b','#59b5b5','#f6f0e2','#596acd'][i%6];
    box(2,1.1,4.1,0,.8,0,color,g);box(1.75,.85,2.1,0,1.65,-.2,color,g);box(1.58,.55,.05,0,1.68,-1.27,'#495f60',g);box(1.58,.55,.05,0,1.68,.88,'#495f60',g);
    for(const x of [-1,1])for(const z of [-1.3,1.3]){
      const tire=new THREE.Mesh(new THREE.CylinderGeometry(.39,.39,.25,12),mat('#283545'));tire.rotation.z=Math.PI/2;tire.position.set(x,.53,z);tire.castShadow=true;g.add(tire);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.27,10),mat('#cad3d9'));hub.rotation.z=Math.PI/2;hub.position.copy(tire.position);g.add(hub);
    }
    for(const side of [-1,1]){
      for(const z of [-.72,.34])box(.045,.52,.83,side*.89,1.67,z,'#527c99',g);
      box(.055,.6,.1,side*.92,1.66,-.18,'#263e53',g);
      box(.055,.09,.23,side*1.025,1.12,-.54,'#dce0db',g);
      box(.24,.19,.32,side*1.09,1.42,.83,color,g);
    }
    box(1.45,.2,.07,0,.55,2.08,'#d7dce0',g);
    box(.63,.24,.08,0,.78,2.12,'#314154',g);
    box(1.6,.16,.08,0,.55,-2.1,'#b2c0ce',g);
    for(const x of [-.68,.68])box(.43,.24,.07,x,.96,-2.09,'#e94e4c',g);
    box(.4,.15,.05,-.65,.9,2.08,'#fff3c1',g);box(.4,.15,.05,.65,.9,2.08,'#fff3c1',g);
    const avMarker=box(.9,.12,.9,0,2.15,-.2,'#7bbdc0',g);avMarker.visible=false;
    const axis=i<14?'x':'z',p=axis==='x'?-118+(i*17):(-87+(i-14)*23),lane=i%2?2.2:-2.2;
    g.rotation.y=axis==='x'?Math.PI/2:Math.PI;scene.add(g);cars.push({g,axis,p,lane,originalLane:lane,speed:6+rng()*2,velocity:0,avMarker});
  }
  const pedestrians=[];
  for(let i=0;i<16;i++){
    const g=new THREE.Group();box(.5,1,.4,0,.95,0,['#ce8653','#4d7770','#e5d7b3','#899aad'][i%4],g);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.25,8,6),mat('#bca285'));head.position.y=1.75;g.add(head);
    const legs=[box(.16,.65,.2,-.14,.3,0,'#435249',g),box(.16,.65,.2,.14,.3,0,'#435249',g)];
    scene.add(g);pedestrians.push({g,legs,p:-55+i*7,side:i%2?9:-9});
  }
  const halo=new THREE.Mesh(new THREE.RingGeometry(2.6,3.1,48),new THREE.MeshBasicMaterial({color:0xe6a34a,transparent:true,opacity:.8,side:THREE.DoubleSide}));halo.rotation.x=-Math.PI/2;halo.visible=false;scene.add(halo);
  let paused=matchMedia('(prefers-reduced-motion: reduce)').matches,speed=1,elapsed=0,previous=performance.now(),lastEvent=-99,eventTime=-99,selected=null,settings={green:35,av:0,demand:800},eventsVisible=true,frameId;
  function pick(clientX,clientY){const rect=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),camera);const point=new THREE.Vector3();if(!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),point))return null;const nearest=Object.entries(zonePositions).sort((a,b)=>Math.hypot(point.x-a[1][0],point.z-a[1][1])-Math.hypot(point.x-b[1][0],point.z-b[1][1]))[0];return Math.hypot(point.x-nearest[1][0],point.z-nearest[1][1])<19?nearest[0]:null;}
  let down=null;
  function hover(clientX,clientY){
    hovered=selected?pick(clientX,clientY):null;ghost.visible=!!hovered;
    for(const [name,label] of zoneLabels){label.classList.toggle('hovered',name===hovered);label.classList.remove('invalid');label.textContent=`${name[0].toUpperCase()+name.slice(1)} · drop here`;}
    if(hovered){const [x,z]=zonePositions[hovered],error=validatePlacement(selected,hovered);ghost.position.set(x,.6,z);ghost.rotation.y=['east','west'].includes(hovered)?Math.PI/2:0;ghost.material.color.setHex(error?0xe56d61:0x3864ed);const label=zoneLabels.get(hovered);label.classList.toggle('invalid',!!error);label.textContent=error?'Unavailable · choose another':`${hovered} · release to place`;}
  }
  renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
  renderer.domElement.addEventListener('pointermove',e=>hover(e.clientX,e.clientY));
  renderer.domElement.addEventListener('pointerup',e=>{if(selected&&down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<6){const zone=pick(e.clientX,e.clientY);if(zone)onPlace(selected,zone);}});
  container.addEventListener('dragover',e=>{e.preventDefault();hover(e.clientX,e.clientY);e.dataTransfer.dropEffect=hovered&&!validatePlacement(selected,hovered)?'copy':'none';});
  container.addEventListener('dragleave',()=>{ghost.visible=false;});
  container.addEventListener('drop',e=>{e.preventDefault();ghost.visible=false;const type=e.dataTransfer.getData('application/interlock');const zone=pick(e.clientX,e.clientY);if(type&&zone)onPlace(type,zone);else onEvent({type:'hint',message:'Drop onto a blue approach target. Nothing was charged.'});});
  function animate(now){frameId=requestAnimationFrame(animate);const dt=Math.min((now-previous)/1000,.08)*(paused?0:speed);previous=now;elapsed+=dt;
    const signals=signalState(elapsed,settings.green),xGreen=signals.penn==='green',zGreen=signals.cross==='green';
    const signalKey=`${signals.penn}/${signals.cross}/${signals.remaining}/${paused}`;
    if(signalKey!==lastSignal){lastSignal=signalKey;onEvent({type:'signals',...signals,paused});}
    signalLamps.forEach(({lamp,axis,index})=>{const state=axis==='x'?signals.penn:signals.cross;const lit=index===({red:0,amber:1,green:2}[state]);const c=lit?[0xff493e,0xffbf35,0x45ed99][index]:0x172231;lamp.material.color.setHex(c);lamp.material.emissive.setHex(lit?c:0);lamp.scale.setScalar(lit?1.12:1);});
    for(const car of cars){if(!car.g.visible)continue;const green=car.axis==='x'?xGreen:zGreen,dir=car.axis==='x'?1:-1,stop=car.axis==='x'?-17:17;
      const ahead=cars.some(other=>other!==car&&other.g.visible&&other.axis===car.axis&&other.lane===car.lane&&(other.p-car.p)*dir>0&&(other.p-car.p)*dir<7);
      const distanceToStop=(stop-car.p)*dir;
      const redStop=!green&&distanceToStop>=0&&distanceToStop<=car.speed*dt+.15;
      if(redStop&&!ahead)car.p=stop;
      car.velocity=(ahead||redStop)?0:car.speed*dir;car.p+=car.velocity*dt;
      if(car.axis==='x'&&car.p>128)car.p=-128;if(car.axis==='z'&&car.p< -100)car.p=100;
      car.g.position.set(car.axis==='x'?car.p:car.lane,.25,car.axis==='x'?car.lane:car.p);
    }
    pedestrians.forEach((p,i)=>{p.p+=dt*(.7+i%3*.15);if(p.p>75)p.p=-75;p.g.position.set(p.p,.28,p.side);p.legs.forEach((leg,j)=>leg.rotation.x=Math.sin(elapsed*7+i+j*Math.PI)*.3);});
    // Detect short following gaps from animated actors; this overlay is a preview, not Monte Carlo output.
    if(elapsed-lastEvent>8){for(const a of cars){if(!a.g.visible)continue;const b=cars.find(b=>b!==a&&b.g.visible&&a.axis===b.axis&&a.lane===b.lane&&(b.p-a.p)*Math.sign(a.velocity)>0&&Math.abs(b.p-a.p)<12&&Math.abs(a.velocity)>Math.abs(b.velocity)+1);if(b){const ttc=(Math.abs(b.p-a.p)-4.1)/(Math.abs(a.velocity)-Math.abs(b.velocity));if(ttc>0&&ttc<1.5){lastEvent=elapsed;eventTime=elapsed;halo.position.copy(a.g.position);halo.position.y=.5;if(eventsVisible)onEvent({type:'near-miss',ttc:ttc.toFixed(1)});break;}}}}
    halo.visible=eventsVisible&&elapsed-eventTime<2;halo.scale.setScalar(1+Math.sin(elapsed*7)*.08);
    controls.update();
    for(const [name,label] of zoneLabels){label.hidden=!selected;if(selected){const [x,z]=zonePositions[name];const p=new THREE.Vector3(x,2,z).project(camera);label.style.left=`${(p.x+1)*container.clientWidth/2}px`;label.style.top=`${(1-p.y)*container.clientHeight/2}px`;}}
    const compass=container.parentElement.querySelector('.north-arrow svg');
    if(compass){const origin=new THREE.Vector3(0,0,0).project(camera),north=new THREE.Vector3(-Math.sin(map.rotation)*20,0,-Math.cos(map.rotation)*20).project(camera);const angle=Math.atan2((north.x-origin.x)*container.clientWidth,(north.y-origin.y)*container.clientHeight)*180/Math.PI-45;compass.style.transform=`rotate(${angle}deg)`;}
    renderer.render(scene,camera);
  }
  const resize=()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h);camera.left=-100*w/h;camera.right=100*w/h;camera.top=100;camera.bottom=-100;camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(container);resize();frameId=requestAnimationFrame(animate);
  function clear(group){while(group.children.length){const child=group.children[0];child.traverse(o=>o.geometry?.dispose());group.remove(child);}}
  return {
    previewPlacement: hover,
    placeAt(type,x,y){ghost.visible=false;const zone=pick(x,y);if(zone)onPlace(type,zone);else onEvent({type:'hint',message:'Drop onto a blue approach target. Nothing was charged.'});},
    cancelPlacement(){ghost.visible=false;},
    setPlacementValidator(fn){validatePlacement=fn;},
    setTool(type){selected=type;zones.visible=!!type;ghost.visible=false;renderer.domElement.style.cursor=type?'crosshair':'grab';},
    setUpgrades(items){signalLamps.splice(permanentSignalCount).forEach(({lamp})=>lamp.material.dispose());clear(upgrades);cars.forEach(car=>{const diet=items.some(i=>i.type==='diet'&&((car.axis==='x'&&['east','west'].includes(i.zone))||(car.axis==='z'&&['north','south'].includes(i.zone))));car.lane=diet?2.2:car.originalLane;});for(const item of items){const [x,z]=zonePositions[item.zone],horizontal=item.zone==='east'||item.zone==='west';
      if(item.type==='crosswalk')crosswalk(upgrades,item.zone,true);
      if(item.type==='bike'){const g=new THREE.Group();g.position.set(x*2,.32,z*2);if(!horizontal)g.rotation.y=Math.PI/2;upgrades.add(g);box(38,.08,2.3,0,0,5,'#6eaa88',g);for(let p=-18;p<=18;p+=4)box(.2,.9,.2,p,.45,3.7,'#fff5d6',g);}
      if(item.type==='curb'){box(5,.5,5,x*.55,.4,z*.55+ (horizontal?7:0),'#c3cbae',upgrades);}
      if(item.type==='signal')trafficSignal(upgrades,x*.55+5,z*.55+5,horizontal?'x':'z');
      if(item.type==='diet'){const g=new THREE.Group();g.position.set(x*2,.4,z*2);if(!horizontal)g.rotation.y=Math.PI/2;upgrades.add(g);box(35,.12,3,0,0,-2,'#b6c49d',g);for(let p=-15;p<=15;p+=5)box(2,.7,1.3,p,.4,-2,'#8b9c77',g);}
    }},
    setPaused(value){paused=value;},setSpeed(value){speed=value;},setSettings(value){settings={...value};cars.forEach((car,i)=>{car.g.visible=(i%14)<Math.max(3,Math.ceil(value.demand/1600*14));car.avMarker.visible=(i*7%100)<value.av;});},
    toggleLayer(name,value){if(name==='buildings')buildings.visible=value;if(name==='events')eventsVisible=value;if(name==='pedestrians')pedestrians.forEach(p=>p.g.visible=value);},
    view(top){camera.position.set(top?0:130,top?230:155,top?.01:150);controls.target.set(0,0,0);camera.zoom=1;camera.updateProjectionMatrix();controls.update();},
    zoom(amount){camera.zoom=THREE.MathUtils.clamp(camera.zoom*amount,.55,3);camera.updateProjectionMatrix();},
    dispose(){cancelAnimationFrame(frameId);observer.disconnect();controls.dispose();scene.traverse(o=>{o.geometry?.dispose();if(o.material&&!materials.has(o.material.color?.getStyle()))o.material.dispose?.();});materials.forEach(m=>m.dispose());labelTextures.forEach(t=>t.dispose());renderer.dispose();renderer.domElement.remove();},
  };
}
