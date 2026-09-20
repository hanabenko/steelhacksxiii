import {test,expect} from '@playwright/test';
import data from '../../src/data/weather.json' with {type:'json'};

test('historical weather updates scene, assistant and SUMO; manual override clears attribution',async({page})=>{
 let ask,simulation;
 await page.route('**/api/voice/voice/ask',route=>{ask=route.request().postDataJSON();return route.fulfill({json:{text:'Weather received',missing:[]}});});
 await page.route('**/api/simulation',route=>{simulation=route.request().postDataJSON();return route.fulfill({status:503,json:{detail:'Test complete'}});});
 const date=Object.keys(data.days).find(date=>data.days[date][0]==='snow');
 await page.goto('/');await page.locator('#quick-run').click();
 await page.locator('#weather-date').fill(date);await page.locator('#apply-weather-date').click();
 await expect(page.locator('#weather')).toHaveValue('snow');await expect(page.locator('#weather-source')).toContainText('Open-Meteo');
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-weather','Snow / icy roads');
 await page.locator('.assistant summary').click();await page.locator('#assistant-question').fill('What weather is selected?');await page.locator('.assistant button[type=submit]').click();
 await expect(page.locator('[data-answer]')).toHaveText('Weather received');expect(ask.context.weather.date).toBe(date);
 await page.locator('.assistant summary').click();await page.locator('.sumo-study summary').click();await page.locator('[data-run-sumo]').click();
 await expect(page.locator('[data-sumo-status]')).toContainText('Test complete');expect(simulation.settings.conditions.weather).toBe('snow');
 await page.locator('#weather').selectOption('rain');await expect(page.locator('#weather-source')).not.toContainText(date);
 await expect(page.locator('#scene canvas')).toHaveAttribute('data-weather','Rain');
 await page.locator('#play-mode').click();await expect(page.locator('#apply-weather-date')).toBeDisabled();
});
