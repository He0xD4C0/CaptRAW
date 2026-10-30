import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {adobePartialFields,adobePartialFixture,partialTargetSettings,readDocument} from '../../support/xmp-test.mjs';
import {XMP,CRS,CT,lookup,property,text,encode} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
import {ENGINE_VERSION} from '@captraw/contracts';
import {EngineClient} from '../../support/engine-client.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,existsSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';

const out=resolve(process.env.CAPTRAW_XMP_PARTIAL_GUI_OUT||'artifacts/xmp-partial-gui');mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-')),source=resolve('build/samples/synthetic.dng'),plain=join(work,'原始 编辑.dng'),sparseRaw=join(work,'稀疏 编辑.dng');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),sourceHash=hash(source),executablePath=process.env.CAPTRAW_APP;
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp),checks=[],errors=[],pass=message=>{checks.push(message);console.log('PASS',message);};
const preset=join(work,'partial.xmp'),classic=join(work,'classic.xmp'),split=join(work,'split.xmp');
copyFileSync(source,plain);copyFileSync(source,sparseRaw);writeFileSync(preset,adobePartialFixture);
const fixture=(name,fields)=>`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:crs="${CRS}" ${Object.entries(fields).map(([k,v])=>`crs:${k}="${v}"`).join(' ')}><crs:Name><rdf:Alt><rdf:li xml:lang="x-default">${name}</rdf:li></rdf:Alt></crs:Name></rdf:Description></rdf:RDF></x:xmpmeta>`;
writeFileSync(classic,fixture('旧式 分离色调',{SplitToningShadowHue:225,SplitToningShadowSaturation:17,SplitToningHighlightHue:45,SplitToningHighlightSaturation:25,SplitToningBalance:12}));
writeFileSync(split,fixture('冲突 分界',{ParametricShadowSplit:60}));
const originalHashes=[preset,classic,split].map(hash);
let app,page,success=false,tiffPixels,base,expected,sparseDocument;
async function launch(){
 app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(String(error)));
 await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true})));
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(event=>{if(event.event==='preview')window.__frames.push(event.frame);});});
}
async function rendered(){await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>{const frame=window.__frames.filter(f=>f.kind!=='detail').at(-1);return frame&&document.querySelector('canvas')?.dataset.frame===frame.url;});}
async function settle(action){const count=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(count=>window.__frames.length>count,count);await rendered();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(name){const path=join(work,name+'.xmp');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);await rendered();return {path,document:await readDocument(path)};}
async function importPreset(path,name){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await page.getByRole('button',{name:'导入…',exact:true}).click();await expect(page.getByRole('button',{name,exact:true})).toBeEnabled();}
async function pixels(){return createHash('sha256').update(await page.locator('canvas').evaluate(canvas=>canvas.toDataURL())).digest('hex');}
function checkValues(actual,wanted){for(const key of ['exposure','hsl','parametricCurve','colorGrading','calibration'])expect(actual[key]).toEqual(wanted[key]);}
try{
 const engine=new EngineClient({cache:join(work,'prepare-core')});let fullPacket;
 try{
  const image=await engine.call('open',{path:plain,sessionId:'prepare'});base={...image.adjustments,...structuredClone(partialTargetSettings),exposure:1.1};
  const profile=await engine.call('compose',{path:plain,width:image.width,height:image.height,adjustments:base,artProfile:image.artProfile});
  fullPacket=await documents.serialize({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:plain,size:statSync(plain).size,sha256:sourceHash},adjustments:base,artProfile:profile.artProfile});
 }finally{await engine.stop();}
 const full=join(work,'完整 基值.xmp');writeFileSync(full,fullPacket);
 const properties=(await xmp.call('read',fullPacket)).properties,grouped=properties.filter(p=>p.ns===CRS&&(/^(?:Hue|Saturation|Luminance)Adjustment/.test(p.name)||/^(?:Parametric|ColorGrade|SplitToning)/.test(p.name)||/^(?:Red|Green|Blue)(?:Hue|Saturation)$/.test(p.name)));
 sparseDocument=join(work,'稀疏 文档.xmp');writeFileSync(sparseDocument,(await xmp.call('write',fullPacket,[...grouped.map(p=>property(CRS,p.name,null)),...Object.entries(adobePartialFields).map(([name,value])=>property(CRS,name,text(value))),property(CT,'Source',encode({path:sparseRaw,size:statSync(sparseRaw).size,sha256:sourceHash}))])).packet);
 const sparseHash=hash(sparseDocument);
 expected=structuredClone(base);expected.hsl.hue[3]=27;expected.hsl.luminance[5]=-16;expected.parametricCurve.highlights=18;expected.parametricCurve.splits[0]=40;expected.colorGrading.midtones.saturation=37;expected.colorGrading.global.luminance=-9;expected.calibration.redHue=-14;

 await launch();await open(full);const initialPixels=await pixels();checkValues((await save('基值')).document.adjustments,base);
 await page.getByRole('button',{name:'预设',exact:true}).click();await importPreset(preset,'Adobe 局部参数');
 const exported=join(work,'导出 稀疏预设.xmp');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},exported);
 await page.getByRole('button',{name:'管理 Adobe 局部参数',exact:true}).click();await page.getByRole('button',{name:'导出预设…',exact:true}).click();await expect.poll(()=>existsSync(exported)).toBe(true);
 const exportedProperties=(await xmp.read(exported)).properties;
 for(const [key,value] of Object.entries(adobePartialFields))expect(Number(lookup(exportedProperties,CRS,key).value)).toBe(value);
 for(const key of ['HueAdjustmentRed','ParametricDarks','ParametricMidtoneSplit','ColorGradeBlending','SplitToningBalance','GreenHue'])expect(lookup(exportedProperties,CRS,key)).toBeUndefined();
 pass('visible preset import and export retain only the seven supplied standard controls');

 await settle(()=>page.getByRole('button',{name:'Adobe 局部参数',exact:true}).click());const applied=await save('应用 稀疏');checkValues(applied.document.adjustments,expected);const editedPixels=await pixels();expect(editedPixels).not.toBe(initialPixels);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());checkValues((await save('撤销 稀疏')).document.adjustments,base);expect(await pixels()).toBe(initialPixels);
 await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());checkValues((await save('重做 稀疏')).document.adjustments,expected);expect(await pixels()).toBe(editedPixels);
 pass('applying a sparse preset changes actual pixels and exactly seven controls with one-step undo and redo');

 await open(sparseDocument);const hydrated=await save('展开 稀疏文档');checkValues(hydrated.document.adjustments,expected);expect(await pixels()).toBe(editedPixels);expect(hash(sparseDocument)).toBe(sparseHash);
 await closeElectron(app);app=undefined;await launch();await open(hydrated.path);checkValues((await save('重启 还原')).document.adjustments,expected);expect(await pixels()).toBe(editedPixels);
 pass('opening sparse XMP reads the stored ART base and a fresh process restores complete settings and exact displayed pixels');

 await page.getByRole('button',{name:'预设',exact:true}).click();await importPreset(classic,'旧式 分离色调');
 const notice=page.locator('.preset-import-notice');await expect(notice.locator('p').filter({hasText:'旧式分离色调'})).toBeVisible();
 await settle(()=>page.getByRole('button',{name:'旧式 分离色调',exact:true}).click());const classicApplied=await save('旧式 应用');
 checkValues(classicApplied.document.adjustments,{...expected,colorGrading:{shadows:{hue:225,saturation:17,luminance:0},midtones:{hue:0,saturation:0,luminance:0},highlights:{hue:45,saturation:25,luminance:0},global:{hue:0,saturation:0,luminance:0},blending:100,balance:12}});
 expect(await pixels()).not.toBe(editedPixels);await page.screenshot({path:join(out,'classic-toning.png')});
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());checkValues((await save('撤销 旧式')).document.adjustments,expected);expect(await pixels()).toBe(editedPixels);
 pass('legacy Split Toning visibly explains and applies blend-100 and modern-control resets without changing unrelated controls');

 await importPreset(split,'冲突 分界');await page.getByRole('button',{name:'冲突 分界',exact:true}).click();await expect(page.getByRole('alert')).toContainText(/分界.*冲突/);await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('dialog',{name:'应用预设'})).toHaveCount(0);await page.screenshot({path:join(out,'split-conflict.png')});
 const unchanged=await save('冲突 未改变');checkValues(unchanged.document.adjustments,expected);expect(await pixels()).toBe(editedPixels);
 pass('a split-only preset imports successfully and an incompatible target displays an actionable error without changing edits or pixels');

 const output=join(work,'desktop.tiff');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 const reference=join(work,'headless.tiff'),referenceEngine=new EngineClient({cache:join(work,'reference-core')});try{await referenceEngine.call('export',{path:sparseRaw,artProfile:unchanged.document.artProfile,format:'tiff',output:reference});}finally{await referenceEngine.stop();}
 tiffPixels=JSON.parse(execFileSync(resolve('build/qa-venv/bin/python'),['-c',`import tifffile,numpy as np,json,sys
a,b=[tifffile.imread(p) for p in sys.argv[1:3]]
assert a.dtype==b.dtype==np.uint16 and np.array_equal(a,b)
with tifffile.TiffFile(sys.argv[1]) as t:icc=t.pages[0].tags[34675].value
assert len(icc)>0
print(json.dumps(dict(shape=list(a.shape),bitsPerSample=16,maximumDifference=0,iccBytes=len(icc))))`,output,reference],{encoding:'utf8'}));
 pass('desktop TIFF16 and its ICC match independent core output pixel for pixel after sparse preset and document operations');

 if(process.env.CAPTRAW_PARTIAL_PREVIOUS_APP){
  const before=hash(hydrated.path);await closeElectron(app);app=undefined;app=await electron.launch({executablePath:process.env.CAPTRAW_PARTIAL_PREVIOUS_APP});page=await app.firstWindow();
  page.on('pageerror',error=>errors.push(String(error)));await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true})));
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},hydrated.path);await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.getByRole('alert')).toContainText('不支持的 ART 显影版本');await expect(page.locator('.film-item')).toHaveCount(0);expect(hash(hydrated.path)).toBe(before);
  pass('the previous installed application explicitly rejects the new document version and leaves it untouched');
 }
 expect([source,plain,sparseRaw].map(hash)).toEqual([sourceHash,sourceHash,sourceHash]);expect([preset,classic,split].map(hash)).toEqual(originalHashes);expect(hash(sparseDocument)).toBe(sparseHash);expect(errors).toEqual([]);
 expect((await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>[w.isVisible(),w.isFocused(),w.isFocusable()]))).every(values=>values.every(v=>!v))).toBe(true);
 pass('RAW, original XMP and presets stay unchanged with hidden unfocused windows and no page errors');success=true;
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{
 if(app)await closeElectron(app);
 writeFileSync(join(out,'report.json'),JSON.stringify({checks,success,errors,executablePath:executablePath||null,backgroundWindow:true,httpBlocked:true,previousApp:process.env.CAPTRAW_PARTIAL_PREVIOUS_APP||null,sourceHash,tiffPixels,...(!success?{work}:{})},null,2)+'\n');
 if(success){rmSync(work,{recursive:true,force:true});rmSync(join(out,'failure.png'),{force:true});}else console.error('Failure workspace:',work);
}
