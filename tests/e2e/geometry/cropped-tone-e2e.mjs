import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const out=resolve(process.env.CAPTRAW_CROPPED_GUI_OUT||'artifacts/cropped-tone-gui');mkdirSync(out,{recursive:true});
const source=resolve('build/samples/nikon-d850.NEF'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(source),checks=[],errors=[];
let app,page,passed=false;const pass=s=>{checks.push(s);console.log('PASS',s);};
async function launch(){app=await electron.launch();page=await app.firstWindow();page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(String(e)));await page.evaluate(()=>{window.frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.frames.push(e.frame);});});}
async function settle(action){const n=await page.evaluate(()=>window.frames.length);await action();await page.waitForFunction(n=>window.frames.length>n,n);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.frames.filter(f=>f.kind==='fit').at(-1)?.url);}
async function open(path){await app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});},path);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function value(name,n){await settle(async()=>{const input=page.getByRole('spinbutton',{name,exact:true});await input.fill(String(n));await input.press('Tab');});}
async function save(){const path=join(out,'裁切 明暗.xmp');rmSync(path,{force:true});await app.evaluate(({dialog},p)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:p});},path);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);return readDocument(path);}
const fit=()=>page.evaluate(()=>window.frames.filter(f=>f.kind==='fit').at(-1));
try{
 await launch();await open(source);await page.getByRole('button',{name:'裁切 C',exact:true}).click();
 const handle=await page.getByTestId('crop-handle-se').boundingBox();await settle(async()=>{await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2-120,handle.y+handle.height/2-70,{steps:5});await page.mouse.up();});await page.keyboard.press('Enter');pass('visible crop handle resizes the RAW crop and Enter applies it');
 await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await settle(()=>page.getByRole('button',{name:'线性',exact:true}).click());
 const box=await page.getByTestId('viewport').boundingBox();await settle(async()=>{await page.mouse.move(box.x+box.width*.25,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.7,{steps:5});await page.mouse.up();});
 await value('局部亮度',.25);const neutral=hash((await fit()).file);await value('局部高光',25);const adjusted=hash((await fit()).file);expect(adjusted).not.toBe(neutral);pass('local highlights change the real cropped RAW preview');
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());expect(hash((await fit()).file)).toBe(neutral);await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());expect(hash((await fit()).file)).toBe(adjusted);pass('undo and redo restore exact cropped preview pixels');
 const document=await save();expect(document.adjustments.crop.width).toBeLessThan(.9);expect(document.adjustments.masks[0].tone.highlights).toBe(25);
 await page.getByRole('button',{name:'1:1',exact:true}).click();await page.waitForFunction(()=>{const f=window.frames.filter(f=>f.kind==='detail').at(-1);return f&&document.querySelector('canvas').dataset.detail===f.url;});
 await expect(page.getByTestId('mask-detail-coverage')).toBeVisible();const detail=await page.evaluate(()=>window.frames.filter(f=>f.kind==='detail').at(-1));copyFileSync(detail.file,join(out,'detail.png'));writeFileSync(join(out,'detail.json'),JSON.stringify(detail,null,2));
 const canvasPixels=await page.evaluate(async crop=>{
  const c=document.querySelector('canvas'),f=window.frames.filter(f=>f.kind==='detail').at(-1),image=new Image();image.crossOrigin='anonymous';image.src=f.url;await image.decode();
  const ref=document.createElement('canvas');ref.width=c.width;ref.height=c.height;const ctx=ref.getContext('2d'),bounds=c.getBoundingClientRect(),dpr=devicePixelRatio;ctx.scale(dpr,dpr);ctx.imageSmoothingEnabled=false;
  const x=bounds.width/2-(crop.x+crop.width/2)*f.fullWidth/dpr,y=bounds.height/2-(crop.y+crop.height/2)*f.fullHeight/dpr;
  ctx.drawImage(image,x+f.x/dpr,y+f.y/dpr,f.width/dpr,f.height/dpr);
  const a=c.getContext('2d').getImageData(Math.floor(c.width/2)-8,Math.floor(c.height/2)-8,16,16).data,b=ctx.getImageData(Math.floor(ref.width/2)-8,Math.floor(ref.height/2)-8,16,16).data;let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));return max;
 },document.adjustments.crop);expect(canvasPixels).toBe(0);await page.screenshot({path:join(out,'cropped-tone.png')});pass('1:1 paints native detail pixels and correctly positioned mask coverage');
 const output=join(out,'desktop.tiff');rmSync(output,{force:true});await app.evaluate(({dialog},p)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:p});},output);await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 const crop=document.artProfile.match(/\[Crop\]\n([^[]+)/)[1],get=k=>Number(crop.match(new RegExp('^'+k+'=(.+)$','m'))[1]);const rect={x:get('X'),y:get('Y'),width:get('W'),height:get('H')};
 const exporter=new EngineClient({cache:join(out,'independent')});try{await exporter.call('export',{path:source,artProfile:document.artProfile,output:join(out,'independent.tiff'),format:'tiff'});}finally{await exporter.stop();}
 execFileSync('build/qa-venv/bin/python',['-c',`import json,sys,numpy as np,tifffile
from pathlib import Path
from PIL import Image
p=Path(sys.argv[1]);r=json.loads(sys.argv[2]);f=json.loads((p/'detail.json').read_text());a=tifffile.imread(p/'desktop.tiff');b=tifffile.imread(p/'independent.tiff');assert a.dtype==np.uint16 and np.array_equal(a,b)
with tifffile.TiffFile(p/'desktop.tiff') as t:icc=len(t.pages[0].tags[34675].value)
x=f['x']-r['x'];y=f['y']-r['y'];assert x>=0 and y>=0
expected=np.rint(a[y:y+f['height'],x:x+f['width']].astype(float)/257);actual=np.array(Image.open(p/'detail.png'));assert actual.shape==expected.shape
d=np.abs(actual-expected);result={'shape':list(a.shape),'iccBytes':icc,'maximumPreviewDifference':float(d.max()),'differentPreviewSamples':int(np.count_nonzero(d)),'desktopIndependentEqual':True};(p/'pixels.json').write_text(json.dumps(result,indent=2));assert icc and d.max()==0,result
`,out,JSON.stringify(rect)]);pass('visible detailed preview and desktop TIFF16 match; independent export is identical');
 await closeElectron(app);app=null;await launch();await open(join(out,'裁切 明暗.xmp'));expect(hash((await fit()).file)).toBe(adjusted);await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'局部高光',exact:true})).toHaveValue('25');pass('a fresh application process restores crop, local tone and exact preview from XMP');
 expect(hash(source)).toBe(sourceHash);expect(errors).toEqual([]);passed=true;
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({status:passed?'passed':'failed',packaged:!!process.env.CAPTRAW_APP,checks,errors,sourceUnchanged:hash(source)===sourceHash},null,2)+'\n');if(app)await closeElectron(app);}
