// --inputs-only runs the added GUI input groups; the default retains every legacy-radius assertion.
// Use --xmp-only before the coordinated desktop build; GUI stays hidden and unfocused.
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {XMP,CRS,CT,property,text,encode,lookup,readExtension,encodeAdjustments,decodeAdjustments} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
import {ENGINE_VERSION} from '@captraw/contracts';
import {capturePreset} from '@captraw/contracts/presets';
import {synchronizedAdjustments} from '@captraw/contracts/synchronize';
const work=mkdtempSync(join(tmpdir(),'captraw-global-boundaries-')),python=resolve('build/qa-venv/bin/python');
const xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp),checks=[];
const oldVersion='CaptRAW-27_ART-1.26.10_LibRaw-3b20539',source=join(work,'旧照片 radius.tif'),sidecar=join(work,'旧照片 radius.xmp'),fresh=join(work,'新照片 fresh.tif');
const boundaries=[
 ['exposure','曝光','Exposure2012',-5,5,.05],['temperature','色温','Temperature',1500,50000,10],['tint','色调','Tint',-150,150,1],
 ['contrast','对比度','Contrast2012',-100,100,1],['highlights','高光','Highlights2012',-100,100,1],['shadows','阴影','Shadows2012',-100,100,1],['whites','白色','Whites2012',-100,100,1],['blacks','黑色','Blacks2012',-100,100,1],
 ['saturation','饱和度','Saturation',-100,100,1],['vibrance','自然饱和度','Vibrance',-100,100,1],['texture','纹理','Texture',-100,100,1],['clarity','清晰度','Clarity2012',-100,100,1],['dehaze','去朦胧','Dehaze',-100,100,1],
 ['sharpening','锐化','Sharpness',0,150,1],['sharpenRadius','锐化半径','SharpenRadius',.5,3,.1],['sharpenDetail','锐化细节','SharpenDetail',0,100,1],['sharpenEdgeMask','锐化边缘蒙版','SharpenEdgeMasking',0,100,1],
 ['luminanceNoise','明亮度降噪','LuminanceSmoothing',0,100,1],['luminanceNoiseDetail','明亮度降噪细节','LuminanceNoiseReductionDetail',0,100,1],['luminanceNoiseContrast','明亮度降噪对比度','LuminanceNoiseReductionContrast',0,100,1],
 ['colorNoise','颜色降噪','ColorNoiseReduction',0,100,1],['colorNoiseDetail','颜色降噪细节','ColorNoiseReductionDetail',0,100,1],['colorNoiseSmoothness','颜色降噪平滑度','ColorNoiseReductionSmoothness',0,100,1],
];
const pass=s=>{checks.push(s);console.log('PASS',s);},hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const inputsOnly=process.argv.includes('--inputs-only');
assert(!inputsOnly||!process.argv.some(arg=>arg==='--xmp-only'||arg==='--native-only'),'--inputs-only must run its GUI groups');
let success=false,core,app,page;
async function launch(){app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(work,'userdata')}});page=await app.firstWindow();page.setDefaultTimeout(30000);await page.evaluate(()=>{window.__boundaryFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__boundaryFrames.push(e.frame);});});await app.evaluate(({ipcMain})=>{globalThis.__boundaryUpdates=[];const update=ipcMain._invokeHandlers.get('image:update');ipcMain.removeHandler('image:update');ipcMain.handle('image:update',async(...args)=>{const record={request:structuredClone(args[1])};globalThis.__boundaryUpdates.push(record);const result=await update(...args);record.profile=result.artProfile;return result;});});}
const button=name=>page.getByRole('button',{name,exact:true}),input=name=>page.getByRole('spinbutton',{name,exact:true});
async function ready(){await expect(button('打开')).toBeEnabled();await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.locator('.rendering').waitFor({state:'hidden'});}
async function settle(action){const n=await page.evaluate(()=>window.__boundaryFrames.length);await action();await page.waitForFunction(n=>window.__boundaryFrames.length>n,n);await ready();const first=await page.evaluate(()=>window.__boundaryFrames.at(-1)?.revision);await page.waitForTimeout(180);await ready();await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__boundaryFrames.filter(f=>f.kind!=='detail').at(-1)?.url);const last=await page.evaluate(()=>window.__boundaryFrames.at(-1)?.revision);if(first!==last)console.log('Drained pending 90ms preview debounce:',first,'→',last);}
async function open(path){await app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});},path);await settle(()=>button('打开').click());const section=page.locator('details').filter({has:page.locator('summary',{hasText:/^细节$/})});if(!await section.getAttribute('open').then(v=>v!==null))await section.locator('summary').click();}
async function pixels(){return createHash('sha256').update(await page.locator('canvas').first().evaluate(c=>c.toDataURL())).digest('hex');}
async function save(path,radius,verify=()=>true){await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await button('保存').click();await expect.poll(async()=>{if(!existsSync(path))return null;const doc=await documents.read(path);return {radius:doc.adjustments.sharpenRadius,verified:verify(doc)};}).toEqual({radius,verified:true});await ready();return documents.read(path);}
async function section(name){const details=page.locator('details.adjust-section').filter({has:page.locator('summary',{hasText:new RegExp(`^${name}$`)})});if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();return details;}
async function number(label,draft,expected){const control=input(label);await control.scrollIntoViewIfNeeded();await expect(control).toBeInViewport();await settle(async()=>{await control.fill(String(draft));await control.press('Tab');});await expect(control).toHaveValue(String(expected));}
async function undoRedo(label,before,after,previousPixels){const currentPixels=await pixels();await settle(()=>button('撤销').click());await expect(input(label)).toHaveValue(String(before));const restored=await pixels();if(restored!==previousPixels)writeFileSync(join(work,'undo-failure.json'),JSON.stringify({label,expected:previousPixels,actual:restored,updates:await app.evaluate(()=>globalThis.__boundaryUpdates),frames:await page.evaluate(()=>window.__boundaryFrames)},null,2));expect(restored).toBe(previousPixels);await settle(()=>button('重做').click());await expect(input(label)).toHaveValue(String(after));expect(await pixels()).toBe(currentPixels);}
try{
 const owned=[property(CRS,'SharpenRadius',text(.1)),property(CT,'EngineVersion',encode(oldVersion))];
 if(!inputsOnly){
 for(const [key,,name,min,max,step] of boundaries){
  for(const value of [min,max]){const fields=encodeAdjustments({[key]:value});assert.equal(Number(lookup(fields,CRS,name).value),value);assert.equal(decodeAdjustments(fields).adjustments[key],value);}
  for(const value of [min-1,max+1,NaN,Infinity])assert.throws(()=>encodeAdjustments({[key]:value}),undefined,key);
  if(step>=1)assert.throws(()=>encodeAdjustments({[key]:min+.5}),undefined,key+' integer');
 }
 pass('23项全局标量边界/整数契约：XMP端点可读，非法数值拒绝');
 for(const radius of [.1,.3,.49,.5,3]){
  const fields=[...encodeAdjustments({sharpenRadius:radius}),property(CT,'EngineVersion',encode(ENGINE_VERSION))];
  const packet=(await xmp.call('write','',fields)).packet,properties=(await xmp.call('read',packet)).properties;
  assert.equal(decodeAdjustments(properties).adjustments.sharpenRadius,radius);
  if(radius<.5){assert.equal(lookup(properties,CRS,'SharpenRadius'),undefined);assert.equal(readExtension(properties,'ARTAdjustments').sharpenRadius,radius);}else assert.equal(readExtension(properties,'ARTAdjustments').sharpenRadius,undefined);
 }
 assert.throws(()=>decodeAdjustments([property(CRS,'SharpenRadius',text(.1))]));
 assert.equal(decodeAdjustments(owned).adjustments.sharpenRadius,.1);
 assert.throws(()=>decodeAdjustments([...encodeAdjustments({sharpenRadius:.1}).filter(p=>p.node!==null),property(CRS,'SharpenRadius',text(1)),property(CT,'EngineVersion',encode(ENGINE_VERSION))]));
 assert.throws(()=>decodeAdjustments([property(CT,'ARTAdjustments',encode({sharpenRadius:.09}))]));
 pass('真实SDK保留旧0.1–0.49 RDF值；标准0.5–3无重复；旧私有/CRS可迁移，外部越界及冲突拒绝');
 const migrated=(await xmp.call('write',(await xmp.call('write','',owned)).packet,[...encodeAdjustments({sharpenRadius:.1}),property(CT,'EngineVersion',encode(ENGINE_VERSION))])).packet;
 assert.equal(lookup((await xmp.call('read',migrated)).properties,CRS,'SharpenRadius'),undefined);
 const standard=(await xmp.call('write',migrated,encodeAdjustments({sharpenRadius:.5}))).packet;
 assert.equal(readExtension((await xmp.call('read',standard)).properties,'ARTAdjustments').sharpenRadius,undefined);
 pass('旧越界CRS保存移除；新标准值替换时清除旧私有半径');
 }
 if(!process.argv.includes('--xmp-only')){
  execFileSync(python,['-c',`import numpy as np,tifffile,sys
y,x=np.mgrid[0:384,0:512];n=np.random.default_rng(17).normal(0,3000,(384,512));a=np.stack([18000+x*50+n,22000+y*45+n,25000+x*20+y*15+n],-1)
tifffile.imwrite(sys.argv[1],np.clip(a,0,65535).astype(np.uint16),photometric='rgb')`,source]);copyFileSync(source,fresh);const original=hash(source);
  let reference;
  if(!inputsOnly){
  core=new EngineClient({cache:join(work,'native'),env:{OMP_NUM_THREADS:'2'}});const image=await core.call('open',{path:source,sessionId:'boundaries',effectsDefaults:'legacy'});
  for(const [key,,name,min,max] of boundaries)for(const value of [min,max])await core.call('validate',{artProfile:image.artProfile,adjustments:{...image.adjustments,[key]:value}});
  // The old owned recipe uses absolute WB; a fresh rendered image now uses relative WB.
  const a={...image.adjustments,temperature:5200,tint:8,wbMode:'custom',wbMultipliers:null,sharpening:100,sharpenRadius:.1};delete a.incrementalTemperature;delete a.incrementalTint;delete a.relativeWBModel;
  const profile=(await core.call('compose',{path:source,width:image.width,height:image.height,artProfile:image.artProfile,adjustments:a})).artProfile;
  const captured=capturePreset({name:'旧半径',group:'边界',groups:['detail'],adjustments:a});assert.equal(captured.adjustments.sharpenRadius,.1);assert.equal(decodeAdjustments(encodeAdjustments(captured.adjustments)).adjustments.sharpenRadius,.1);
  const synced=synchronizedAdjustments({image,profile,adjustments:a},{image,profile:image.artProfile,adjustments:image.adjustments},['detail']);assert.equal(synced.sharpenRadius,.1);
  const recipe={source:{path:source,size:readFileSync(source).length,sha256:original},artProfile:profile,adjustments:a};
  const valid=await documents.serialize(recipe);writeFileSync(sidecar,(await xmp.call('write',valid,[property(CT,'ARTAdjustments',encode(Object.fromEntries(Object.entries(readExtension((await xmp.call('read',valid)).properties,'ARTAdjustments')).filter(([k])=>k!=='sharpenRadius')))),...owned])).packet);
  reference=join(work,'legacy-reference.tif');await core.call('export',{path:source,artProfile:profile,output:reference,format:'tiff',colorSpace:'srgb'});await core.stop();core=null;
  pass('同一native接受全局端点；旧0.1经过预设捕获、同步和XMP参数链不变');
  const fringeProfile=(await documents.read(sidecar)).artProfile,fringeOutputs=[];
  for(const threads of [1,2,8]){
   core=new EngineClient({cache:join(work,'fringe-'+threads),env:{OMP_NUM_THREADS:String(threads)}});
   try{
    const applied=await core.call('compose',{path:source,width:image.width,height:image.height,artProfile:fringeProfile,adjustments:{...a,defringe:{purpleAmount:60,purpleHueLo:20,purpleHueHi:80,greenAmount:40,greenHueLo:35,greenHueHi:65}}});
    for(let repeat=0;repeat<4;++repeat){const output=join(work,`fringe-${threads}-${repeat}.tif`);await core.call('export',{path:source,artProfile:applied.artProfile,output,format:'tiff',colorSpace:'srgb'});fringeOutputs.push(output);}
   }finally{await core.stop();core=null;}
  }
  execFileSync(python,['-c',`import sys,json,tifffile,numpy as np
base=tifffile.imread(sys.argv[1]);paths=json.loads(sys.argv[2]);reference=tifffile.imread(paths[0])
assert reference.dtype==np.uint16 and reference.shape==base.shape and not np.array_equal(reference,base)
for path in paths:
 with tifffile.TiffFile(path) as f:assert 34675 in f.pages[0].tags and np.array_equal(reference,f.asarray()),path`,reference,JSON.stringify(fringeOutputs)]);
  pass('非中性去边的1/2/8线程各4次TIFF16及ICC精确一致；原单线程算子不因调度改变');
  }
  if(!process.argv.includes('--native-only')){
   if(!inputsOnly){
   await launch();await open(source);await input('锐化半径').scrollIntoViewIfNeeded();await expect(input('锐化半径')).toBeInViewport();await expect(input('锐化半径')).toHaveValue('0.1');await expect(input('锐化半径')).toHaveAttribute('min','0.5');const oldPixels=await pixels();
   await expect(input('色温')).toHaveAttribute('min','1500');await expect(input('色温')).toHaveAttribute('max','50000');await expect(input('色温')).toHaveAttribute('step','10');await expect(input('色温')).toHaveValue('5200');await expect(input('色调')).toHaveAttribute('min','-150');await expect(input('色调')).toHaveAttribute('max','150');
   await input('锐化半径').focus();await input('锐化半径').press('Tab');expect(await pixels()).toBe(oldPixels);await expect(button('撤销')).toBeDisabled();
   await input('锐化半径').fill('0.8');await settle(()=>input('锐化半径').press('Escape'));await expect(input('锐化半径')).toHaveValue('0.1');await expect.poll(pixels).toBe(oldPixels);await expect(button('撤销')).toBeDisabled();
   await save(sidecar,.1);await closeElectron(app);app=null;await launch();await open(source);await expect.poll(pixels).toBe(oldPixels);await expect(input('锐化半径')).toHaveValue('0.1');pass('旧越界CRS实际打开/聚焦/取消/保存/重启均保持0.1及原像素');
   const output=join(work,'gui-legacy.tif');await app.evaluate(({dialog},p)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:p});},output);await button('导出').click();await page.getByRole('button',{name:/TIFF · 16 位/}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:60000});
   execFileSync(python,['-c',`import tifffile,numpy as np,sys
with tifffile.TiffFile(sys.argv[1]) as f:assert f.pages[0].dtype.name=='uint16' and 34675 in f.pages[0].tags
assert np.array_equal(tifffile.imread(sys.argv[1]),tifffile.imread(sys.argv[2]))`,output,reference]);pass('实际TIFF16/ICC导出与原0.1配方逐像素一致');
   await input('锐化半径').scrollIntoViewIfNeeded();await settle(async()=>{await input('锐化半径').fill('0.8');await input('锐化半径').press('Tab');});await expect.poll(pixels).not.toBe(oldPixels);await settle(()=>button('撤销').click());await expect.poll(pixels).toBe(oldPixels);await expect(input('锐化半径')).toHaveValue('0.1');pass('新合法半径实际响应，撤销精确恢复旧外观');
   await open(fresh);
   for(const [key,label,,min,max,step] of boundaries){const relative=key==='temperature'||key==='tint',control=input(label);await control.scrollIntoViewIfNeeded();await expect(control).toBeInViewport();await expect(control).toHaveAttribute('min',String(relative?-100:min));await expect(control).toHaveAttribute('max',String(relative?100:max));await expect(control).toHaveAttribute('step',String(relative?1:step));}
   await input('锐化半径').scrollIntoViewIfNeeded();await settle(async()=>{await input('锐化半径').fill('0.1');await input('锐化半径').press('Tab');});await expect(input('锐化半径')).toHaveValue('0.5');
   for(const label of ['对比度','锐化细节','明亮度降噪','明亮度降噪细节']){await input(label).scrollIntoViewIfNeeded();await settle(async()=>{await input(label).fill('6.6');await input(label).press('Tab');});await expect(input(label)).toHaveValue('7');}
   const saved=await save(join(work,'新照片 fresh.xmp'),.5);assert.equal(saved.adjustments.contrast,7);assert.equal(saved.adjustments.sharpenDetail,7);assert.equal(saved.adjustments.luminanceNoise,7);assert.equal(saved.adjustments.luminanceNoiseDetail,7);pass('23控件可见且边界一致；新半径钳制0.5，整数输入规范化并可保存');
   }else{await launch();await open(fresh);}
   const expectedRadius=inputsOnly?1:.5;
   const expectedFields={};await section('颜色分级');
   for(const [region,names] of [['阴影',['SplitToningShadowHue','SplitToningShadowSaturation','ColorGradeShadowLum']],['中间调',['ColorGradeMidtoneHue','ColorGradeMidtoneSat','ColorGradeMidtoneLum']],['高光',['SplitToningHighlightHue','SplitToningHighlightSaturation','ColorGradeHighlightLum']],['全局',['ColorGradeGlobalHue','ColorGradeGlobalSat','ColorGradeGlobalLum']]]){
    await button(`${region}分级视图`).scrollIntoViewIfNeeded();await button(`${region}分级视图`).click();
    for(const [i,suffix,draft,rounded] of [[0,'色相',37.6,38],[1,'饱和度',22.6,23],[2,'明度',-8.6,-9]]){const label=`${region}分级${suffix}`,before=Number(await input(label).inputValue()),beforePixels=await pixels();await number(label,draft,rounded);expectedFields[names[i]]=rounded;if(i===2)await undoRedo(label,before,rounded,beforePixels);}
   }
   await button('阴影分级视图').scrollIntoViewIfNeeded();await button('阴影分级视图').click();await number('分级混合',62.6,63);await number('分级平衡',-14.6,-15);expectedFields.ColorGradeBlending=63;expectedFields.SplitToningBalance=-15;
   pass('真实四轮14项分级小数文本归一为整数；各轮明度撤销/重做一步恢复控件和精确预览');
   await section('颜色校准');
   for(const [label,name,draft,rounded] of [['阴影色调','ShadowTint',-4.6,-5],['红色色相','RedHue',12.6,13],['红色饱和度','RedSaturation',-7.6,-8],['绿色色相','GreenHue',16.6,17],['绿色饱和度','GreenSaturation',-11.6,-12],['蓝色色相','BlueHue',21.6,22],['蓝色饱和度','BlueSaturation',-18.6,-19]]){const before=Number(await input(label).inputValue()),beforePixels=await pixels();await number(label,draft,rounded);expectedFields[name]=rounded;if(name==='BlueSaturation')await undoRedo(label,before,rounded,beforePixels);}
   const mixer=await section('混色器');
   for(const [tab,label,name,draft,rounded] of [['色相','红色色相','HueAdjustmentRed',18.6,19],['饱和度','红色饱和度','SaturationAdjustmentRed',-12.6,-13],['明亮度','红色明亮度','LuminanceAdjustmentRed',7.6,8]]){
    await mixer.getByRole('button',{name:tab,exact:true}).click();const control=mixer.getByRole('spinbutton',{name:label,exact:true});await control.scrollIntoViewIfNeeded();await expect(control).toBeInViewport();const before=Number(await control.inputValue()),beforePixels=await pixels();
    await settle(async()=>{await control.fill(String(draft));await control.press('Tab');});await expect(control).toHaveValue(String(rounded));const currentPixels=await pixels();await settle(()=>button('撤销').click());await expect(control).toHaveValue(String(before));expect(await pixels()).toBe(beforePixels);await settle(()=>button('重做').click());await expect(control).toHaveValue(String(rounded));expect(await pixels()).toBe(currentPixels);expectedFields[name]=rounded;
   }
   pass('真实7项校准及HSL三通道小数输入规范化；校准/HSL一步撤销重做保持精确预览');
   await section('光学');const fringe=page.locator('details.lens-defringe');if(await fringe.getAttribute('open')===null)await fringe.locator('summary').click();
   for(const [label,name] of [['紫色去边','DefringePurpleAmount'],['绿色去边','DefringeGreenAmount']]){
    const control=input(label),slider=page.getByRole('slider',{name:`${label}滑杆`,exact:true});await control.scrollIntoViewIfNeeded();await expect(control).toBeInViewport();await expect(control).toHaveAttribute('min','0');await expect(control).toHaveAttribute('max','100');await slider.scrollIntoViewIfNeeded();await expect(slider).toBeInViewport();await expect(slider).toHaveAttribute('min','0');await expect(slider).toHaveAttribute('max','100');
    await number(label,24,24);const positivePixels=await pixels();await number(label,-1,0);await undoRedo(label,24,0,positivePixels);expectedFields[name]=0;
   }
   for(const label of ['手动扭曲','镜头暗角']){await input(label).scrollIntoViewIfNeeded();await expect(input(label)).toBeInViewport();await expect(input(label)).toHaveAttribute('min','-100');await expect(input(label)).toHaveAttribute('max','100');}
   pass('真实两色去边数字框/滑杆仅0–100，负输入归零且一步撤销恢复正强度；手动扭曲/暗角仍保留负范围');
   const exposureBefore=Number(await input('曝光').inputValue()),exposurePixels=await pixels();await number('曝光',1.25,1.25);await undoRedo('曝光',exposureBefore,1.25,exposurePixels);expectedFields.Exposure2012=1.25;
   const freshSidecar=join(work,'新照片 fresh.xmp');
   const matches=doc=>{const fields=encodeAdjustments(doc.adjustments);return Object.entries(expectedFields).every(([name,value])=>Number(lookup(fields,CRS,name)?.value)===value);};
   const normalized=await save(freshSidecar,expectedRadius,matches),properties=(await xmp.read(freshSidecar)).properties;
   for(const [name,value] of Object.entries(expectedFields))assert.equal(Number(lookup(properties,CRS,name)?.value),value,name);
   const normalizedPixels=await pixels(),normalizedState=JSON.stringify(normalized.adjustments);await closeElectron(app);app=null;await launch();await open(fresh);await expect.poll(pixels).toBe(normalizedPixels);
   await expect(input('曝光')).toHaveValue('1.25');await expect(button('撤销')).toBeDisabled();
   const reopened=await save(freshSidecar,expectedRadius,matches);assert.equal(JSON.stringify(reopened.adjustments),normalizedState);assert.equal(hash(fresh),original);
   pass('Exposure小数step保留1.25且可撤销；全部新增数值写入真实SDK XMP，重启恢复相同配方/像素且无新历史');
   await closeElectron(app);app=null;
  }
  assert.equal(hash(source),original);
 }
 success=true;console.log(JSON.stringify({scope:inputsOnly?'inputs-only; legacy radius groups not run':'global-boundaries',checks,gui:!process.argv.includes('--native-only')&&!process.argv.includes('--xmp-only')}));
}catch(error){if(page)await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});throw error;}
finally{if(core)await core.stop();if(app)await closeElectron(app);if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
