import {simulateNetwork,random} from './model.js';
import {trialPreviewPlan} from './trial-preview.js';
// One paired exposure per site per trial; probabilities are explicit game assumptions.
export function createGameTrialRun(items,settings){
 const result=simulateNetwork(items,settings,42),rng=random(1042),timeline=[];
 let accidents=0;
 return {
  step(){
   if(timeline.length>=settings.runs)return null;
   const index=timeline.length;
   for(const site of result.intersections)if(rng()<Math.min(1,site.samples[index]/100))accidents++;
   timeline.push(accidents);
   return {completed:timeline.length,accidents};
  },
  outcome(){return {result,accidents,timeline};}
 };
}
export function evaluateGame(items,settings){
 const run=createGameTrialRun(items,settings);
 while(run.step()){};
 return run.outcome();
}

/** Compare against the actual challenge baseline, including its locked signals. */
export function gameComparison(baseline,outcome){
 const compare=(before,after)=>{
  const reduction=before.after.risk.mean?100*(1-after.after.risk.mean/before.after.risk.mean):0;
  const retained=before.after.throughput.mean?100*after.after.throughput.mean/before.after.throughput.mean:100;
  return {...after,before:before.after,reduction,retained};
 };
 const saved=baseline.accidents-outcome.accidents;
 const improvement=baseline.accidents?Math.round(saved/baseline.accidents*100):0;
 const result=compare(baseline.result,outcome.result);
 result.score=Math.max(0,Math.min(100,improvement));
 result.intersections=outcome.result.intersections.map(site=>compare(baseline.result.intersections.find(b=>b.id===site.id),site));
 return {result,saved,improvement,score:result.score};
}

export async function runGameTrialBatch(items, settings, {
 onProgress, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
 const run=createGameTrialRun(items,settings),plan=trialPreviewPlan(settings.runs);
 let progress,illustrated=0;
 while((progress=run.step())){
  if(onProgress && progress.completed===plan.checkpoints[illustrated]){
   illustrated++;
   onProgress({...progress,illustrated,previewCount:plan.count,sampled:plan.sampled});
   await wait(plan.delayMs);
  }
 }
 return run.outcome();
}
