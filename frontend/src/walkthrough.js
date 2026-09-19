export function createWalkthrough({openPanel,getState}) {
  const card=document.createElement('section');
  card.className='walkthrough';card.hidden=true;card.setAttribute('role','region');card.setAttribute('aria-label','Guided walkthrough');
  card.innerHTML='<div class="tour-top"><span id="tour-progress"></span><button id="tour-skip" aria-label="Close walkthrough">Skip tour ×</button></div><h2 id="tour-title"></h2><p id="tour-body"></p><p id="tour-status" role="status"></p><div class="tour-actions"><button id="tour-back">Back</button><button id="tour-next">Next →</button></div>';
  document.body.append(card);
  const $=s=>card.querySelector(s);
  let step=-1,highlight=null;
  const steps=[
    {title:'Welcome to your street lab',body:'Watch the signals cycle from green to amber to red. Cars stop at red lights. Drag the scene to orbit, or use Top down to plan your layout.',panel:null,target:'.signal-hud'},
    {title:'Your budget is $100,000',body:'Every upgrade has a price per approach. Money is deducted only when you place it. Undo refunds the last upgrade; Reset refunds your whole design.',panel:'design',target:'.budget-card'},
    {title:'Place your first upgrade',body:'Drag the raised crosswalk card onto a blue street target. Or click the card, then choose an approach. This changes your actual design—you can undo it anytime.',panel:'design',target:'[data-tool="crosswalk"]',gate:s=>s.count>0,pending:'Place an upgrade to continue.'},
    {title:'Run a fair comparison',body:'Choose traffic demand, signal timing, and AV adoption, then click Run simulation. Before is the original street; After includes your design. Both use the same sampled traffic demand.',panel:'simulation',target:'#run',gate:s=>!!s.result,pending:'Run the simulation to continue.'},
    {title:'See what changed',body:'Compare Before and After, then read Change: negative delay or conflict values are improvements; positive throughput or access values are improvements. Use Compare with original to toggle the 3D design. These local estimates are experimental, not crash forecasts.',panel:'results',target:'.metric-table'},
  ];
  function clearHighlight(){highlight?.classList.remove('tour-highlight');highlight=null;}
  function refresh(){
    if(step<0)return;
    const data=steps[step],ready=!data.gate||data.gate(getState());
    $('#tour-next').disabled=!ready;
    $('#tour-status').textContent=data.gate?(ready?'✓ Done. You’re ready to continue.':data.pending):'';
  }
  function show(index){
    clearHighlight();step=index;const data=steps[step];openPanel(data.panel);
    card.hidden=false;document.body.classList.add('tour-active');card.dataset.step=String(step);
    $('#tour-progress').textContent=`QUICK START · ${step+1} OF ${steps.length}`;
    $('#tour-title').textContent=data.title;$('#tour-body').textContent=data.body;
    $('#tour-back').disabled=step===0;$('#tour-next').textContent=step===steps.length-1?'Finish tour ✓':'Next →';
    highlight=document.querySelector(data.target);highlight?.classList.add('tour-highlight');
    requestAnimationFrame(()=>highlight?.scrollIntoView({block:'nearest',behavior:'instant'}));
    refresh();$('#tour-title').tabIndex=-1;$('#tour-title').focus({preventScroll:true});
  }
  function stop(){step=-1;clearHighlight();card.hidden=true;document.body.classList.remove('tour-active');document.querySelector('#guide-button').focus({preventScroll:true});}
  $('#tour-back').onclick=()=>step>0&&show(step-1);
  $('#tour-next').onclick=()=>{if($('#tour-next').disabled)return;step===steps.length-1?stop():show(step+1);};
  $('#tour-skip').onclick=stop;
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&step>=0){event.preventDefault();event.stopImmediatePropagation();stop();}},true);
  const resize=new ResizeObserver(()=>document.body.style.setProperty('--tour-bottom',`${card.getBoundingClientRect().bottom+12}px`));resize.observe(card);
  return {start:()=>show(0),refresh,get active(){return step>=0;}};
}
