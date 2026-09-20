import {runGameTrialBatch} from './game-trials.js';
self.onmessage=async({data})=>{
 try{
  const outcome=await runGameTrialBatch(data.items,data.settings,{
   onProgress:data.visible?progress=>self.postMessage(progress):undefined,
  });
  self.postMessage({...outcome,done:true});
 }catch(error){self.postMessage({error:error.message});}
};
