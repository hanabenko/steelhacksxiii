import {buildTool,openPanel,switchPanel,enterGame} from './ui-helpers.js';
import { test, expect } from '@playwright/test';
test('renders real geometry with an operational WebGL canvas',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('link',{name:'Interlock home'})).toBeVisible();
  const bounds=await page.locator('#scene canvas').boundingBox();
  expect(bounds.x).toBe(0);expect(bounds.y).toBe(0);expect(bounds.width).toBe(1440);expect(bounds.height).toBe(1050);
  await expect(page.locator('#design-panel')).not.toBeVisible();
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('.location-bar')).toHaveCount(0);await expect(page.locator('#play-mode')).toBeVisible();
  await expect(page.locator('[data-lucide]:not(svg)')).toHaveCount(0);
  await page.getByRole('button',{name:'Top down'}).click();
  await expect(page.locator('#view-top')).toHaveClass('selected');
  await page.getByRole('button',{name:'Pause animation'}).click();
  await expect(page.getByRole('button',{name:'Resume animation'})).toBeVisible();
  await page.getByRole('button',{name:'Map layers'}).click();
  await page.getByLabel('Buildings',{exact:true}).uncheck();
  await page.getByLabel('Buildings',{exact:true}).check();
  expect(errors).toEqual([]);
});
test('complete keyboard-accessible design, simulation, undo, and reset',async({page})=>{
  await page.goto('/');
  await openPanel(page,'design');await page.locator('[data-tool="crosswalk"]').click();
  await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="north"]').click();
  await expect(page.locator('#budget')).toHaveText('$88,000');
  await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="north"]').click();
  await expect(page.locator('#toast')).toContainText('already');
  await openPanel(page,'design');await page.locator('[data-tool="curb"]').click();
  await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="east"]').click();
  await expect(page.locator('#budget')).toHaveText('$70,000');
  await openPanel(page,'simulation');await page.locator('#test-design').click();
  await expect(page.locator('#result-status')).toHaveText('100 RUNS',{timeout:15000});
  await expect(page.locator('#score')).not.toContainText('—');
  await expect(page.locator('#after-risk')).not.toHaveText('—');
  await page.getByRole('button',{name:'Compare with original',exact:true}).click();
  await expect(page.getByRole('button',{name:'Return to your design'})).toBeVisible();
  await openPanel(page,'design');await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('#budget')).toHaveText('$88,000');
  await expect(page.locator('#result-status')).toHaveText('DESIGN UPDATED');
  await page.getByRole('button',{name:'Reset design',exact:true}).click();
  await expect(page.locator('#budget')).toHaveText('$100,000');
  await expect(page.locator('#undo')).toBeDisabled();
});
test('budget constraint is visible and export is absent',async({page})=>{
  await page.goto('/');
  await openPanel(page,'design');await page.locator('[data-tool="diet"]').click();
  for(const zone of ['North','East','South','West'])await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="'+zone.toLowerCase()+'"]').click();
  await expect(page.locator('#budget')).toHaveText('$16,000');
  await expect(page.locator('#toast')).toContainText('Not enough budget');
  await expect(page.getByRole('button',{name:'Export scenario'})).toHaveCount(0);
  await page.locator('#placed-summary').click();await expect(page.locator('#placed-list li')).toHaveCount(3);
});
test('settings invalidate results and provenance remains accessible',async({page})=>{
  await page.goto('/');await openPanel(page,'simulation');await (await page.locator('body').getAttribute('data-mode')==='game'?page.locator('#test-design'):page.locator('#run')).click();await expect(page.locator('#result-status')).toHaveText('100 RUNS',{timeout:15000});
  await openPanel(page,'simulation');await page.locator('#demand').fill('1100');await expect(page.locator('#demand-value')).toHaveText('1100 veh/h');await expect(page.locator('#compare')).toBeDisabled();
  await page.getByRole('button',{name:'Data sources & model limits'}).click();await expect(page.getByRole('dialog')).toContainText('OpenStreetMap');await expect(page.getByRole('dialog')).toContainText('No public crash counts');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('mobile layout stays inside viewport and supports tool placement',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.locator('#scene canvas')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await openPanel(page,'design');await page.locator('[data-tool="bike"]').click();await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="west"]').click();await expect(page.locator('#budget')).toHaveText('$76,000');
});
test('drag and drop places infrastructure on a raycast approach',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Top down'}).click();
  await openPanel(page,'design');
  const bounds=await page.locator('#scene canvas').boundingBox();
  await page.locator('[data-tool="crosswalk"]').dragTo(page.locator('#scene canvas'),{targetPosition:{x:bounds.width/2+bounds.height*12/200,y:bounds.height/2}});
  await expect(page.locator('#budget')).toHaveText('$88,000');
  await expect(page.locator('body')).not.toHaveClass(/is-dragging/);
});
test('reduced-motion preference starts preview paused',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  await expect(page.getByRole('button',{name:'Resume animation'})).toBeVisible();
});
test('drag outside a valid approach does not spend budget',async({page})=>{
  await page.goto('/');await openPanel(page,'design');
  const bounds=await page.locator('#scene canvas').boundingBox();
  await page.locator('[data-tool="crosswalk"]').dragTo(page.locator('#scene canvas'),{targetPosition:{x:bounds.width*.72,y:bounds.height*.78}});
  await expect(page.locator('#budget')).toHaveText('$100,000');
  await expect(page.locator('#toast')).toContainText('Nothing was charged');
});
test('editing and simulations remain usable when WebGL is unavailable',async({page})=>{
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:original.call(this,type,...args);};});
  await page.goto('/');await expect(page.getByText('3D view is unavailable')).toBeVisible();
  await openPanel(page,'design');await page.locator('[data-tool="bike"]').click();await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="east"]').click();
  await expect(page.locator('#budget')).toHaveText('$76,000');await openPanel(page,'simulation');await (await page.locator('body').getAttribute('data-mode')==='game'?page.locator('#test-design'):page.locator('#run')).click();await expect(page.locator('#result-status')).toHaveText('100 RUNS',{timeout:15000});
});

 test('panels toggle, close with Escape, and return focus without shrinking the scene',async({page})=>{
   await page.goto('/');
   const original=await page.locator('#scene canvas').boundingBox();
   for(const name of ['design','simulation','results']){
     await openPanel(page,name);
     await expect(page.locator('#'+name+'-panel')).toBeVisible();
     expect(await page.locator('#scene canvas').boundingBox()).toEqual(original);
     await page.keyboard.press('Escape');
     await expect(page.locator('#'+name+'-panel')).not.toBeVisible();
     await expect(page.locator('body')).toHaveAttribute('data-mode',/game|simulation/);await expect(page.locator('body[data-mode="game"] button[data-panel="'+name+'"],body[data-mode="simulation"] #quick-run')).toBeFocused();
   }
   await openPanel(page,'design');await openPanel(page,'simulation');
   await expect(page.locator('#design-panel')).not.toBeVisible();
   await page.getByRole('button',{name:'Close simulation panel'}).click();
   await expect(page.locator('#simulation-panel')).not.toBeVisible();
 });

