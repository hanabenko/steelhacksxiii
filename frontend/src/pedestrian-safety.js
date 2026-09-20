// Preview-only geometry checks. These are not calibrated crash predictions.
const halfWidth = vehicle => vehicle.kind === 'bus' ? 1.28 : vehicle.kind === 'bike' ? .38 : 1;
function local(point, pose) {
  const x=point.x-pose.x,z=point.z-pose.z;
  return {x:x*Math.cos(pose.angle)-z*Math.sin(pose.angle),z:x*Math.sin(pose.angle)+z*Math.cos(pose.angle)};
}
function crossesBox(a,b,width,length) {
  let enter=0,exit=1;
  for(const [axis,limit] of [['x',width],['z',length]]){
    const delta=b[axis]-a[axis];
    if(Math.abs(delta)<1e-9){if(Math.abs(a[axis])>limit)return false;continue;}
    let lo=(-limit-a[axis])/delta,hi=(limit-a[axis])/delta;
    if(lo>hi)[lo,hi]=[hi,lo];enter=Math.max(enter,lo);exit=Math.min(exit,hi);
    if(enter>exit)return false;
  }
  return true;
}
export function vehicleBlocksWalk(position,next,vehicle,horizon=2) {
  if(!vehicle.enabled)return false;
  const a=local(position,vehicle.pose),b=local(next,vehicle.pose);
  // Conservative swept corridor: leave room ahead of moving traffic, including buses.
  const travel=vehicle.speed*horizon;
  a.z-=travel/2;b.z-=travel/2;
  return crossesBox(a,b,halfWidth(vehicle)+.8,vehicle.length/2+travel/2+1);
}
export function pedestrianContact(before,after,vehicle) {
  if(!vehicle.enabled || vehicle.kind==='bike')return false;
  const previous=vehicle.previousPose||vehicle.pose;
  if(Math.hypot(vehicle.pose.x-previous.x,vehicle.pose.z-previous.z)<.001&&vehicle.speed<.2)return false;
  // Relative swept motion detects contact even when a fast car crosses within one frame.
  const a=local({x:before.x+vehicle.pose.x-previous.x,z:before.z+vehicle.pose.z-previous.z},vehicle.pose);
  const b=local(after,vehicle.pose);
  return crossesBox(a,b,halfWidth(vehicle)+.24,vehicle.length/2+.24);
}
export function recordPedestrianContact(person,before,after,vehicles) {
  if(person.injured)return null;
  const vehicle=vehicles.find(v=>pedestrianContact(before,after,v));
  if(!vehicle)return null;
  person.injured=true;person.injuryTime=0;person.injuryAge=0;person.velocity=0;person.wait=0;
  vehicle.crashWait=2;vehicle.speed=0;vehicle.braking=true;
  return vehicle;
}
