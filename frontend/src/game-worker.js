import {createGameTrialRun} from './game-trials.js';
self.onmessage=async({data})=>{
 try{
  const run=createGameTrialRun(data.items,data.settings);
  let progress;
  while((progress=run.step())){
   if(data.visible){
    self.postMessage(progress);
    await new Promise(resolve=>setTimeout(resolve,Math.max(10,5000/data.settings.runs)));
   }
  }
  self.postMessage({...run.outcome(),done:true});
 }catch(error){self.postMessage({error:error.message});}
};
