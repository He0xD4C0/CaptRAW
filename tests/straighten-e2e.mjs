import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {EngineClient} from './engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {resolve,join,dirname} from 'node:path';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(process.env.CAPTRAW_STRAIGHTEN_GUI_OUT||'artifacts/straighten-gui');mkdirSync(root,{recursive:true});const out=mkdtempSync(join(root,'run-'));
const executablePath=process.env.CAPTRAW_APP,native=executablePath?resolve(dirname(executablePath),'../Resources/native'):resolve('build/native');
const docs=new Documents(new XMP(executablePath?join(native,'captraw-xmp'):resolve('build/xmp/captraw-xmp')));
const source=join(out,'拉直 原片.png'),other=join(out,'另一张.png');
execFileSync('build/qa-venv/bin/python',['-c',`from PIL import Image,ImageDraw\nimport sys\na=Image.new('RGB',(1000,760),(80,80,80));d=ImageDraw.Draw(a)\nfor (x,y),c in [((280,300),(240,30,30)),((720,460),(30,220,240))]:d.ellipse((x-18,y-18,x+18,y+18),fill=c)\na.save(sys.argv[1])`,source]);copyFileSync(source,other);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(source),checks=[],errors=[],metrics=[];let app,page,failure,sequence=0;
const button=name=>page.getByRole('button',{name,exact:true}),angle=()=>page.getByRole('spinbutton',{name:'角度',exact:true});
const pass=s=>{checks.push(s);console.log('PASS',s);};
const frame=()=>page.evaluate(()=>window.__straightenFrames.filter(f=>f.kind==='fit').at(-1));
async function ready(){await page.waitForFunction(()=>{const f=window.__straightenFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas')?.dataset.frame===f.url&&!document.querySelector('.rendering');});await expect(page.getByRole('alert')).toHaveCount(0);}
async function settle(action){const previous=(await frame())?.url;await action();await expect.poll(async()=>(await frame())?.url,{timeout:120000}).not.toBe(previous);await ready();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>button('打开').click());}
async function save(name){const path=join(out,`${++sequence}-${name}.xmp`);await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await button('保存').click();await expect.poll(()=>existsSync(path)).toBe(true);await ready();return {path,doc:await docs.read(path)};}
async function setAngle(value){await settle(async()=>{await angle().fill(String(value));await angle().press('Tab');});}
async function markers(){
 return page.locator('canvas').evaluate(c=>{
  const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data,b=c.getBoundingClientRect(),points=[];
  for(let mode=0;mode<2;mode++){
   let sx=0,sy=0,total=0;
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
    const i=(y*c.width+x)*4,r=a[i],g=a[i+1],blue=a[i+2];
    const weight=mode?Math.min(g,blue)-r:r-Math.max(g,blue);
    if(weight>50){sx+=x*weight;sy+=y*weight;total+=weight;}
   }
   if(!total)throw new Error('Visible marker missing');
   points.push({x:b.x+(sx/total+.5)*b.width/c.width,y:b.y+(sy/total+.5)*b.height/c.height});
  }return points;
 });
}
async function draw(points,release=true){await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:8});await expect(page.getByTestId('straighten-line')).toBeVisible();if(release)await page.mouse.up();}
async function aligned(axis){const [a,b]=await markers(),error=Math.abs(axis==='horizontal'?b.y-a.y:b.x-a.x);assert(error<1.5,`Visible marker alignment ${error}px`);return error;}
async function launch(){
 app=await electron.launch({executablePath});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({session,ipcMain})=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_r,done)=>done({cancel:true}));
  const real=ipcMain._invokeHandlers.get('image:straighten');globalThis.__straightenCalls=0;globalThis.__straightenFinished=0;
  ipcMain.removeHandler('image:straighten');ipcMain.handle('image:straighten',async(...args)=>{
   globalThis.__straightenCalls++;const result=await real(...args);
   if(globalThis.__holdStraighten){globalThis.__straightenHeld=true;await new Promise(resolve=>{globalThis.__releaseStraighten=resolve;});}
   globalThis.__straightenFinished++;return result;
  });
 });
 await page.evaluate(()=>{window.__straightenFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__straightenFrames.push(e.frame);});});
}
async function hold(){await app.evaluate(()=>{globalThis.__holdStraighten=true;globalThis.__straightenHeld=false;});}
async function release(){const before=await app.evaluate(()=>globalThis.__straightenFinished);await app.evaluate(()=>{globalThis.__holdStraighten=false;globalThis.__releaseStraighten?.();});await expect.poll(()=>app.evaluate(()=>globalThis.__straightenFinished)).toBe(before+1);}
try{
 await launch();await open(source);await button('蒙版 M').click();await settle(()=>button('径向').click());
 const v=await page.getByTestId('viewport').boundingBox();
 await settle(async()=>{await page.mouse.move(v.x+v.width*.28,v.y+v.height*.3);await page.mouse.down();await page.mouse.move(v.x+v.width*.5,v.y+v.height*.65,{steps:6});await page.mouse.up();});
 await settle(async()=>{const control=page.getByRole('spinbutton',{name:'局部亮度',exact:true});await control.fill('0.4');await control.press('Tab');});
 const masked=await save('masked');await button('裁切 C').click();
 for(const rotation of [0,90,180,270]){
  if(rotation)await settle(()=>button('顺时针旋转 90 度').click());
  await setAngle(rotation%180?-12.5:12.5);const before=await angle().inputValue();
  await button('拉直').click();await expect(button('拉直')).toHaveAttribute('aria-pressed','true');await expect(button('裁切 C')).toHaveClass(/selected/);
  const points=await markers(),axis=Math.abs(points[1].x-points[0].x)>=Math.abs(points[1].y-points[0].y)?'horizontal':'vertical';
  await settle(()=>draw(points));await expect(button('拉直')).toHaveAttribute('aria-pressed','false');await expect(page.getByTestId('straighten-line')).toHaveCount(0);
  const error=await aligned(axis),value=Number(await angle().inputValue());assert(Math.abs(value-19.98)<.08,`Expected source-marker tilt: ${value}`);
  const edited=await save('straightened-'+rotation);assert.deepEqual(edited.doc.adjustments.masks,masked.doc.adjustments.masks);assert.equal(edited.doc.adjustments.rotation,rotation);assert.deepEqual(edited.doc.adjustments.crop,masked.doc.adjustments.crop);
  const rendered=hash((await frame()).file);await settle(()=>button('撤销').click());await expect(angle()).toHaveValue(before);await settle(()=>button('重做').click());assert.equal(hash((await frame()).file),rendered);
  metrics.push({rotation,angle:value,axis,visibleErrorPx:error});pass(`coarse ${rotation}: visible horizontal/vertical line, native pixels, one-step history and mask/crop preservation`);
 }
 await settle(()=>button('顺时针旋转 90 度').click());await setAngle(-8);await button('1:1').click();
 await page.waitForFunction(()=>!!document.querySelector('canvas').dataset.detail);const bounds=await page.getByTestId('viewport').boundingBox();
 await page.keyboard.down('Space');await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.5+30,bounds.y+bounds.height*.5+15,{steps:5});await page.mouse.up();await page.keyboard.up('Space');
 await button('拉直').click();await settle(async()=>draw((await markers()).reverse()));await aligned('horizontal');await button('适屏').click();
 pass('reversed stroke at physical 1:1 after Space-pan produces the same horizontal alignment');
 await button('拉直').click();const calls=await app.evaluate(()=>globalThis.__straightenCalls),points=await markers();
 await page.mouse.click(points[0].x,points[0].y);await expect(page.getByTestId('straighten-line')).toHaveCount(0);assert.equal(await app.evaluate(()=>globalThis.__straightenCalls),calls);
 await draw(points,false);await page.keyboard.press('Escape');await page.mouse.up();await expect(page.getByTestId('straighten-line')).toHaveCount(0);assert.equal(await app.evaluate(()=>globalThis.__straightenCalls),calls);await expect(angle()).toBeVisible();
 pass('click-only and Escape during a stroke create neither a native request nor an edit');
 await setAngle(0);const unchanged=await save('before-cancel');await hold();await button('拉直').click();await draw(await markers());await expect.poll(()=>app.evaluate(()=>globalThis.__straightenHeld)).toBe(true);await expect(page.getByTestId('straighten-pending')).toBeVisible();
 const forbidden=join(out,'must-not-save.xmp');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},forbidden);
 await page.keyboard.press('Meta+s');await expect(page.getByRole('alert')).toContainText('尚未完成');assert(!existsSync(forbidden));await page.getByRole('alert').getByRole('button').click();
 await app.evaluate(({dialog,BrowserWindow})=>{globalThis.__closeCalls=0;dialog.showMessageBox=async()=>{globalThis.__closeCalls++;return {response:0};};BrowserWindow.getAllWindows()[0].close();});await expect.poll(()=>app.evaluate(()=>globalThis.__closeCalls)).toBe(1);
 await page.keyboard.press('Escape');await expect(page.getByTestId('straighten-pending')).toHaveCount(0);await release();await expect(angle()).toHaveValue('0');assert.deepEqual((await save('after-cancel')).doc.adjustments,unchanged.doc.adjustments);
 pass('pending real solve is protected from save/quit; Escape discards its delayed result');
 await hold();await button('拉直').click();await draw(await markers());await expect.poll(()=>app.evaluate(()=>globalThis.__straightenHeld)).toBe(true);
 await open(other);await release();await button('裁切 C').click();await expect(angle()).toHaveValue('0');assert.equal((await save('other')).doc.adjustments.masks.length,0);
 pass('switching photos discards a delayed result without changing the new document');
 await open(unchanged.path);await button('裁切 C').click();await button('拉直').click();await settle(async()=>draw(await markers()));
 const final=await save('final');await page.screenshot({path:join(out,'straightened-workbench.png')});
 const output=join(out,'desktop.tiff');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);await button('导出').click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 const old='/Users/he0xd4c0/Applications/CaptRAW-0.48.app/Contents/Resources/native',reference=new EngineClient({executable:join(old,'captraw-engine'),resources:join(old,'resources'),cache:join(out,'reference')});
 try{await reference.call('export',{path:source,artProfile:final.doc.artProfile,format:'tiff',output:join(out,'reference.tiff')});}finally{await reference.stop();}
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np,sys\na,b=[tifffile.imread(p) for p in sys.argv[1:]]\nwith tifffile.TiffFile(sys.argv[1]) as f: assert len(f.pages[0].tags[34675].value)>0\nassert a.dtype==np.uint16 and np.array_equal(a,b)`,output,join(out,'reference.tiff')]);
 const visible=hash((await frame()).file);await closeElectron(app);app=undefined;await launch();await open(final.path);assert.equal(hash((await frame()).file),visible);await button('裁切 C').click();await expect(angle()).toHaveValue(String(final.doc.adjustments.fineRotation));
 pass('saved XMP reopens exact preview; TIFF16 and ICC equal independent installed 0.48 output');
 assert.equal(hash(source),sourceHash);assert.equal(hash(other),sourceHash);assert.deepEqual(errors,[]);
}catch(e){failure={stack:e.stack||String(e),stdout:e.stdout?.toString(),stderr:e.stderr?.toString()};if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw e;}
finally{let diagnostics;if(app){diagnostics=electronDiagnostics(app);await closeElectron(app).catch(e=>{errors.push(String(e));process.exitCode=1;});}writeFileSync(join(out,'report.json'),JSON.stringify({passed:!failure&&!errors.length,checks,errors,failure,metrics,source,sourceHash,executablePath:executablePath||null,diagnostics},null,2)+'\n');console.log('REPORT',join(out,'report.json'));}
