import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/documents';
import {ENGINE_VERSION} from '@captraw/contracts';
import {mkdtemp,rm,writeFile,copyFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const work=await mkdtemp(join(tmpdir(),'captraw-inherited-flip-')),source=join(work,'legacy.png'),sidecar=join(work,'legacy.xmp');
const python=resolve('build/qa-venv/bin/python'),documents=new Documents(new XMP(resolve('build/xmp/captraw-xmp')));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const observations=[];let app,page,passed=false,core;
const button=name=>page.getByRole('button',{name,exact:true});
const frame=()=>page.evaluate(()=>window.__inheritedFrames.filter(f=>f.kind==='fit').at(-1));
async function ready(){
 await page.waitForTimeout(160);await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const f=window.__inheritedFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas[aria-label="显影预览"]')?.dataset.frame===f.url;});
 await expect(page.getByRole('alert')).toHaveCount(0);
}
async function settle(action){const before=(await frame())?.revision??-1;await action();await page.waitForFunction(r=>(window.__inheritedFrames.filter(f=>f.kind==='fit').at(-1)?.revision??-1)>r,before);await ready();}
const inspect=(file,mask)=>JSON.parse(execFileSync(python,['-c',String.raw`
from PIL import Image
import numpy as np,json,sys
a=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(float);h,w=a.shape[:2]
blue=(a[:,:,2]>a[:,:,0]*1.35)&(a[:,:,2]>a[:,:,1]*1.2);y,x=np.where(blue&(np.indices(blue.shape)[0]<h*.55));assert len(x)>20
cx,cy=float(x.mean()),float(y.mean());yy,xx=np.where(blue&(np.indices(blue.shape)[0]>h*.55));clone=[float(xx.mean())/w,float(yy.mean())/h] if len(xx)>20 else None
m=np.array(Image.open(sys.argv[2]).getchannel('A')) if sys.argv[2]!='none' else None
print(json.dumps(dict(content=[cx/w,cy/h],clone=clone,coverage=int(m[round(cy*m.shape[0]/h),round(cx*m.shape[1]/w)]) if m is not None else None)))
`,file,mask||'none'],{encoding:'utf8'}));
async function observe(label){
 await button('蒙版 M').click();await page.locator('.mask-select').first().click();await ready();
 await expect(page.getByTestId('mask-coverage')).toBeVisible();const f=await frame();
 const image=join(work,label+'.png'),mask=join(work,label+'-mask.png');await copyFile(f.file,image);await copyFile(f.mask.file,mask);
 const result={label,...inspect(image,mask)};observations.push(result);return result;
}
try{
 execFileSync(python,['-c',"from PIL import Image,ImageDraw;import sys;i=Image.new('RGB',(1024,768),(96,96,96));ImageDraw.Draw(i).rectangle((346,335,370,359),fill=(35,80,160));i.save(sys.argv[1])",source]);
 const sourceHash=hash(source);core=new EngineClient({cache:join(work,'fixture-cache')});
 const image=await core.call('open',{path:source,sessionId:'fixture'});
 const pending=core.preview(1),mirrored=await core.call('update',{revision:1,artProfile:image.artProfile,adjustments:{...image.adjustments,flipHorizontal:true}});await pending;
 const adjustments={...image.adjustments,masks:[{id:'legacy',name:'Legacy radial',type:'radial',enabled:true,inverted:false,initialized:true,referenceAngle:0,feather:0,brightness:.5,contrast:0,saturation:0,
  points:[],start:{x:.60,y:.39},end:{x:.70,y:.51}}],spots:[{id:'clone',name:'Legacy clone',enabled:true,method:'clone',source:{x:665/1023,y:347/767},target:{x:.25,y:.7},radius:30,feather:0,opacity:100,detail:0,sourceMode:'manual'}]};
 delete adjustments.flipHorizontal;delete adjustments.flipVertical;
 const legacyProfile=mirrored.artProfile.replace(/^CaptRAWSourceBasis(?:Horizontal|Vertical)?=.*\n/gm,'');
 await writeFile(sidecar,await documents.serialize({source:{path:source,size:readFileSync(source).length,sha256:sourceHash},engineVersion:ENGINE_VERSION,baselineVersion:4,artProfile:legacyProfile,adjustments}));
 await core.stop();core=undefined;
 const loaded=await documents.read(sidecar);assert(!Object.hasOwn(loaded.adjustments,'flipHorizontal'));assert(loaded.artProfile.includes('HorizontalFlip=true'));
 app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(60000);
 await page.evaluate(()=>{window.__inheritedFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__inheritedFrames.push(e.frame);});});
 await app.evaluate(({dialog,ipcMain})=>{
  globalThis.__inheritedUpdates=[];const original=ipcMain._invokeHandlers.get('image:update');ipcMain.removeHandler('image:update');
  ipcMain.handle('image:update',async(event,input)=>{const record={input:structuredClone(input)};globalThis.__inheritedUpdates.push(record);record.result=await original(event,input);return record.result;});
  dialog.showMessageBox=async(...args)=>({response:args.at(-1).buttons?.findIndex(v=>v.includes('放弃'))??1});
 });
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},sidecar);
 await settle(()=>button('打开').click());const before=await observe('before');
 await button('裁切 C').click();await ready();const pressedBefore=await button('水平翻转').getAttribute('aria-pressed');
 await settle(()=>button('水平翻转').click());const pressedAfter=await button('水平翻转').getAttribute('aria-pressed');
 await page.locator('.crop-actions').getByRole('button',{name:'完成',exact:true}).click();const after=await observe('after-first-click');
 await button('裁切 C').click();await ready();await settle(()=>button('水平翻转').click());
 await page.locator('.crop-actions').getByRole('button',{name:'完成',exact:true}).click();const restored=await observe('after-second-click');
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));
 assert(windows.every(w=>!w.visible&&!w.focused&&!w.focusable));
 observations.push({pressedBefore,pressedAfter,windows,updates:await app.evaluate(()=>globalThis.__inheritedUpdates.map(r=>({flipHorizontal:r.input.adjustments.flipHorizontal,geometry:r.result?.geometry,profileLength:r.input.artProfile?.length})))});
 console.log(JSON.stringify({observations},null,2));
 assert.equal(pressedBefore,'true','Inherited hflip=true must be shown as pressed');assert.equal(pressedAfter,'false');
 assert(Math.abs(before.content[0]-(1-after.content[0]))<.01,'First click must actually mirror image content');
 for(const state of [before,after,restored]){assert(state.coverage>180,'Legacy mask must stay on image content');assert(state.clone,'Legacy cloned image content must remain present');}
 assert(Math.abs(before.clone[0]-(1-after.clone[0]))<.01,'Legacy repair target follows mirrored content');
 assert(Math.abs(before.content[0]-restored.content[0])<.01);assert.equal(hash(source),sourceHash);passed=true;
}catch(error){
 if(page&&!page.isClosed())await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});
 await writeFile(join(work,'failure.json'),JSON.stringify({error:String(error.stack||error),observations,diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;
}finally{
 await core?.stop();if(app)await closeElectron(app);
 if(passed)await rm(work,{recursive:true,force:true});else console.error('Retained failure:',work);
}
