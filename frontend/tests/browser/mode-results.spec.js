import {test,expect} from '@playwright/test';
import {enterGame} from './ui-helpers.js';

test('free results show a single scenario and retain site selection',async({page})=>{
 await page.goto('/');await page.locator('#quick-run').click();await page.locator('#run').click();
 await expect(page.locator('#result-status')).toHaveText('100 RUNS');
 await expect(page.locator('.metric-header span:visible')).toHaveText(['METRIC','RESULT']);
 await expect(page.locator('#result-note')).toContainText('Local simulation estimates');
 await expect(page.locator('#result-note')).not.toContainText('lower');
 await expect(page.locator('#compare')).toBeHidden();await expect(page.locator('.change-key')).toBeHidden();
 await expect(page.locator('.score-card')).toBeHidden();
 await page.locator('#result-scope').selectOption('pitt-forbes-bigelow');
 await expect(page.locator('#after-speed')).not.toHaveText('—');
 await expect(page.locator('#before-speed')).toBeHidden();
 await enterGame(page);await page.getByRole('button',{name:'Start walkthrough'}).click();
 await expect(page.locator('#tour-title')).toHaveText('Redesign the street');
 await page.locator('#tour-skip').click();await page.locator('#exit-game').click();
 await page.getByRole('button',{name:'Start walkthrough'}).click();
 await expect(page.locator('#tour-title')).toHaveText('Explore simulation mode');
});

test('mobile game walkthrough tests the design and restores its action after completion',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await enterGame(page);
 await page.getByRole('button',{name:'Start walkthrough'}).click();
 await page.locator('#tour-next').click();await page.locator('#tour-next').click();
 await page.locator('[data-tool="crosswalk"]').click();await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="west"]').click();
 await page.locator('#tour-next').click();await expect(page.locator('#tour-title')).toHaveText('Test your design');
 await page.locator('#simulation-panel #test-design').click();await expect(page.locator('#tour-next')).toBeEnabled();
 await page.locator('#tour-next').click();await expect(page.locator('#tour-title')).toHaveText('See what changed');
 await expect(page.locator('.metric-header span:visible')).toHaveText(['METRIC','BEFORE','AFTER','CHANGE']);
 await expect(page.locator('#change-risk')).toHaveClass(/improved/);
 await page.locator('#tour-next').click();await page.locator('#tour-next').click();
 await expect(page.locator('.scenario-banner #test-design')).toBeVisible();
 await expect(page.locator('#test-design')).toHaveCount(1);
});

test('free shortcuts stay separate and completed results survive a game visit',async({page})=>{
 await page.goto('/');await page.keyboard.press('1');await expect(page.locator('#design-panel')).toBeHidden();
 await page.locator('#quick-run').click();await page.locator('#weather').selectOption('snow');await page.locator('#run').click();
 await expect(page.locator('#result-status')).toHaveText('100 RUNS');const speed=await page.locator('#after-speed').textContent();
 await enterGame(page);await page.locator('button[data-panel=simulation]').click();await page.locator('#run').click();await expect(page.locator('#result-status')).toHaveText('100 RUNS');
 await page.locator('#exit-game').click();await expect(page.locator('#after-speed')).toHaveText(speed);await expect(page.locator('#weather')).toHaveValue('snow');
 await page.locator('#scenarios-button').click();await expect(page.locator('#dialog-content')).toContainText('Free simulation');await expect(page.locator('#dialog-content')).not.toContainText('Score');
});

test('smaller challenge budgets control affordability styling',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{Math.random=()=>0;});await page.locator('#play-mode').click();
 await expect(page.locator('#test-design')).toBeEnabled();await expect(page.locator('#budget')).toHaveText('$60,000');
 await page.locator('[data-tool="bike"]').click();await page.locator('.keyboard-placement summary').click();
 await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="east"]').click();
 await page.locator('[data-intersection="pitt-forbes-bigelow"][data-zone="west"]').click();
 await expect(page.locator('[data-tool="diet"]')).toHaveClass(/unaffordable/);
 await expect(page.locator('#budget')).toHaveText('$12,000');
});
