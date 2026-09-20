import { vehicleBlocksWalk } from './pedestrian-safety.js';
// Sidewalk reactions and cautious gap acceptance in the illustrative preview.
export function updatePedestrianReaction(person,index,dt,position,incident,vehicles=[],next={x:position.x+2,z:position.z}){
  if(dt<=0)return;
  if(person.injured){person.injuryTime+=dt;person.velocity=0;return;}
  const normal=.7+index%3*.15;
  person.velocity??=normal;person.walkPhase??=0;person.wait??=0;
  const distance=incident?Math.hypot(position.x-incident.x,position.z-incident.z):Infinity;
  const blocker=vehicles.find(vehicle=>vehicleBlocksWalk(position,next,vehicle));
  person.reacting=distance<26||!!blocker;person.waitingForTraffic=!!blocker;
  let desired=normal;
  if(blocker){
    // Stop before stepping into the swept vehicle corridor; wait for a clear gap.
    person.wait=1.2;person.velocity=0;desired=0;
    person.lookAngle=Math.atan2(blocker.pose.x-position.x,blocker.pose.z-position.z);
  }else if(distance<26){
    person.wait=1+(index%4)*.35;
    // Step away along the sidewalk if close; others pause and watch from a safe distance.
    desired=distance<18?Math.sign(position.x-incident.x||index%2-.5)*1.5:0;
    person.lookAngle=Math.atan2(incident.x-position.x,incident.z-position.z);
  }else if(person.wait>0){person.wait=Math.max(0,person.wait-dt);desired=0;}
  else person.lookAngle=Math.PI/2;
  const change=Math.max(-3*dt,Math.min(3*dt,desired-person.velocity));person.velocity+=change;
  person.p+=person.velocity*dt;person.walkPhase+=Math.abs(person.velocity)*dt*7;
}
