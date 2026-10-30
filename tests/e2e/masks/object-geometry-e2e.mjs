import assert from 'node:assert/strict';
import {expect as playwrightExpect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/documents';
import {ENGINE_VERSION} from '@captraw/contracts';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,statSync,copyFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const expect=playwrightExpect.configure({timeout:30000});
const root=resolve(process.env.CAPTRAW_OBJECT_GEOMETRY_GUI_OUT||'artifacts/object-geometry-gui');mkdirSync(root,{recursive:true});
const out=mkdtempSync(join(root,'run-')),python=resolve('build/qa-venv/bin/python');
const fixture=resolve(process.env.CAPTRAW_OBJECT_SOURCE||'artifacts/segmentation/inputs/canon-r5.CR3.jpg');
const executablePath=process.env.CAPTRAW_APP;
const native=executablePath?resolve(dirname(executablePath),'../Resources/native'):resolve('build/native');
const coreBinary=process.env.CAPTRAW_ENGINE||join(native,'captraw-engine'),resources=process.env.CAPTRAW_RESOURCES||join(native,'resources');
const xmpBinary=process.env.CAPTRAW_XMP_BINARY||(executablePath?join(native,'captraw-xmp'):resolve('build/xmp/captraw-xmp'));
const documents=new Documents(new XMP(xmpBinary));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const checks=[],metrics=[],errors=[],launches=[],limitations=[];
let app,page,core,stage='fixture',failure,fixtureHash,sourceHash,sequence=0;
const source=join(out,'private-source.png');
const pass=name=>{checks.push(name);console.log('PASS',name);};
const button=name=>page.getByRole('button',{name,exact:true});
const fits=()=>page.evaluate(()=>window.__objectEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').length);
const frame=()=>page.evaluate(()=>window.__objectEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame);
const calls=()=>app.evaluate(()=>globalThis.__objectRPC.records);
function section(profile,name,body){const start=profile.indexOf('['+name+']');assert(start>=0,name);const end=profile.indexOf('\n[',start);return profile.slice(0,start)+`[${name}]\n${body}\n`+(end<0?'':profile.slice(end));}
function png(name,data){const file=join(out,name+'.png');writeFileSync(file,Buffer.from(data.split(',')[1],'base64'));return file;}
async function ready(){
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const f=window.__objectEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame;return f&&document.querySelector('canvas')?.dataset.frame===f.url;});
 await expect(page.getByRole('alert')).toHaveCount(0);
}
async function settle(action){const n=await fits();await action();await expect.poll(fits,{timeout:120000}).toBeGreaterThan(n);await ready();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>button('打开').click());}
async function save(label){
 const path=join(out,`${++sequence}-${label}.xmp`);
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);
 await button('保存').click();await expect.poll(()=>existsSync(path)).toBe(true);await ready();return {path,doc:await documents.read(path)};
}
async function canvas(name){const data=await page.locator('canvas').evaluate(c=>c.toDataURL());const path=png(name,data);return {path,sha256:hash(path)};}
async function displayed(name){await ready();const f=await frame();copyFileSync(f.file,join(out,name+'.png'));return f;}
async function begin(){
 const entering=!(await button('蒙版 M').getAttribute('class')||'').split(' ').includes('selected'),previous=await frame();
 await button('蒙版 M').click();await expect(button('蒙版 M')).toHaveClass(/selected/);
 await expect(page.locator('.profile-line b')).toHaveText('蒙版');
 if(await page.locator('.mask-row').count()){
  // Entering mask mode schedules coverage after a debounce. An absent busy
  // indicator before that timer fires is not readiness: await its actual frame.
  await page.waitForFunction(({entering,revision})=>{
   const f=window.__objectEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame;
   return f?.mask&&(!entering||f.revision>revision)&&document.querySelector('canvas')?.dataset.frame===f.url;
  },{entering,revision:previous.revision});
  await expect(page.getByTestId('mask-coverage')).toBeVisible();
 }
 await ready();await expect(button('选择对象')).toBeEnabled();
 const pointerIndex=await page.evaluate(()=>window.__objectPointers.length);
 await button('选择对象').click();
 const events=await page.evaluate(index=>window.__objectPointers.slice(index),pointerIndex);
 assert(events.some(e=>e.type==='click'&&e.name==='选择对象'&&!e.disabled&&e.trusted),'Object start must receive one real enabled DOM click');
 metrics.push({kind:'object-start-click',frameRevision:(await frame()).revision,events});
 await expect(page.getByRole('region',{name:'对象选择'})).toBeVisible();await expect(button('点选')).toBeEnabled({timeout:120000});
}
async function pick(wait=true){
 const svg=page.getByTestId('viewport').locator('svg.mask-overlay'),b=await svg.boundingBox();assert(b);
 const r=await svg.locator('#mask-image-bounds rect').evaluate(e=>Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(e.getAttribute(k))])));
 const p={x:b.x+r.x+r.width*.5,y:b.y+r.y+r.height*.5};
 assert(await page.getByTestId('viewport').evaluate((e,p)=>e.contains(document.elementFromPoint(p.x,p.y)),p),'Prompt must reach the visible image');
 await page.mouse.click(p.x,p.y);
 if(wait){await expect(button('创建蒙版')).toBeEnabled({timeout:120000});await expect(page.getByTestId('object-candidate-overlay')).toBeVisible();}
}
async function launch(){
 app=await electron.launch({executablePath});page=await app.firstWindow();page.setDefaultTimeout(30000);
 page.on('pageerror',e=>errors.push(e.stack||String(e)));
 await app.evaluate(({session,ipcMain})=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_r,done)=>done({cancel:true}));
  const state={records:[],hold:false,held:[],released:0};globalThis.__objectRPC=state;
  for(const channel of ['object:begin','object:predict','object:commit','object:cancel','image:update','presets:apply']){
   const original=ipcMain._invokeHandlers.get(channel);if(typeof original!=='function')throw new Error(channel+' unavailable');
   ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,input)=>{
    const record={channel,input};state.records.push(record);
    const hold=channel==='object:predict'&&state.hold;if(hold)state.hold=false;
    try{
     const result=await original(event,input);record.result=result;
     // Hold only delivery of a completed real inference; never fabricate candidates.
     if(hold)await new Promise(done=>state.held.push(()=>{++state.released;done();}));
     return result;
    }catch(error){record.error=String(error);throw error;}
   });
  }
 });
 await page.evaluate(()=>{
  window.__objectEvents=[];window.captraw.onEvent(e=>window.__objectEvents.push(e));window.__objectPointers=[];
  for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>{
   const target=event.target.closest?.('button');if(!target)return;const name=target.getAttribute('aria-label')||target.textContent.trim();
   if(['蒙版 M','选择对象','预设','保存预设'].includes(name))window.__objectPointers.push({type,name,disabled:target.disabled,trusted:event.isTrusted,time:performance.now(),rendering:!!document.querySelector('.rendering')});
  },true);
 });
}
async function close(){if(!app)return;launches.push({diagnostics:electronDiagnostics(app),calls:await calls(),events:await page.evaluate(()=>window.__objectEvents),pointers:await page.evaluate(()=>window.__objectPointers)});await closeElectron(app);app=undefined;}
async function hidden(){const states=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));assert(states.length&&states.every(w=>!w.visible&&!w.focused&&!w.focusable));return states;}
async function overlay(name,testid){
 const element=page.getByTestId(testid);await expect(element).toBeVisible();await expect(element).toBeInViewport();
 // Rasterize a detached snapshot of the displayed SVG, retaining its actual
 // filters, clipping, opacity and transforms. The live DOM is never changed.
 const result=await element.evaluate(async element=>{
  const svg=element.ownerSVGElement,clone=svg.cloneNode(true);
  for(const node of clone.querySelectorAll('[data-testid="object-prompt"],[data-testid="object-box"]'))node.remove();
  for(const node of clone.querySelectorAll('image')){
   const blob=await (await fetch(node.getAttribute('href'))).blob();
   const url=await new Promise((done,fail)=>{const reader=new FileReader();reader.onload=()=>done(reader.result);reader.onerror=fail;reader.readAsDataURL(blob);});node.setAttribute('href',url);
  }
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  const image=new Image(),url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
  try{
   image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=svg.width.baseVal.value;canvas.height=svg.height.baseVal.value;
   canvas.getContext('2d').drawImage(image,0,0);const matrix=element.getCTM();
   return {data:canvas.toDataURL(),matrix:[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f],width:canvas.width,height:canvas.height};
  }finally{URL.revokeObjectURL(url);}
 });
 png(name,result.data);delete result.data;metrics.push({kind:name,...result});await page.screenshot({path:join(out,name+'-screen.png')});
}
try{
 assert(existsSync(fixture),'Prepare the real segmentation image fixture first');fixtureHash=hash(fixture);
 // Only this run's private copy receives Lensfun metadata.
 execFileSync(python,['-c',String.raw`
from PIL import Image,TiffImagePlugin
import sys
im=Image.open(sys.argv[1]).convert('RGB');exif=Image.Exif()
exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
im.save(sys.argv[2],exif=exif)
`,fixture,source]);sourceHash=hash(source);
 core=new EngineClient({executable:coreBinary,resources,cache:join(out,'fixture-core')});
 core.on('error',e=>errors.push('fixture core: '+JSON.stringify(e)));
 const image=await core.call('open',{path:source,sessionId:'object-geometry-fixture'});
 let profile=section(image.artProfile,'Rotation','Enabled=true\nDegree=23\nCaptRAWMaskCoordinates=true\nCaptRAWMaskReferenceDegree=7');
 profile=section(profile,'Common Properties for Transformations','AutoFill=true');
 profile=section(profile,'Perspective','Enabled=true\nHorizontal=25\nVertical=-15\nAngle=2\nShear=3\nFocalLength=10\nCropFactor=1.5\nAspect=1\nControlLines=');
 const adjustments={...image.adjustments,perspective:undefined,rotation:90,crop:null,lensCorrections:true,lensProfile:{mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:false,ca:true},masks:[]};
 const pending=core.preview(1,'fit',120000),applied=await core.call('update',{revision:1,artProfile:profile,adjustments});await pending;
 assert.deepEqual(applied.geometry,{rotation:90,angle:23});assert(applied.lensStatus.distortion&&applied.lensStatus.ca);
 assert.match(applied.artProfile,/CaptRAWMaskReferenceDegree=7/);
 const recipe=join(out,'fixture.xmp');writeFileSync(recipe,await documents.serialize({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:source,size:statSync(source).size,sha256:sourceHash},adjustments,artProfile:applied.artProfile}));
 await core.stop();core=undefined;
 stage='candidate';await launch();await open(recipe);await expect(button('撤销')).toBeDisabled();
 await begin();const neutralCanvas=await canvas('neutral-canvas');await displayed('neutral-fit');await pick();
 await expect(page.locator('.object-candidates button')).toHaveCount(3);
 const prediction=(await calls()).filter(r=>r.channel==='object:predict').at(-1).result;
 const selected=prediction.candidates.find(c=>c.index===prediction.selected);assert(selected.pixels>0);
 await expect(button(`候选 ${selected.index+1}`)).toHaveAttribute('aria-pressed','true');
 const candidateURL=await page.getByTestId('object-candidate-overlay').getAttribute('href');assert.equal(candidateURL,selected.url);
 const candidateBytes=await page.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),candidateURL);
 writeFileSync(join(out,'selected-candidate.png'),Buffer.from(candidateBytes));
 await overlay('candidate-overlay','object-candidate-overlay');pass('visible point prompt yields three real SAM candidates on coarse 90, fine 23, Lensfun and perspective');

 stage='commit';await settle(()=>button('创建蒙版').click());await expect(page.getByTestId('object-candidate-overlay')).toHaveCount(0);
 await expect(page.locator('.mask-row')).toHaveCount(1);await expect(page.getByTestId('mask-coverage')).toBeVisible();
 await page.waitForFunction(()=>window.__objectEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame.mask);
 await ready();await overlay('committed-overlay','mask-coverage');const neutral=await displayed('committed-fit');
 copyFileSync(neutral.mask.file,join(out,'committed-coverage.png'));
 const committed=await save('committed'),leaf=committed.doc.adjustments.masks[0].components[0];
 assert.equal(leaf.type,'raster');assert.equal(leaf.referenceAngle,23);assert.notEqual(leaf.referenceAngle,7);
 assert.equal(committed.doc.maskAssets.files.length,1);
 const asset=join(dirname(committed.path),committed.doc.maskAssets.files[0].path);copyFileSync(asset,join(out,'canonical-asset.png'));
 assert.equal(hash(asset),hash(join(out,'selected-candidate.png')));
 const beginResult=(await calls()).find(r=>r.channel==='object:begin').result;
 assert.equal(leaf.raster.width,beginResult.height);assert.equal(leaf.raster.height,beginResult.width);
 metrics.push({kind:'canonical-raster',input:beginResult,raster:leaf.raster,referenceAngle:leaf.referenceAngle});
 const alignment=JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image,ImageFilter
