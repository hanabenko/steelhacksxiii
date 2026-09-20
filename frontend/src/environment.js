import * as THREE from 'three';
import { DEFAULT_CONDITIONS, WEATHER, resolvedHazards } from './scenarios.js';
import { createUpgrade, disposeUpgrade, placementFor } from './infrastructure.js';
import {ROAD_BLOCKS} from './road-blocks.js';
import {createBlockClosure,createPothole} from './hazard-meshes.js';
export function createEnvironment(scene,sun,ambient){
  let conditions={...DEFAULT_CONDITIONS},hour=9,cycling=false,elapsed=0,upgrades=[];
  const hazards=new THREE.Group();scene.add(hazards);
  const positions=new Float32Array(900*3);
  for(let i=0;i<positions.length;i+=3){positions[i]=Math.random()*900-475;positions[i+1]=Math.random()*100;positions[i+2]=Math.random()*800-500;}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const rain=new THREE.Points(geometry,new THREE.PointsMaterial({color:'#b4d9fa',size:.65,transparent:true,opacity:.75}));scene.add(rain);
  const day=new THREE.Color('#d8e7f0'),night=new THREE.Color('#101a35'),storm=new THREE.Color('#637787');
  function rebuild(){
    for(const child of [...hazards.children])disposeUpgrade(child);
    const effective=resolvedHazards(conditions,upgrades);
    if(effective.closure)hazards.add(createUpgrade('closure',effective.closure.zone,{intersection:effective.closure.intersection}));
    const p=effective.pothole;
    if(p&&!upgrades.some(i=>i.type==='repair'&&i.intersection===p.intersection&&i.zone===p.zone)){
      const anchor=placementFor('repair',p.zone,p.intersection);hazards.add(createPothole(anchor.x,anchor.z));
    }
    for(const id of conditions.closures||[]){const block=ROAD_BLOCKS.find(b=>b.id===id);if(block)hazards.add(createBlockClosure(block));}
    for(const p of conditions.potholes||[])hazards.add(createPothole(p.x,p.z));
  }
  return {
    setConditions(value){conditions={...DEFAULT_CONDITIONS,...value};hour=conditions.hour;rebuild();},
    setUpgrades(value){upgrades=value;rebuild();},start(){cycling=true;},
    stop(){cycling=false;hour=conditions.hour;},
    update(dt,realDt=dt){
      elapsed+=dt>0?realDt:0;if(cycling&&conditions.dayNight)hour=(hour+dt/30)%24;
      const daylight=Math.max(0,Math.sin((hour-6)*Math.PI/12)),wet=conditions.weather!=='clear';
      scene.background.copy(night).lerp(wet?storm:day,daylight);
      ambient.intensity=.32+daylight*(wet?.85:1.35);sun.intensity=daylight*(wet?.55:2);
      sun.position.set(Math.cos(hour*Math.PI/12)*350,Math.max(25,daylight*440),180);
      if(conditions.weather==='storm'&&elapsed%13<.5)ambient.intensity+=.5*(1-elapsed%13/.5);
      rain.visible=wet;rain.material.color.set(conditions.weather==='snow'?'#ffffff':'#b4d9fa');rain.material.size=conditions.weather==='snow'?1.2:.65;
      if(wet&&dt>0){for(let i=1;i<positions.length;i+=3)positions[i]=(positions[i]-dt*(conditions.weather==='snow'?4:35)%100+100)%100;geometry.attributes.position.needsUpdate=true;}
      for(const hazard of hazards.children){const ripple=hazard.userData.ripple;if(ripple){const phase=elapsed%2/2;ripple.scale.setScalar(1+phase*2);ripple.material.opacity=(1-phase)*.4;}}
      return {hour,weather:WEATHER[conditions.weather].label};
    },
    dispose(){geometry.dispose();rain.material.dispose();scene.remove(rain);for(const child of [...hazards.children])disposeUpgrade(child);scene.remove(hazards);}
  };
}
