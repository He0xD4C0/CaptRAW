// Run after the coordinated native + desktop build. Never shows or focuses a window.
import assert from 'node:assert/strict';import {expect} from '@playwright/test';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {electron,closeElectron} from '../../support/electron-background.mjs';import {EngineClient} from '../../support/engine-client.mjs';
import {XMP,CRS,lookup} from '@captraw/desktop-core/documents';import {Documents} from '@captraw/desktop-core/documents';
const work=mkdtempSync(join(tmpdir(),'captraw-glow-gui-')),source=join(work,'发光 fixture.tif'),sidecar=join(work,'发光 fixture.xmp'),python=resolve('build/qa-venv/bin/python');
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),checks=[];let app,page,core,success=false;
const pass=s=>{checks.push(s);console.log('PASS',s);},hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const button=name=>page.getByRole('button',{name,exact:true}),input=name=>page.getByRole('spinbutton',{name,exact:true});
async function launch(){app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(work,'userdata')}});page=await app.firstWindow();page.setDefaultTimeout(30000);await page.evaluate(()=>{window.__glowFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__glowFrames.push(e.frame);});});}
async function ready(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});}
async function settle(action){const n=await page.evaluate(()=>window.__glowFrames.length);await action();await page.waitForFunction(n=>window.__glowFrames.length>n,n);await ready();await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__glowFrames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function open(){await app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});},source);await settle(()=>button('打开').click());}
const pixels=async()=>createHash('sha256').update(await page.locator('canvas').first().evaluate(c=>c.toDataURL())).digest('hex');
async function number(label,value){const i=input(label);await i.scrollIntoViewIfNeeded();await expect(i).toBeInViewport();await expect(i).toBeEnabled();const before=await pixels();await settle(async()=>{await i.fill(String(value));await i.press('Tab');});await expect.poll(pixels).not.toBe(before);}
async function save(expected){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await button('保存').click();await expect.poll(async()=>{if(!existsSync(sidecar))return null;const a=(await documents.read(sidecar)).adjustments;return [a.glow,a.masks[0]?.details?.glow];}).toEqual(expected);await ready();return documents.read(sidecar);}
try{
 execFileSync(python,['-c',`import numpy as np,tifffile,sys
y,x=np.mgrid[0:768,0:1024];a=np.full((768,1024,3),4500.)
for cx,cy in [(220,350),(500,380),(790,300)]:a+=np.exp(-((x-cx)**2+(y-cy)**2)/250)[:,:,None]*np.array([57000,53000,47000])
tifffile.imwrite(sys.argv[1],np.clip(a,0,65535).astype(np.uint16),photometric='rgb')`,source]);const original=hash(source);
 core=new EngineClient({cache:join(work,'fixture'),env:{OMP_NUM_THREADS:'2'}});const image=await core.call('open',{path:source,sessionId:'fixture',effectsDefaults:'legacy'});
 const mask={id:'glow-test',name:'渐变发光',type:'linear',enabled:true,initialized:true,inverted:false,feather:50,points:[],start:{x:.1,y:.5},end:{x:.9,y:.5},brightness:0,contrast:0,saturation:0};
 const a={...image.adjustments,glow:0,glowStyle:'diffusion',glowRange:50,glowSpread:50,glowWarmth:0,masks:[mask]},profile=(await core.call('compose',{path:source,width:image.width,height:image.height,adjustments:a,artProfile:image.artProfile})).artProfile;
 assert.match((await core.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...a,glow:40},artProfile:profile})).artProfile,/\[CaptRAW Glow\]/,'Need the coordinated Glow native build');
 writeFileSync(sidecar,await documents.serialize({source:{path:source,size:readFileSync(source).length,sha256:original},adjustments:a,artProfile:profile}));await core.stop();core=null;
 await launch();await open();const neutral=await pixels();await number('发光',40);
 const style=page.getByRole('combobox',{name:'发光样式',exact:true});await style.scrollIntoViewIfNeeded();for(const value of ['bloom','halation']){const p=await pixels();await settle(()=>style.selectOption(value));await expect.poll(pixels).not.toBe(p);}
 for(const [label,value] of [['发光范围',25],['发光扩散',75],['发光暖度',30]])await number(label,value);
 const active=await pixels();await settle(()=>button('撤销').click());await expect.poll(pixels).not.toBe(active);await settle(()=>button('重做').click());await expect.poll(pixels).toBe(active);pass('全局五个实际控件/三样式改变画布；单步撤销与重做正确');
 await number('发光',0);await expect.poll(pixels).toBe(neutral);await button('蒙版 M').click();await page.getByRole('button',{name:'渐变发光',exact:true}).click();await number('局部发光',30);const local=await pixels();expect(local).not.toBe(neutral);const saved=await save([0,30]);assert.equal(saved.adjustments.glowStyle,'halation');pass('全局0时局部数量独立生效，共享样式保留；正式文档保存局部值');
 await expect(input('局部发光')).toHaveAttribute('min','-100');await expect(input('局部发光')).toHaveAttribute('max','100');
 await input('局部发光').scrollIntoViewIfNeeded();await settle(async()=>{await input('局部发光').fill('-30');await input('局部发光').press('Tab');});await expect(input('局部发光')).toHaveValue('-30');await save([0,-30]);
 // Only document/history semantics are asserted until ACR global0/40+local-30 TIFFs exist.
 await settle(()=>button('撤销').click());await expect(input('局部发光')).toHaveValue('30');await expect.poll(pixels).toBe(local);await save([0,30]);pass('局部负值可输入/保存/撤销，未将图像组合认定Adobe等效');
 const properties=(await xmp.read(sidecar)).properties;assert.equal(lookup(properties,CRS,'Glow').value,'0');assert.equal(lookup(properties,CRS,'GlowStyle').value,'2');assert.equal(lookup(properties,CRS,'GlowWarmth').value,'30');
 await closeElectron(app);app=null;await launch();await open();await expect.poll(pixels).toBe(local);await button('蒙版 M').click();await page.getByRole('button',{name:'渐变发光',exact:true}).click();await input('局部发光').scrollIntoViewIfNeeded();await expect(input('局部发光')).toHaveValue('30');pass('XMP标准全局字段与局部RDF经完整App重启恢复相同画布');
 const output=join(work,'glow.tif'),reference=join(work,'reference.tif');await app.evaluate(({dialog},p)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:p});},output);await button('导出').click();await page.getByRole('button',{name:/TIFF · 16 位/}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 core=new EngineClient({cache:join(work,'reference'),env:{OMP_NUM_THREADS:'2'}});await core.call('export',{path:source,artProfile:saved.artProfile,output:reference,format:'tiff',colorSpace:'srgb'});await core.stop();core=null;
 execFileSync(python,['-c',`import tifffile,numpy as np,sys
with tifffile.TiffFile(sys.argv[1]) as f:assert f.pages[0].dtype.name=='uint16' and 34675 in f.pages[0].tags
assert np.array_equal(tifffile.imread(sys.argv[1]),tifffile.imread(sys.argv[2]))`,output,reference]);assert.equal(hash(source),original);pass('实际生产菜单TIFF16/ICC输出与保存配方独立核心像素一致，原图不变');
 await button('关闭导出结果').click();
 // Verify negative candidate state, reopen determinism and production pixels;
 // do not assert what Adobe's negative combination should look like.
 for(const global of [0,40]){
  await page.keyboard.press('e');const g=input('发光');await g.scrollIntoViewIfNeeded();
  if(Number(await g.inputValue())!==global)await settle(async()=>{await g.fill(String(global));await g.press('Tab');});
  await button('蒙版 M').click();await page.getByRole('button',{name:'渐变发光',exact:true}).click();const n=input('局部发光');await n.scrollIntoViewIfNeeded();
  if(Number(await n.inputValue())!==-30)await settle(async()=>{await n.fill('-30');await n.press('Tab');});await expect(n).toHaveValue('-30');
  const negativePixels=await pixels(),negativeRecipe=await save([global,-30]);
  await closeElectron(app);app=null;await launch();await open();await expect.poll(pixels).toBe(negativePixels);await button('蒙版 M').click();await page.getByRole('button',{name:'渐变发光',exact:true}).click();await input('局部发光').scrollIntoViewIfNeeded();await expect(input('局部发光')).toHaveValue('-30');
  const out=join(work,`negative-g${global}.tif`),ref=join(work,`negative-g${global}-reference.tif`);await app.evaluate(({dialog},p)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:p});},out);await button('导出').click();await page.getByRole('button',{name:/TIFF · 16 位/}).click();await expect.poll(()=>existsSync(out),{timeout:120000}).toBe(true);await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
  core=new EngineClient({cache:join(work,`negative-reference-${global}`),env:{OMP_NUM_THREADS:'2'}});await core.call('export',{path:source,artProfile:negativeRecipe.artProfile,output:ref,format:'tiff',colorSpace:'srgb'});await core.stop();core=null;
  execFileSync(python,['-c',`import tifffile,numpy as np,sys
with tifffile.TiffFile(sys.argv[1]) as f:assert f.pages[0].dtype.name=='uint16' and 34675 in f.pages[0].tags
assert np.array_equal(tifffile.imread(sys.argv[1]),tifffile.imread(sys.argv[2]))`,out,ref]);await button('关闭导出结果').click();
  pass(`候选全局${global}/局部-30经UI、文件、重启及TIFF16独立核心像素一致；Adobe组合未证实`);
 }
 success=true;console.log(JSON.stringify({hidden:true,checks,acrPixelParity:false}));
}catch(error){if(page)await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});throw error;}
finally{if(core)await core.stop();if(app)await closeElectron(app);if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
