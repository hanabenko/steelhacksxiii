import { chromium } from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5173');await page.locator('button[data-navigation="street"]').click();await page.locator('#observe-toggle').click();await page.screenshot({path:'artifacts/street-navigation.png'});
await page.locator('#observe-toggle').click();await page.locator('#campus-view').click();await page.getByLabel('Active intersection',{exact:true}).selectOption('pitt-fifth-bigelow');await page.locator('#view-top').click();await page.locator('[data-quick-tool="crosswalk"]').click();await page.screenshot({path:'artifacts/fifth-editing.png'});
console.log(JSON.stringify({errors}));await browser.close();
