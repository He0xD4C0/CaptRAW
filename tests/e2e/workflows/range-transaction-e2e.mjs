import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {mkdirSync,mkdtempSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(process.env.CAPTRAW_RANGE_TRANSACTION_OUT||'artifacts/range-transaction');mkdirSync(root,{recursive:true});
const out=mkdtempSync(join(root,'run-')),source=join(out,'范围 原片.png'),checks=[],errors=[];
execFileSync('build/qa-venv/bin/python',['-c',`from PIL import Image,ImageDraw\nimport sys\na=Image.new('RGB',(800,600),(80,80,80));d=ImageDraw.Draw(a);d.rectangle((50,50,350,550),fill=(210,40,30));d.rectangle((450,50,750,550),fill=(30,160,210));a.save(sys.argv[1])`,source]);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),original=hash(source);let app,page,failure,sequence=0;
const button=name=>page.getByRole('button',{name,exact:true}),pass=s=>{checks.push(s);console.log('PASS',s);};
async function ready(){await page.waitForFunction(()=>{const f=window.__rangeFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas')?.dataset.frame===f.url&&!document.querySelector('.rendering');});}
async function settle(action){const before=await page.evaluate(()=>window.__rangeFrames.filter(f=>f.kind==='fit').at(-1)?.url);await action();await page.waitForFunction(before=>window.__rangeFrames.filter(f=>f.kind==='fit').at(-1)?.url!==before,before);await ready();}
async function save(name){const path=join(out,`${++sequence}-${name}.xmp`);await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await button('保存').click();await expect.poll(()=>existsSync(path)).toBe(true);await ready();return readDocument(path);}
async function points(){return page.evaluate(()=>{const b=document.querySelector('[data-testid=viewport]').getBoundingClientRect(),f=window.__rangeFrames.filter(f=>f.kind==='fit').at(-1),s=Math.min((b.width-64)/f.fullWidth,(b.height-64)/f.fullHeight);return [.2,.35].map(x=>({x:b.x+b.width/2+(x-.5)*f.fullWidth*s,y:b.y+b.height/2-.1*f.fullHeight*s}));});}
async function drag(release=false){const [a,b]=await points();await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y+30,{steps:5});await expect(page.getByTestId('luminance-sample-box')).toBeVisible();if(release)await page.mouse.up();}
async function protectedSave(name){const path=join(out,`forbidden-${name}.xmp`);await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await page.keyboard.press('Meta+s');await expect(page.getByRole('alert')).toContainText('尚未完成',{timeout:4000});assert(!existsSync(path));await button('关闭错误').focus();await page.keyboard.press('Enter');}
async function hold(){await app.evaluate(()=>{globalThis.__rangeHeld=false;globalThis.__holdRange=true;});}
async function release(){const before=await app.evaluate(()=>globalThis.__rangeFinished);await app.evaluate(()=>{globalThis.__holdRange=false;globalThis.__releaseRange?.();});await expect.poll(()=>app.evaluate(()=>globalThis.__rangeFinished)).toBe(before+1);}
try{
 app=await electron.launch({executablePath:process.env.CAPTRAW_APP});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({ipcMain,session})=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_r,done)=>done({cancel:true}));
  globalThis.__rangeCalls=0;globalThis.__rangeFinished=0;
  for(const name of ['image:color-sample','image:luminance-sample']){const real=ipcMain._invokeHandlers.get(name);if(!real)throw Error(name);ipcMain.removeHandler(name);ipcMain.handle(name,async(...args)=>{globalThis.__rangeCalls++;const result=await real(...args);if(globalThis.__holdRange){globalThis.__rangeHeld=true;await new Promise(resolve=>{globalThis.__releaseRange=resolve;});}globalThis.__rangeFinished++;return result;});}
 });
 await page.evaluate(()=>{window.__rangeFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__rangeFrames.push(e.frame);});});
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);await settle(()=>button('打开').click());
 for(const type of ['颜色','亮度']){
  await button('蒙版 M').click();await settle(()=>button(type+'范围').click());const baseline=await save(type+'-initial');
  const calls=await app.evaluate(()=>globalThis.__rangeCalls);await drag();await protectedSave(type+'-draft');
  await app.evaluate(({dialog,BrowserWindow})=>{globalThis.__closeCalls=0;dialog.showMessageBox=async()=>{globalThis.__closeCalls++;return {response:0};};BrowserWindow.getAllWindows()[0].close();});await expect.poll(()=>app.evaluate(()=>globalThis.__closeCalls)).toBe(1);
  await page.keyboard.press('Escape');await page.mouse.up();await expect(page.getByTestId('luminance-sample-box')).toHaveCount(0);assert.equal(await app.evaluate(()=>globalThis.__rangeCalls),calls);assert.deepEqual((await save(type+'-cancelled')).adjustments,baseline.adjustments);pass(type+': draft save/close protection and Escape leave recipe and request count unchanged');
  await settle(()=>button('蒙版 M').click());await hold();await drag(true);await expect.poll(()=>app.evaluate(()=>globalThis.__rangeHeld)).toBe(true);await protectedSave(type+'-pending');
  await page.keyboard.press('p');await release();await page.keyboard.press('p');await ready();assert.deepEqual((await save(type+'-comparison')).adjustments,baseline.adjustments);pass(type+': comparison discards a delayed real sample and releases save protection');
  if(await button(type+'取样').getAttribute('aria-pressed')!=='true')await button(type+'取样').click();await drag();const n=await app.evaluate(()=>globalThis.__rangeCalls);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720));await expect(page.getByTestId('luminance-sample-box')).toHaveCount(0);await page.mouse.up();assert.equal(await app.evaluate(()=>globalThis.__rangeCalls),n);assert.deepEqual((await save(type+'-resized')).adjustments,baseline.adjustments);pass(type+': resizing cancels the selected rectangle instead of sampling stale screen coordinates');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,960));await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(1480);
  if(await button(type+'取样').getAttribute('aria-pressed')!=='true')await button(type+'取样').click();
  await settle(()=>drag(true));await expect(page.getByRole('alert')).toHaveCount(0);const edited=await save(type+'-edited');assert.notDeepEqual(edited.adjustments,baseline.adjustments);
  await settle(()=>button('撤销').click());assert.deepEqual((await save(type+'-undo')).adjustments,baseline.adjustments);await settle(()=>button('重做').click());assert.deepEqual((await save(type+'-redo')).adjustments,edited.adjustments);pass(type+': successful native sample produces one reversible edit');
 }
 await page.screenshot({path:join(out,'range-workbench.png')});assert.equal(hash(source),original);assert.deepEqual(errors,[]);
}catch(e){failure=e.stack;if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw e;}
finally{if(app)await closeElectron(app);writeFileSync(join(out,'report.json'),JSON.stringify({passed:!failure&&!errors.length,checks,errors,failure,sourceHash:original,executablePath:process.env.CAPTRAW_APP||null},null,2)+'\n');console.log('REPORT',join(out,'report.json'));}
