import {expect} from '@playwright/test';
import {electron,closeElectron} from '../../support/electron-background.mjs';
import {readDocument} from '../../support/xmp-test.mjs';
import {mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const out=resolve(process.env.CAPTRAW_COMPARISON_OUT||'artifacts/comparison-gui');mkdirSync(out,{recursive:true});
const app=await electron.launch(),page=await app.firstWindow();page.setDefaultTimeout(45000);
const sources=['build/samples/nikon-d850.NEF','build/samples/canon-r5.CR3'];
const checks=[],errors=[],composites=[],pass=s=>{checks.push(s);console.log('PASS',s);},hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const sourceHashes=sources.map(hash);
const workers=()=>execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(line=>line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(m=>m&&Number(m[2])===app.process().pid&&m[3].includes('/comparison-')).map(m=>Number(m[1]));
page.on('pageerror',e=>errors.push(String(e)));
const view=()=>page.getByRole('combobox',{name:'前后对比视图'});
async function idle(){await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.framesAfter.filter(f=>f.kind==='fit').at(-1)?.url);}
async function settle(fn){const n=await page.evaluate(()=>window.framesAfter.length);await fn();await page.waitForFunction(n=>window.framesAfter.length>n,n);await idle();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},resolve(path));await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function ready(){await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>{const c=document.querySelector('canvas');return c.dataset.before&&c.dataset.before===window.framesBefore.filter(f=>f.kind==='fit').at(-1)?.url;});}
async function save(name){const path=join(out,name+'.xmp');rmSync(path,{force:true});await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);await idle();return readDocument(path);}
try{
 await page.evaluate(()=>{window.framesAfter=[];window.framesBefore=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.framesAfter.push(e.frame);if(e.event==='comparison-preview')window.framesBefore.push(e.frame);});});
 await expect(page.getByRole('button',{name:'适屏',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'1:1',exact:true})).toBeDisabled();await expect(page.getByLabel('缩放比例')).toHaveText('—');await expect(view()).toBeDisabled();pass('empty canvas disables zoom and comparison and has no fabricated percentage');
 await open('build/samples/nikon-d850.NEF');const original=hash(await page.evaluate(()=>window.framesAfter.filter(f=>f.kind==='fit').at(-1).file));
 await settle(async()=>{const c=page.getByRole('spinbutton',{name:'曝光',exact:true});await c.fill('1');await c.press('Tab');});const before=await save('before-comparison');
 await view().selectOption('left-right');await ready();await expect(page.getByLabel('前后对比', {exact:true})).toBeVisible();
 expect(hash(await page.evaluate(()=>window.framesBefore.filter(f=>f.kind==='fit').at(-1).file))).toBe(original);
 expect(hash(await page.evaluate(()=>window.framesAfter.filter(f=>f.kind==='fit').at(-1).file))).not.toBe(original);pass('before pane renders original RAW pixels in an isolated core while after retains actual edited pixels');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));await expect(view()).toBeInViewport();
 for(const mode of ['left-right','top-bottom','split-vertical','split-horizontal']){
  await view().selectOption(mode);await ready();await expect(page.locator('canvas')).toHaveAttribute('data-layout',mode);
  const result=await page.evaluate(async crop=>{
   const c=document.querySelector('canvas'),mode=c.dataset.layout;
   const image=async src=>{const i=new Image();i.crossOrigin='anonymous';i.src=src;await i.decode();return i;};
   const a=await image(c.dataset.before),b=await image(c.dataset.frame),ref=window.comparisonReference||document.createElement('canvas');window.comparisonReference=ref;ref.width=c.width;ref.height=c.height;const ctx=ref.getContext('2d'),dpr=devicePixelRatio,w=c.getBoundingClientRect().width,h=c.getBoundingClientRect().height;
   ctx.scale(dpr,dpr);const f=window.framesAfter.filter(f=>f.kind==='fit').at(-1),fw=f.fullWidth,fh=f.fullHeight,area=crop||{x:0,y:0,width:1,height:1};const pw=mode==='left-right'?w/2:w,ph=mode==='top-bottom'?h/2:h,scale=Math.min((pw-64)/(fw*area.width),(ph-64)/(fh*area.height)),x=pw/2-(area.x+area.width/2)*fw*scale,y=ph/2-(area.y+area.height/2)*fh*scale;
   for(const [i,img] of [a,b].entries()){ctx.save();ctx.beginPath();const horizontal=mode==='top-bottom'||mode==='split-horizontal';ctx.rect(horizontal?0:i*w/2,horizontal?i*h/2:0,horizontal?w:w/2,horizontal?h/2:h);ctx.clip();if(i&&mode==='left-right')ctx.translate(w/2,0);if(i&&mode==='top-bottom')ctx.translate(0,h/2);ctx.beginPath();ctx.rect(x+area.x*fw*scale,y+area.y*fh*scale,area.width*fw*scale,area.height*fh*scale);ctx.clip();ctx.drawImage(img,x,y,fw*scale,fh*scale);ctx.restore();}
   const actual=c.getContext('2d').getImageData(0,0,c.width,c.height).data,expected=ctx.getImageData(0,0,c.width,c.height).data;let max=0,count=0;for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);max=Math.max(max,d);if(d)count++;}return {mode,max,count};
  },before.adjustments.crop);composites.push(result);console.log('COMPOSITE',result);expect(result.max).toBeLessThanOrEqual(1);
 }
 await page.screenshot({path:join(out,'split.png')});pass('all four comparison layouts composite the actual two native images at matching fit scales, including the minimum window');
 await view().selectOption('left-right');await page.getByTestId('viewport').click({position:{x:20,y:20}});await page.keyboard.press('q');await expect(view()).toHaveValue('top-bottom');await page.keyboard.press('Shift+Q');await expect(view()).toHaveValue('left-right');await page.keyboard.press('Shift+Q');await expect(view()).toHaveValue('off');await page.keyboard.press('q');await expect(view()).toHaveValue('left-right');await ready();pass('Q cycles layouts and Shift+Q cycles in reverse, including single view');
 await settle(async()=>{const c=page.getByRole('spinbutton',{name:'曝光',exact:true});await c.fill('1.5');await c.press('Tab');});await ready();expect(hash(await page.evaluate(()=>window.framesBefore.filter(f=>f.kind==='fit').at(-1).file))).toBe(original);pass('editing while comparing changes the after image without replacing the before image');
 await page.getByRole('button',{name:'1:1',exact:true}).click();
 await page.waitForFunction(()=>{const c=document.querySelector('canvas');return c.dataset.detail&&c.dataset.beforeDetail;});
 const first=await page.locator('canvas').getAttribute('data-before-detail');const box=await page.getByTestId('viewport').boundingBox();
 await page.mouse.move(box.x+box.width*.3,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.3+60,box.y+box.height*.5+35,{steps:5});await page.mouse.up();
 await expect.poll(()=>page.locator('canvas').getAttribute('data-before-detail')).not.toBe(first);
 const regions=await page.evaluate(()=>[window.framesBefore.filter(f=>f.kind==='detail').at(-1),window.framesAfter.filter(f=>f.kind==='detail').at(-1)].map(f=>[f.x,f.y,f.width,f.height]));expect(regions[0]).toEqual(regions[1]);await expect(page.getByLabel('缩放比例')).toHaveText('100%');pass('true 1:1 before and after detail windows follow the same pan region');
 const detailPixels=await page.evaluate(async crop=>{
  const c=document.querySelector('canvas'),ref=document.createElement('canvas');ref.width=c.width;ref.height=c.height;const ctx=ref.getContext('2d'),dpr=devicePixelRatio,w=c.getBoundingClientRect().width,h=c.getBoundingClientRect().height;
  const f=window.framesAfter.filter(f=>f.kind==='fit').at(-1),area=crop||{x:0,y:0,width:1,height:1},tx=w/4-(area.x+area.width/2)*f.fullWidth/dpr+60,ty=h/2-(area.y+area.height/2)*f.fullHeight/dpr+35;
  ctx.scale(dpr,dpr);ctx.imageSmoothingEnabled=false;
  for(const [i,list] of [window.framesBefore,window.framesAfter].entries()){
   const frame=list.filter(f=>f.kind==='detail').at(-1),img=new Image();img.crossOrigin='anonymous';img.src=frame.url;await img.decode();
   ctx.drawImage(img,tx+frame.x/dpr+i*w/2,ty+frame.y/dpr,frame.width/dpr,frame.height/dpr);
  }
  let max=0;for(const x of [Math.floor(c.width/4),Math.floor(c.width*3/4)]){const y=Math.floor(c.height/2),a=c.getContext('2d').getImageData(x,y,16,16).data,b=ctx.getImageData(x,y,16,16).data;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));}return {maximumDifference:max,sampledPixels:512};
 },before.adjustments.crop);expect(detailPixels.maximumDifference).toBe(0);writeFileSync(join(out,'detail-pixels.json'),JSON.stringify(detailPixels,null,2));await page.screenshot({path:join(out,'detail.png')});pass('both 1:1 panes display the native detail pixels without stretching or a second color conversion');

 await page.getByRole('button',{name:'适屏',exact:true}).click();await view().selectOption('off');await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());const after=await save('after-comparison');expect(after.adjustments).toEqual(before.adjustments);expect(after.artProfile).toBe(before.artProfile);pass('view changes preserve the edit recipe and undo history');
 await page.getByRole('button',{name:'裁切 C',exact:true}).click();const handle=await page.getByTestId('crop-handle-se').boundingBox();await settle(async()=>{await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2-140,handle.y+handle.height/2-80,{steps:5});await page.mouse.up();});await page.keyboard.press('Enter');
 await settle(()=>page.getByRole('button',{name:'顺时针旋转 90 度',exact:true}).click());await view().selectOption('left-right');await ready();const dims=await page.evaluate(()=>[window.framesBefore.filter(f=>f.kind==='fit').at(-1),window.framesAfter.filter(f=>f.kind==='fit').at(-1)].map(f=>[f.fullWidth,f.fullHeight]));expect(dims[0]).toEqual(dims[1]);expect(dims[0][1]).toBeGreaterThan(dims[0][0]);pass('custom crop and rotation update both comparison images without changing the before tone');
 await expect.poll(()=>workers().length).toBe(1);process.kill(workers()[0],'SIGTERM');await expect(page.getByRole('alert')).toBeVisible();await view().selectOption('off');await expect(page.getByRole('alert')).toHaveCount(0);await expect.poll(()=>workers().length).toBe(0);await view().selectOption('left-right');await ready();await expect.poll(()=>workers().length).toBe(1);pass('comparison worker failure is visible and retry recovers without disturbing the current editing processor');
 const final=await save('final');expect(final.adjustments.crop.width).toBeLessThan(.85);expect(final.adjustments.crop.height).toBeLessThan(.85);const tiff=join(out,'desktop.tiff');rmSync(tiff,{force:true});await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},tiff);await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});await page.getByRole('button',{name:'关闭导出结果',exact:true}).click();pass('saving and TIFF16 export remain available during comparison');
 await open('build/samples/canon-r5.CR3');await expect(view()).toHaveValue('off');await expect(page.locator('canvas')).toHaveAttribute('data-before','');await expect.poll(()=>workers().length).toBe(0);pass('switching photographs clears old comparison frames and stops their processor');
 for(const [i,path] of sources.entries())expect(hash(path)).toBe(sourceHashes[i]);
 expect(errors).toEqual([]);await expect(page.getByRole('alert')).toHaveCount(0);
}catch(error){await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({packaged:!!process.env.CAPTRAW_APP,checks,errors,composites},null,2)+'\n');await closeElectron(app);}
