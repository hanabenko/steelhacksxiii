import costs from './data/oakland-costs.json' with {type:'json'};
import { WEATHER, DEFAULT_CONDITIONS, validateConditions } from './scenarios.js';
import {ROAD_BLOCKS} from './road-blocks.js';
export const COST_DATA=costs;
import { INTERSECTIONS, DEFAULT_INTERSECTION, intersectionById } from './intersections.js';
export const BUDGET = 100000;
export const TOOLS = [
  { id: 'crosswalk', name: 'Raised crosswalk', detail: 'An elevated crossing slows approaching cars and makes people easier to see.', benefit: 'Pedestrian priority', tradeoff: 'May add vehicle delay', cost: costs.allowances.crosswalk, icon: 'Footprints' },
  { id: 'bike', name: 'Protected bike lane', detail: 'Bollards separate the bike lane from moving traffic along this approach.', benefit: 'Protected cycling', tradeoff: 'Uses curbside space', cost: costs.allowances.bike, icon: 'Bike' },
  { id: 'curb', name: 'Curb extension', detail: 'Extend the sidewalk into the street to shorten crossings and tighten turns.', benefit: 'Shorter crossings', tradeoff: 'Less turning space', cost: costs.allowances.curb, icon: 'CornerDownRight' },
  { id: 'shelter', name: 'Bus stop shelter', detail: 'Add a sheltered waiting area and a bench alongside this approach.', benefit: 'Comfortable transit access', tradeoff: 'Needs sidewalk space', cost: costs.allowances.shelter, icon: 'TrafficCone' },
  { id: 'diet', name: 'Road diet', detail: 'Convert a travel lane into a planted buffer for a calmer street.', benefit: 'Lower vehicle speeds', tradeoff: 'Reduced lane capacity', cost: costs.allowances.diet, icon: 'Route' },
  { id:'closure',name:'Construction barriers',detail:'Close this approach with orange and white barriers. Traffic takes an available detour; queues only when no safe route is available.',benefit:'Protect a work zone',tradeoff:'Blocks traffic capacity',cost:costs.allowances.closure,icon:'TrafficCone' },
  { id:'repair',name:'Pothole repair',detail:'Patch the road surface on this approach, removing a scenario pothole when locations match.',benefit:'Restore the road surface',tradeoff:'Uses the repair budget',cost:costs.allowances.repair,icon:'Route' },
];
export const DEFAULT_SETTINGS = { demand: 800, green: 35, av: 0, runs: 100 };
export const ZONES = ['north', 'east', 'south', 'west'];
export function costOf(items) { return items.reduce((sum, item) => sum + (TOOLS.find(t => t.id === item.type)?.cost ?? 0), 0); }
export function addUpgrade(items, type, zone, intersection = DEFAULT_INTERSECTION, budget=BUDGET) {
  const tool = TOOLS.find(t => t.id === type);
  if (!tool || !ZONES.includes(zone) || !intersectionById(intersection)) return { error: 'Choose a valid tool and intersection approach.' };
  if (items.some(i => i.type === type && i.zone === zone && (i.intersection || DEFAULT_INTERSECTION) === intersection)) return { error: `${tool.name} is already on this approach.` };
  if (costOf(items) + tool.cost > budget) return { error: 'Not enough budget. Undo an upgrade to free up funds.' };
  return { items: [...items, { type, zone, intersection }] };
}
export function validateSettings(settings) {
  validateConditions(settings.conditions);
  if(settings.budget!==undefined&&(!Number.isFinite(settings.budget)||settings.budget<0))throw new Error('Invalid budget');
  for (const [key, min, max] of [['demand',200,1600],['green',20,60],['av',0,100],['runs',10,1000]]) {
    if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) throw new Error(`Invalid ${key}`);
  }
  if (!Number.isInteger(settings.runs)) throw new Error('Runs must be an integer');
}
export function random(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Transparent, uncalibrated surrogate: paired demand samples, not SUMO or crash prediction.
export function simulate(items, settings = DEFAULT_SETTINGS, seed = 42, {includeTrials=false} = {}) {
  validateSettings(settings);
  const rng = random(seed), count = type => items.filter(i => i.type === type).length;
  const cross = count('crosswalk'), bike = count('bike'), curb = count('curb'), shelter = count('shelter'), diet = count('diet');
  const conditions=settings.conditions||DEFAULT_CONDITIONS,weather=WEATHER[conditions.weather];
  const scenarioClosed=!!conditions.closure&&conditions.closure.intersection===(settings.siteId||DEFAULT_INTERSECTION);
  const hasPothole=!!conditions.pothole&&conditions.pothole.intersection===(settings.siteId||DEFAULT_INTERSECTION);
  const repaired=hasPothole&&items.some(i=>i.type==='repair'&&i.zone===conditions.pothole.zone);
  const protectedPothole=hasPothole&&items.some(i=>i.type==='closure'&&i.zone===conditions.pothole.zone);
  const closures=new Set(items.filter(i=>i.type==='closure').map(i=>i.zone));if(scenarioClosed)closures.add(conditions.closure.zone);
  const placedClosures=(conditions.closures||[]).filter(id=>ROAD_BLOCKS.find(b=>b.id===id)?.intersection===(settings.siteId||DEFAULT_INTERSECTION)).length;
  const placedPotholes=(conditions.potholes||[]).filter(p=>p.intersection===(settings.siteId||DEFAULT_INTERSECTION)).length;
  const closureFactor=Math.max(.15,1-placedClosures*.25);
  const beforeCapacity=980*weather.capacity*(scenarioClosed?.75:1)*closureFactor,afterClosureFactor=Math.max(.15,1-closures.size*.25)*closureFactor;
  const hazardRisk=1+placedPotholes*.12,hazardSpeed=1/(1+placedPotholes*.12);
  const samples = { before: [], after: [] };
  for (let i=0; i<settings.runs; i++) {
    const demand = settings.demand * (0.85 + rng() * .3), noise = .9 + rng() * .2;
    const base = { risk: 12.4 * demand / 800 * noise*weather.risk*(hasPothole?1.2:1)*hazardRisk, speed: (29 + (rng()-.5)*5)*weather.speed*(hasPothole?.8:1)*hazardSpeed, delay: 24 + demand / 90 + Math.max(0,demand-beforeCapacity)*.04+(hasPothole?6:0)+placedPotholes*3, throughput: Math.min(demand, beforeCapacity), access: 48 };
    // AV effects disabled for now: + settings.av*1.2 capacity, - settings.av*.0015 risk.
    const capacity = Math.max(100, (980 - diet*90 - cross*16 - curb*10 + (settings.green-35)*3)*weather.capacity*afterClosureFactor);
    const riskFactor = Math.max(.18, 1 - cross*.11 - bike*.08 - curb*.09 - diet*.13);
    samples.before.push(base);
    samples.after.push({ risk: base.risk*riskFactor/(repaired||protectedPothole?1.2:1), speed: Math.max(5, base.speed/(repaired?.8:1)-cross*.8-curb*1.2-diet*2), delay: Math.max(8, base.delay+cross*.9+diet*3/* AV delay effect disabled: -settings.av*.04 */+(35-settings.green)*.16+(Math.max(0,demand-capacity)-Math.max(0,demand-beforeCapacity))*.04-(repaired?6:0)), throughput: Math.min(demand,capacity), access: Math.min(100,48+cross*9+curb*7+bike*3+diet*3+shelter*4-Math.max(0,settings.green-35)*.35) });
  }
  const aggregate = rows => Object.fromEntries(Object.keys(rows[0]).map(key => {
    const values = rows.map(r=>r[key]), mean = values.reduce((a,b)=>a+b,0)/values.length;
    const variance = values.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,values.length-1);
    return [key,{ mean, ci:1.96*Math.sqrt(variance/values.length) }];
  }));
  const before = aggregate(samples.before), after = aggregate(samples.after);
  const reduction = (1-after.risk.mean/before.risk.mean)*100;
  const retained = after.throughput.mean/before.throughput.mean*100;
  const score = Math.round(Math.min(100,Math.max(0,30+reduction*.65+(after.access.mean-48)*.5-Math.max(0,95-retained))));
  return { before, after, reduction, retained, score, seed, runs:settings.runs, engine:'local-surrogate-v1', samples:samples.after.map(r=>r.risk), ...(includeTrials?{trials:samples}:{}) };
}
export function exportScenario(items, settings, result) {
  return { schemaVersion:2, intersection:'pitt-campus-network', intersections:INTERSECTIONS.map(({id,name,sourceUrl})=>({id,name,sourceUrl})), createdAt:new Date().toISOString(), costBasis:costs, budget:settings.budget??BUDGET, spent:costOf(items), upgrades:items.map(i=>({...i,intersection:i.intersection||DEFAULT_INTERSECTION})), settings:{...settings}, result, disclaimer:'Uncalibrated frontend surrogate. Not a crash forecast. See README for SUMO integration.' };
}

