import { buildVehicleVariant } from './vehicle-variants.js';
import { roadWidth, nearestIntersection } from './road-layout.js';
import { addStreetFurniture } from './street-furniture.js';
import { updatePedestrianReaction } from './pedestrian-reactions.js';
import { createTraffic } from './traffic.js';
import { createCollisionPreview } from './collision-preview.js';
import { createNavigation } from './navigation.js';
import { INTERSECTIONS, DEFAULT_INTERSECTION, intersectionById } from './intersections.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import map from './data/intersection.json' with { type: 'json' };
import { centerOf, clearOfSignals, clipSegment, roadPoint } from './campus-geometry.js';
import { random } from './model.js';
import { createArchitecture } from './architecture.js';
import { signalState } from './signals.js';
import { APPROACHES, placementFor, createUpgrade, colorPreview, disposeUpgrade } from './infrastructure.js';

export function createIntersection(container, onPlace, onEvent) {
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#d8e7f0');
  let camera=new THREE.OrthographicCamera(-110,110,85,-85,.1,2200);
  camera.position.set(130,155,150); camera.lookAt(0,0,0);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label','Interactive 3D model of the University of Pittsburgh campus between Forbes and Fifth avenues. Use approach buttons to place selected upgrades with a keyboard.');
  container.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI/2.2;controls.minZoom=.1;controls.maxZoom=5;controls.enablePan=true;controls.screenSpacePanning=true;controls.target.set(0,0,0);
  const orthographic=camera;const activeIntersection=DEFAULT_INTERSECTION;
  const navigation=createNavigation({orthographic,controls,element:renderer.domElement,getOrigin:()=>[controls.target.x,controls.target.z],onCamera:next=>camera=next,onMode:mode=>onEvent({type:'navigation',mode})});
  function focusIntersection(top=false,id=activeIntersection){navigation.setMode('pan');const [x,z]=intersectionById(id).origin;camera.position.set(x+(top?0:130),top?230:155,z+(top?.01:150));controls.target.set(x,0,z);camera.zoom=1;camera.updateProjectionMatrix();controls.update();}
  scene.add(new THREE.HemisphereLight(0xffffff,0xb5bea8,1.7));
  const sun=new THREE.DirectionalLight(0xfffaf1,2);sun.position.set(-180,440,180);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-600,right:600,top:600,bottom:-600,far:1400});sun.shadow.bias=-.001;scene.add(sun);
  const materials=new Map();
  const mat=color=>{if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.85}));return materials.get(color);};
  function box(w,h,d,x,y,z,color,parent=scene){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function line(points,color,width=1,parent=scene){for(let i=1;i<points.length;i++){const [x,z]=points[i-1],[xx,zz]=points[i],len=Math.hypot(xx-x,zz-z);const m=box(width,.045,len,(x+xx)/2,.12,(z+zz)/2,color,parent);m.rotation.y=Math.atan2(xx-x,zz-z);}}
  box(900,1,800,-25,-1,-100,'#c5dacd');
  const roads=new THREE.Group();scene.add(roads);
  const driveable=new Set(['trunk','primary','secondary','tertiary','residential','unclassified','service','living_street','trunk_link','secondary_link']);
  const roadFeatures=map.features.filter(f=>driveable.has(f.tags.highway));
  for(const f of map.features.filter(f=>f.tags.highway)){
    if(f.tags.area==='yes')continue;
    const driving=driveable.has(f.tags.highway);const width=driving?roadWidth(f.tags.name):f.tags.highway==='cycleway'?2.2:1.8;
    for(let i=1;i<f.points.length;i++){const segment=clipSegment(f.points[i-1],f.points[i],map.bounds);if(!segment)continue;
      if(driving)line(segment,'#e7e3d7',width+5,roads);
      line(segment,driving?'#65758a':f.tags.highway==='cycleway'?'#86b8a3':'#dfe0cf',width,roads);
    }
  }
  roads.children.forEach(mesh=>{mesh.position.y=mesh.material.color.getHexString()==='65758a'?.19:.08;mesh.receiveShadow=true;mesh.castShadow=false;});
  // Road segments share one instanced draw per material, including the expanded field.
  for(const material of new Set(roads.children.map(mesh=>mesh.material))){
    const pieces=roads.children.filter(mesh=>mesh.material===material);const batch=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,pieces.length);batch.receiveShadow=true;
    pieces.forEach((mesh,i)=>{const {width,height,depth}=mesh.geometry.parameters;mesh.scale.set(width,height,depth);mesh.updateMatrix();batch.setMatrixAt(i,mesh.matrix);mesh.geometry.dispose();roads.remove(mesh);});roads.add(batch);
  }
  const rng=random(14), buildings=new THREE.Group();scene.add(buildings);
  const colors=['#8babcd','#df9586','#e8c36c','#b4c8dc','#e4d4ba','#7cb5bb'];
  const architecture=createArchitecture(buildings,mat);
  let buildingIndex=0;
  for(const f of map.features.filter(f=>f.tags.building||f.tags['building:part'])){
    if(f.points.length<4||f.id==='30678664')continue; // Cathedral is rendered from its tagged 3D building parts.
    const shape=new THREE.Shape();f.points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));
    for(const ring of f.holes||[]){const hole=new THREE.Path();ring.forEach(([x,z],i)=>i?hole.lineTo(x,-z):hole.moveTo(x,-z));shape.holes.push(hole);}
    const height=Number.parseFloat(f.tags.height)||Number.parseFloat(f.tags['building:levels'])*3.2||6+rng()*9;
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});geometry.rotateX(-Math.PI/2);
    const cathedral=f.id.startsWith('8411179');const tower=/Litchfield Tower [ABC]/.test(f.tags.name||'');
    const color=cathedral?'#d7cfb6':tower?'#c6bda7':colors[Math.floor(rng()*colors.length)];
    const building=new THREE.Mesh(geometry,[mat('#aeb9c1'),mat(color)]);building.castShadow=true;building.receiveShadow=true;buildings.add(building);
    architecture.add(f.points,height,['#3864b1','#cd6958','#d5a22d','#427f84'][buildingIndex%4],buildingIndex++,{storefront:!cathedral&&!tower&&!f.tags['building:part']&&f.tags.building!=='university'});
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,35),new THREE.LineBasicMaterial({color:0xaab2a1,transparent:true,opacity:.3}));buildings.add(edge);
    if(cathedral||tower)continue;
    const center=centerOf(f.points);
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
  for(const [name,axis,coordinates] of [['Forbes Avenue','x',[-225,-75,95]],['Fifth Avenue','x',[-250,100]],['Bigelow Boulevard','z',[-240,-85]],['South Bouquet Street','z',[45]]])for(const coordinate of coordinates){
    const anchor=roadPoint(roadFeatures,name,axis,coordinate,roadWidth(name)/2-2);if(!anchor)continue;
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d');ctx.font='bold 65px Cantarell, sans-serif';ctx.fillStyle='#f7f4e6';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name.toUpperCase(),512,64,980);
    const texture=new THREE.CanvasTexture(canvas);labelTextures.push(texture);const geometry=new THREE.PlaneGeometry(30,1.7,30,1);geometry.rotateX(-Math.PI/2);const v=geometry.attributes.position;
    for(let i=0;i<v.count;i++){const p=roadPoint(roadFeatures,name,axis,coordinate+v.getX(i)*(axis==='x'?Math.sin(anchor.angle):Math.cos(anchor.angle)),roadWidth(name)/2-2+v.getZ(i));if(p)v.setXYZ(i,p.x,.31,p.z);}
    geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide}));details.add(mesh);
  }
  for(const road of roadFeatures){if(!road.tags.name)continue;let distance=0;for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    for(let d=0;d<length;d+=1){const fraction=(d+.5)/length,x=a[0]+(b[0]-a[0])*fraction,z=a[1]+(b[1]-a[1])*fraction;
      if((distance+d)%8>3||x<map.bounds.minX||x>map.bounds.maxX||z<map.bounds.minZ||z>map.bounds.maxZ||INTERSECTIONS.some(site=>Math.hypot(site.origin[0]-x,site.origin[1]-z)<19))continue;
      const dash=box(.14,.03,Math.min(1,length-d),x,.27,z,road.tags.oneway==='yes'?'#f8f5e8':'#efd37c',details);dash.rotation.y=Math.atan2(b[0]-a[0],b[1]-a[1]);dash.castShadow=false;dash.userData.roadStripe=true;
    }distance+=length;
  }}
  for(const color of ['#f8f5e8','#efd37c']){const stripes=details.children.filter(mesh=>mesh.userData.roadStripe&&mesh.material===mat(color));if(!stripes.length)continue;const batch=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),mat(color),stripes.length);stripes.forEach((mesh,i)=>{const {width,height,depth}=mesh.geometry.parameters;mesh.scale.set(width,height,depth);mesh.updateMatrix();batch.setMatrixAt(i,mesh.matrix);mesh.geometry.dispose();details.remove(mesh);});details.add(batch);}
  const furnitureIds=addStreetFurniture({parent:details,map,box,mat,textures:labelTextures});renderer.domElement.dataset.furnitureCount=furnitureIds.length;
  for(const site of INTERSECTIONS)for(const zone of APPROACHES){const crossing=createUpgrade('crosswalk',zone,{intersection:site.id});crossing.children[0].visible=false;details.add(crossing);}
  const signalAnchors=[[-8,-9],[8,9],[9,-8],[-9,8],...INTERSECTIONS.flatMap(site=>APPROACHES.map(zone=>{const p=placementFor('signal',zone,site.id);return[p.x,p.z];})),...map.points.filter(p=>p.tags.highway==='traffic_signals').map(p=>p.point)];
  const treePoints=map.points.filter(p=>p.tags.natural==='tree').map(p=>p.point).filter(p=>clearOfSignals(p,signalAnchors));
  for(const [x,z] of treePoints){
    box(.45,3,.45,x,1.5,z,'#8d927a',details);
    const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(3.2,1),mat('#59a47f'));crown.position.set(x,5,z);crown.castShadow=true;details.add(crown);
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
  for(const site of INTERSECTIONS)for(const zone of APPROACHES){const p=placementFor('signal',zone,site.id);trafficSignal(details,p.x,p.z,p.axis);}
  const permanentSignalCount=signalLamps.length;
  const upgrades=new THREE.Group();scene.add(upgrades);
  const previews=new THREE.Group();scene.add(previews);
  const zoneLabels=new Map();
  const labelLayer=document.createElement('div');labelLayer.className='placement-labels';container.append(labelLayer);
  for(const site of INTERSECTIONS)for(const name of APPROACHES){const label=document.createElement('span');label.className='placement-target';label.dataset.approach=name;label.dataset.intersection=site.id;label.hidden=true;labelLayer.append(label);zoneLabels.set(site.id+":"+name,label);}
  const landmarkLayer=document.createElement('div');landmarkLayer.className='landmark-labels';container.append(landmarkLayer);
  const landmarkSpecs=[['cathedral','Cathedral of Learning','30678664',163],['towers','Litchfield Towers','154377421',68.4],['union','William Pitt Union','154245869',35],['hillman','Hillman Library','121060908',20],['jefes',"El Jefe’s Taqueria",'2710170993',8]];
  const landmarks=landmarkSpecs.map(([id,name,osmId,height])=>{const feature=map.features.find(f=>f.id===osmId),poi=map.points.find(p=>p.id===osmId);const point=feature?centerOf(feature.points):poi.point;const label=document.createElement('span');label.textContent=name;label.dataset.landmark=id;landmarkLayer.append(label);return{id,name,point,height,label};});
  function frameCampus(){navigation.setMode('pan');const zoom=Math.min(container.clientWidth/container.clientHeight*200/760,200/550);controls.target.set(-45,25,-95);camera.position.set(285,405,385);camera.zoom=zoom;camera.updateProjectionMatrix();controls.update();}
  function focusLandmark(id){navigation.setMode('pan');const landmark=landmarks.find(l=>l.id===id);if(!landmark)return;const [x,z]=landmark.point;controls.target.set(x,landmark.height*.4,z);camera.position.set(x+160,landmark.height*.4+190,z+200);camera.zoom=id==='cathedral'?.7:1.3;camera.updateProjectionMatrix();controls.update();}
  let hovered=null,validatePlacement=()=>null,lastSignal='';
  const placementRay=new THREE.Raycaster();
  function refreshPreviews(){for(const group of previews.children)colorPreview(group,{hovered:group.userData.intersection+":"+group.userData.zone===hovered,invalid:!!validatePlacement(selected,group.userData.zone,group.userData.intersection)});for(const [name,label] of zoneLabels){const error=hovered===name?validatePlacement(selected,name.split(':')[1],name.split(':')[0]):null;label.classList.toggle('invalid',!!error);label.textContent=error||intersectionById(name.split(':')[0]).name+' · '+name.split(':')[1]+' · build here';}}
  const cars=[];const traffic=createTraffic(roadFeatures,42,map.points);let designItems=[];
  for(let i=0;i<42;i++){
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
    const brakeLights=[];for(const x of [-.68,.68]){const lamp=box(.43,.24,.07,x,.96,-2.09,'#e94e4c',g);lamp.material=lamp.material.clone();brakeLights.push(lamp);}
    box(.4,.15,.05,-.65,.9,2.08,'#fff3c1',g);box(.4,.15,.05,.65,.9,2.08,'#fff3c1',g);
    const avMarker=box(.9,.12,.9,0,2.15,-.2,'#7bbdc0',g);avMarker.visible=false;
    const hazardLights=[];for(const x of [-.85,.85])for(const z of [-2.13,2.13]){const lamp=box(.22,.22,.06,x,1,z,'#ffb82e',g);lamp.material=lamp.material.clone();lamp.material.emissive.setHex(0xff9400);lamp.material.emissiveIntensity=2;lamp.visible=false;hazardLights.push(lamp);}
    const vehicle=traffic.vehicles[i];let model={g,avMarker,brakeLights,hazardLights,wheels:[]};
    if(vehicle.kind!=='car'){for(const lamp of [...brakeLights,...hazardLights])lamp.material.dispose();for(const child of [...g.children]){child.geometry?.dispose();g.remove(child);}model={g,...buildVehicleVariant(vehicle.kind,g,{box,mat,textures:labelTextures})};}
    g.rotation.y=vehicle.pose.angle;scene.add(g);cars.push(model);
  }
  renderer.domElement.dataset.vehicleTypes=[...new Set(traffic.vehicles.map(v=>v.kind))].join(',');
  const collision=createCollisionPreview(scene,cars.filter((_,i)=>traffic.vehicles[i].kind==='car').map(car=>car.g));
  const pedestrians=[];
  for(let i=0;i<16;i++){
    const g=new THREE.Group();box(.5,1,.4,0,.95,0,['#ce8653','#4d7770','#e5d7b3','#899aad'][i%4],g);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.25,8,6),mat('#bca285'));head.position.y=1.75;g.add(head);
    const legs=[box(.16,.65,.2,-.14,.3,0,'#435249',g),box(.16,.65,.2,.14,.3,0,'#435249',g)];
    scene.add(g);pedestrians.push({g,legs,p:-55+i*7,side:i%2?9:-9});
  }
  const halo=new THREE.Mesh(new THREE.RingGeometry(2.6,3.1,48),new THREE.MeshBasicMaterial({color:0xe6a34a,transparent:true,opacity:.8,side:THREE.DoubleSide}));halo.rotation.x=-Math.PI/2;halo.visible=false;scene.add(halo);
  let paused=matchMedia('(prefers-reduced-motion: reduce)').matches,speed=1,elapsed=0,previous=performance.now(),lastEvent=-99,eventTime=-99,selected=null,settings={green:35,av:0,demand:800},eventsVisible=true,frameId;
  function pick(clientX,clientY){
    if(!selected)return null;
    const rect=renderer.domElement.getBoundingClientRect();
    placementRay.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),camera);
    const hit=placementRay.intersectObjects(previews.children,true)[0];
    if(!hit)return null;
    let object=hit.object;while(object&&!object.userData.zone)object=object.parent;
    return object?object.userData.intersection+":"+object.userData.zone:null;
  }
  let down=null;
  function hover(clientX,clientY){
    hovered=pick(clientX,clientY);refreshPreviews();
  }
  renderer.domElement.addEventListener('pointerdown',e=>down=e.button===0?[e.clientX,e.clientY]:null);
  renderer.domElement.addEventListener('pointercancel',()=>down=null);
  renderer.domElement.addEventListener('pointermove',e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)down=null;hover(e.clientX,e.clientY);});
  renderer.domElement.addEventListener('pointerup',e=>{if(selected&&down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<6){const zone=pick(e.clientX,e.clientY);if(zone)onPlace(selected,zone.split(":")[1],zone.split(":")[0]);}});
  container.addEventListener('dragover',e=>{e.preventDefault();hover(e.clientX,e.clientY);e.dataTransfer.dropEffect=hovered&&!validatePlacement(selected,hovered.split(":")[1],hovered.split(":")[0])?'copy':'none';});
  container.addEventListener('dragleave',()=>{hovered=null;refreshPreviews();});
  container.addEventListener('drop',e=>{e.preventDefault();hovered=null;refreshPreviews();const type=e.dataTransfer.getData('application/interlock');const zone=pick(e.clientX,e.clientY);if(type&&zone)onPlace(type,zone.split(":")[1],zone.split(":")[0]);else onEvent({type:'hint',message:'Drop directly onto a blue upgrade silhouette. Nothing was charged.'});});
  function animate(now){frameId=requestAnimationFrame(animate);const realDt=Math.min((now-previous)/1000,.08);navigation.update(realDt);const dt=realDt*(paused?0:speed);previous=now;elapsed+=dt;
    const signals=signalState(elapsed,settings.green),xGreen=signals.penn==='green',zGreen=signals.cross==='green';
    const look=new THREE.Vector3();camera.getWorldDirection(look);const viewPoint=navigation.mode==='street'?camera.position.clone().addScaledVector(look,35):controls.target;const viewedSite=nearestIntersection(viewPoint.x,viewPoint.z,INTERSECTIONS);renderer.domElement.dataset.viewedIntersection=viewedSite.id;
    const signalKey=`${viewedSite.id}/${signals.penn}/${signals.cross}/${signals.remaining}/${paused}`;
    if(signalKey!==lastSignal){lastSignal=signalKey;onEvent({type:'signals',...signals,paused,site:viewedSite});}
    signalLamps.forEach(({lamp,axis,index})=>{const state=axis==='x'?signals.penn:signals.cross;const lit=index===({red:0,amber:1,green:2}[state]);const c=lit?[0xff493e,0xffbf35,0x45ed99][index]:0x172231;lamp.material.color.setHex(c);lamp.material.emissive.setHex(lit?c:0);lamp.scale.setScalar(lit?1.12:1);});
    renderer.domElement.dataset.incident=collision.update(dt,eventsVisible);
    const incident=collision.incident;
    traffic.update(dt,signals,designItems,incident);
    cars.forEach((car,i)=>{const vehicle=traffic.vehicles[i];car.g.visible=vehicle.enabled;car.g.position.set(vehicle.pose.x,.25,vehicle.pose.z);
      const delta=Math.atan2(Math.sin(vehicle.pose.angle-car.g.rotation.y),Math.cos(vehicle.pose.angle-car.g.rotation.y));car.g.rotation.y+=delta*Math.min(1,dt*9);
      car.wheels.forEach(wheel=>wheel.rotateY(vehicle.speed*dt/.45));
      car.hazardLights.forEach(lamp=>lamp.visible=vehicle.reacting&&Math.floor(elapsed*3)%2===0);
      car.brakeLights.forEach(lamp=>{lamp.material.emissive.setHex((vehicle.braking||vehicle.reacting&&vehicle.speed<.5)?0xff1608:0x000000);lamp.material.emissiveIntensity=(vehicle.braking||vehicle.reacting&&vehicle.speed<.5)?2:0;});

    });
    pedestrians.forEach((p,i)=>{
      const before=roadPoint(roadFeatures,'Forbes Avenue','x',p.p,p.side);if(!before)return;
      updatePedestrianReaction(p,i,dt,before,incident);if(p.p>75)p.p=-75;
      const route=roadPoint(roadFeatures,'Forbes Avenue','x',p.p,p.side);if(route)p.g.position.set(route.x,.28,route.z);
      const target=p.lookAngle??Math.PI/2,delta=Math.atan2(Math.sin(target-p.g.rotation.y),Math.cos(target-p.g.rotation.y));p.g.rotation.y+=delta*(1-Math.exp(-dt*5));
      p.legs.forEach((leg,j)=>{const target=Math.sin((p.walkPhase||0)+j*Math.PI)*Math.min(.35,Math.abs(p.velocity||0)*.35);leg.rotation.x+=(target-leg.rotation.x)*(1-Math.exp(-dt*12));});
    });
    renderer.domElement.dataset.reactingCars=traffic.vehicles.filter(v=>v.enabled&&v.reacting).length;
    renderer.domElement.dataset.reactingPedestrians=pedestrians.filter(p=>p.reacting).length;

    // Following-gap marker belongs only to the animated preview.
    if(elapsed-lastEvent>8){for(const a of traffic.vehicles){if(!a.enabled||a.speed<1)continue;const b=traffic.vehicles.find(b=>b!==a&&b.enabled&&b.route===a.route&&b.s>a.s&&b.s-a.s<15&&a.speed>b.speed+1);if(b){const ttc=(b.s-a.s-4.5)/(a.speed-b.speed);if(ttc>0&&ttc<1.5){lastEvent=elapsed;eventTime=elapsed;halo.position.set(a.pose.x,.5,a.pose.z);if(eventsVisible)onEvent({type:'near-miss',ttc:ttc.toFixed(1)});break;}}}}
    halo.visible=eventsVisible&&elapsed-eventTime<2;halo.scale.setScalar(1+Math.sin(elapsed*7)*.08);
    controls.update();
    for(const [name,label] of zoneLabels){label.hidden=!selected||hovered!==name;if(selected){const {x,z}=placementFor(selected,name.split(":")[1],name.split(":")[0]);const p=new THREE.Vector3(x,selected==='signal'?8:1,z).project(camera);label.dataset.screenX=((p.x+1)*container.clientWidth/2).toFixed(2);label.dataset.screenY=((1-p.y)*container.clientHeight/2).toFixed(2);label.style.left=((p.x+1)*container.clientWidth/2)+'px';label.style.top=((1-p.y)*container.clientHeight/2)+'px';}}
    for(const landmark of landmarks){const p=new THREE.Vector3(landmark.point[0],landmark.height+5,landmark.point[1]).project(camera);landmark.label.hidden=!buildings.visible||Math.abs(p.x)>1||Math.abs(p.y)>1||p.z>1;landmark.label.style.left=((p.x+1)*container.clientWidth/2)+'px';landmark.label.style.top=((1-p.y)*container.clientHeight/2)+'px';}
    const compass=container.parentElement.querySelector('.north-arrow svg');
    if(compass){const origin=new THREE.Vector3(0,0,0).project(camera),north=new THREE.Vector3(-Math.sin(map.rotation)*20,0,-Math.cos(map.rotation)*20).project(camera);const angle=Math.atan2((north.x-origin.x)*container.clientWidth,(north.y-origin.y)*container.clientHeight)*180/Math.PI-45;compass.style.transform=`rotate(${angle}deg)`;}
    renderer.render(scene,camera);
  }
  const resize=()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h);orthographic.left=-100*w/h;orthographic.right=100*w/h;orthographic.top=100;orthographic.bottom=-100;orthographic.updateProjectionMatrix();navigation.resize();};const observer=new ResizeObserver(resize);observer.observe(container);resize();frameCampus();frameId=requestAnimationFrame(animate);
  function clear(group){for(const child of [...group.children])disposeUpgrade(child);}
  return {
    frameCampus, focusLandmark,
    jumpToIntersection(id,top=false){if(intersectionById(id))focusIntersection(top,id);},
    previewCollision(){focusIntersection(false);camera.zoom=2.3;camera.updateProjectionMatrix();collision.start();},
    setNavigation(mode){navigation.setMode(mode);},holdNavigation(action,active){navigation.hold(action,active);},nudgeNavigation(action){navigation.nudge(action);},
    previewPlacement: hover,
    placeAt(type,x,y){hovered=null;refreshPreviews();const zone=pick(x,y);if(zone)onPlace(type,zone.split(":")[1],zone.split(":")[0]);else onEvent({type:'hint',message:'Drop directly onto a blue upgrade silhouette. Nothing was charged.'});},
    cancelPlacement(){hovered=null;refreshPreviews();},
    setPlacementValidator(fn){validatePlacement=fn;},
    setTool(type){selected=type;hovered=null;clear(previews);if(type){for(const site of INTERSECTIONS)for(const zone of APPROACHES)previews.add(createUpgrade(type,zone,{preview:true,intersection:site.id}));refreshPreviews();}renderer.domElement.style.cursor=type?'crosshair':'grab';},
    setUpgrades(items){
      designItems=items;signalLamps.splice(permanentSignalCount);clear(upgrades);
      for(const item of items){const group=createUpgrade(item.type,item.zone,{intersection:item.intersection||DEFAULT_INTERSECTION});upgrades.add(group);if(item.type==='signal')group.traverse(lamp=>{if(lamp.userData.signalIndex!==undefined)signalLamps.push({lamp,axis:placementFor(item.type,item.zone,item.intersection||DEFAULT_INTERSECTION).axis,index:lamp.userData.signalIndex});});}
      refreshPreviews();
    },
    setPaused(value){paused=value;},setSpeed(value){speed=value;},setSettings(value){settings={...value};cars.forEach((car,i)=>{traffic.vehicles[i].enabled=(i%14)<Math.max(3,Math.ceil(value.demand/1600*14));car.g.visible=traffic.vehicles[i].enabled;car.avMarker.visible=traffic.vehicles[i].kind!=='bike'&&(i*7%100)<value.av;});},
    toggleLayer(name,value){if(name==='buildings')buildings.visible=value;if(name==='events')eventsVisible=value;if(name==='pedestrians')pedestrians.forEach(p=>p.g.visible=value);},
    view:focusIntersection,
    zoom(amount){if(navigation.mode==='street')navigation.nudge(amount>1?'forward':'back');else{camera.zoom=THREE.MathUtils.clamp(camera.zoom*amount,.1,5);camera.updateProjectionMatrix();}},
    dispose(){cancelAnimationFrame(frameId);observer.disconnect();navigation.dispose();controls.dispose();clear(previews);clear(upgrades);labelLayer.remove();landmarkLayer.remove();scene.traverse(o=>{o.geometry?.dispose();if(o.material&&!materials.has(o.material.color?.getStyle()))o.material.dispose?.();});materials.forEach(m=>m.dispose());labelTextures.forEach(t=>t.dispose());renderer.dispose();renderer.domElement.remove();},
  };
}