test('walkthrough guides a real upgrade, budget, run, and comparison',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Start walkthrough'}).click();
  await expect(page.locator('#tour-title')).toHaveText('Welcome to your street lab');
  await page.locator('#tour-next').click();await expect(page.locator('.budget-card')).toBeVisible();
  await page.locator('#tour-next').click();await expect(page.locator('#tour-next')).toBeDisabled();
  await page.locator('[data-tool="crosswalk"]').click();await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="east"]').click();
  await expect(page.locator('#budget-receipt')).toContainText('$12,000 spent');
  await expect(page.locator('#tour-next')).toBeEnabled();await page.locator('#tour-next').click();
  await expect(page.locator('#tour-next')).toBeDisabled();await (await page.locator('body').getAttribute('data-mode')==='game'?page.locator('#test-design'):page.locator('#run')).click();
  await expect(page.locator('#tour-next')).toBeEnabled();await page.locator('#tour-next').click();
  await expect(page.locator('#tour-title')).toHaveText('See what changed');
  await expect(page.locator('#change-risk')).toHaveClass(/improved/);
  await expect(page.locator('.comparison-explain')).toContainText('original street');
  await page.locator('#tour-next').click();await expect(page.locator('.walkthrough')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Start walkthrough'})).toBeFocused();
});

test('signals advance with playback and stop when paused',async({page})=>{
  await page.goto('/');await expect(page.locator('#signal-penn')).toHaveAttribute('data-state','green');
  await openPanel(page,'simulation');await page.locator('#green').fill('20');
  await page.getByRole('button',{name:'Close simulation panel'}).click();
  await page.locator('[data-speed="10"]').click();
  await expect(page.locator('#signal-cross')).toHaveAttribute('data-state','green',{timeout:15000});
  await page.getByRole('button',{name:'Pause animation'}).click();
  await expect(page.locator('#signal-countdown')).toHaveText('Paused');
  await expect(page.locator('#signal-penn')).toHaveAttribute('data-state','red');
});

