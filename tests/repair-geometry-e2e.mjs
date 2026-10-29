import assert from 'node:assert/strict';
import {expect as playwrightExpect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from './electron-background.mjs';
import {EngineClient} from './engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {ENGINE_VERSION} from '@captraw/contracts';
import {DEFAULT_EXPORT_OPTIONS} from '@captraw/contracts/export-options';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,statSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const expect=playwrightExpect.configure({timeout:30000});
const rotations=process.env.CAPTRAW_REPAIR_GEOMETRY_ROTATION===undefined?[0,90,180,270]:[Number(process.env.CAPTRAW_REPAIR_GEOMETRY_ROTATION)];
assert(rotations.every(n=>[0,90,180,270].includes(n)),'Invalid coarse rotation');
const root=resolve(process.env.CAPTRAW_REPAIR_GEOMETRY_OUT||'artifacts/repair-geometry-gui');mkdirSync(root,{recursive:true});
const out=mkdtempSync(join(root,'run-')),fixture=resolve('build/samples/repair-source.png'),python=resolve('build/qa-venv/bin/python');
assert(existsSync(fixture),'Prepare the existing repair-source fixture first');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex'),fixtureHash=hash(fixture);
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
const checks=[],metrics=[],errors=[];let app,page,core,revision=0,sequence=0,context,stage='fixture',failure;
const pass=name=>{checks.push(name);console.log('PASS',name);};
const viewport=()=>page.getByTestId('viewport'),pending=()=>page.getByTestId('repair-gesture-pending');
const undo=()=>page.getByRole('button',{name:'撤销',exact:true}),redo=()=>page.getByRole('button',{name:'重做',exact:true});
const list=()=>page.getByRole('list',{name:'修复列表'}).getByRole('listitem');
const frame=()=>page.evaluate(()=>window.__repairEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame);
const fits=()=>page.evaluate(()=>window.__repairEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').length);
const pixels=async()=>createHash('sha256').update(await page.locator('canvas').evaluate(c=>c.toDataURL())).digest('hex');
const updates=()=>app.evaluate(()=>globalThis.__repairRPC.updates.length);
async function ready(guides=true){
 await pending().waitFor({state:'hidden'});await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const f=window.__repairEvents.filter(e=>e.event==='preview'&&e.frame.kind==='fit').at(-1)?.frame;return f&&document.querySelector('canvas')?.dataset.frame===f.url;});
 await page.waitForTimeout(160);await page.locator('.rendering').waitFor({state:'hidden'});
 if(guides)await page.getByTestId('repair-guides').waitFor({state:'attached'});
 await expect(page.getByRole('alert')).toHaveCount(0);
}
async function settle(action){const n=await fits();await action();await expect.poll(fits).toBeGreaterThan(n);await ready();}
async function open(path){
 const n=await fits();await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);
 await page.getByRole('button',{name:'打开',exact:true}).click();await expect.poll(fits).toBeGreaterThan(n);await ready(false);
 await page.getByRole('button',{name:'修复 B',exact:true}).click();await ready();
}
async function save(label){
 const path=join(context.directory,`${++sequence}-${label}.xmp`);
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);await ready();
 return {path,doc:await documents.read(path)};
}
function section(profile,name,body){const start=profile.indexOf('['+name+']');assert(start>=0,name);const end=profile.indexOf('\n[',start);return profile.slice(0,start)+`[${name}]\n${body}\n`+(end<0?'':profile.slice(end));}
function normalized(p){const x=p.x/(context.rw-1),y=p.y/(context.rh-1);switch(context.rotation){case 90:return {x:y,y:1-x};case 180:return {x:1-x,y:1-y};case 270:return {x:1-y,y:x};default:return {x,y};}}
function sourcePixel(p){let {x,y}=p;switch(context.rotation){case 90:[x,y]=[1-y,x];break;case 180:[x,y]=[1-x,1-y];break;case 270:[x,y]=[y,1-x];}
 return {x:Math.floor(x*(context.rw-1)+.5),y:Math.floor(y*(context.rh-1)+.5)};
}
async function map(points,from='display',to='source'){
 const result=await core.call('coordinates',{sessionId:context.sessionId,revision,from,to,points});
 assert.equal(result.width,context.fw);assert.equal(result.height,context.fh);assert(result.points.every(Boolean),'Oracle inverse failed');return result.points;
}
async function imageRect(){
 await expect(viewport()).toBeVisible();
 const svg=viewport().locator('svg.mask-overlay'),box=await svg.boundingBox();assert(box);
 const r=await svg.locator('#mask-image-bounds rect').evaluate(e=>Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(e.getAttribute(k))])));
 assert(r.width>0&&r.height>0);return {x:box.x+r.x,y:box.y+r.y,width:r.width,height:r.height};
}
const screen=(p,r)=>({x:r.x+(p.x+.5)*r.width/context.fw,y:r.y+(p.y+.5)*r.height/context.fh});
const display=(p,r)=>({x:(p.x-r.x)*context.fw/r.width-.5,y:(p.y-r.y)*context.fh/r.height-.5});
async function visible(p){assert(await viewport().evaluate((e,p)=>{const hit=document.elementFromPoint(p.x,p.y);return !!hit&&e.contains(hit);},p),'Pointer must reach the visible viewport');}
async function handle(part){await ready();const h=page.getByTestId(`repair-${part}-handle`);await expect(h).toBeVisible();return h.evaluate(e=>{const p=new DOMPoint(Number(e.getAttribute('cx')),Number(e.getAttribute('cy'))).matrixTransform(e.getScreenCTM());return {x:p.x,y:p.y};});}
async function pointerStart(){return page.evaluate(()=>window.__repairPointers.length);}
async function pointerPair(index){return page.evaluate(index=>{const events=window.__repairPointers.slice(index);return {down:events.find(e=>e.type==='pointerdown'),up:events.find(e=>e.type==='pointerup')};},index);}
async function clickAt(css){await ready();await visible(css);const r=await imageRect();assert(css.x>=r.x&&css.y>=r.y&&css.x<r.x+r.width&&css.y<r.y+r.height,'Pick must lie inside the displayed image');const index=await pointerStart();await page.mouse.click(css.x,css.y);const pair=await pointerPair(index);assert(pair.up);return pair.up;}
async function expectedPick(css,r){return normalized((await map([display(css,r)]))[0]);}
function verifySpot(doc,expected){
 assert.equal(doc.adjustments.spots.length,1);const s=doc.adjustments.spots[0];
 let error=0;for(const part of ['source','target']){
  const actual=s[part],want=expected[part];error=Math.max(error,Math.hypot((actual.x-want.x)*(context.image.width-1),(actual.y-want.y)*(context.image.height-1)));
 }
 assert(error<.02,`Saved normalized coordinates differ from native oracle by ${error} source pixels`);
 assert.equal(s.method,'clone');assert.equal(s.radius,30);assert.equal(s.feather,50);assert.equal(s.opacity,100);
 const block=doc.artProfile.split('[Spot Removal]')[1]?.split('\n[')[0];assert(block);
 const entries=[...block.matchAll(/^Spot\d+=(.*)$/gm)];assert.equal(entries.length,1);
 const values=entries[0][1].split(';').filter(Boolean).map(Number),source=sourcePixel(expected.source),target=sourcePixel(expected.target);
 assert.deepEqual(values.slice(0,5),[source.x,source.y,target.x,target.y,30]);assert(Math.abs(values[5]-.5)<1e-6);assert.equal(values[6],1);assert.equal(values[7],0);
 metrics.push({rotation:context.rotation,kind:'saved-coordinates',maximumSourcePixelError:error,nativeEntry:values});return s;
}
async function verifyGuides(s){
 await ready();const r=await imageRect(),centers=await map([sourcePixel(s.source),sourcePixel(s.target)],'source','display');
 for(const [i,part] of ['source','target'].entries()){const actual=await handle(part),expected=screen(centers[i],r);assert(Math.hypot(actual.x-expected.x,actual.y-expected.y)<.1,'Mapped guide center disagrees with native pixel center');}
 const paths=page.locator('path.repair-area');await expect(paths).toHaveCount(4);
 const contours=await paths.evaluateAll(paths=>paths.map(path=>{
  const length=path.getTotalLength(),matrix=path.getScreenCTM(),n=Math.max(2,Math.ceil(length));
  return Array.from({length:n+1},(_,i)=>{const q=path.getPointAtLength(length*i/n),p=new DOMPoint(q.x,q.y).matrixTransform(matrix);return {x:p.x,y:p.y};});
 }));
 const input=[];for(const part of ['target','source'])for(const radius of [30,45]){const c=sourcePixel(s[part]);for(let i=0;i<256;i++){const a=i*2*Math.PI/256;input.push({x:c.x+radius*Math.cos(a),y:c.y+radius*Math.sin(a)});}}
 const output=await map(input,'source','display');let worst=0;
 for(let i=0;i<output.length;i++){
  const p=screen(output[i],r),curve=contours[Math.floor(i/256)];let best=Infinity;
  for(let j=1;j<curve.length;j++){const a=curve[j-1],b=curve[j],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;best=Math.min(best,Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy));}
  worst=Math.max(worst,best);
 }
 assert(worst<.4,`Rendered complete repair contours differ by ${worst} CSS px`);metrics.push({rotation:context.rotation,kind:'rendered-guides',maximumCSSDistance:worst});
}
async function arm(){await app.evaluate(()=>{globalThis.__repairRPC.hold=true;});}
async function held(){await expect.poll(()=>app.evaluate(()=>globalThis.__repairRPC.held.length)).toBe(1);}
async function release(){await app.evaluate(()=>{for(const done of globalThis.__repairRPC.held.splice(0))done();});}
async function dragStart(part,dx=22,dy=14,fast=false){
 const h=await handle(part),r=await imageRect(),a={x:h.x+4,y:h.y-3},b={x:a.x+dx,y:a.y+dy};await visible(a);await visible(b);
 const index=await pointerStart(),count=await updates(),before=await pixels();await arm();await page.mouse.move(a.x,a.y);await page.mouse.down();await held();
 if(!fast)await page.mouse.move(b.x,b.y,{steps:6});
 assert.equal(await updates(),count,'Pointermove must not submit draft edits');assert.equal(await pixels(),before);
 if(fast)await viewport().evaluate((e,p)=>e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:0,clientX:p.x,clientY:p.y})),b);
 await page.mouse.up();await expect(pending()).toBeVisible();assert.equal(await updates(),count,'Pointerup must await native coordinates');
 const pair=await pointerPair(index);assert(pair.down&&pair.up);return {pair,r,count};
}
async function dragExpected(s,part,gesture){const [first,last]=(await map([display(gesture.pair.down,gesture.r),display(gesture.pair.up,gesture.r)])).map(normalized);return {...s,[part]:{x:s[part].x+last.x-first.x,y:s[part].y+last.y-first.y}};}

