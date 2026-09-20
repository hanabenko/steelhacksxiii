import { roadPoint } from './campus-geometry.js';
import { INTERSECTIONS } from './intersections.js';

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
export function createTraffic(features,count=42,points=[]){
  const routes=campusRoutes(features);
  for(const route of routes)route.busStops=points.filter(p=>p.tags.highway==='bus_stop'&&(route.id.startsWith('forbes')?p.tags.name?.startsWith('Forbes'):route.id.startsWith('fifth')?p.tags.name?.startsWith('Fifth'):false)).map(p=>{const nearest=route.path.reduce((a,b)=>Math.hypot(a.x-p.point[0],a.z-p.point[1])<Math.hypot(b.x-p.point[0],b.z-p.point[1])?a:b);return{id:p.id,s:nearest.s,distance:Math.hypot(nearest.x-p.point[0],nearest.z-p.point[1])};}).filter(p=>p.distance<13);
  const vehicles=Array.from({length:count},(_,i)=>{const route=routes[i%routes.length],rank=Math.floor(i/routes.length)+(i%routes.length===7?.5:0);const kind=i%13===3&&/^(forbes|fifth)/.test(route.id)?'bus':i%7===5?'bike':'car';return{kind,length:kind==='bus'?11.5:kind==='bike'?2:4.5,served:[],dwell:0,route,s:(12+rank*62)%route.length,speed:0,desired:kind==='bike'?4.3:kind==='bus'?7:7.8+(i*17%19)/10,enabled:true,braking:false,pose:poseAt(route,(12+rank*62)%route.length)};});
  function update(dt,signals,upgrades=[],incident=null){
    // Substeps keep queue behavior stable at 4x playback and after slow render frames.
    while(dt>0){const h=Math.min(dt,1/30);dt-=h;const snapshots=vehicles.map(v=>({...v,pose:poseAt(v.route,v.s)}));
      vehicles.forEach((v,i)=>{if(!v.enabled)return;if(v.dwell>0){v.dwell=Math.max(0,v.dwell-h);v.speed=0;v.braking=true;return;}const old=snapshots[i];let gap=Infinity,target=v.desired;v.reacting=false;
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
        for(const stop of v.route.stops){const distance=stop.s-v.s-(v.length-4.5)/2,state=stop.axis==='x'?signals.penn:signals.cross;if(distance>=0&&(state==='red'||state==='amber'&&distance>v.speed*v.speed/7+2))gap=Math.min(gap,distance+1.5);
          if(upgrades.some(item=>item.intersection===stop.site&&['crosswalk','diet','curb'].includes(item.type))&&Math.abs(distance)<35)target=Math.min(target,5.5);
        }
        if(v.kind==='bus')for(const stop of v.route.busStops){if(v.served.includes(stop.id))continue;const distance=stop.s-v.s;if(distance<-.5){v.served.push(stop.id);continue;}if(distance<45){gap=Math.min(gap,distance+1.5);if(distance<1&&v.speed<.2){v.dwell=5;v.served.push(stop.id);}}}
        // Leave a two meter gap and a speed-dependent following buffer; brake before the stop line.
        if(Number.isFinite(gap))target=Math.min(target,Math.sqrt(2*3*Math.max(0,gap-2)),Math.max(0,(gap-2)/1.35));
        const acceleration=Math.max(v.reacting?-7:-4.5,Math.min(1.7,(target-v.speed)*1.8));v.braking=acceleration<-.35;v.speed=Math.max(0,v.speed+acceleration*h);v.s+=Math.min(v.speed*h,Math.max(0,gap-1.5));
        if(v.s>=v.route.length){const entry=poseAt(v.route,0);if(!snapshots.some(o=>o.enabled&&Math.hypot(o.pose.x-entry.x,o.pose.z-entry.z)<12)){v.s=0;v.speed=0;v.served=[];}else v.s=v.route.length;}
        v.pose=poseAt(v.route,v.s);
      });
    }
  }
  return{routes,vehicles,update};
}
