export async function switchPanel(page,name){
 if(name==='design'&&await page.locator('body').getAttribute('data-mode')!=='game')await enterGame(page);
 if(await page.locator('body').getAttribute('data-mode')==='game'){await page.locator('button[data-panel="'+name+'"]').click();return;}
 if(await page.locator('#'+name+'-panel').isVisible()){await page.getByRole('button',{name:'Close '+name+' panel',exact:true}).click();return;}
 await page.locator('#quick-run').click();
 if(name!=='simulation')await page.locator(name==='design'?'#free-design':'#run').click();
}
export async function buildTool(page,type){if(!await page.locator('#design-panel').isVisible())await switchPanel(page,'design');return page.locator('[data-quick-tool="'+type+'"]');}
export async function openPanel(page,name){if(!await page.locator('#'+name+'-panel').isVisible())await switchPanel(page,name);if(name==='design'&&!await page.locator('.keyboard-placement').evaluate(el=>el.open))await page.locator('.keyboard-placement>summary').click();}
export async function enterGame(page){
 // Fixed random draws isolate editor regressions from the separately tested random challenge generator.
 await page.evaluate(()=>{window.savedTestRandom=Math.random;const draws=[0,0,0,.99,0,.5];Math.random=()=>draws.length?draws.shift():window.savedTestRandom();});
 await page.locator('#play-mode').click();await page.locator('#test-design').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#test-design').disabled);await page.evaluate(()=>{Math.random=window.savedTestRandom;delete window.savedTestRandom;});
 await page.locator('button[data-panel="design"]').click();
}
