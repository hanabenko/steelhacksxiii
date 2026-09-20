import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
await page.goto('http://127.0.0.1:5173');await page.locator('#view-top').click();await page.locator('button[data-panel="design"]').click();await page.locator('[data-quick-tool="crosswalk"]').click();await page.mouse.move(783,525);await page.screenshot({path:'artifacts/exact-preview.png'});await browser.close();
