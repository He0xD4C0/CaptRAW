import {readDocument} from './xmp-test.mjs';
import {expect} from '@playwright/test';
import {electron} from './electron-background.mjs';import {resolve,join} from 'node:path';import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';import {createHash} from 'node:crypto';
const root=process.cwd(),out=resolve(process.env.CAPTRAW_NIKON_GUI_OUT||'artifacts/nikon-he-gui');mkdirSync(out,{recursive:true});const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest=JSON.parse(readFileSync('build/upstream/redlamp-libraw-3b20539d3faa766a370e93a529a3b87edffbf0f6/redlamp/bench/samples.json'));
const fixtures=manifest.samples.filter(s=>['HE','HE*'].includes(s.mode)&&(!process.env.CAPTRAW_NIKON_FILTER||s.name.includes(process.env.CAPTRAW_NIKON_FILTER))&&existsSync(resolve('build/samples/nikon-he',s.name+'.NEF'))&&hash(resolve('build/samples/nikon-he',s.name+'.NEF'))===s.sha256);expect(fixtures.length).toBeGreaterThan(0);
const executablePath=process.env.CAPTRAW_APP,app=await electron.launch({executablePath,args:executablePath?[]:[root]}),page=await app.firstWindow(),results=[],errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(String(e)));
async function settle(action){const n=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,n);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind!=='detail').at(-1)?.url);}
const pixels=()=>page.locator('canvas').evaluate(c=>c.toDataURL());
try{
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 for(const s of fixtures){
 const file=resolve('build/samples/nikon-he',s.name+'.NEF');await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);const started=Date.now();await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());
 await expect(page.locator('.document-title')).toContainText(s.name);await expect(page.locator('canvas')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);const baseline=await pixels(),firstVisibleMs=Date.now()-started;
 const adjustmentStarted=Date.now();await settle(async()=>{const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await exposure.fill('.5');await exposure.press('Tab');});const adjustmentLatencyMs=Date.now()-adjustmentStarted;expect(await pixels()).not.toBe(baseline);
 const recipe=join(out,s.name+'.xmp');rmSync(recipe,{force:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},recipe);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(recipe)).toBe(true);const saved=(await readDocument(recipe));expect(saved.source.sha256).toBe(s.sha256);expect(saved.adjustments.exposure).toBe(.5);expect(hash(file)).toBe(s.sha256);
 await page.screenshot({path:join(out,s.name+'.png')});results.push({name:s.name,camera:s.camera,mode:s.mode,crop:s.crop,sourceSHA256:s.sha256,sourceUnchanged:true,firstVisibleMs,adjustmentLatencyMs,visiblePreviewAndExposure:true,recipe});console.log('PASS GUI',s.name,firstVisibleMs,adjustmentLatencyMs);
 writeFileSync(join(out,'report.json'),JSON.stringify({executablePath,backgroundWindow:true,packaged:!!executablePath,selectedSamples:fixtures.length,results,errors},null,2)+'\n');
 }
 expect(errors).toEqual([]);
}finally{writeFileSync(join(out,'report.json'),JSON.stringify({executablePath,backgroundWindow:true,packaged:!!executablePath,selectedSamples:fixtures.length,results,errors},null,2)+'\n');await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});await app.close();}
