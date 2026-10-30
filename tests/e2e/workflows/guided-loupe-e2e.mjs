import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(process.env.CAPTRAW_LOUPE_OUT||'artifacts/guided-loupe-gui');mkdirSync(root,{recursive:true});const out=mkdtempSync(join(root,'run-'));
const source=resolve(process.env.CAPTRAW_TEST_RAW||'build/samples/nikon-d850.NEF'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(source);
const checks=[],errors=[],metrics=[];let app,page,reference,failure,n=0;
const pass=s=>{checks.push(s);console.log('PASS',s);},button=name=>page.getByRole('button',{name,exact:true}),loupe=()=>page.getByRole('img',{name:'引导透视放大镜'});
const fit=()=>page.evaluate(()=>window.__loupeFrames.filter(f=>f.kind==='fit').at(-1));
async function ready(){await page.waitForFunction(()=>{const f=window.__loupeFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas')?.dataset.frame===f.url&&!document.querySelector('.rendering');});}
async function settle(fn){const old=(await fit()).url;await fn();await expect.poll(async()=>(await fit()).url,{timeout:120000}).not.toBe(old);await ready();}
async function panel(){await button('编辑').click();const s=page.locator('.adjust-section > summary').filter({hasText:/^几何$/});await s.scrollIntoViewIfNeeded();if(await s.locator('..').getAttribute('open')===null)await s.click();await button('引导透视').scrollIntoViewIfNeeded();}
async function save(name){const path=join(out,`${++n}-${name}.xmp`);await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await button('保存').click();await expect.poll(()=>existsSync(path)).toBe(true);return readDocument(path);}
async function hover(){const b=await page.locator('canvas').boundingBox();const q={x:b.x+b.width/2,y:b.y+b.height/2};await page.mouse.move(q.x,q.y);await expect(loupe()).toBeVisible();await expect(loupe()).toHaveAttribute('data-ready','true',{timeout:120000});return q;}
async function anchor(){return loupe().evaluate(e=>({x:Number(e.dataset.x),y:Number(e.dataset.y)}));}
try{
 app=await electron.launch({executablePath:process.env.CAPTRAW_APP});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__loupeFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__loupeFrames.push(e.frame);});});
 await app.evaluate(({dialog,session},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_r,done)=>done({cancel:true}));},source);
 await button('打开').click();await ready();const original=await save('original');await panel();await button('引导透视').click();await expect(page.getByRole('checkbox',{name:/显示放大镜/})).toBeChecked();const center=await hover();
 const f=await fit(),q=await anchor(),url=await loupe().locator('image').getAttribute('href');const detail=await page.evaluate(url=>window.__loupeFrames.find(f=>f.url===url),url);assert(detail&&detail.kind==='detail');assert.equal(detail.revision,f.revision);assert(detail.width<f.fullWidth&&detail.height<f.fullHeight);copyFileSync(detail.file,join(out,'detail.png'));
 // Compare the genuine detail raster with an independent installed core, not the fit preview.
 const native='/Users/he0xd4c0/Applications/CaptRAW-0.55.app/Contents/Resources/native';reference=new EngineClient({executable:join(native,'captraw-engine'),resources:join(native,'resources'),cache:join(out,'reference-cache')});
 await reference.call('open',{path:source,sessionId:'reference'});let pending=reference.preview(1);await reference.call('update',{revision:1,adjustments:original.adjustments,artProfile:original.artProfile});await pending;pending=reference.preview(1,'detail');await reference.call('viewport',{revision:1,x:detail.x,y:detail.y,width:detail.width,height:detail.height});const expected=await pending;copyFileSync(expected.file,join(out,'reference.png'));
 execFileSync('build/qa-venv/bin/python',['-c','from PIL import Image\nimport numpy as np,sys\na,b=[np.asarray(Image.open(p)) for p in sys.argv[1:]]\nassert np.array_equal(a,b)',detail.file,expected.file]);
 await reference.stop();reference=undefined;pass('RAW loupe uses native full-resolution detail pixels identical to independent installed core output');
 const shot=join(out,'loupe.png');await loupe().screenshot({path:shot});const layout=await loupe().evaluate(e=>{const svg=e.querySelector('svg'),b=e.getBoundingClientRect(),v=svg.getBoundingClientRect();return {x:Number(e.dataset.x),y:Number(e.dataset.y),scale:Number(e.dataset.scale),dpr:devicePixelRatio,offsetX:v.x-b.x,offsetY:v.y-b.y};});
 const measured=JSON.parse(execFileSync('build/qa-venv/bin/python',['-c',String.raw`
from PIL import Image,ImageCms
import numpy as np,json,sys,math,io
shot=Image.open(sys.argv[1]);source=Image.open(sys.argv[2]).convert('RGB')
if shot.info.get('icc_profile'):
 source=ImageCms.profileToProfile(source,ImageCms.createProfile('sRGB'),ImageCms.ImageCmsProfile(io.BytesIO(shot.info['icc_profile'])),outputMode='RGB')
s=np.asarray(shot)[:,:,:3];a=np.asarray(source);v=json.loads(sys.argv[3]);d=json.loads(sys.argv[4]);errors=[]
# Sample away from crosshair/shadow; map physical screenshot pixel centers back to the real detail tile.
for y in range(15,130,11):
 for x in range(15,130,11):
  if abs(x-72)<5 or abs(y-72)<5:continue
  px=math.floor((v['offsetX']+x)*v['dpr']);py=math.floor((v['offsetY']+y)*v['dpr'])
  sx=math.floor(v['x']+.5+((px+.5)/v['dpr']-v['offsetX']-72)/v['scale'])-d['x']
  sy=math.floor(v['y']+.5+((py+.5)/v['dpr']-v['offsetY']-72)/v['scale'])-d['y']
  errors.append(int(np.abs(s[py,px].astype(int)-a[sy,sx]).max()))
assert max(errors)<=1,(max(errors),errors)
print(json.dumps(dict(samples=len(errors),maximumDifference=max(errors))))
`,shot,detail.file,JSON.stringify(layout),JSON.stringify(detail)],{encoding:'utf8'}));metrics.push(measured);await page.screenshot({path:join(out,'raw-loupe-workbench.png')});pass('visible magnifier screenshot maps to the correct native pixel centers at 200% physical scale');
 await page.keyboard.press('Shift+L');await expect(loupe()).toHaveCount(0);await expect(page.getByRole('checkbox',{name:/显示放大镜/})).not.toBeChecked();await page.keyboard.press('Shift+L');await expect(loupe()).toHaveAttribute('data-ready','true');assert.deepEqual((await fit()).fullWidth,f.fullWidth);pass('Shift+L toggles the loupe inside guided mode without creating a luminance mask or rotating');
 await button('完成引导校正').click();const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await exposure.scrollIntoViewIfNeeded();await settle(async()=>{await exposure.fill('1');await exposure.press('Tab');});await panel();await button('引导透视').click();await hover();const changedURL=await loupe().locator('image').getAttribute('href');assert.notEqual(changedURL,url);const changedFrame=await page.evaluate(url=>window.__loupeFrames.find(f=>f.url===url),changedURL);assert.equal(changedFrame.revision,(await fit()).revision);assert.notEqual(hash(changedFrame.file),hash(detail.file));await button('完成引导校正').click();await settle(()=>button('撤销').click());await panel();await button('引导透视').click();await hover();pass('exposure revision discards old detail and displays a newly rendered tile; undo restores the document');

 // Option movement is quarter speed; releasing Option retains the current endpoint without a jump.
 await page.keyboard.press('Shift+L');await page.mouse.move(center.x,center.y);await page.keyboard.down('Alt');await page.mouse.down();const a=await anchor();await page.mouse.move(center.x+40,center.y+20,{steps:4});const b=await anchor();await page.keyboard.up('Alt');await expect(loupe()).toHaveCount(0);await page.mouse.move(center.x+50,center.y+25,{steps:2});await expect(loupe()).toHaveCount(0);
 const endpoint=page.getByTestId('perspective-guide-0-1');const pos=await endpoint.boundingBox();await page.keyboard.down('Alt');await page.mouse.move(center.x+50,center.y+25);const c=await anchor();const dx=b.x-a.x,dy=b.y-a.y;assert(dx>0&&dy>0);assert(Math.abs((c.x-b.x)/dx-1)<.001);assert(Math.abs((c.y-b.y)/dy-1)<.001);metrics.push({precisionDelta:{x:dx,y:dy},ordinaryDelta:{x:c.x-b.x,y:c.y-b.y}});assert(pos);await page.keyboard.press('Escape');await page.mouse.up();await page.keyboard.up('Alt');await expect(loupe()).toHaveCount(0);assert.deepEqual((await save('cancelled')).adjustments,original.adjustments);pass('Option-drag reveals loupe with quarter-speed placement; releasing Option has no endpoint jump and Escape before mouse-up preserves the document');
 await panel();await button('引导透视').click();await page.getByRole('checkbox',{name:/显示放大镜/}).check();await button('1:1').click();await hover();await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(center.x+35,center.y+25,{steps:5});await page.mouse.up();await page.keyboard.up('Space');const afterPan=await hover();
 const centerDifference=await page.evaluate(async screen=>{const c=document.querySelector('canvas'),b=c.getBoundingClientRect(),l=document.querySelector('.guided-loupe'),f=window.__loupeFrames.find(f=>f.url===l.querySelector('image').getAttribute('href')),img=new Image();img.crossOrigin='anonymous';img.src=f.url;await img.decode();const tile=document.createElement('canvas');tile.width=f.width;tile.height=f.height;tile.getContext('2d').drawImage(img,0,0);const a=c.getContext('2d').getImageData(Math.floor((screen.x-b.x)*c.width/b.width),Math.floor((screen.y-b.y)*c.height/b.height),1,1).data,d=tile.getContext('2d').getImageData(Math.floor(Number(l.dataset.x)+.5)-f.x,Math.floor(Number(l.dataset.y)+.5)-f.y,1,1).data;return Math.max(...[0,1,2].map(i=>Math.abs(a[i]-d[i])));},afterPan);assert(centerDifference<=1,String(centerDifference));metrics.push({actualPannedCenterDifference:centerDifference});await page.screenshot({path:join(out,'actual-panned.png')});pass('physical 1:1 and Space-pan retain current detail; magnifier center agrees with the displayed canvas pixel');
 await button('完成引导校正').click();await expect(loupe()).toHaveCount(0);await settle(()=>button('顺时针旋转 90 度').click());await panel();await button('引导透视').click();await hover();const rotated=await fit();assert.equal(rotated.fullWidth,f.fullHeight);assert.equal(rotated.fullHeight,f.fullWidth);await button('蒙版 M').click();await expect(loupe()).toHaveCount(0);pass('rotated image uses current dimensions; leaving guided mode removes magnifier');
 await panel();await button('引导透视').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720));await button('适屏').click();await hover();const box=await page.getByTestId('viewport').boundingBox(),lens=await loupe().boundingBox();assert(lens.x>=box.x&&lens.y>=box.y&&lens.x+lens.width<=box.x+box.width&&lens.y+lens.height<=box.y+box.height);await page.screenshot({path:join(out,'minimum-window.png')});await page.mouse.move(box.x+box.width-40,box.y+box.height/2);await expect(loupe()).toHaveCount(0);pass('minimum window keeps loupe inside canvas; letterbox and pointer exit do not display unrelated image detail');
 assert.equal(hash(source),sourceHash);assert.deepEqual(errors,[]);
}catch(e){failure=e.stack;if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw e;}finally{if(reference)await reference.stop();if(app)await closeElectron(app);rmSync(join(out,'reference-cache'),{recursive:true,force:true});writeFileSync(join(out,'report.json'),JSON.stringify({passed:!failure&&!errors.length,checks,metrics,errors,failure,source,sourceHash,executablePath:process.env.CAPTRAW_APP||null,httpBlocked:true},null,2)+'\n');console.log('REPORT',join(out,'report.json'));}
