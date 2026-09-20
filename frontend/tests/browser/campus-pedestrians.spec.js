import {test,expect} from '@playwright/test';
test('campus class change increases pedestrians and rewards crossing throughput',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-pedestrian-count','48');
 await page.locator('#play-mode').click();await expect(page.locator('#test-design')).toBeEnabled();await page.locator('#campus-challenge').click();await expect(page.locator('#test-design')).toBeEnabled();
 await expect(page.locator('#scenario-title')).toContainText('Campus class change');await expect(page.locator('#scene canvas')).toHaveAttribute('data-pedestrian-count','72');
 await expect(page.locator('#objective-access small')).toHaveText('Increase campus pedestrian throughput by 15%');
 await page.locator('#play-edit-design').click();
 await page.locator('[data-tool="crosswalk"]').click();await page.locator('.keyboard-placement summary').click();
 for(const site of ['pitt-forbes-bigelow','pitt-fifth-bigelow','pitt-forbes-bouquet'])await page.locator(`[data-intersection="${site}"][data-zone="east"]`).click();
 await page.getByRole('button',{name:'Next: Simulate →',exact:true}).click();await page.locator('#run').click();
 await expect(page.locator('#objective-access')).toHaveClass(/achieved/,{timeout:15000});await expect(page.locator('#change-pedestrianThroughput')).toHaveClass(/improved/);
 await expect(page.locator('#game-score')).toContainText('Pedestrian throughput +');
 await page.locator('#result-scope').selectOption('pitt-forbes-bigelow');await expect(page.locator('#objective-access')).toHaveClass(/achieved/);
 await page.locator('#exit-game').click();await expect(page.locator('#scene canvas')).toHaveAttribute('data-pedestrian-count','48');
 await expect(page.locator('#objective-access small')).toHaveText('Reach 65 pedestrian access');expect(errors).toEqual([]);
});
