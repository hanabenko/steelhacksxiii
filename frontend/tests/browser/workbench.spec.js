import { test, expect } from '@playwright/test';
async function openPanel(page,name){const button=page.locator('button[data-panel="'+name+'"]');if(await button.getAttribute('aria-expanded')!=='true')await button.click();}

test('renders real geometry with an operational WebGL canvas',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('link',{name:'Interlock home'})).toBeVisible();
  const bounds=await page.locator('#scene canvas').boundingBox();
  expect(bounds.x).toBe(0);expect(bounds.y).toBe(0);expect(bounds.width).toBe(1440);expect(bounds.height).toBe(1050);
  await expect(page.locator('#design-panel')).not.toBeVisible();
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('.location-icon svg')).toBeVisible();
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
  await page.getByRole('button',{name:'North',exact:true}).click();
  await expect(page.locator('#budget')).toHaveText('$88,000');
  await page.getByRole('button',{name:'North',exact:true}).click();
  await expect(page.locator('#toast')).toContainText('already');
  await openPanel(page,'design');await page.locator('[data-tool="curb"]').click();
  await page.getByRole('button',{name:'East',exact:true}).click();
  await expect(page.locator('#budget')).toHaveText('$70,000');
  await openPanel(page,'simulation');await page.getByRole('button',{name:'Run simulation',exact:true}).click();
  await expect(page.locator('#result-status')).toHaveText('100 RUNS');
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
test('budget constraint is visible and export contains the scenario',async({page})=>{
  await page.goto('/');
  await openPanel(page,'design');await page.locator('[data-tool="diet"]').click();
  for(const zone of ['North','East','South','West'])await page.getByRole('button',{name:zone,exact:true}).click();
  await expect(page.locator('#budget')).toHaveText('$16,000');
  await expect(page.locator('#toast')).toContainText('Not enough budget');
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export scenario'}).click();
  const download=await downloaded;
  const stream=await download.createReadStream();let content='';for await(const chunk of stream)content+=chunk;
  const scenario=JSON.parse(content);expect(scenario.spent).toBe(84000);expect(scenario.upgrades).toHaveLength(3);expect(scenario.intersection).toBe('penn-21st-pittsburgh');
});
test('settings invalidate results and provenance remains accessible',async({page})=>{
  await page.goto('/');await openPanel(page,'simulation');await page.locator('#run').click();await expect(page.locator('#result-status')).toHaveText('100 RUNS');
  await openPanel(page,'simulation');await page.locator('#av').fill('50');await expect(page.locator('#av-value')).toHaveText('50%');await expect(page.locator('#compare')).toBeDisabled();
  await page.getByRole('button',{name:'Explore the data'}).click();await expect(page.getByRole('dialog')).toContainText('OpenStreetMap');await expect(page.getByRole('dialog')).toContainText('No public crash counts');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('mobile layout stays inside viewport and supports tool placement',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.locator('#scene canvas')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await openPanel(page,'design');await page.locator('[data-tool="bike"]').click();await page.getByRole('button',{name:'West',exact:true}).click();await expect(page.locator('#budget')).toHaveText('$76,000');
});
test('drag and drop places infrastructure on a raycast approach',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Top down'}).click();
  await openPanel(page,'design');
  const bounds=await page.locator('#scene canvas').boundingBox();
  await page.locator('[data-tool="crosswalk"]').dragTo(page.locator('#scene canvas'),{targetPosition:{x:bounds.width/2+bounds.height*23/200,y:bounds.height/2}});
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
  await openPanel(page,'design');await page.locator('[data-tool="bike"]').click();await page.getByRole('button',{name:'East',exact:true}).click();
  await expect(page.locator('#budget')).toHaveText('$76,000');await openPanel(page,'simulation');await page.locator('#run').click();await expect(page.locator('#result-status')).toHaveText('100 RUNS');
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
     await expect(page.locator('button[data-panel="'+name+'"]')).toBeFocused();
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
  await page.locator('[data-tool="crosswalk"]').click();await page.getByRole('button',{name:'East',exact:true}).click();
  await expect(page.locator('#budget-receipt')).toContainText('$12,000 spent');
  await expect(page.locator('#tour-next')).toBeEnabled();await page.locator('#tour-next').click();
  await expect(page.locator('#tour-next')).toBeDisabled();await page.locator('#run').click();
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
  await page.locator('[data-speed="4"]').click();
  await expect(page.locator('#signal-cross')).toHaveAttribute('data-state','green',{timeout:15000});
  await page.getByRole('button',{name:'Pause animation'}).click();
  await expect(page.locator('#signal-countdown')).toHaveText('Paused');
  await expect(page.locator('#signal-penn')).toHaveAttribute('data-state','red');
});

test('remove refunds the upgrade and invalidates comparison',async({page})=>{
  await page.goto('/');await openPanel(page,'design');await page.locator('[data-tool="bike"]').click();
  await page.getByRole('button',{name:'North',exact:true}).click();
  await page.locator('#placed-summary').click();
  await page.getByRole('button',{name:'Remove Protected bike lane from north'}).click();
  await expect(page.locator('#budget')).toHaveText('$100,000');
  await expect(page.locator('#budget-receipt')).toContainText('$24,000 refunded');
});

test('mobile walkthrough can be completed without covering required controls',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'Start walkthrough'}).click();
  await page.locator('#tour-next').click();await page.locator('#tour-next').click();
  await page.locator('[data-tool="crosswalk"]').click();await page.getByRole('button',{name:'West',exact:true}).click();
  await page.locator('#tour-next').click();await page.locator('#run').click();
  await expect(page.locator('#tour-next')).toBeEnabled();await page.locator('#tour-next').click();
  await page.locator('#tour-next').click();
  await expect(page.locator('.walkthrough')).not.toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