async function tiffOracle(saved,expected){
 const output=join(context.directory,'gui.tiff'),independent=join(context.directory,'oracle.tiff'),baseline=join(context.directory,'baseline.tiff');
 await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);
 await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('combobox',{name:'输出色彩空间'}).selectOption('srgb');
 await page.getByRole('combobox',{name:'输出尺寸方式'}).selectOption('original');await page.getByRole('checkbox',{name:'输出锐化',exact:true}).uncheck();
 await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect.poll(()=>existsSync(output),{timeout:120000}).toBe(true);await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});await ready();
 // Compose independently from the original profile and analytically checked
 // pick positions, not merely re-exporting the GUI's saved ART profile.
 const wanted={...saved.adjustments,spots:[{...saved.adjustments.spots[0],source:expected.source,target:expected.target}]};
 const waiting=core.preview(++revision);const result=await core.call('update',{revision,artProfile:context.profile,adjustments:wanted});await waiting;
 await core.call('export',{path:context.source,artProfile:result.artProfile,output:independent,format:'tiff',colorSpace:'srgb',options:DEFAULT_EXPORT_OPTIONS});
 await core.call('export',{path:context.source,artProfile:context.profile,output:baseline,format:'tiff',colorSpace:'srgb',options:DEFAULT_EXPORT_OPTIONS});
 const centers=await map([sourcePixel(expected.source),sourcePixel(expected.target)],'source','display');
 const measured=JSON.parse(execFileSync(python,['-c',String.raw`
import json,sys,numpy as np,tifffile
a,b,base=[tifffile.imread(p) for p in sys.argv[1:4]]
assert a.dtype==b.dtype==base.dtype==np.uint16
assert a.shape==b.shape==base.shape and np.array_equal(a,b), 'GUI TIFF differs from independently composed repair'
source,target=json.loads(sys.argv[4]);roi=lambda im,p:im[round(p['y'])-3:round(p['y'])+4,round(p['x'])-3:round(p['x'])+4].astype(float)
src,dst,old=roi(base,source),roi(a,target),roi(base,target)
assert src.shape==dst.shape==old.shape==(7,7,3)
copied=float(np.max(np.abs(dst.mean((0,1))-src.mean((0,1)))))
changed=float(np.max(np.abs(dst.mean((0,1))-old.mean((0,1)))))
assert copied<512,(copied,'clone center must reproduce the uniform source patch')
assert changed>2000,(changed,'target must visibly change')
delta=np.max(np.abs(a.astype(np.int32)-base.astype(np.int32)),axis=2)
assert np.count_nonzero(delta)>100
print(json.dumps(dict(tiffMaximumDifference=0,cloneCenterMaximumDifference=copied,targetChange=changed,changedPixels=int(np.count_nonzero(delta)))))
`,output,independent,baseline,JSON.stringify(centers)],{encoding:'utf8'}));
 metrics.push({rotation:context.rotation,kind:'TIFF-pixels',...measured});
}