test('remove refunds the upgrade and invalidates comparison',async({page})=>{
  await page.goto('/');await openPanel(page,'design');await page.locator('[data-tool="bike"]').click();
  await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="north"]').click();
  await page.locator('#placed-summary').click();
  await page.getByRole('button',{name:'Remove Protected bike lane from north at Forbes × Bigelow'}).click();
  await expect(page.locator('#budget')).toHaveText('$100,000');
  await expect(page.locator('#budget-receipt')).toContainText('$24,000 refunded');
});

test('mobile walkthrough can be completed without covering required controls',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'Start walkthrough'}).click();
  await page.locator('#tour-next').click();await page.locator('#tour-next').click();
  await page.locator('[data-tool="crosswalk"]').click();await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="west"]').click();
  await page.locator('#tour-next').click();await (await page.locator('body').getAttribute('data-mode')==='game'?page.locator('#test-design'):page.locator('#run')).click();
  await expect(page.locator('#tour-next')).toBeEnabled();await page.locator('#tour-next').click();
  await page.locator('#tour-next').click();
  await expect(page.locator('.walkthrough')).not.toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('quick tray targets the crosswalk itself and launches a comparison',async({page})=>{
  await page.goto('/');await page.locator('#view-top').click();
  const canvas=page.locator('#scene canvas');const b=await canvas.boundingBox();
  const card=await buildTool(page,'crosswalk');
  await card.dragTo(canvas,{targetPosition:{x:b.width/2+b.height*23/200,y:b.height/2}});
  await expect(page.locator('#budget-hud')).toHaveText('$100,000');
  await card.dragTo(canvas,{targetPosition:{x:b.width/2+b.height*12/200,y:b.height/2}});
  await expect(page.locator('#budget-hud')).toHaveText('$88,000');
  await expect(page.locator('#design-panel')).toBeVisible();
  await openPanel(page,'simulation');await (await page.locator('body').getAttribute('data-mode')==='game'?page.locator('#test-design'):page.locator('#run')).click();
  await expect(page.locator('#result-status')).toHaveText('100 RUNS',{timeout:15000});
  await expect(page.locator('#after-risk')).not.toHaveText('—');
});

