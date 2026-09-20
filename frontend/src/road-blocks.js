import map from './data/intersection.json' with {type:'json'};
import { roadWidth, nearestIntersection } from './road-layout.js';
import { INTERSECTIONS } from './intersections.js';
const drivable=new Set(['trunk','primary','secondary','tertiary','residential','unclassified','living_street','service']);
const key=p=>p.map(n=>n.toFixed(2)).join(',');
// OSM road chains end at shared road junctions, not arbitrary screen coordinates.
export function buildRoadBlocks(features){
  const nodes=new Map(),edges=[],seen=new Set();
  for(const road of features.filter(f=>drivable.has(f.tags.highway)&&f.tags.name))for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],ka=key(a),kb=key(b),edgeKey=[ka,kb].sort().join('|');
    if(ka===kb||seen.has(edgeKey))continue;seen.add(edgeKey);
    for(const [id,point] of [[ka,a],[kb,b]])if(!nodes.has(id))nodes.set(id,{point,edges:[],names:new Set()});
    const edge={a:ka,b:kb,name:road.tags.name,id:edges.length};edges.push(edge);
    for(const id of [ka,kb]){nodes.get(id).edges.push(edge);nodes.get(id).names.add(edge.name);}
  }
  const boundary=id=>nodes.get(id).edges.length!==2||nodes.get(id).names.size>1,visited=new Set(),blocks=[];
  function walk(edge,start){
    const points=[nodes.get(start).point];let node=start,current=edge;
    while(current&&!visited.has(current.id)){
      visited.add(current.id);node=current.a===node?current.b:current.a;points.push(nodes.get(node).point);
      if(boundary(node))break;current=nodes.get(node).edges.find(e=>!visited.has(e.id)&&e.name===edge.name);
    }
    const length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);
    if(length<25)return;
    // Restrict placement to the rendered campus field.
    if(points.some(([x,z])=>x<map.bounds.minX||x>map.bounds.maxX||z<map.bounds.minZ||z>map.bounds.maxZ))return;
    const center=points[Math.floor(points.length/2)],site=nearestIntersection(...center,INTERSECTIONS);
    blocks.push({id:edge.name+':'+key(points[0])+':'+key(points.at(-1)),name:edge.name,points,width:roadWidth(edge.name),length,intersection:site.id});
  }
  for(const edge of edges)if(!visited.has(edge.id)&&(boundary(edge.a)||boundary(edge.b)))walk(edge,boundary(edge.a)?edge.a:edge.b);
  for(const edge of edges)if(!visited.has(edge.id))walk(edge,edge.a);
  return blocks;
}
export const ROAD_BLOCKS=buildRoadBlocks(map.features);
export function nearestRoadPoint(x,z){
  let best=null;
  for(const block of ROAD_BLOCKS)for(let i=1;i<block.points.length;i++){
    const a=block.points[i-1],b=block.points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    const px=a[0]+dx*t,pz=a[1]+dz*t,distance=Math.hypot(x-px,z-pz);
    if(distance<=block.width/2-1&&(!best||distance<best.distance))best={x,z,distance,block,angle:Math.atan2(dx,dz)};
  }
  return best;
}
export function blockEnds(block){
  return [[block.points[0],block.points[1]],[block.points.at(-1),block.points.at(-2)]].map(([a,b])=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),inset=Math.min(5,length/3);
    return{x:a[0]+dx/length*inset,z:a[1]+dz/length*inset,angle:Math.atan2(dx,dz),width:block.width};
  });
}
