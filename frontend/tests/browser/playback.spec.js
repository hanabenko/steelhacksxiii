import {test,expect} from '@playwright/test';

test('large runs illustrate a bounded sample and return to normal after calculating every trial',async({page})=>{
 await page.route('**/api/gemini/**',route=>route.fulfill({json:{source:'fallback',result:{verdict:'Complete.'}}}));
 await page.goto('/');await page.locator('#quick-run').click();await page.locator('#runs-slider').fill('500');
 await page.locator('#run').click();await expect(page.locator('#playback-title')).toContainText('30 sampled rounds');
 await expect(page.locator('#result-status')).toHaveText('500 RUNS',{timeout:15000});
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-playback-speed','1');
 await expect(page.locator('#playback-title')).toHaveText('A city in motion');
 await expect(page.locator('[data-speed="1"]')).toHaveClass(/selected/);
});

test('completion restores the previous paused state and a second run can start normally',async({page})=>{
 await page.route('**/api/gemini/**',route=>route.fulfill({json:{source:'fallback',result:{verdict:'Complete.'}}}));
 await page.goto('/');await page.locator('#pause').click();await page.locator('#quick-run').click();
 await page.locator('#run').click();await expect(page.locator('#scene canvas')).toHaveAttribute('data-playback-speed','100');
 await expect(page.locator('#result-status')).toHaveText('100 RUNS',{timeout:15000});
 await expect(page.locator('#pause')).toHaveAttribute('aria-label','Resume animation');
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-playback-speed','1');
 await page.locator('#quick-run').click();await page.locator('#runs-slider').fill('150');await page.locator('#run').click();
 await expect(page.locator('#result-status')).toHaveText('150 RUNS',{timeout:15000});
 await expect(page.locator('#pause')).toHaveAttribute('aria-label','Resume animation');
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-playback-speed','1');
});

test('a slow server cannot leave playback accelerated and failure still restores normal controls',async({page})=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/simulation',async route=>{await gate;await route.fulfill({status:503,json:{detail:'Simulation unavailable'}});});
 await page.goto('/');await page.locator('#quick-run').click();await page.locator('.sumo-study summary').click();
 await page.locator('[data-run-sumo]').click();await expect(page.locator('#scene canvas')).toHaveAttribute('data-playback-speed','100');
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-playback-speed','1',{timeout:10000});
 await expect(page.locator('#playback-title')).toContainText('Preview finished');
 release();await expect(page.locator('[data-sumo-status]')).toContainText('unavailable');
 await expect(page.locator('[data-run-sumo]')).toBeEnabled();await expect(page.locator('#run')).toBeEnabled();
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-playback-speed','1');
 await expect(page.locator('#playback-title')).toHaveText('A city in motion');
});
