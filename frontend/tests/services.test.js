import test from 'node:test';
import assert from 'node:assert/strict';
import {createServices,sceneContext} from '../src/services.js';
import {DEFAULT_SETTINGS,TOOLS} from '../src/model.js';

test('assistant context uses current upgrades, budget, settings and result provenance',()=>{
 const item={type:'crosswalk',zone:'north',intersection:'pitt-forbes-bigelow'};
 const context=sceneContext({items:[item],settings:DEFAULT_SETTINGS,result:null,budget:100000,gameMode:true});
 assert.equal(context.budget.spent,TOOLS.find(t=>t.id==='crosswalk').cost);
 assert.equal(context.budget.remaining,100000-context.budget.spent);
 assert.equal(context.results,null);assert.equal(context.placements[0].intersection,item.intersection);
 assert.match(context.data_note,/not crash predictions/);
});
test('Gemini and voice requests send current context to separate server routes without keys',async()=>{
 const requests=[];const services=createServices({fetchImpl:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({text:'answer'})};}});
 await services.ask('budget?',{budget:{total:80000,spent:10000}},false);
 await services.generate('simulation_debrief',{results:{engine:'local-network'}});
 assert.equal(requests[0].url,'/api/voice/voice/ask');assert.equal(JSON.parse(requests[0].options.body).context.budget.spent,10000);
 assert.equal(requests[1].url,'/api/gemini/generate/simulation_debrief');assert.equal(JSON.parse(requests[1].options.body).payload.results.engine,'local-network');
 assert.deepEqual(requests[0].options.headers,{'Content-Type':'application/json'});
});
test('service failures surface instead of inventing answers',async()=>{
 const services=createServices({fetchImpl:async()=>({ok:false,status:503})});
 await assert.rejects(()=>services.ask('budget?',{},false),/HTTP 503/);
});
