import {test,expect} from '@playwright/test';

for(const viewport of [{width:1440,height:900},{width:900,height:800},{width:390,height:844}]){
 test(`walkthrough stays above overlapping controls at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);await page.goto('/');
  await page.getByRole('button',{name:'Start walkthrough'}).click();
  for(let step=0;step<3;step++){
   const card=page.locator('.walkthrough');
   await expect(card).toBeVisible();
   // Check the whole card, not just the buttons: navigation previously covered
   // the title/body even when Next remained clickable.
   const covered=await card.evaluate(element=>{
    const r=element.getBoundingClientRect(),points=[];
    for(let y=r.top+18;y<r.bottom-18;y+=20)for(let x=r.left+18;x<r.right-18;x+=20){
     if(!element.contains(document.elementFromPoint(x,y)))points.push({x,y});
    }
    return points;
   });
   expect(covered).toEqual([]);
   if(step<2)await page.locator('#tour-next').click();
  }
  await page.locator('#tour-skip').click();await expect(page.locator('.walkthrough')).toBeHidden();
  await expect(page.getByRole('button',{name:'Start walkthrough'})).toBeFocused();
 });
}