/** Paired multi-site estimates. Shared demand draws preserve covariance; no routing/spillback physics. */
export function simulateNetwork(items, settings=DEFAULT_SETTINGS, seed=42){
  for(const item of items)if(!intersectionById(item.intersection)||!TOOLS.some(t=>t.id===item.type)||!ZONES.includes(item.zone))throw new Error('Invalid network upgrade.');
  const sites=INTERSECTIONS.map(site=>({id:site.id,name:site.name,...simulate(items.filter(item=>(item.intersection||DEFAULT_INTERSECTION)===site.id),{...settings,siteId:site.id},seed,{includeTrials:true})}));
  const combined={};
  for(const phase of ['before','after']){
    combined[phase]={};
    for(const metric of ['risk','speed','delay','throughput','access']){
      const values=Array.from({length:settings.runs},(_,i)=>sites.reduce((sum,site)=>sum+site.trials[phase][i][metric],0)/(metric==='throughput'?1:sites.length));
      const mean=values.reduce((a,b)=>a+b,0)/values.length;const variance=values.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,values.length-1);
      combined[phase][metric]={mean,ci:1.96*Math.sqrt(variance/values.length)};
    }
  }
  const {before,after}=combined,reduction=(1-after.risk.mean/before.risk.mean)*100,retained=after.throughput.mean/before.throughput.mean*100;
  const score=Math.round(Math.min(100,Math.max(0,30+reduction*.65+(after.access.mean-48)*.5-Math.max(0,95-retained))));
  return {before,after,reduction,retained,score,seed,runs:settings.runs,engine:'local-network-surrogate-v1',intersections:sites.map(({trials,...site})=>site),aggregation:'Equal-demand mean across three intersections; throughput sums intersection passages, not unique vehicles. Shared paired demand trials. No rerouting or queue spillback.'};
}