async function lifecycle(baseline){
 for(const action of ['save','close','export','native-close','quit']){
  const clean=await save('clean-'+action);await expect.poll(()=>app.evaluate(()=>globalThis.__repairRPC.dirty.length)).toBe(0);
  await app.evaluate(({dialog})=>{globalThis.__repairDialogs={saves:0,messages:[]};dialog.showSaveDialog=async()=>{globalThis.__repairDialogs.saves++;return {canceled:true};};dialog.showMessageBox=async(...args)=>{const o=args.at(-1);globalThis.__repairDialogs.messages.push({message:o.message,buttons:o.buttons});return {response:o.buttons.includes('继续编辑')?o.buttons.indexOf('继续编辑'):o.cancelId??0};};});
  const gesture=await dragStart('target',12,8),expected=await dragExpected(baseline,'target',gesture);
  await expect.poll(()=>app.evaluate((_,path)=>globalThis.__repairRPC.dirty.includes(path),context.source)).toBe(true);
  if(action==='save')await page.keyboard.press('Meta+s');else if(action==='close')await page.keyboard.press('Meta+w');
  else if(action==='export'){await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();}
  else if(action==='native-close')await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());else await app.evaluate(({app})=>app.quit());
  if(action==='native-close'||action==='quit'){
   await expect.poll(()=>app.evaluate(()=>globalThis.__repairDialogs.messages.length)).toBe(1);
   assert.match((await app.evaluate(()=>globalThis.__repairDialogs.messages))[0].message,/未保存/);await expect(viewport()).toBeVisible();
  }else await expect(page.getByRole('alert')).toContainText('修复操作尚未完成');
  assert.equal(await app.evaluate(()=>globalThis.__repairDialogs.saves),0);assert.equal(await updates(),gesture.count);await expect(pending()).toBeVisible();
  await settle(release);const applied=await save('released-'+action);verifySpot(applied.doc,expected);
  await settle(()=>undo().click());assert.deepEqual((await save('undo-'+action)).doc.adjustments.spots,clean.doc.adjustments.spots);
  pass(`pending repair ${action} preserves draft and revision, then saves with one undo`);
 }
 for(const action of ['Escape','tool','photo']){
  const clean=await save('cancel-'+action),before=await pixels(),gesture=await dragStart('source',17,11);
  if(action==='Escape')await page.keyboard.press('Escape');
  else if(action==='tool')await page.getByRole('button',{name:'平移 H',exact:true}).click();
  else await open(context.otherRecipe);
  await pending().waitFor({state:'hidden'});await release();await page.waitForTimeout(200);
  if(action==='photo'){
   await ready();await expect(list()).toHaveCount(0);assert.deepEqual((await save('other-after-late')).doc.adjustments.spots,[]);await open(clean.path);
  }else{assert.equal(await updates(),gesture.count);await page.getByRole('button',{name:'修复 B',exact:true}).click();await ready();}
  assert.equal(await pixels(),before);assert.deepEqual((await save('cancelled-'+action)).doc.adjustments.spots,clean.doc.adjustments.spots);
  await list().first().getByRole('button').first().click();await ready();
  pass(`${action} cancels repair and ignores the delayed actual coordinates result`);
 }
}

