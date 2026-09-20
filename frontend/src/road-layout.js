import map from './data/intersection.json' with {type:'json'};
import { intersectionById } from './intersections.js';
import { roadPoint } from './campus-geometry.js';

export function roadWidth(name){
  if(name==='Fifth Avenue')return 15;
  if(['Forbes Avenue','Bigelow Boulevard'].includes(name))return 13.5;
  const road=map.features.find(f=>f.tags.name===name&&f.tags.highway);
  return Number.parseFloat(road?.tags.width)||Math.max(5,(+road?.tags.lanes||2)*3.2);
}
export function approachRoad(zone,intersection){
  const site=intersectionById(intersection),horizontal=['east','west'].includes(zone);
  return {site,name:horizontal?site.primaryRoad:site.id==='pitt-forbes-bigelow'&&zone==='south'?'Schenley Drive':site.crossRoad,axis:horizontal?'x':'z',sign:['east','south'].includes(zone)?1:-1};
}
export function roadAnchor(type,zone,intersection){
  const {site,name,axis,sign}=approachRoad(zone,intersection),width=roadWidth(name);
  const distance=['bike','diet'].includes(type)?34:type==='signal'?16:12;
  const coordinate=site.origin[axis==='x'?0:1]+sign*distance;
  const lane=type==='bike'?width/2-1.4:type==='diet'?-width/2+1.8:['curb','signal','shelter'].includes(type)?sign*(width/2+(type==='signal'?1.4:type==='shelter'?2:0)):0;
  const point=roadPoint(map.features,name,axis,coordinate,lane);
  if(!point)throw new Error('Missing road geometry for '+name);
  return {...point,rotation:point.angle-Math.PI/2,axis,name,width,coordinate,lane};
}
export function sampleAnchor(anchor,along=0,across=0){
  const component=anchor.axis==='x'?Math.sin(anchor.angle):Math.cos(anchor.angle);
  return roadPoint(map.features,anchor.name,anchor.axis,anchor.coordinate+along*component,anchor.lane+across);
}
export function nearestIntersection(x,z,sites){return sites.reduce((best,site)=>Math.hypot(x-site.origin[0],z-site.origin[1])<Math.hypot(x-best.origin[0],z-best.origin[1])?site:best,sites[0]);}
