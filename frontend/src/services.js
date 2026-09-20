import {DRIVING_DATA} from './driving-data.js';
import {TOOLS, costOf} from './model.js';
import {INTERSECTIONS} from './intersections.js';

export function sceneContext({items, settings, result, budget, gameMode}) {
  const spent=costOf(items);
  return {
    intersection_id:'pitt-campus-network', intersection_name:'Pitt campus · three intersections',
    streets:[...new Set(INTERSECTIONS.flatMap(s=>[s.primaryRoad,s.crossRoad]))],
    budget:{total:budget,spent,remaining:budget-spent},
    placements:items.map(item=>({...item,label:TOOLS.find(t=>t.id===item.type)?.name,cost:TOOLS.find(t=>t.id===item.type)?.cost})),
    results:result ? {...result,stale:false} : null,
    traffic_observation:DRIVING_DATA,
    result_presentation:gameMode?"Compare the challenge baseline and edited design":"Describe results.after as the current simulation result. Do not present a before/after comparison or game score.",
    warnings:[`${gameMode?'Challenge':'Free simulation'}; weather: ${settings.conditions?.weather||'clear'}; demand: ${settings.demand} vehicles/hour per intersection.`,
      'Traffic animation is illustrative. Campus metrics are uncalibrated local estimates, not measured crashes.'],
    weather:settings.conditions?.weatherObservation||{weather:settings.conditions?.weather||'clear',source:'Manual or challenge condition'},
    data_note:'Weather behavior uses engineering assumptions; historical weather is Open-Meteo ERA5 reanalysis. Street geometry: OpenStreetMap. Local conflict proxies are not crash predictions.',
  };
}

export function createServices({base='/api',fetchImpl=globalThis.fetch}={}) {
  async function request(path,body,{form=false,blob=false,timeout=60000}={}) {
    const response=await fetchImpl(base+path,{method:'POST',headers:form?{}:{'Content-Type':'application/json'},body:form?body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
    if(!response.ok) {
      let detail;try{detail=(await response.json()).detail;}catch{}
      throw new Error(`Service unavailable (HTTP ${response.status}). ${typeof detail==='string'?detail:detail?.message||'Check that the app server is running.'}`);
    }
    return blob?response.blob():response.json();
  }
  return {
    ask:(question,context,speak)=>request('/voice/voice/ask',{question,context,speak}),
    generate:(task,payload)=>request('/gemini/generate/'+task,{payload,allow_fallback:true}),
    speak:text=>request('/voice/voice/speak',{text},{blob:true}),
    transcribe:audio=>{const form=new FormData();form.append('file',audio,'question.webm');return request('/voice/voice/transcribe',form,{form:true});},
    replay:payload=>request('/simulation',payload,{timeout:600000}),
  };
}
