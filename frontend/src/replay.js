import * as THREE from 'three';

export function replaySample(payload,time){
  const frames=payload.frames;
  if(!frames?.length)return [];
  let low=0,high=frames.length-1;
  while(low<high){const mid=Math.ceil((low+high)/2);if(frames[mid].t<=time)low=mid;else high=mid-1;}
  const before=frames[low],after=frames[Math.min(low+1,frames.length-1)];
  const ratio=Math.min(1,Math.max(0,(time-before.t)/(after.t-before.t||1)));
  const next=new Map(after.agents.map(a=>[a.id,a]));
  return before.agents.map(a=>{const b=next.get(a.id)||a;return {...a,
    longitude:a.longitude+(b.longitude-a.longitude)*ratio,latitude:a.latitude+(b.latitude-a.latitude)*ratio,
    heading:(a.heading||0)+((((b.heading||0)-(a.heading||0)+540)%360)-180)*ratio};});
}

export function createReplayLayer(scene,map){
 const group=new THREE.Group();scene.add(group);const actors=new Map();let payload=null,time=0;
 const vehicleGeometry=new THREE.BoxGeometry(1.8,1.5,4.4),personGeometry=new THREE.CylinderGeometry(.3,.3,1.7,8);
 const vehicleMaterial=new THREE.MeshStandardMaterial({color:'#408ec6'}),personMaterial=new THREE.MeshStandardMaterial({color:'#edaa60'});
 function clear(){actors.clear();group.clear();}
 return {
  get active(){return !!payload;},
  get signals(){
    const timeline=payload?.signal_states||[];if(!timeline.length)return null;
    let index=0;while(index+1<timeline.length&&timeline[index+1].t<=time)index++;
    const state=timeline[index].state||'';
    const color=part=>/[Gg]/.test(part)?'green':/[yY]/.test(part)?'amber':'red';
    return {penn:color(state.slice(0,3)),cross:color(state.slice(8,15)),remaining:Math.max(0,Math.ceil((timeline[index+1]?.t??payload.duration_s)-time))};
  },
  set(value){if(value&&(!Array.isArray(value.frames)||!Number.isFinite(value.duration_s)||value.duration_s<=0))throw new Error('Invalid SUMO replay');payload=value;time=0;clear();},
  update(dt){if(!payload)return;time=(time+dt)%payload.duration_s;const visible=new Set();for(const agent of replaySample(payload,time)){
    if(!Number.isFinite(agent.longitude)||!Number.isFinite(agent.latitude))continue;
    visible.add(agent.id);let actor=actors.get(agent.id);if(!actor){const person=agent.type==='pedestrian';actor=new THREE.Mesh(person?personGeometry:vehicleGeometry,person?personMaterial:vehicleMaterial);actors.set(agent.id,actor);group.add(actor);}
    const east=(agent.longitude-map.center.lon)*111320*Math.cos(map.center.lat*Math.PI/180),north=-(agent.latitude-map.center.lat)*111320;
    actor.position.set(east*Math.cos(map.rotation)+north*Math.sin(map.rotation),1,-east*Math.sin(map.rotation)+north*Math.cos(map.rotation));
    actor.rotation.y=Math.PI-(agent.heading||0)*Math.PI/180+map.rotation;
  }for(const [id,actor] of actors)if(!visible.has(id)){group.remove(actor);actors.delete(id);}return {time,count:actors.size};},
  dispose(){clear();scene.remove(group);vehicleGeometry.dispose();personGeometry.dispose();vehicleMaterial.dispose();personMaterial.dispose();},
 };
}
