async function buildTool(page,type){const design=page.locator('button[data-panel="design"]');if(await design.getAttribute('aria-expanded')!=='true')await design.click();return page.locator('[data-quick-tool="'+type+'"]');}
import { test, expect } from '@playwright/test';

test('map has all twelve placement footprints; mouse navigation keeps the selected upgrade',async({page})=>{
 test.setTimeout(90000); // Long mouse-only traversal across three blocks under software WebGL.
 await page.goto('/');const canvas=page.locator('#scene canvas');await page.locator('#view-top').click();await (await buildTool(page,'crosswalk')).click();
 await expect(page.locator('[data-intersection-picker]')).toHaveCount(0);await expect(page.locator('.placement-target')).toHaveCount(12);
 const before=await canvas.getAttribute('data-camera-position');await page.mouse.move(720,380);await page.mouse.down();await page.mouse.move(740,440,{steps:10});await page.mouse.up();
 await expect.poll(()=>canvas.getAttribute('data-camera-position')).not.toBe(before);await expect(page.locator('[data-quick-tool="crosswalk"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#budget-hud')).toHaveText('$100,000');
 // Use mouse panning, never a site selector, to bring each real footprint to the center.
 for(const id of ['pitt-forbes-bigelow','pitt-fifth-bigelow','pitt-forbes-bouquet']){
  const target=page.locator('.placement-target[data-intersection="'+id+'"][data-approach="north"]');
  for(let step=0;step<12;step++){
   const point=await target.evaluate(el=>({x:+el.dataset.screenX,y:+el.dataset.screenY}));if(Math.abs(point.x-720)<90&&Math.abs(point.y-500)<90)break;
   const dx=Math.max(-230,Math.min(230,720-point.x)),dy=Math.max(-180,Math.min(180,500-point.y));await page.mouse.move(720,500);await page.mouse.down();await page.mouse.move(720+dx,500+dy,{steps:4});await page.mouse.up();await page.waitForTimeout(200);
  }
  const point=await target.evaluate(el=>({x:+el.dataset.screenX,y:+el.dataset.screenY}));await page.mouse.click(point.x,point.y);await expect(page.locator('.signal-hud')).toHaveAttribute('data-intersection',id);
 }
 await expect(page.locator('#budget-hud')).toHaveText('$64,000');await expect(page.locator('#network-design-status')).toContainText('3 of 3 sites edited');await page.locator('#quick-run').click();await expect(page.locator('#result-status')).toHaveText('100 RUNS');
});

test('street right-drag translates camera and collision replay respects pause without spending budget',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');const canvas=page.locator('#scene canvas');
 await page.locator('button[data-navigation="street"]').click();const before=await canvas.getAttribute('data-camera-position');await page.mouse.move(700,450);await page.mouse.down({button:'right'});await page.mouse.move(800,510,{steps:8});await page.mouse.up({button:'right'});await expect.poll(()=>canvas.getAttribute('data-camera-position')).not.toBe(before);
 await page.locator('#pause').click();await page.locator('#collision-demo').click();await expect(canvas).toHaveAttribute('data-incident','approach');await page.waitForTimeout(350);await expect(canvas).toHaveAttribute('data-incident','approach');
 await page.locator('#pause').click();await expect(canvas).toHaveAttribute('data-incident','impact',{timeout:15000});await expect(canvas).toHaveAttribute('data-incident','fire',{timeout:15000});await expect.poll(async()=>Number(await canvas.getAttribute('data-reacting-cars'))).toBeGreaterThan(0);await expect.poll(async()=>Number(await canvas.getAttribute('data-reacting-pedestrians'))).toBeGreaterThan(0);await page.locator('#pause').click();await expect(page.locator('#budget-hud')).toHaveText('$100,000');await expect(page.locator('#result-status')).toHaveText('NOT RUN YET');expect(errors).toEqual([]);
});


test('hover feedback distinguishes duplicate infrastructure from insufficient funds',async({page})=>{
 await page.goto('/');await page.locator('#view-top').click();await (await buildTool(page,'crosswalk')).click();
 const target=zone=>page.locator('.placement-target[data-intersection="pitt-forbes-bigelow"][data-approach="'+zone+'"]');
 const point=await target('north').evaluate(el=>({x:+el.dataset.screenX,y:+el.dataset.screenY}));await page.mouse.click(point.x,point.y);
 await expect(target('north')).toContainText('Raised crosswalk is already on this approach.');await expect(target('north')).not.toContainText('budget');
 if(await page.locator('button[data-panel="design"]').getAttribute('aria-expanded')!=='true')await page.locator('button[data-panel="design"]').click();await page.locator('.keyboard-placement>summary').click();await page.locator('[data-tool="diet"]').click();
 for(const zone of ['east','south','west'])await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="'+zone+'"]').click();
 await expect(page.locator('#budget-hud')).toHaveText('$4,000');await (await buildTool(page,'bike')).click();
 const bike=await target('east').evaluate(el=>({x:+el.dataset.screenX,y:+el.dataset.screenY}));await page.mouse.move(bike.x,bike.y);
 await expect(target('east')).toContainText('Not enough budget.');await expect(target('east')).not.toContainText('already');await expect(page.locator('#budget-hud')).toHaveText('$4,000');
});


test('matching navy right panels toggle independently and keep navigation visible',async({page})=>{
 await page.goto('/');await expect(page.locator('#design-panel')).not.toBeVisible();await expect(page.locator('.tools-panel')).toHaveCount(0);
 let previous;
 for(const name of ['design','simulation','results']){
  await page.locator('button[data-panel="'+name+'"]').click();const panel=page.locator('#'+name+'-panel');await expect(panel).toBeVisible();await expect(page.locator('.navigation-panel')).toBeVisible();
  await panel.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
  const bounds=await panel.boundingBox();expect(bounds.x+bounds.width).toBe(1415);if(previous)expect(bounds).toEqual(previous);previous=bounds;
  const color=await panel.evaluate(el=>getComputedStyle(el).backgroundColor);expect(color).toMatch(/^rgba?\(25, 47, 78/);
 }
 await page.locator('#quick-settings').click();await expect(page.locator('#simulation-panel')).toBeVisible();await page.locator('#quick-settings').click();await expect(page.locator('#simulation-panel')).not.toBeVisible();
 await page.locator('button[data-panel="design"]').click();await expect(page.locator('[data-tool="signal"]')).toHaveCount(0);await expect(page.locator('[data-tool="shelter"]')).toBeVisible();
 await page.locator('#cost-sources').click();await expect(page.getByRole('dialog')).toContainText('not quoted Oakland construction prices');await expect(page.getByRole('dialog')).toContainText('$110,000');
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-vehicle-types',/bus/);await expect(page.locator('#scene canvas')).toHaveAttribute('data-vehicle-types',/bike/);
});

test('intersection arrows cycle all sites and preserve the open build panel',async({page})=>{
 await page.goto('/');await page.locator('#view-top').click();await page.locator('button[data-panel="design"]').click();
 const canvas=page.locator('#scene canvas');
 await expect(canvas).toHaveAttribute('data-viewed-intersection','pitt-forbes-bigelow');
 for(const site of ['pitt-fifth-bigelow','pitt-forbes-bouquet','pitt-forbes-bigelow']){
  await page.getByRole('button',{name:'Next intersection',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-viewed-intersection',site);
  await expect(page.locator('#design-panel')).toBeVisible();
 }
 await page.getByRole('button',{name:'Previous intersection',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(canvas).toHaveAttribute('data-viewed-intersection','pitt-forbes-bouquet');
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Next intersection',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-viewed-intersection','pitt-forbes-bigelow');
});
