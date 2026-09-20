import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateGame} from '../src/game-trials.js';
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
