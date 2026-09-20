import {test,expect} from '@playwright/test';
async function streetClick(page,x){
 const point=await page.evaluate(async x=>{const {roadPoint}=await import('/src/campus-geometry.js');const map=(await import('/src/data/intersection.json')).default;return roadPoint(map.features,'Forbes Avenue','x',x,0);},x);
 const box=await page.locator('#scene canvas').boundingBox();await page.mouse.click(box.x+box.width/2+point.x*box.height/200,box.y+box.height/2+point.z*box.height/200);
}
test('free mode opens settings without running; AV, budget and road dropdowns are absent from the visible controls',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await expect(page.getByRole('button',{name:'Play game'})).toBeVisible();await expect(page.locator('.action-dock')).not.toBeVisible();await expect(page.locator('.navigation-panel')).toBeVisible();await expect(page.locator('.location-bar')).toHaveCount(0);
 await page.locator('#quick-run').click();await expect(page.locator('#simulation-panel')).toBeVisible();await expect(page.locator('#result-status')).toHaveText('NOT RUN YET');
 for(const id of ['av','scenario-budget','closed-road','pothole-road','runs'])await expect(page.locator('#'+id)).not.toBeVisible();
 await page.locator('#demand').fill('1100');await page.locator('#weather').selectOption('storm');await page.locator('#quick-run').click();await expect(page.locator('#demand')).toHaveValue('1100');await expect(page.locator('#weather')).toHaveValue('storm');await expect(page.locator('#result-status')).not.toHaveText('100 RUNS',{timeout:15000});
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-weather','Thunderstorm');expect(errors).toEqual([]);
});
test('Play locks a random challenge; exit restores free weather and demand',async({page})=>{
 await page.goto('/');await page.locator('#quick-run').click();await page.locator('#weather').selectOption('snow');await page.locator('#demand').fill('1100');
 await page.locator('#play-mode').click();await expect(page.locator('body')).toHaveAttribute('data-mode','game');await expect(page.locator('.action-dock')).toBeVisible();await expect(page.locator('.navigation-panel')).toBeVisible();
 const nav=await page.locator('.navigation-panel').boundingBox();expect(nav.y).toBe(110);
 const budget=Number((await page.locator('#budget-hud').textContent()).replace(/\D/g,''));expect([60000,80000,100000]).toContain(budget);
 await page.locator('button[data-panel="simulation"]').click();for(const id of ['weather','closed-road','pothole-road','start-hour','scenario-budget','demand','green'])await expect(page.locator('#'+id)).toBeDisabled();await expect(page.locator('#add-pothole')).not.toBeVisible();
 await page.locator('#exit-game').click();await page.locator('#quick-run').click();await expect(page.locator('#weather')).toHaveValue('snow');await expect(page.locator('#demand')).toHaveValue('1100');await expect(page.locator('.action-dock')).not.toBeVisible();
});
test('multiple conditions are placed by clicking blue roads, removed individually, with export absent',async({page})=>{
 await page.goto('/');await page.locator('#view-top').click();await page.locator('#quick-run').click();
 await page.locator('#add-closure').click();await expect(page.locator('#scene canvas')).toHaveAttribute('data-hazard-tool','closure');await streetClick(page,-70);await streetClick(page,40);await expect(page.locator('#hazard-list li')).toHaveCount(2);
 await page.locator('#add-pothole').click();await streetClick(page,-40);await streetClick(page,40);await expect(page.locator('#hazard-list li')).toHaveCount(4);
 await page.locator('#cancel-hazard').click();await expect(page.locator('#scene canvas')).toHaveAttribute('data-hazard-tool','');
 await expect(page.getByRole('button',{name:'Export scenario'})).toHaveCount(0);
 await page.getByRole('button',{name:'Remove Pothole 1',exact:true}).click();await expect(page.locator('#hazard-list li')).toHaveCount(3);await page.locator('#clear-hazards').click();await expect(page.locator('#hazard-list li')).toHaveCount(0);
});
test('trial slider and plus/minus respect 10–500; day/night starts when the simulation runs',async({page})=>{
 await page.goto('/');const canvas=page.locator('#scene canvas');await page.locator('#quick-run').click();
 await page.locator('#runs-slider').fill('10');await expect(page.locator('#runs-minus')).toBeDisabled();await page.locator('#runs-plus').click();await expect(page.locator('#runs-value')).toHaveText('11 runs');await page.locator('#runs-slider').fill('500');await expect(page.locator('#runs-plus')).toBeDisabled();await page.locator('#runs-minus').click();await expect(page.locator('#runs-value')).toHaveText('499 runs');await page.locator('#runs-slider').fill('100');
 await page.locator('#start-hour').fill('23');await page.locator('#start-hour').dispatchEvent('change');await expect(canvas).toHaveAttribute('data-time-of-day','23.00');
 for(const speed of ['1','10','100'])await expect(page.locator('[data-speed="'+speed+'"]')).toBeVisible();
 await page.locator('#run').click();await expect(canvas).toHaveAttribute('data-playback-speed','100');
 await expect.poll(()=>canvas.getAttribute('data-time-of-day')).not.toBe('23.00');
 await expect(page.locator('#result-status')).toHaveText('100 RUNS',{timeout:15000});
 await expect(canvas).toHaveAttribute('data-playback-speed','1');await expect(canvas).toHaveAttribute('data-time-of-day','23.00');
 await page.locator('#pause').click();const time=await canvas.getAttribute('data-time-of-day');await page.locator('[data-speed="1"]').click();await expect(canvas).toHaveAttribute('data-time-of-day',time);
});
test('mobile Play game sits above the legend and speed controls; game navigation stays reachable',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 const play=await page.locator('#play-mode').boundingBox(),legend=await page.locator('.scene-legend').boundingBox(),speed=await page.locator('.playback').boundingBox();expect(play.x).toBe(13);expect(play.y+play.height).toBeLessThanOrEqual(legend.y);expect(legend.y+legend.height).toBeLessThanOrEqual(speed.y);
 await page.locator('#play-mode').click();await expect(page.locator('.navigation-panel')).toBeVisible();await page.locator('#exit-game').click();await expect(page.locator('#play-mode')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('game completes baseline before editing and compares an unchanged design fairly',async({page})=>{
 await page.goto('/');await page.locator('#play-mode').click();
 await expect(page.locator('#test-design')).toBeEnabled();
 await expect(page.locator('#game-score')).toContainText('Baseline:');
 await expect(page.locator('#quick-run')).not.toBeVisible();await expect(page.locator('#run')).not.toBeVisible();
 const baseline=await page.locator('#game-score').textContent();
 await page.locator('#test-design').click();await expect(page.locator('#game-score')).toContainText('Testing');
 await expect(page.locator('#test-design')).toBeDisabled();
 await expect(page.locator('#game-score')).toContainText('0 fewer (0%)',{timeout:15000});
 await expect(page.locator('#game-score')).toContainText('Score 0/100');
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-playback-speed','1');
 const count=baseline.match(/Baseline: (\d+)/)[1];await expect(page.locator('#game-score')).toContainText('Your design '+count);
 await expect(page.locator('#placement-hint')).not.toBeVisible();
});
