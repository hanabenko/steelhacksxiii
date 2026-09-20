import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateGame,runGameTrialBatch,gameComparison} from '../src/game-trials.js';
import {trialPreviewPlan} from '../src/trial-preview.js';
import {DEFAULT_SETTINGS,TOOLS} from '../src/model.js';
import {DEFAULT_CONDITIONS} from '../src/scenarios.js';
const hazard={intersection:'pitt-forbes-bigelow',zone:'east'};
const settings={...DEFAULT_SETTINGS,runs:500,conditions:{...DEFAULT_CONDITIONS,pothole:hazard}};
test('game baseline is repeatable, complete, and identical to an unchanged design',()=>{
 const a=evaluateGame([],settings),b=evaluateGame([],structuredClone(settings));
 assert.deepEqual(a,b);assert.equal(a.timeline.length,500);assert.equal(a.timeline.at(-1),a.accidents);
});
test('repair and matching barriers mitigate pothole exposure at different costs',()=>{
 const base=evaluateGame([],settings),repair=evaluateGame([{type:'repair',...hazard}],settings),closed=evaluateGame([{type:'closure',...hazard}],settings);
 assert.ok(repair.result.after.risk.mean<base.result.after.risk.mean);
 assert.equal(repair.accidents,closed.accidents);assert.ok(repair.accidents<=base.accidents);
 assert.ok(repair.result.after.throughput.mean>closed.result.after.throughput.mean);
 assert.notEqual(TOOLS.find(t=>t.id==='repair').cost,TOOLS.find(t=>t.id==='closure').cost);
 const wrong=evaluateGame([{type:'closure',...hazard,zone:'west'}],settings);assert.equal(wrong.accidents,base.accidents);
});

test('preview threshold shows all rounds below 150 and samples 30 at and above 150',()=>{
 const small=trialPreviewPlan(149),large=trialPreviewPlan(150);
 assert.equal(small.count,149);assert.equal(small.sampled,false);
 assert.deepEqual(small.checkpoints,Array.from({length:149},(_,i)=>i+1));
 assert.equal(large.count,30);assert.equal(large.sampled,true);
 assert.equal(large.checkpoints.at(-1),150);assert.equal(new Set(large.checkpoints).size,30);
 assert.ok(large.durationMs<small.durationMs);
});

test('sampling presentation still calculates every round and preserves exact outcomes',async()=>{
 for(const runs of [10,149,150,500]){
  const config={...settings,runs},updates=[],delays=[];
  const actual=await runGameTrialBatch([],config,{onProgress:p=>updates.push(p),wait:async ms=>delays.push(ms)});
  assert.deepEqual(actual,evaluateGame([],config));assert.equal(actual.timeline.length,runs);
  assert.equal(updates.length,runs<150?runs:30);assert.equal(updates.at(-1).completed,runs);
  assert.ok(delays.reduce((sum,ms)=>sum+ms,0)<=3001);
 }
});

test('game comparison uses its evaluated baseline at every locked signal duration',()=>{
 for(const green of [25,35,45]){
  const config={...settings,green},base=evaluateGame([],config);
  const same=gameComparison(base,evaluateGame([],config));
  assert.deepEqual(same.result.before,same.result.after);assert.equal(same.saved,0);assert.equal(same.result.reduction,0);
  for(const site of same.result.intersections)assert.deepEqual(site.before,site.after);
  const upgraded=gameComparison(base,evaluateGame([{type:'repair',...hazard}],config));
  assert.deepEqual(upgraded.result.before,base.result.after);assert.ok(upgraded.result.after.risk.mean<upgraded.result.before.risk.mean);
 }
});

test('challenge score rewards fixing a road closure even when accident counts do not change',()=>{
 const config={...settings,demand:1200,conditions:{...DEFAULT_CONDITIONS,closure:{...hazard,repairable:true}}},items=[{type:'repair',...hazard}];
 const base=evaluateGame([],config),outcome=evaluateGame(items,config);
 const comparison=gameComparison(base,outcome,{conditions:config.conditions,items});
 assert.ok(comparison.result.after.throughput.mean>comparison.result.before.throughput.mean);
 assert.equal(comparison.result.hazards.addressed,1);assert.ok(comparison.score>=50);
 assert.equal(gameComparison(base,base,{conditions:config.conditions,items:[]}).score,0);
});

test('pedestrian goal completion contributes to the campus challenge score',()=>{
 const config={...settings,pedestrianDemand:1800},base=evaluateGame([],config);
 const items=base.result.intersections.map(site=>({type:'crosswalk',intersection:site.id,zone:'east'}));
 const comparison=gameComparison(base,evaluateGame(items,config),{conditions:config.conditions,items,pedestrianGoal:15});
 assert.equal(comparison.result.pedestrianObjective.achieved,true);assert.ok(comparison.score>=40);
 assert.equal(gameComparison(base,base,{conditions:config.conditions,items:[],pedestrianGoal:15}).result.pedestrianObjective.achieved,false);
});
