import { test, expect } from '@playwright/test';

test('map has all twelve placement footprints; mouse navigation keeps the selected upgrade',async({page})=>{
 test.setTimeout(90000); // Long mouse-only traversal across three blocks under software WebGL.
 await page.goto('/');const canvas=page.locator('#scene canvas');await page.locator('#view-top').click();await page.locator('[data-quick-tool="crosswalk"]').click();
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
  const point=await target.evaluate(el=>({x:+el.dataset.screenX,y:+el.dataset.screenY}));await page.mouse.click(point.x,point.y);
 }
 await expect(page.locator('#budget-hud')).toHaveText('$64,000');await expect(page.locator('#network-design-status')).toContainText('3 of 3 sites edited');await page.locator('#quick-run').click();await expect(page.locator('#result-status')).toHaveText('100 RUNS');
});

test('street right-drag translates camera and collision replay respects pause without spending budget',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');const canvas=page.locator('#scene canvas');
 await page.locator('button[data-navigation="street"]').click();const before=await canvas.getAttribute('data-camera-position');await page.mouse.move(700,450);await page.mouse.down({button:'right'});await page.mouse.move(800,510,{steps:8});await page.mouse.up({button:'right'});await expect.poll(()=>canvas.getAttribute('data-camera-position')).not.toBe(before);
 await page.locator('#pause').click();await page.locator('#collision-demo').click();await expect(canvas).toHaveAttribute('data-incident','approach');await page.waitForTimeout(350);await expect(canvas).toHaveAttribute('data-incident','approach');
 await page.locator('#pause').click();await expect(canvas).toHaveAttribute('data-incident','impact',{timeout:15000});await expect(canvas).toHaveAttribute('data-incident','fire',{timeout:15000});await page.locator('#pause').click();await expect(page.locator('#budget-hud')).toHaveText('$100,000');await expect(page.locator('#result-status')).toHaveText('NOT RUN YET');expect(errors).toEqual([]);
});
