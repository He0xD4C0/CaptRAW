import {_electron as electron,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
const root=process.cwd(),executablePath=process.env.CAPTRAW_APP;
const recipe=JSON.parse(readFileSync('artifacts/workbench/durable.captraw.json','utf8'));
const output=resolve('artifacts/restarted.captraw.json');rmSync(output,{force:true});
const app=await electron.launch({executablePath,args:executablePath?[]:[root]});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(30000);
 await expect(page.getByRole('heading',{name:'从光线，开始。'})).toBeVisible();
 expect(await page.evaluate(()=>typeof require)).toBe('undefined');
 await app.evaluate(({dialog,BrowserWindow},file)=>{
  BrowserWindow.getAllWindows()[0].webContents.session.enableNetworkEmulation({offline:true});
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
 },resolve('artifacts/workbench/durable.captraw.json'));
 await page.getByRole('button',{name:'打开',exact:true}).click();
 await expect(page.locator('.film-item img')).toBeVisible();
 await page.locator('.rendering').waitFor({state:'hidden'});
 await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue(String(recipe.adjustments.exposure));
 await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await expect(page.locator('.mask-row')).toHaveCount(3);
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(output)).toBe(true);
 const restored=JSON.parse(readFileSync(output,'utf8'));expect(restored.adjustments).toEqual(recipe.adjustments);expect(restored.source).toEqual(recipe.source);
 await page.screenshot({path:'artifacts/restarted.png'});
 writeFileSync('artifacts/restart-report.json',JSON.stringify({packaged:!!executablePath,coldProcess:true,offline:true,rendererNodeAccess:false,restoredAdjustments:true,sourceIdentityMatches:true},null,2)+'\n');
 console.log('Restart recovery passed',executablePath||'production build');
}finally{await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await app.close();}
