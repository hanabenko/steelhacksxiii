import { INTERSECTIONS } from './intersections.js';
import {ROAD_BLOCKS,nearestRoadPoint} from './road-blocks.js';

import {WEATHER} from './weather.js';
export {WEATHER};
export const DEFAULT_CONDITIONS={weather:'clear',closure:null,pothole:null,closures:[],potholes:[],hour:9,dayNight:true};
export function makeScenario(rng=Math.random,kind){
  const index=kind==='campus'?4:Math.floor(rng()*5),site=INTERSECTIONS[Math.floor(rng()*INTERSECTIONS.length)];
  const zone=['north','east','south','west'][Math.floor(rng()*4)];
  const hazard={intersection:site.id,zone};
  const location=`${site.name}, ${zone} approach`;
  const variants=[
    {title:'Rainy commute with road damage',description:`${location}: a pothole makes wet-road travel harder. Repair it ($8,000), or isolate it with construction barriers ($4,000) and accept reduced capacity.`,weather:'rain',pothole:hazard},
    {title:'Storm recovery',description:`${location}: road damage has closed the approach during a storm. Place Road repair ($8,000) on that approach to reopen it, then improve the remaining streets.`,weather:'storm',closure:{...hazard,repairable:true}},
    {title:'Damaged-road closure',description:`${location}: the approach is closed for damaged pavement. Place Road repair ($8,000) on the matching approach to reopen it and restore capacity.`,closure:{...hazard,repairable:true}},
    {title:'Pothole season',description:`${location}: a large pothole slows traffic. Repair it ($8,000) or isolate the approach with construction barriers ($4,000).`,pothole:hazard},
    {title:'Campus class change',description:`Help students reach class: increase campus pedestrian throughput by 15% with raised crosswalks and curb extensions across the three intersections. ${location} also has a pothole to repair or isolate. Keep at least 95% of vehicle throughput.`,pothole:hazard,pedestrianGoal:15,pedestrianDemand:1800},
  ];
  const chosen=variants[index],budget=index===4?100000:[60000,80000,100000][Math.floor(rng()*3)];
  return {id:chosen.title.toLowerCase().replaceAll(' ','-'),title:chosen.title,description:chosen.description,budget,pedestrianGoal:chosen.pedestrianGoal,
    settings:{demand:[800,1000,1200][Math.floor(rng()*3)],green:[25,35,45][Math.floor(rng()*3)],av:0 /* AV scenarios disabled for now */,runs:100,budget,pedestrianDemand:chosen.pedestrianDemand||900,
      conditions:{...DEFAULT_CONDITIONS,...Object.fromEntries(['weather','closure','pothole'].filter(k=>chosen[k]).map(k=>[k,chosen[k]])),hour:index===1?18:9}}};
}
export function validateConditions(conditions){
  if(!conditions)return;
  if(!WEATHER[conditions.weather]||!Number.isFinite(conditions.hour)||conditions.hour<0||conditions.hour>24||typeof conditions.dayNight!=='boolean')throw new Error('Invalid weather or time conditions');
  for(const key of ['closure','pothole']){const hazard=conditions[key];if(hazard&&(!INTERSECTIONS.some(s=>s.id===hazard.intersection)||!['north','east','south','west'].includes(hazard.zone)))throw new Error('Invalid '+key+' location');}
  if(conditions.closures&&(!Array.isArray(conditions.closures)||conditions.closures.some(id=>!ROAD_BLOCKS.some(b=>b.id===id))))throw new Error('Invalid closure block');
  if(conditions.potholes&&(!Array.isArray(conditions.potholes)||conditions.potholes.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z)||!nearestRoadPoint(p.x,p.z))))throw new Error('Invalid pothole placement');
}

// Repairs only reopen explicitly repairable scenario closures, never arbitrary work zones.
export function resolvedHazards(conditions,items=[]){
  const repaired=hazard=>hazard&&items.some(i=>i.type==='repair'&&i.intersection===hazard.intersection&&i.zone===hazard.zone);
  return {...conditions,closure:conditions.closure?.repairable&&repaired(conditions.closure)?null:conditions.closure,pothole:repaired(conditions.pothole)?null:conditions.pothole};
}

export function hazardProgress(conditions,items=[]){
  const effective=resolvedHazards(conditions,items);
  const hazards=[conditions.pothole,conditions.closure?.repairable?conditions.closure:null].filter(Boolean);
  const protectedPothole=conditions.pothole&&items.some(i=>i.type==='closure'&&i.intersection===conditions.pothole.intersection&&i.zone===conditions.pothole.zone);
  const addressed=Number(!!conditions.pothole&&(!effective.pothole||!!protectedPothole))+Number(!!conditions.closure?.repairable&&!effective.closure);
  return {addressed,total:hazards.length};
}
