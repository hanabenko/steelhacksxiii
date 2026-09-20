import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateGame,runGameTrialBatch} from '../src/game-trials.js';
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