test('quick selection supports number keys, cancellation, and mobile controls',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await enterGame(page);
  await (await buildTool(page,'bike')).click();
  await expect(page.locator('[data-quick-tool="bike"]')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');await expect(page.locator('#placement-hint')).not.toBeVisible();
  await page.keyboard.press('1');await expect(page.locator('[data-quick-tool="crosswalk"]')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');await openPanel(page,'simulation');await (await page.locator('body').getAttribute('data-mode')==='game'?page.locator('#test-design'):page.locator('#run')).click();
  await expect(page.locator('#result-status')).toHaveText('100 RUNS',{timeout:15000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('observation mode hides every overlay and keeps orbit/zoom and restoration available',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Pause animation'}).click();
  await openPanel(page,'design');await page.locator('[data-tool="crosswalk"]').click();
  await page.getByRole('button',{name:'Hide interface',exact:true}).click();
  await expect(page.locator('#scene canvas')).toBeVisible();
  for(const selector of ['.header','.action-dock','.upgrade-bar','.quick-simulation','.panel','.map-controls','.signal-hud','.navigation-panel','.landmark-labels','#placement-hint']){
    for(const element of await page.locator(selector).all())await expect(element).not.toBeVisible();
  }
  const before=(await page.locator('#scene canvas').screenshot()).toString('base64');
  await page.mouse.move(720,500);await page.mouse.wheel(0,-350);
  await expect.poll(async()=>(await page.locator('#scene canvas').screenshot()).toString('base64')).not.toBe(before);
  await page.keyboard.press('h');await expect(page.locator('.header')).toBeVisible();
  await expect(page.locator('#observe-toggle')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#placement-hint')).not.toBeVisible();
});

test('landmarks remain on the map while navigation replaces the removed overlays',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await enterGame(page);
 await expect(page.locator('.campus-jumps,.preview-badge,[data-focus]')).toHaveCount(0);
 for(const id of ['cathedral','towers','jefes'])await expect(page.locator('[data-landmark="'+id+'"]')).toBeVisible();
 const navigation=await page.locator('.navigation-panel').boundingBox();expect(navigation.x).toBe(25);expect(navigation.y).toBe(110);
 await page.setViewportSize({width:390,height:844});await page.reload();await enterGame(page);const mobile=await page.locator('.navigation-panel').boundingBox();expect(mobile.x).toBe(13);expect(mobile.y).toBe(86);
 await page.locator('#observe-toggle').click();await expect(page.locator('.navigation-panel')).not.toBeVisible();await page.locator('#observe-toggle').click();await expect(page.locator('.navigation-panel')).toBeVisible();expect(errors).toEqual([]);
});

test('corner observation toggle dismisses native dialogs and walkthroughs',async({page})=>{
  await page.goto('/');await openPanel(page,'simulation');await page.getByRole('button',{name:'Data sources & model limits'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await page.locator('#observe-toggle').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('body')).toHaveClass(/observe-mode/);
  await page.locator('#observe-toggle').click();await page.getByRole('button',{name:'Start walkthrough'}).click();
  await expect(page.locator('.walkthrough')).toBeVisible();await page.locator('#observe-toggle').click();
  await expect(page.locator('.walkthrough')).not.toBeVisible();await page.locator('#observe-toggle').click();
  await expect(page.locator('.header')).toBeVisible();
});

test('three intersections keep separate placements and produce combined and per-site results',async({page})=>{
 await page.goto('/');await openPanel(page,'design');
 for(const id of ['pitt-forbes-bigelow','pitt-fifth-bigelow','pitt-forbes-bouquet']){
  await expect(page.locator('[data-intersection-picker]')).toHaveCount(0);
  if(await page.locator('[data-tool="crosswalk"]').getAttribute('aria-pressed')!=='true')await page.locator('[data-tool="crosswalk"]').click();
  await page.locator('[data-intersection="'+id+'"][data-zone="north"]').click();
 }
 await expect(page.locator('#budget')).toHaveText('$64,000');
 await page.locator('#placed-summary').click();await expect(page.locator('#placed-list li')).toHaveCount(3);
 await expect(page.locator('#placed-list')).toContainText('Fifth × Bigelow');await expect(page.locator('#placed-list')).toContainText('Forbes × Bouquet');
 await openPanel(page,'simulation');await (await page.locator('body').getAttribute('data-mode')==='game'?page.locator('#test-design'):page.locator('#run')).click();await expect(page.locator('#result-status')).toHaveText('100 RUNS',{timeout:15000});
 await expect(page.locator('#result-scope')).toHaveValue('network');
 const combined=Number(await page.locator('#after-throughput').textContent());
 await page.locator('#result-scope').selectOption('pitt-fifth-bigelow');
 await expect(page.locator('#aggregation-note')).toContainText('Fifth × Bigelow');
 expect(combined).toBeGreaterThan(2*Number(await page.locator('#after-throughput').textContent()));await expect(page.locator('#change-risk')).toHaveClass(/improved/);
 await openPanel(page,'design');await page.getByRole('button',{name:'Remove Raised crosswalk from north at Fifth × Bigelow'}).click();await expect(page.locator('#budget')).toHaveText('$76,000');await expect(page.locator('#result-scope')).toBeDisabled();
});

test('street navigation moves while traffic is paused and while interface is hidden',async({page})=>{
 await page.goto('/');await enterGame(page);await page.getByRole('button',{name:'Pause animation'}).click();
 await page.locator('button[data-navigation="street"]').click();const canvas=page.locator('#scene canvas');await expect(canvas).toHaveAttribute('data-navigation','street');
 const position=()=>canvas.getAttribute('data-camera-position');const before=await position();await page.keyboard.down('w');await expect.poll(position).not.toBe(before);await page.keyboard.up('w');
 await page.locator('#observe-toggle').click();const hiddenBefore=await position();await page.keyboard.down('d');await expect.poll(position).not.toBe(hiddenBefore);await page.keyboard.up('d');
 await page.locator('#observe-toggle').click();const riseBefore=(await position()).split(',').map(Number)[1];await page.getByRole('button',{name:'Rise',exact:true}).focus();await page.keyboard.press('Enter');await expect.poll(async()=>Number((await position()).split(',')[1])).toBeGreaterThan(riseBefore);
 await page.locator('button[data-navigation="pan"]').click();await expect(canvas).toHaveAttribute('data-navigation','pan');
 const panBefore=await position();await page.mouse.move(680,450);await page.mouse.down();await page.mouse.move(830,500,{steps:8});await page.mouse.up();await expect.poll(position).not.toBe(panBefore);
 await page.locator('#recenter').click();await expect(canvas).toHaveAttribute('data-navigation','pan');
});

test('mobile free navigation and on-screen movement remain reachable',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await enterGame(page);await expect(page.locator('[data-intersection-picker]')).toHaveCount(0);
 await page.locator('.navigation-panel summary').click();await page.locator('button[data-navigation="street"]').click();
 const canvas=page.locator('#scene canvas');const before=await canvas.getAttribute('data-camera-position');await page.getByRole('button',{name:'Move forward',exact:true}).focus();await page.keyboard.press('Enter');await expect.poll(()=>canvas.getAttribute('data-camera-position')).not.toBe(before);
 await page.locator('#observe-toggle').click();await page.locator('#observe-toggle').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});