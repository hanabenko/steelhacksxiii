export const BUDGET = 100000;
export const TOOLS = [
  { id: 'crosswalk', name: 'Raised crosswalk', detail: 'An elevated crossing slows approaching cars and makes people easier to see.', benefit: 'Pedestrian priority', tradeoff: 'May add vehicle delay', cost: 12000, icon: 'Footprints' },
  { id: 'bike', name: 'Protected bike lane', detail: 'Bollards separate the bike lane from moving traffic along this approach.', benefit: 'Protected cycling', tradeoff: 'Uses curbside space', cost: 24000, icon: 'Bike' },
  { id: 'curb', name: 'Curb extension', detail: 'Extend the sidewalk into the street to shorten crossings and tighten turns.', benefit: 'Shorter crossings', tradeoff: 'Less turning space', cost: 18000, icon: 'CornerDownRight' },
  { id: 'signal', name: 'Smart signal', detail: 'Upgrade the signal controller to coordinate traffic through the intersection.', benefit: 'Smoother traffic flow', tradeoff: 'Timing needs calibration', cost: 16000, icon: 'TrafficCone' },
  { id: 'diet', name: 'Road diet', detail: 'Convert a travel lane into a planted buffer for a calmer street.', benefit: 'Lower vehicle speeds', tradeoff: 'Reduced lane capacity', cost: 28000, icon: 'Route' },
];
export const DEFAULT_SETTINGS = { demand: 800, green: 35, av: 0, runs: 100 };
export const ZONES = ['north', 'east', 'south', 'west'];
export function costOf(items) { return items.reduce((sum, item) => sum + (TOOLS.find(t => t.id === item.type)?.cost ?? 0), 0); }
export function addUpgrade(items, type, zone) {
  const tool = TOOLS.find(t => t.id === type);
  if (!tool || !ZONES.includes(zone)) return { error: 'Choose a valid tool and intersection approach.' };
  if (items.some(i => i.type === type && i.zone === zone)) return { error: `${tool.name} is already on this approach.` };
  if (costOf(items) + tool.cost > BUDGET) return { error: 'Not enough budget. Undo an upgrade to free up funds.' };
  return { items: [...items, { type, zone }] };
}
export function validateSettings(settings) {
  for (const [key, min, max] of [['demand',200,1600],['green',20,60],['av',0,100],['runs',10,1000]]) {
    if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) throw new Error(`Invalid ${key}`);
  }
  if (!Number.isInteger(settings.runs)) throw new Error('Runs must be an integer');
}
export function random(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Transparent, uncalibrated surrogate: paired demand samples, not SUMO or crash prediction.
export function simulate(items, settings = DEFAULT_SETTINGS, seed = 42) {
  validateSettings(settings);
  const rng = random(seed), count = type => items.filter(i => i.type === type).length;
  const cross = count('crosswalk'), bike = count('bike'), curb = count('curb'), signal = count('signal'), diet = count('diet');
  const samples = { before: [], after: [] };
  for (let i=0; i<settings.runs; i++) {
    const demand = settings.demand * (0.85 + rng() * .3), noise = .9 + rng() * .2;
    const base = { risk: 12.4 * demand / 800 * noise, speed: 29 + (rng()-.5)*5, delay: 24 + demand / 90 + Math.max(0,demand-980)*.04, throughput: Math.min(demand, 980), access: 48 };
    const capacity = Math.max(400, 980 - diet*90 - cross*16 - curb*10 + signal*60 + settings.av*1.2 + (settings.green-35)*3);
    const riskFactor = Math.max(.18, 1 - cross*.11 - bike*.08 - curb*.09 - diet*.13 - signal*.055 - settings.av*.0015);
    samples.before.push(base);
    samples.after.push({ risk: base.risk*riskFactor, speed: Math.max(15, base.speed-cross*.8-curb*1.2-diet*2), delay: Math.max(8, base.delay+cross*.9+diet*3-signal*3-settings.av*.04+(35-settings.green)*.16+(Math.max(0,demand-capacity)-Math.max(0,demand-980))*.04), throughput: Math.min(demand,capacity), access: Math.min(100,48+cross*9+curb*7+bike*3+diet*3-Math.max(0,settings.green-35)*.35) });
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
  return { before, after, reduction, retained, score, seed, runs:settings.runs, engine:'local-surrogate-v1', samples:samples.after.map(r=>r.risk) };
}
export function exportScenario(items, settings, result) {
  return { schemaVersion:1, intersection:'penn-21st-pittsburgh', createdAt:new Date().toISOString(), budget:BUDGET, spent:costOf(items), upgrades:items.map(i=>({...i})), settings:{...settings}, result, disclaimer:'Uncalibrated frontend surrogate. Not a crash forecast. See README for SUMO integration.' };
}
