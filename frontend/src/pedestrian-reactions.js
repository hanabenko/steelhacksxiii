// Sidewalk reactions for the illustrative collision replay. Pedestrians stay on their route.
export function updatePedestrianReaction(person,index,dt,position,incident){
  if(dt<=0)return;
  const normal=.7+index%3*.15;
  person.velocity??=normal;person.walkPhase??=0;person.wait??=0;
  const distance=incident?Math.hypot(position.x-incident.x,position.z-incident.z):Infinity;
  person.reacting=distance<26;
  let desired=normal;
  if(person.reacting){
    person.wait=1+(index%4)*.35;
    // Step away along the sidewalk if close; others pause and watch from a safe distance.
    desired=distance<18?Math.sign(position.x-incident.x||index%2-.5)*1.5:0;
    person.lookAngle=Math.atan2(incident.x-position.x,incident.z-position.z);
  }else if(person.wait>0){person.wait=Math.max(0,person.wait-dt);desired=0;}
  else person.lookAngle=Math.PI/2;
  const change=Math.max(-3*dt,Math.min(3*dt,desired-person.velocity));person.velocity+=change;
  person.p+=person.velocity*dt;person.walkPhase+=Math.abs(person.velocity)*dt*7;
}
