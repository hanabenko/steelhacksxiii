import { chromium } from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
await page.goto('http://127.0.0.1:5173');await page.locator('#scene canvas').waitFor();await page.locator('#pause').click();
await page.locator('#observe-toggle').click();await page.screenshot({path:'artifacts/campus-clean.png'});
await page.locator('#observe-toggle').click();await page.screenshot({path:'artifacts/campus-controls.png'});
await page.locator('#view-top').click();await page.screenshot({path:'artifacts/campus-top-down.png'});
await browser.close();
