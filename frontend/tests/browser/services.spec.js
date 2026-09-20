import {test,expect} from '@playwright/test';

test('assistant submits current budget, renders plain text, and reports speech failures',async({page})=>{
 let payload;
 await page.route('**/api/voice/voice/ask',route=>{payload=route.request().postDataJSON();return route.fulfill({json:{text:'Budget <script>unsafe</script>: 100000',missing:[]}});});
 await page.route('**/api/voice/voice/speak',route=>route.fulfill({status:503,json:{detail:'Audio unavailable'}}));
 await page.goto('/');await page.locator('.assistant summary').click();await page.locator('[data-speak]').check();
 await page.locator('#assistant-question').fill('How much budget is left?');await page.locator('.assistant button[type=submit]').click();
 await expect(page.locator('[data-answer]')).toContainText('<script>unsafe</script>');await expect(page.locator('[data-source]')).toContainText('speech unavailable');
 expect(payload.context.budget.spent).toBe(0);expect(payload.context.results).toBeNull();expect(payload.speak).toBe(false);
});

test('free simulation runs fast with moving traffic and sends results to Gemini',async({page})=>{
 let payload;
 await page.route('**/api/gemini/generate/simulation_debrief',route=>{payload=route.request().postDataJSON();return route.fulfill({json:{source:'gemini',unverified_numbers:[],result:{verdict:'Your simulation is complete.'}}});});
 await page.goto('/');await page.locator('#quick-run').click();const canvas=page.locator('#scene canvas');
 const before=await canvas.getAttribute('data-traffic-position');await page.locator('#run').click();await expect(canvas).toHaveAttribute('data-playback-speed','100');
 await expect.poll(()=>canvas.getAttribute('data-traffic-position')).not.toBe(before);
 await expect(page.locator('#result-status')).toHaveText('100 RUNS',{timeout:15000});
 await expect(canvas).toHaveAttribute('data-playback-speed','1');
 await expect(canvas).toHaveAttribute('data-time-of-day','9.00');
 const completedPosition=await canvas.getAttribute('data-traffic-position');
 await expect.poll(()=>canvas.getAttribute('data-traffic-position')).not.toBe(completedPosition);
 await expect.poll(()=>payload?.payload?.results?.runs).toBe(100);expect(payload.payload.results.engine).toMatch(/^local-/);
 await page.locator('.assistant summary').click();await expect(page.locator('[data-answer]')).toHaveText('Your simulation is complete.');
});

test('assistant discards a reply when the scene changes while it is pending',async({page})=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/voice/voice/ask',async route=>{await gate;await route.fulfill({json:{text:'Outdated budget'}});});
 await page.goto('/');await page.locator('.assistant summary').click();await page.locator('#assistant-question').fill('budget?');await page.locator('.assistant button[type=submit]').click();
 await page.locator('.assistant summary').click();await page.locator('#quick-run').click();await page.locator('#demand').fill('1100');release();
 await expect(page.locator('[data-answer]')).toContainText('scene changed');
});

test('recorded question is transcribed, submitted, and releases the microphone',async({page})=>{
 await page.addInitScript(()=>{
   window.stoppedTracks=0;
   Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){window.stoppedTracks++;}}]})}});
   window.MediaRecorder=class{
     state='inactive';mimeType='audio/webm';
     start(){this.state='recording';}
     stop(){this.state='inactive';this.ondataavailable({data:new Blob(['recorded question'],{type:this.mimeType})});queueMicrotask(()=>this.onstop());}
   };
 });
 let question;
 await page.route('**/api/voice/voice/transcribe',route=>route.fulfill({json:{text:'How much budget is left?'}}));
 await page.route('**/api/voice/voice/ask',route=>{question=route.request().postDataJSON().question;return route.fulfill({json:{text:'Your budget is available.'}});});
 await page.goto('/');await page.locator('.assistant summary').click();await page.locator('[data-mic]').click();
 await expect(page.locator('[data-mic]')).toHaveText('Stop recording');await expect(page.locator('.assistant button[type=submit]')).toBeDisabled();
 await page.locator('[data-mic]').click();await expect(page.locator('[data-answer]')).toHaveText('Your budget is available.');
 expect(question).toBe('How much budget is left?');expect(await page.evaluate(()=>window.stoppedTracks)).toBeGreaterThan(0);
 await expect(page.locator('.assistant button[type=submit]')).toBeEnabled();
});

test('SUMO study sends supported inputs and renders physical results and replay',async({page})=>{
 let payload;
 const replay={duration_s:60,frames:[{t:0,agents:[{id:'a',type:'vehicle',longitude:-79.9535,latitude:40.4432,heading:90}]},{t:60,agents:[]}]};
 const metrics={mean_speed_mph:{mean:15},average_delay_s_per_vehicle:{mean:12},throughput_vehicles_per_hour:{mean:700}};
 await page.route('**/api/simulation',route=>{payload=route.request().postDataJSON();return route.fulfill({json:{contract_version:1,engine:'sumo-traci',baseline:{metrics},modified:{metrics,representative_replay:replay}}});});
 await page.goto('/');await page.locator('#quick-run').click();await page.locator('.sumo-study summary').click();await page.locator('[data-run-sumo]').click();
 await expect(page.locator('[data-sumo-status]')).toContainText('SUMO complete');await expect(page.locator('#scene canvas')).toHaveAttribute('data-traffic-source','sumo-traci');
 await expect(page.locator('.signal-heading strong')).toHaveText('Forbes × Bigelow');
 await expect(page.locator('#playback-title')).toHaveText('SUMO · Forbes / Bigelow');
 await expect(page.locator('#collision-demo')).toBeDisabled();
 expect(payload.intersection).toBe('pitt-forbes-bigelow');expect(payload.upgrades[0].type).toBe('signal_timing');
 await page.locator('[data-stop-replay]').click();await expect(page.locator('#scene canvas')).toHaveAttribute('data-traffic-source','illustrative');
});

for(const width of [1440,390,320])test(`toolbar assistant is reachable at ${width}px and closes with Escape`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.goto('/');
 const launcher=page.locator('.header .assistant summary');
 await expect(launcher).toContainText('Street assistant');await expect(launcher.locator('svg')).toBeVisible();
 const header=await page.locator('.header').boundingBox(),button=await launcher.boundingBox();
 expect(button.x).toBeGreaterThanOrEqual(header.x);expect(button.x+button.width).toBeLessThanOrEqual(header.x+header.width);
 const guide=await page.locator('#guide-button').boundingBox();expect(guide.x+guide.width).toBeLessThanOrEqual(header.x+header.width);
 await launcher.click();await expect(page.locator('#assistant-question')).toBeVisible();
 const panel=await page.locator('.assistant-content').boundingBox();
 expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(width);
 await page.locator('#assistant-question').focus();await page.keyboard.press('Escape');
 await expect(page.locator('#assistant-question')).not.toBeVisible();await expect(launcher).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
