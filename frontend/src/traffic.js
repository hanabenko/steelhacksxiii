import { roadPoint } from './campus-geometry.js';
import { INTERSECTIONS } from './intersections.js';
import { WEATHER, DEFAULT_CONDITIONS } from './scenarios.js';
import { roadAnchor } from './road-layout.js';
import { ROAD_BLOCKS, blockEnds } from './road-blocks.js';

// Illustrative traffic, not a calibrated microscopic transport model. Distances are meters.
export function makeRoute(id, points, axis) {
  const path=points.filter(Boolean).map(p=>({x:p.x,z:p.z}));
  let length=0;path.forEach((p,i)=>{if(i)length+=Math.hypot(p.x-path[i-1].x,p.z-path[i-1].z);p.s=length;});
  const stops=[];
  for(const site of INTERSECTIONS){let nearest=path.reduce((a,p)=>Math.hypot(p.x-site.origin[0],p.z-site.origin[1])<Math.hypot(a.x-site.origin[0],a.z-site.origin[1])?p:a,path[0]);if(Math.hypot(nearest.x-site.origin[0],nearest.z-site.origin[1])<12&&nearest.s>20&&nearest.s<length-15)stops.push({s:nearest.s-17,axis,site:site.id});}
  return {id,path,length,stops};
}
export function poseAt(route,s){
  s=Math.max(0,Math.min(route.length,s));let hi=route.path.findIndex(p=>p.s>=s);hi=Math.max(1,hi<0?route.path.length-1:hi);const a=route.path[hi-1],b=route.path[hi],t=(s-a.s)/(b.s-a.s||1);
  return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,angle:Math.atan2(b.x-a.x,b.z-a.z)};
}
export function campusRoutes(features){
  const sample=(name,axis,start,end,lane)=>{const p=[];const dir=Math.sign(end-start);for(let v=start;(end-v)*dir>=0;v+=dir*2)p.push(roadPoint(features,typeof name==='function'?name(v):name,axis,v,lane));return p.filter(Boolean);};
  const routes=[
    makeRoute('forbes-east-inner',sample('Forbes Avenue','x',-365,260,-1.8),'x'),
    makeRoute('forbes-east-outer',sample('Forbes Avenue','x',-365,260,2.2),'x'),
    makeRoute('fifth-west-inner',sample('Fifth Avenue','x',290,-370,-1.8),'x'),
    makeRoute('fifth-west-outer',sample('Fifth Avenue','x',290,-370,-5),'x'),
    makeRoute('bigelow-south',sample(v=>v>0?'Schenley Drive':'Bigelow Boulevard','z',-295,135,2.2),'z'),
    makeRoute('bigelow-north',sample(v=>v>0?'Schenley Drive':'Bigelow Boulevard','z',135,-295,-2.2),'z'),
    makeRoute('bouquet-south',sample('South Bouquet Street','z',-85,125,1.5),'z'),
  ];
  // A curved left turn joins the same eastbound Forbes lane as through traffic.
  const from=routes[4],to=routes[1];const a=from.path.reduce((best,p)=>Math.abs(p.z+15)<Math.abs(best.z+15)?p:best,from.path[0]);const b=to.path.reduce((best,p)=>Math.abs(p.x-17)<Math.abs(best.x-17)?p:best,to.path[0]);
  const curve=[];for(let i=1;i<25;i++){const t=i/24,u=1-t;curve.push({x:u*u*a.x+2*u*t*a.x+t*t*b.x,z:u*u*a.z+2*u*t*b.z+t*t*b.z});}
  const turn=makeRoute('bigelow-to-forbes', [...from.path.filter(p=>p.s<=a.s),...curve,...to.path.filter(p=>p.s>b.s)],'z');
  turn.stops=from.stops.map(stop=>({...stop}));turn.turnStart=a.s;turn.turnEnd=a.s+30;routes.push(turn);
  return routes;
}
// Join only existing directed lanes. A blocked exit is never selected as a detour.
export function detourRoute(vehicle,routes,hazards){
 const source=vehicle.route;
 const obstructed=p=>hazards.some(h=>{
  const dx=p.x-h.x,dz=p.z-h.z;
  return h.width?Math.abs(dx*Math.sin(h.angle)+dz*Math.cos(h.angle))<4&&Math.abs(dx*Math.cos(h.angle)-dz*Math.sin(h.angle))<h.width/2+1:Math.hypot(dx,dz)<3;
 });
 if(!source.path.some(p=>p.s>vehicle.s&&p.s<vehicle.s+85&&obstructed(p)))return null;
 for(const junction of source.path.filter(p=>p.s>vehicle.s+12&&p.s<vehicle.s+65)){
  if(source.path.some(p=>p.s>vehicle.s&&p.s<=junction.s&&obstructed(p)))break;
  for(const target of routes){
   if(target===source||target.id===source.id)continue;
   const join=target.path.find(p=>p.s<target.length-35&&Math.hypot(p.x-junction.x,p.z-junction.z)<5);
   if(!join)continue;
   const a=poseAt(source,junction.s-10),b=poseAt(target,join.s+14);
   if(Math.cos(a.angle-b.angle)<-.3)continue; // No turns into opposing lanes.
   if(target.path.some(p=>p.s>=join.s&&p.s<join.s+120&&obstructed(p)))continue;
   const curve=[];
   for(let i=1;i<=20;i++){
    const t=i/20,u=1-t;
    curve.push({x:u*u*u*a.x+3*u*u*t*(a.x+8*Math.sin(a.angle))+3*u*t*t*(b.x-8*Math.sin(b.angle))+t*t*t*b.x,z:u*u*u*a.z+3*u*u*t*(a.z+8*Math.cos(a.angle))+3*u*t*t*(b.z-8*Math.cos(b.angle))+t*t*t*b.z});
   }
   if(curve.some(obstructed))continue;
   const prefix=source.path.filter(p=>p.s<junction.s-10);
   const route=makeRoute(target.id,[...prefix,a,...curve,...target.path.filter(p=>p.s>join.s+14)],'x');
   const offset=route.length-target.length;
   route.stops=[...source.stops.filter(p=>p.s<junction.s),...target.stops.filter(p=>p.s>join.s).map(p=>({...p,s:p.s+offset}))];
   route.busStops=(target.busStops||[]).filter(p=>p.s>join.s+14).map(p=>({...p,s:p.s+offset}));
   route.turnStart=junction.s-10;route.turnEnd=junction.s+25;
   return route;
  }
 }
 return null;
}
export function createTraffic(features,count=42,points=[]){
  const routes=campusRoutes(features);
  for(const route of routes)route.busStops=points.filter(p=>p.tags.highway==='bus_stop'&&(route.id.startsWith('forbes')?p.tags.name?.startsWith('Forbes'):route.id.startsWith('fifth')?p.tags.name?.startsWith('Fifth'):false)).map(p=>{const nearest=route.path.reduce((a,b)=>Math.hypot(a.x-p.point[0],a.z-p.point[1])<Math.hypot(b.x-p.point[0],b.z-p.point[1])?a:b);return{id:p.id,s:nearest.s,distance:Math.hypot(nearest.x-p.point[0],nearest.z-p.point[1])};}).filter(p=>p.distance<13);
  const vehicles=Array.from({length:count},(_,i)=>{const route=routes[i%routes.length],rank=Math.floor(i/routes.length)+(i%routes.length===7?.5:0);const kind=i%13===3&&/^(forbes|fifth)/.test(route.id)?'bus':i%7===5?'bike':'car';return{kind,length:kind==='bus'?11.5:kind==='bike'?2:4.5,served:[],dwell:0,route,s:(12+rank*62)%route.length,speed:0,desired:kind==='bike'?4.3:kind==='bus'?7:7.8+(i*17%19)/10,enabled:true,braking:false,pose:poseAt(route,(12+rank*62)%route.length)};});
  function update(dt,signals,upgrades=[],incident=null,pedestrians=[],conditions=DEFAULT_CONDITIONS){
    const weather=WEATHER[conditions.weather||'clear'];
    const minGap=2*weather.min_gap_scale,headway=1.35*weather.tau_scale,decel=3*weather.decel_scale;
    const closures=[...upgrades.filter(i=>i.type==='closure'),...(conditions.closure?[conditions.closure]:[])].map(i=>roadAnchor('closure',i.zone,i.intersection));
    for(const id of conditions.closures||[]){const block=ROAD_BLOCKS.find(b=>b.id===id);if(block)closures.push(...blockEnds(block));}
    const pothole=conditions.pothole&&!upgrades.some(i=>i.type==='repair'&&i.intersection===conditions.pothole.intersection&&i.zone===conditions.pothole.zone)?roadAnchor('repair',conditions.pothole.zone,conditions.pothole.intersection):null;
    const hazards=[...closures,...(pothole?[pothole]:[]),...(conditions.potholes||[])];
    const hazardKey=JSON.stringify(hazards);
    if(dt>0)for(const v of vehicles){
      v.previousPose={...v.pose};
      if(v.enabled&&(v.hazardKey!==hazardKey||Math.abs(v.s-(v.detourCheck??-100))>8)){
        const route=detourRoute(v,routes,hazards);
        if(route){v.route=route;v.detoured=true;}
        v.hazardKey=hazardKey;v.detourCheck=v.s;
      }
    }
    // Substeps keep queue behavior stable at 4x playback and after slow render frames.
    while(dt>0){const h=Math.min(dt,1/30);dt-=h;const snapshots=vehicles.map(v=>({...v,pose:poseAt(v.route,v.s)}));
      vehicles.forEach((v,i)=>{if(!v.enabled)return;if(v.crashWait>0){v.crashWait=Math.max(0,v.crashWait-h);v.speed=0;v.braking=true;v.reacting=true;return;}if(v.dwell>0){v.dwell=Math.max(0,v.dwell-h);v.speed=0;v.braking=true;return;}const old=snapshots[i];let gap=Infinity,target=v.desired*weather.speed;v.reacting=false;
        for(const barrier of closures){const dx=barrier.x-old.pose.x,dz=barrier.z-old.pose.z,along=dx*Math.sin(old.pose.angle)+dz*Math.cos(old.pose.angle),side=Math.abs(dx*Math.cos(old.pose.angle)-dz*Math.sin(old.pose.angle));
          if(along>=0&&along<70&&side<barrier.width/2&&Math.abs(Math.cos(old.pose.angle-barrier.angle))>.7){gap=Math.min(gap,Math.max(0,along-v.length/2-1));v.reacting=true;}}
        if(pothole&&Math.hypot(old.pose.x-pothole.x,old.pose.z-pothole.z)<18)target=Math.min(target,2.5);
        if((conditions.potholes||[]).some(p=>Math.hypot(old.pose.x-p.x,old.pose.z-p.z)<18))target=Math.min(target,2.5);
        for(const person of pedestrians){
          const dx=person.x-old.pose.x,dz=person.z-old.pose.z;
          const along=dx*Math.sin(old.pose.angle)+dz*Math.cos(old.pose.angle),lateral=Math.abs(dx*Math.cos(old.pose.angle)-dz*Math.sin(old.pose.angle));
          if(along>0&&along<40&&lateral<(v.kind==='bus'?1.28:v.kind==='bike'?.38:1)+.65){v.reacting=true;gap=Math.min(gap,Math.max(0,along-v.length/2-.5));}
        }
        if(incident){
          const dx=incident.x-old.pose.x,dz=incident.z-old.pose.z;
          const ahead=dx*Math.sin(old.pose.angle)+dz*Math.cos(old.pose.angle),lateral=Math.abs(dx*Math.cos(old.pose.angle)-dz*Math.sin(old.pose.angle));
          if(ahead>0&&ahead<65&&lateral<incident.radius+1.2){
            v.reacting=true;
            // Treat the wreck and fire as a blocked section, regardless of the traffic signal.
            gap=Math.min(gap,Math.max(0,ahead-incident.radius-v.length/2));
          }
        }
        if(v.route.turnStart&&v.s>v.route.turnStart-18&&v.s<v.route.turnEnd)target=Math.min(target,4.5);
        for(const other of snapshots){if(other===old||!other.enabled)continue;const dx=other.pose.x-old.pose.x,dz=other.pose.z-old.pose.z;const along=dx*Math.sin(old.pose.angle)+dz*Math.cos(old.pose.angle),lateral=Math.abs(dx*Math.cos(old.pose.angle)-dz*Math.sin(old.pose.angle));
          if(along>0&&lateral<2.3&&Math.cos(other.pose.angle-old.pose.angle)>.5)gap=Math.min(gap,along-(v.length+other.length)/2);
        }
        for(const stop of v.route.stops){const distance=stop.s-v.s-(v.length-4.5)/2,state=stop.axis==='x'?signals.penn:signals.cross;if(distance>=0&&(state==='red'||state==='amber'&&distance>v.speed*v.speed/(7*weather.decel_scale)+minGap))gap=Math.min(gap,distance+1.5);
          if(upgrades.some(item=>item.intersection===stop.site&&['crosswalk','diet','curb'].includes(item.type))&&Math.abs(distance)<35)target=Math.min(target,5.5);
        }
        if(v.kind==='bus')for(const stop of v.route.busStops){if(v.served.includes(stop.id))continue;const distance=stop.s-v.s;if(distance<-.5){v.served.push(stop.id);continue;}if(distance<45){gap=Math.min(gap,distance+1.5);if(distance<1&&v.speed<.2){v.dwell=5;v.served.push(stop.id);}}}
        // Leave a two meter gap and a speed-dependent following buffer; brake before the stop line.
        if(Number.isFinite(gap))target=Math.min(target,Math.sqrt(2*decel*Math.max(0,gap-minGap)),Math.max(0,(gap-minGap)/headway));
        const acceleration=Math.max(v.reacting?-Math.max(7*weather.emergency_decel_scale,4.5*weather.decel_scale):-4.5*weather.decel_scale,Math.min(1.7*weather.decel_scale,(target-v.speed)*1.8));v.braking=acceleration<-.35;v.speed=Math.max(0,v.speed+acceleration*h);v.s+=Math.min(v.speed*h,Math.max(0,gap-1.5));
        if(v.s>=v.route.length){const entry=poseAt(v.route,0);if(!snapshots.some(o=>o.enabled&&Math.hypot(o.pose.x-entry.x,o.pose.z-entry.z)<12)){v.s=0;v.speed=0;v.served=[];v.previousPose={...entry};}else v.s=v.route.length;}
        v.pose=poseAt(v.route,v.s);
      });
    }
  }
  return{routes,vehicles,update};
}
