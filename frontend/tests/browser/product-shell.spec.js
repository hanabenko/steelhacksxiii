import {test,expect} from '@playwright/test';

test('Play presents one challenge flow and Model presents expert controls',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-mode','play');
  await expect(page.getByRole('button',{name:'Play',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'Model',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('.scenario-banner')).toBeVisible();
  await expect(page.locator('#scenario-title')).not.toBeEmpty();
  await expect(page.locator('#challenge-constraint')).not.toBeEmpty();
  await expect(page.locator('.scenario-banner .budget-card')).toBeVisible();
  await expect(page.locator('.scenario-banner .objectives')).toBeVisible();
  await expect(page.locator('#test-design')).toBeEnabled({timeout:15000});

  await page.locator('#play-edit-design').click();
  await expect(page.locator('#design-panel')).toBeVisible();
  await expect(page.locator('.scenario-banner')).not.toBeVisible();
  await page.getByRole('button',{name:'Close design panel'}).click();
  await expect(page.locator('.scenario-banner')).toBeVisible();

  await page.getByRole('button',{name:'Model',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode','model');
  await expect(page.locator('#simulation-panel')).toBeVisible();
  await expect(page.locator('.model-control-group > .control-group-heading > h3')).toHaveText(['Traffic','Environment','Infrastructure','Autonomy','Simulation']);
  await expect(page.locator('#av')).toBeDisabled();
  await expect(page.locator('.unsupported-note')).toContainText('not supported');
  await expect(page.locator('.hud-budget')).not.toBeVisible();

  await page.locator('#run').click();
  await expect(page.locator('#result-status')).toHaveText('100 RUNS',{timeout:15000});
  await expect(page.locator('#simulation-panel')).toBeVisible();
  await expect(page.locator('#results-panel')).toBeVisible();
  await expect(page.locator('.score-card')).not.toBeVisible();
  await expect(page.locator('#before-speed')).not.toHaveText('—');
  await expect(page.locator('#after-speed')).not.toHaveText('—');
  await expect(page.locator('#change-speed')).toHaveText('—');
  await expect(page.locator('.unavailable-metrics')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile keeps the map dominant with one contextual panel',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('.scenario-banner')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Model',exact:true}).click();
  await expect(page.locator('#simulation-panel')).toBeVisible();
  await expect(page.locator('.scenario-banner')).not.toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
