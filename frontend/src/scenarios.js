import { INTERSECTIONS } from './intersections.js';
import {ROAD_BLOCKS,nearestRoadPoint} from './road-blocks.js';

import {WEATHER} from './weather.js';
export {WEATHER};
export const DEFAULT_CONDITIONS={weather:'clear',closure:null,pothole:null,closures:[],potholes:[],hour:9,dayNight:true};
export function makeScenario(rng=Math.random){
  const index=Math.floor(rng()*4),site=INTERSECTIONS[Math.floor(rng()*INTERSECTIONS.length)];
  const zone=['north','east','south','west'][Math.floor(rng()*4)];
  const hazard={intersection:site.id,zone};
  const variants=[
    {title:'Rainy Oakland commute',description:'Wet roads slow traffic. Improve crossings and transit access under a limited budget.',weather:'rain'},
    {title:'Thunderstorm at rush hour',description:'Poor visibility and reduced road capacity. Balance safer streets with long queues.',weather:'storm'},
    {title:'Campus construction',description:`${site.name}: the ${zone} approach is closed. Traffic takes available turns around the closure; make the remaining network safer.`,closure:hazard},
    {title:'Pothole season',description:`A large pothole on the ${zone} approach at ${site.name} slows traffic. Repair it ($8,000) or isolate the approach with barriers ($4,000).`,pothole:hazard},
  ];
  const chosen=variants[index],budget=[60000,80000,100000][Math.floor(rng()*3)];
  return {id:chosen.title.toLowerCase().replaceAll(' ','-'),title:chosen.title,description:chosen.description,budget,
    settings:{demand:[800,1000,1200][Math.floor(rng()*3)],green:[25,35,45][Math.floor(rng()*3)],av:0 /* AV scenarios disabled for now */,runs:100,budget,
      conditions:{...DEFAULT_CONDITIONS,...Object.fromEntries(['weather','closure','pothole'].filter(k=>chosen[k]).map(k=>[k,chosen[k]])),hour:index===1?18:9}}};
}
export function validateConditions(conditions){
  if(!conditions)return;
  if(!WEATHER[conditions.weather]||!Number.isFinite(conditions.hour)||conditions.hour<0||conditions.hour>24||typeof conditions.dayNight!=='boolean')throw new Error('Invalid weather or time conditions');
  for(const key of ['closure','pothole']){const hazard=conditions[key];if(hazard&&(!INTERSECTIONS.some(s=>s.id===hazard.intersection)||!['north','east','south','west'].includes(hazard.zone)))throw new Error('Invalid '+key+' location');}
  if(conditions.closures&&(!Array.isArray(conditions.closures)||conditions.closures.some(id=>!ROAD_BLOCKS.some(b=>b.id===id))))throw new Error('Invalid closure block');
  if(conditions.potholes&&(!Array.isArray(conditions.potholes)||conditions.potholes.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z)||!nearestRoadPoint(p.x,p.z))))throw new Error('Invalid pothole placement');
}
