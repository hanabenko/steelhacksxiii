import { chromium } from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5173');await page.locator('#pause').click();await page.screenshot({path:'artifacts/streets-overview.png'});
for(const name of ['design','simulation','results']){await page.locator('button[data-panel="'+name+'"]').click();await page.locator('#'+name+'-panel').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));await page.screenshot({path:'artifacts/navy-'+name+'.png'});}
await page.locator('button[data-panel="results"]').click();await page.locator('#view-top').click();await page.locator('button[data-panel="design"]').click();await page.locator('[data-tool="bike"]').click();await page.screenshot({path:'artifacts/road-alignment.png'});
await page.setViewportSize({width:390,height:844});await page.reload();await page.locator('button[data-panel="design"]').click();await page.screenshot({path:'artifacts/mobile-build.png'});
console.log(JSON.stringify({errors}));await browser.close();