import numpy as np,json,sys
from pathlib import Path
p=Path(sys.argv[1]);read=lambda name:np.asarray(Image.open(p/name))
a=read('candidate-overlay.png')[:,:,3]>57;b=read('committed-overlay.png')[:,:,3]>57
assert a.shape==b.shape and a.sum()>100 and b.sum()>100
iou=float((a&b).sum()/(a|b).sum());ca=np.argwhere(a).mean(0);cb=np.argwhere(b).mean(0);distance=float(np.linalg.norm(ca-cb))
dilate=lambda x:np.asarray(Image.fromarray(x.astype('uint8')*255).filter(ImageFilter.MaxFilter(5)))>0
outside=int((a&~dilate(b)).sum()+(b&~dilate(a)).sum())
assert iou>.98 and distance<1 and outside==0,(iou,distance,outside)
asset=Image.open(p/'canonical-asset.png');assert asset.mode=='L' and list(asset.size)==json.loads(sys.argv[2])
assert np.array_equal(read('committed-fit.png'),read('neutral-fit.png')),'Neutral commit changed photo pixels'
print(json.dumps(dict(iou=iou,centroidDistanceCSS=distance,outsideTwoPixelBoundary=outside,maskSize=list(asset.size))))
`,out,JSON.stringify([leaf.raster.width,leaf.raster.height])],{encoding:'utf8'}));metrics.push({kind:'overlay-alignment',...alignment});
 pass('actual SVG candidate and committed alpha coverage align; canonical asset bytes/dimensions match and leaf reference is 23, not global 7');

 stage='undo';await settle(()=>button('撤销').click());await expect(page.locator('.mask-row')).toHaveCount(0);await expect(button('撤销')).toBeDisabled();
 assert.equal((await canvas('undo-canvas')).sha256,neutralCanvas.sha256);assert.equal((await save('undo')).doc.adjustments.masks.length,0);
 await settle(()=>button('重做').click());await expect(page.locator('.mask-row')).toHaveCount(1);
 assert.equal((await save('redo')).doc.adjustments.masks[0].components[0].referenceAngle,23);pass('one undo removes the complete commit and redo restores the reference-aware raster');

 stage='local-adjustment';await settle(async()=>{const control=page.getByRole('spinbutton',{name:'局部亮度',exact:true});await expect(control).toBeVisible();await control.fill('0.75');await control.press('Tab');});
 const editedFrame=await displayed('edited-fit');assert(editedFrame.mask);await canvas('edited-canvas');
 const changed=JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image,ImageFilter
import numpy as np,json,sys
from pathlib import Path
p=Path(sys.argv[1]);read=lambda name:np.asarray(Image.open(p/name))
a=read('committed-fit.png').astype(float);b=read('edited-fit.png').astype(float);coverage=read('committed-coverage.png')[:,:,3]
assert a.shape==b.shape and coverage.shape==a.shape[:2]
delta=np.max(np.abs(a[:,:,:3]-b[:,:,:3]),axis=2);inside=coverage>240;outside=np.asarray(Image.fromarray(coverage).filter(ImageFilter.MaxFilter(7)))==0
count=int(np.count_nonzero(delta>2));insideMean=float(delta[inside].mean());outsideMax=float(delta[outside].max())
assert count>100 and insideMean>2 and outsideMax<=1,(count,insideMean,outsideMax)
print(json.dumps(dict(changedPixels=count,insideMeanDifference=insideMean,outsideMaximumDifference=outsideMax)))
`,out],{encoding:'utf8'}));metrics.push({kind:'local-adjustment',...changed});
 const edited=await save('edited');assert.equal(edited.doc.adjustments.masks[0].brightness,.75);
 await button('编辑').click();await page.getByTestId('mask-coverage').waitFor({state:'hidden'});await ready();const beforeRestart=await canvas('before-restart');
 pass('visible local brightness changes actual displayed pixels inside committed coverage');

 stage='reopen';await hidden();await close();await launch();await open(edited.path);
 assert.equal((await canvas('reopened-canvas')).sha256,beforeRestart.sha256);
 await button('蒙版 M').click();await expect(page.locator('.mask-row')).toHaveCount(1);await expect(page.getByTestId('mask-coverage')).toBeVisible();await ready();
 const reopened=await frame();assert(reopened.mask);assert.equal(hash(reopened.mask.file),hash(join(out,'committed-coverage.png')));
 const savedAgain=await save('reopened');assert.equal(savedAgain.doc.adjustments.masks[0].components[0].referenceAngle,23);
 assert.equal(savedAgain.doc.maskAssets.files[0].id,edited.doc.maskAssets.files[0].id);
 assert.equal((await calls()).filter(r=>r.channel==='object:begin'||r.channel==='object:predict').length,0);
 assert.equal(await page.evaluate(()=>window.__objectEvents.filter(e=>e.event==='object-progress').length),0);
 pass('fresh-process XMP reopen restores identical displayed pixels, coverage and asset hash without object/model inference');

 stage='profile-route';await button('预设').click();await button('创建预设').click();const dialog=page.getByRole('dialog',{name:'创建预设'});
 await dialog.getByRole('textbox',{name:'预设名称',exact:true}).fill('同值光线');await dialog.getByRole('button',{name:'全不选',exact:true}).click();
 await dialog.getByRole('checkbox',{name:'光线',exact:true}).check();await dialog.getByRole('button',{name:'保存预设',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(button('撤销')).toBeDisabled();await begin();await app.evaluate(()=>{globalThis.__objectRPC.hold=true;});await pick(false);
 await expect.poll(()=>app.evaluate(()=>globalThis.__objectRPC.held.length),{timeout:120000}).toBe(1);await expect(button('创建蒙版')).toBeDisabled();
 await button('预设').click();await expect(page.getByRole('region',{name:'对象选择'})).toHaveCount(0);
 await button('同值光线').click();await expect.poll(async()=>(await calls()).filter(r=>r.channel==='presets:apply'&&r.result!==undefined).length).toBe(1);
 assert.deepEqual((await calls()).find(r=>r.channel==='presets:apply').result,[]);await expect(button('撤销')).toBeDisabled();
 await app.evaluate(()=>{for(const done of globalThis.__objectRPC.held.splice(0))done();});await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 await button('蒙版 M').click();await expect(page.getByRole('region',{name:'对象选择'})).toHaveCount(0);await expect(page.getByTestId('object-candidate-overlay')).toHaveCount(0);
 const afterNoop=await save('identical-preset');assert.deepEqual(afterNoop.doc.adjustments,savedAgain.doc.adjustments);
 limitations.push('Profile-only cancellation has no isolated visible preset/undo route: identical light preset returns [], creates no history/profileId change, and entering presets cancels object selection by tool change. Presets use the target profile rather than applying a different fine-rotation profile. This test covers the real workflow and stale delivery, not the profileId-only branch; host invalidation is covered separately.');
 pass('same-value visible preset is a no-op; tab cancellation discards a held real candidate without reviving the overlay');
 assert.equal(hash(fixture),fixtureHash);assert.equal(hash(source),sourceHash);assert.deepEqual(errors,[]);metrics.push({kind:'hidden-windows',states:await hidden()});
 pass('original fixture and private source unchanged; every window remains hidden and unfocused');stage='complete';
}catch(error){
 failure={stage,stack:error.stack||String(error),stdout:error.stdout?.toString(),stderr:error.stderr?.toString(),diagnostics:error.electronDiagnostics};
 if(error.electronScreenshot)writeFileSync(join(out,'launch-failure.png'),error.electronScreenshot);
 if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(e=>errors.push('failure screenshot: '+String(e)));
 throw error;
}finally{
 if(app)await close().catch(e=>{errors.push('shutdown: '+String(e));process.exitCode=1;});
 if(core)await core.stop().catch(e=>errors.push('fixture shutdown: '+String(e)));
 const report={status:failure||errors.length?'failed':'passed',stage,command:process.argv,executablePath:executablePath||null,coreBinary,coreSHA256:existsSync(coreBinary)?hash(coreBinary):null,fixture,fixtureHash,source,sourceHash,background:true,httpBlocked:true,checks,metrics,limitations,errors,failure,launches};
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('REPORT',join(out,'report.json'));
}
