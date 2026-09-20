/** Geometry helpers shared by campus rendering and regression tests. Distances are meters. */
export function centerOf(points) {
  const ring=points.slice(0,-1);const values=ring.length?ring:points;
  return [0,1].map(i=>(Math.min(...values.map(p=>p[i]))+Math.max(...values.map(p=>p[i])))/2);
}
export function containsPoint([x,z],points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [a,b]=points[i],[c,d]=points[j];if((b>z)!==(d>z)&&x<(c-a)*(z-b)/(d-b)+a)inside=!inside;}return inside;}
export function clearOfSignals(point,signals,radius=6){return signals.every(signal=>Math.hypot(point[0]-signal[0],point[1]-signal[1])>=radius);}
export function clipSegment(a,b,bounds){
  let low=0,high=1;const dx=b[0]-a[0],dz=b[1]-a[1];
  for(const [p,q] of [[-dx,a[0]-bounds.minX],[dx,bounds.maxX-a[0]],[-dz,a[1]-bounds.minZ],[dz,bounds.maxZ-a[1]]]){
    if(p===0){if(q<0)return null;continue;}const r=q/p;if(p<0)low=Math.max(low,r);else high=Math.min(high,r);if(low>high)return null;
  }return [[a[0]+low*dx,a[1]+low*dz],[a[0]+high*dx,a[1]+high*dz]];
}
export function roadPoint(features,name,axis,distance,lane=0){
  const k=axis==='x'?0:1;let best=null;
  for(const f of features.filter(f=>f.tags.name===name&&f.tags.highway))for(let i=1;i<f.points.length;i++){
    let a=f.points[i-1],b=f.points[i];if(a[k]>b[k])[a,b]=[b,a];if(distance<a[k]||distance>b[k]||a[k]===b[k])continue;
    const t=(distance-a[k])/(b[k]-a[k]),x=a[0]+t*(b[0]-a[0]),z=a[1]+t*(b[1]-a[1]);const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    const candidate={x:x-dz/length*lane,z:z+dx/length*lane,angle:Math.atan2(dx,dz),offset:Math.abs(k===0?z:x)};
    if(!best||candidate.offset<best.offset)best=candidate;
  }return best;
}
