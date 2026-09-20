export function createWalkthrough({openPanel,getState}) {
  const card=document.createElement('section');
  card.className='walkthrough';card.hidden=true;card.setAttribute('role','region');card.setAttribute('aria-label','Guided walkthrough');
  card.innerHTML='<div class="tour-top"><span id="tour-progress"></span><button id="tour-skip" aria-label="Close walkthrough">Skip tour ×</button></div><h2 id="tour-title"></h2><p id="tour-body"></p><p id="tour-status" role="status"></p><div class="tour-actions"><button id="tour-back">Back</button><button id="tour-next">Next →</button></div>';
  document.body.append(card);
  const $=s=>card.querySelector(s);
  let step=-1,highlight=null,steps=[],movedButton=null;
  const assistantStep={title:'Ask Interlock',body:'Use the prominent assistant beside Create report. Type a question or record one, ask for advice, and enable Speak replies to hear the answer.',panel:null,target:'.assistant summary'};
  const freeSteps=[
    {title:'Explore simulation mode',body:'Explore traffic across three campus intersections. Set your own conditions and run the current scenario. This walkthrough stays in simulation mode; there is no budget or upgrade requirement.',panel:null,target:'.navigation-panel'},
    {title:'Choose your conditions',body:'Set traffic demand, signal timing, weather, and starting hour. You can select a historical weather date or choose conditions yourself. These settings apply to all three intersections.',panel:'simulation',target:'#condition-controls'},
    {title:'Run your simulation',body:'Choose the number of rounds and click Run simulation. Under 150 rounds, watch a fast preview; longer runs illustrate 30 rounds while calculating all rounds. Playback returns to normal afterward.',panel:'simulation',target:'#run',gate:s=>!!s.result,pending:'Run the simulation to continue.'},
    {title:'Read your results',body:'The Result column describes the current scenario: speed, delay, throughput, conflict proxy, and pedestrian access. View all three intersections or select one. Change settings and run again to explore another scenario. These are experimental estimates, not crash forecasts.',panel:'results',target:'.metric-table'},
    assistantStep,
  ];
  const gameSteps=[
    {title:'Redesign the street',body:'This challenge fixes weather and traffic conditions and calculates an original-street baseline. Read the named hazard and approach. Road repair fixes potholes or reopens damaged roads; barriers isolate potholes but reduce capacity. Use Next: Simulate when your design is ready.',panel:null,target:'.scenario-banner'},
    {title:'Your challenge budget',budget:true,body:'Every upgrade has a price per approach. Placing it spends your challenge budget. Undo refunds the last upgrade; Reset refunds your design.',panel:'design',target:'.budget-card'},
    {title:'Place your first upgrade',body:'Choose a raised crosswalk and click a blue shape on the map, or use the keyboard approach buttons in Design. This changes your actual challenge design; you can undo it anytime.',panel:'design',target:'[data-tool="crosswalk"]',gate:s=>s.count>0,pending:'Place an upgrade to continue.'},
    {title:'Test your design',testDesign:true,body:'Click Test my design. Your changes and the original street use matched trials with the same weather and demand. The fast preview ends automatically when the run finishes.',panel:'simulation',target:'#test-design',gate:s=>!!s.result,pending:'Test your design to continue.'},
    {title:'See what changed',body:'Compare Before, After, and Change to understand your upgrades. Lower delay or conflict proxy and higher throughput or access indicate improvements. Compare with original toggles the street design. Use Revise design to make changes or Next challenge when you are done. Game accident counts are modeled, not measured crashes.',panel:'results',target:'.metric-table'},
    assistantStep,
  ];
  function restoreButton(){if(movedButton){movedButton.placeholder.replaceWith(movedButton.button);movedButton=null;}}
  function clearHighlight(){highlight?.classList.remove('tour-highlight');highlight=null;}
  function refresh(){
    if(step<0)return;
    const data=steps[step],ready=!data.gate||data.gate(getState());
    $('#tour-next').disabled=!ready;
    $('#tour-status').textContent=data.gate?(ready?'✓ Done. You’re ready to continue.':data.pending):'';
  }
  function show(index){
    restoreButton();clearHighlight();const assistant=document.querySelector('.assistant');if(assistant)assistant.open=false;step=index;const data=steps[step];openPanel(data.panel);
    if(data.testDesign){const button=document.querySelector('#test-design'),placeholder=document.createComment('tour test button');button.replaceWith(placeholder);document.querySelector('#simulation-panel .section-heading').after(button);movedButton={button,placeholder};}
    if(data.panel==='design')document.querySelector('.keyboard-placement').open=true;
    card.hidden=false;document.body.classList.add('tour-active');card.dataset.step=String(step);
    $('#tour-progress').textContent=`${getState().gameMode?"GAME":"SIMULATION"} · ${step+1} OF ${steps.length}`;
    $('#tour-title').textContent=data.budget?'Your budget is '+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(getState().budget??100000):data.title;$('#tour-body').textContent=data.body;
    $('#tour-back').disabled=step===0;$('#tour-next').textContent=step===steps.length-1?'Finish tour ✓':'Next →';
    highlight=document.querySelector(data.target);highlight?.classList.add('tour-highlight');
    requestAnimationFrame(()=>highlight?.scrollIntoView({block:'nearest',behavior:'instant'}));
    refresh();$('#tour-title').tabIndex=-1;$('#tour-title').focus({preventScroll:true});
  }
  function stop(){restoreButton();step=-1;clearHighlight();card.hidden=true;document.body.classList.remove('tour-active');document.querySelector('#guide-button').focus({preventScroll:true});}
  $('#tour-back').onclick=()=>step>0&&show(step-1);
  $('#tour-next').onclick=()=>{if($('#tour-next').disabled)return;step===steps.length-1?stop():show(step+1);};
  $('#tour-skip').onclick=stop;
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&step>=0){event.preventDefault();event.stopImmediatePropagation();stop();}},true);
  const resize=new ResizeObserver(()=>document.body.style.setProperty('--tour-bottom',`${card.getBoundingClientRect().bottom+12}px`));resize.observe(card);
  return {start:()=>{steps=getState().gameMode?gameSteps:freeSteps;show(0);},stop,refresh,get active(){return step>=0;}};
}