try{
 const prepared=join(out,'repair-source.png');
 execFileSync(python,['-c',String.raw`
from PIL import Image,TiffImagePlugin
import sys
im=Image.open(sys.argv[1]);icc=im.info.get('icc_profile');im=im.convert('RGB');exif=Image.Exif()
# Autofill at 23 degrees clips the original top-row patches. Copy those exact
# authored colors into the interior of this run's private fixture only.
blue=im.crop((216,160,296,240));red=im.crop((676,160,756,240))
im.paste(blue,(344,310));im.paste(red,(600,390))
exif[271]='NIKON CORPORATION';exif[272]='NIKON D500'
exif[34665]={42036:'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',37386:TiffImagePlugin.IFDRational(10),33437:TiffImagePlugin.IFDRational(7,2),41989:15}
im.save(sys.argv[2],exif=exif,icc_profile=icc)
`,fixture,prepared]);
 core=new EngineClient({cache:join(out,'oracle-cache')});core.on('error',e=>errors.push(String(e)));
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__repairEvents=[];window.__repairPointers=[];window.captraw.onEvent(e=>window.__repairEvents.push(e));for(const type of ['pointerdown','pointerup'])document.addEventListener(type,e=>{if(e.target.closest('[data-testid="viewport"]'))window.__repairPointers.push({type,x:e.clientX,y:e.clientY});},true);});
 await app.evaluate(({ipcMain})=>{
  const state={hold:false,held:[],coordinates:[],updates:[],dirty:[]};globalThis.__repairRPC=state;
  for(const channel of ['image:coordinates','image:update','documents:dirty']){
   const original=ipcMain._invokeHandlers.get(channel);if(typeof original!=='function')throw new Error(channel+' handler unavailable');
   ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,input)=>{
    if(channel==='documents:dirty')state.dirty=[...input];if(channel==='image:update')state.updates.push({sessionId:input.sessionId,revision:input.revision});
    const intercept=channel==='image:coordinates'&&input.from==='display'&&input.to==='source',hold=intercept&&state.hold;if(hold)state.hold=false;
    const result=await original(event,input);if(intercept)state.coordinates.push({...input,result});
    if(hold)await new Promise(done=>state.held.push(done));return result;
   });
  }
 });
 for(const rotation of rotations){
  stage='prepare '+rotation;const directory=join(out,'rotation'+rotation);mkdirSync(directory);const source=join(directory,'source.png'),other=join(directory,'other.png');copyFileSync(prepared,source);copyFileSync(prepared,other);
  const sessionId='oracle-'+rotation,image=await core.call('open',{path:source,sessionId});
  assert.equal(image.width,1024);assert.equal(image.height,768);
  let profile=section(image.artProfile,'Rotation','Enabled=true\nDegree=23\nCaptRAWMaskCoordinates=true\nCaptRAWMaskReferenceDegree=7');
  profile=section(profile,'Common Properties for Transformations','AutoFill=true');
  profile=section(profile,'Perspective','Enabled=true\nHorizontal=25\nVertical=-15\nAngle=2\nShear=3\nFocalLength=10\nCropFactor=1.5\nAspect=1\nControlLines=');
  const adjustments={...image.adjustments,perspective:undefined,rotation,crop:null,lensCorrections:true,lensProfile:{mode:'auto',cameraMake:'',cameraModel:'',lens:'',distortion:true,vignette:false,ca:true},spots:[]};
  const wait=core.preview(++revision),result=await core.call('update',{revision,artProfile:profile,adjustments}),f=await wait;profile=result.artProfile;
  assert(result.lensStatus.distortion&&result.lensStatus.ca,'Lensfun fixture must enable real distortion and CA');
  const recipe=join(directory,'fixture.xmp'),otherRecipe=join(directory,'other.xmp');
  for(const [path,file]of [[source,recipe],[other,otherRecipe]])writeFileSync(file,await documents.serialize({engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path,size:statSync(path).size,sha256:hash(path)},adjustments,artProfile:profile}));
  context={directory,source,otherRecipe,image,profile,sessionId,rotation,rw:rotation%180?image.height:image.width,rh:rotation%180?image.width:image.height,fw:f.fullWidth,fh:f.fullHeight};
  stage='picks '+rotation;await open(recipe);const shown=await frame();assert.equal(shown.fullWidth,context.fw);assert.equal(shown.fullHeight,context.fh);
  await page.getByRole('button',{name:'仿制',exact:true}).click();
  for(const [name,value]of [['半径',30],['羽化',50],['不透明度',100]]){const input=page.getByRole('spinbutton',{name,exact:true});await input.fill(String(value));await input.press('Tab');}
  await ready();await expect(undo()).toBeDisabled();const originalPixels=await pixels(),r=await imageRect();
  const known={source:{x:384/(image.width-1),y:350/(image.height-1)},target:{x:640/(image.width-1),y:430/(image.height-1)}};
  const centers=await map([sourcePixel(known.source),sourcePixel(known.target)],'source','display');
  const sourceClick=await clickAt(screen(centers[0],r));await ready();await expect(page.getByTestId('repair-pending-source')).toBeVisible();await expect(list()).toHaveCount(0);await expect(undo()).toBeDisabled();assert.equal(await pixels(),originalPixels);
  const targetClick=await clickAt(screen(centers[1],r));await ready();await expect(list()).toHaveCount(1);
  const expected={source:await expectedPick(sourceClick,r),target:await expectedPick(targetClick,r)},saved=await save('created'),s=verifySpot(saved.doc,expected),clonePixels=await pixels();assert.notEqual(clonePixels,originalPixels);
  await verifyGuides(s);await page.screenshot({path:join(directory,'mapped-repair.png')});
  await settle(()=>undo().click());await expect(list()).toHaveCount(0);assert.equal(await pixels(),originalPixels);await settle(()=>redo().click());assert.equal(await pixels(),clonePixels);
  pass(`${rotation}: actual source/target picks, complete nonlinear guides and saved native pixel centers match independent coordinates; one creation undo`);
  stage='drags '+rotation;
  for(const part of ['target','source']){
   const gesture=await dragStart(part,part==='target'?22:-18,14,part==='target'),want=await dragExpected(s,part,gesture);
   await settle(release);const moved=await save(part+'-moved');verifySpot(moved.doc,want);assert.deepEqual(moved.doc.adjustments.spots[0][part==='source'?'target':'source'],s[part==='source'?'target':'source']);
   assert.notEqual(await pixels(),clonePixels);await settle(()=>undo().click());assert.equal(await pixels(),clonePixels);assert.deepEqual((await save(part+'-undone')).doc.adjustments.spots,saved.doc.adjustments.spots);
   const h=await handle(part);await clickAt({x:h.x+4,y:h.y-3});await ready();await expect(redo()).toBeEnabled();assert.deepEqual((await save(part+'-no-motion')).doc.adjustments.spots,saved.doc.adjustments.spots);
   pass(`${rotation}: ${part} drag preserves hit offset, drains final pointerup before a single undo; no-motion click keeps redo`);
  }
  stage='TIFF '+rotation;const final=await save('final');await tiffOracle(final.doc,expected);pass(`${rotation}: GUI TIFF16 equals independently composed repair; cloned target ROI reproduces source color`);
  if(rotation===0){stage='pending lifecycle';await lifecycle(s);}
  assert.equal(hash(source),hash(prepared));
 }
 assert.equal(hash(fixture),fixtureHash);assert.deepEqual(errors,[]);
 const events=await page.evaluate(()=>window.__repairEvents);assert.deepEqual(events.filter(e=>e.event==='error'),[]);stage='complete';
}catch(error){failure=error;console.error(error);if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});}
finally{
 const diagnostics=app?electronDiagnostics(app):undefined;
 const trace=app?await app.evaluate(()=>{const s=globalThis.__repairRPC;return s?{coordinates:s.coordinates,updates:s.updates,dirty:s.dirty}:undefined;}).catch(()=>undefined):undefined;
 const events=page?await page.evaluate(()=>window.__repairEvents).catch(()=>undefined):undefined;
 if(core)await core.stop().catch(error=>{failure??=error;});if(app)await closeElectron(app).catch(error=>{failure??=error;});
 writeFileSync(join(out,'report.json'),JSON.stringify({status:failure?'failed':'passed',stage,checks,metrics,errors,error:failure?.stack,trace,events,diagnostics,backgroundWindow:true,binaries:{app:process.env.CAPTRAW_APP||'dev',engine:process.env.CAPTRAW_ENGINE,resources:process.env.CAPTRAW_RESOURCES,xmp:process.env.CAPTRAW_XMP_BINARY}},null,2)+'\n');
 console.log('Report:',join(out,'report.json'));if(failure)process.exitCode=1;
}
