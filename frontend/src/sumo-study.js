export function installSumoStudy({services,container,getSettings,getScene,isBusy,onStart,onFinish}) {
 const panel=document.createElement('details');panel.className='sumo-study';
 panel.innerHTML=`<summary>SUMO · Forbes / Bigelow signal study</summary><p>Run your selected green-phase setting and demand at this junction. Selected weather applies to both scenarios, including braking, following gaps, speed, and pedestrian demand. Campus upgrades and game scores remain separate.</p><p>3 paired trials × 10 simulated minutes. Geometry: OpenStreetMap. Default traffic calibration comes from Fifth / Meyran; slider demand is your assumption.</p><button type="button" data-run-sumo>Run SUMO study</button><button type="button" data-stop-replay hidden>Return to campus traffic</button><p role="status" data-sumo-status></p><div data-sumo-results></div>`;
 container.append(panel);const run=panel.querySelector('[data-run-sumo]'),stop=panel.querySelector('[data-stop-replay]'),status=panel.querySelector('[data-sumo-status]'),results=panel.querySelector('[data-sumo-results]');
 run.onclick=async()=>{if(isBusy())return;run.disabled=true;onStart();status.textContent='Running SUMO with matched seeds…';results.replaceChildren();try{
   const settings=getSettings();const value=await services.replay({schemaVersion:2,intersection:'pitt-forbes-bigelow',seed:42,duration_s:600,settings:{demand:settings.demand,runs:3,av:0,conditions:{weather:settings.conditions?.weather||'clear'}},upgrades:[{type:'signal_timing',main_green_s:settings.green,side_green_s:settings.green}]});
   if(value.contract_version!==1||value.engine!=='sumo-traci'||!value.modified?.representative_replay)throw new Error('Invalid SUMO response.');
   getScene()?.setReplay(value.modified.representative_replay);stop.hidden=false;
   status.textContent='SUMO complete · modified scenario replay at normal speed. Campus game metrics remain separate.';
   for(const [key,label] of [['mean_speed_mph','Mean speed (mph)'],['average_delay_s_per_vehicle','Delay (seconds/vehicle)'],['throughput_vehicles_per_hour','Throughput (vehicles/hour)']]){
     const line=document.createElement('p'),after=value.modified.metrics[key]?.mean;line.textContent=`${label}: ${Number.isFinite(after)?after.toFixed(1):'unavailable'}`;results.append(line);
   }
 }catch(error){status.textContent='SUMO study unavailable. '+error.message;}finally{run.disabled=false;onFinish();}};
 stop.onclick=()=>{getScene()?.setReplay(null);stop.hidden=true;status.textContent='Illustrative campus traffic restored.';};
 return {clear(){getScene()?.setReplay(null);stop.hidden=true;results.replaceChildren();status.textContent='';}};
}
