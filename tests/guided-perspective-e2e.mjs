import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {electron,closeElectron} from './electron-background.mjs';
import {readDocument} from './xmp-test.mjs';
import {EngineClient} from './engine-client.mjs';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(process.env.CAPTRAW_GUIDED_GUI_OUT||'artifacts/guided-perspective-gui');mkdirSync(root,{recursive:true});const out=mkdtempSync(join(root,'run-'));
const source=join(out,'引导 透视.png'),other=join(out,'另一张照片.png'),checks=[],errors=[],metrics=[];let app,page,failure,n=0;
function createFixture(path){execFileSync('build/qa-venv/bin/python',['-c',String.raw`
from PIL import Image,ImageDraw
import numpy as np,sys
a=Image.new('RGB',(1000,800),(100,100,100));d=ImageDraw.Draw(a)
for y in (235,565):d.line((100,y,900,y),fill=(240,20,20),width=6)
for x in (265,735):d.line((x,80,x,720),fill=(20,210,240),width=6)
dst=[(80,40),(920,90),(980,750),(20,790)];src=[(0,0),(1000,0),(1000,800),(0,800)];m=[];b=[]
for (x,y),(u,v) in zip(dst,src):m.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);b.extend([u,v])
a.transform(a.size,Image.Transform.PERSPECTIVE,np.linalg.solve(m,b),resample=Image.Resampling.BICUBIC,fillcolor=(100,100,100)).save(sys.argv[1])
`,path]);}
createFixture(source);copyFileSync(source,other);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),sourceHash=hash(source),button=name=>page.getByRole('button',{name,exact:true});
const pass=s=>{checks.push(s);console.log('PASS',s);},frame=()=>page.evaluate(()=>window.__guidedFrames.filter(f=>f.kind==='fit').at(-1));
async function ready(){await page.waitForFunction(()=>{const f=window.__guidedFrames.filter(f=>f.kind==='fit').at(-1);return f&&document.querySelector('canvas')?.dataset.frame===f.url&&!document.querySelector('.rendering');});}
async function settle(fn){const before=(await frame())?.url;await fn();await expect.poll(async()=>(await frame())?.url,{timeout:120000}).not.toBe(before);await ready();}
async function open(path){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>button('打开').click());}
async function save(name){const path=join(out,`${++n}-${name}.xmp`);await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await settle(()=>button('保存').click());await expect.poll(()=>existsSync(path)).toBe(true);return {path,doc:await readDocument(path),pixels:hash((await frame()).file)};}
async function panel(){await button('编辑').click();const summary=page.locator('.adjust-section > summary').filter({hasText:/^几何$/});await summary.scrollIntoViewIfNeeded();if(await summary.locator('..').getAttribute('open')===null)await summary.click();await button('引导透视').scrollIntoViewIfNeeded();}
const group=()=>page.getByRole('group',{name:'透视引导线',exact:true});
async function guidedReady(count){await ready();await expect(group().getByRole('status')).toContainText(`${count} / 4`);await expect(button('完成引导校正')).toBeEnabled();await expect(page.getByTestId('perspective-guide')).toHaveCount(count);}
async function start(){await button('引导透视').click();await expect(group().getByRole('status')).toContainText('/ 4');await expect(button('应用引导校正')).toHaveCount(0);}
async function finish(){await button('完成引导校正').click();await expect(group()).toHaveCount(0);await expect(page.getByTestId('perspective-guide')).toHaveCount(0);}
const calls=()=>app.evaluate(()=>globalThis.__guidedCalls.length);
const updates=()=>app.evaluate(()=>globalThis.__guidedUpdates);
async function sameDocument(name,expected){const actual=await save(name);assert.deepEqual(actual.doc.adjustments,expected.doc.adjustments,name);assert.equal(actual.pixels,expected.pixels,name);return actual;}
async function undoable(before,after,label){
 await settle(()=>button('撤销').click());await sameDocument(label+'-undo',before);
 await settle(()=>button('重做').click());await sameDocument(label+'-redo',after);
}
async function aligned(indices,label){
 const edges=await strokes(),residual=Math.max(...indices.map(i=>edges[i].axis==='horizontal'?Math.abs(edges[i].angle):90-Math.abs(edges[i].angle)));
 assert(residual<.25,JSON.stringify({label,indices,edges,residual}));metrics.push({label,indices:[...indices],residualDegrees:residual});
}
async function selected(index){await expect(group().getByRole('button',{name:new RegExp(`^${index+1} ·`)})).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId(`perspective-guide-${index}-0`)).toBeVisible();}

async function strokes(turned=false){return page.locator('canvas').evaluate((c,turned)=>{
 const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data,b=c.getBoundingClientRect(),result=[];
 for(let mode=0;mode<2;mode++)for(let side=0;side<2;side++){
  const points=[];let sx=0,sy=0,sxx=0,syy=0,sxy=0;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
   if((mode===0!==turned?y<c.height/2:x<c.width/2)!==!side)continue;
   const i=(y*c.width+x)*4,weight=mode?Math.min(a[i+1],a[i+2])-a[i]:a[i]-Math.max(a[i+1],a[i+2]);
   if(weight>80){points.push({x,y});sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;}
  }
  const n=points.length;if(n<100)throw Error('Missing colored edge');const x=sx/n,y=sy/n,angle=.5*Math.atan2(2*(sxy-sx*sy/n),sxx-sx*sx/n-syy+sy*sy/n),dx=Math.cos(angle),dy=Math.sin(angle);
  const t=points.map(p=>(p.x-x)*dx+(p.y-y)*dy).sort((a,b)=>a-b),end=q=>({x:b.x+(x+dx*q+.5)*b.width/c.width,y:b.y+(y+dy*q+.5)*b.height/c.height});
  result.push({start:end(t[Math.floor(n*.1)]),end:end(t[Math.floor(n*.9)]),angle:angle*180/Math.PI,axis:Math.abs(dx)>Math.abs(dy)?'horizontal':'vertical'});
 }return result;
},turned);}
async function draw(line,release=true){await page.mouse.move(line.start.x,line.start.y);await page.mouse.down();await expect(button('取消当前操作')).toBeVisible();await expect(button('完成引导校正')).toBeDisabled();await page.mouse.move(line.end.x,line.end.y,{steps:8});if(release){await page.mouse.up();await expect(page.getByRole('group',{name:'透视引导线',exact:true}).getByRole('status')).toContainText('/ 4');}}
async function guideResidual(turned=false,count=4){
 const edges=await strokes(turned),pairs=await page.getByTestId('perspective-guide').evaluateAll(gs=>gs.map(g=>Array.from(g.querySelectorAll('circle')).map(c=>{const b=c.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};}))),matched=new Set();let maximum=0;
 for(const pair of pairs){const errors=edges.map(e=>{const dx=e.end.x-e.start.x,dy=e.end.y-e.start.y;return Math.max(...pair.map(p=>Math.abs((p.x-e.start.x)*dy-(p.y-e.start.y)*dx)/Math.hypot(dx,dy)));}),error=Math.min(...errors),index=errors.indexOf(error);assert(error<1.5,JSON.stringify({error,errors}));assert(!matched.has(index));matched.add(index);maximum=Math.max(maximum,error);}
 assert.equal(matched.size,count);metrics.push({guideMaximumErrorCSSPx:maximum,turned,count});
}
async function launch(){
 app=await electron.launch({executablePath:process.env.CAPTRAW_APP});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluate(()=>{window.__guidedFrames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__guidedFrames.push(e.frame);});});
 await app.evaluate(({ipcMain,session})=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_r,done)=>done({cancel:true}));
  const real=ipcMain._invokeHandlers.get('image:auto-perspective'),update=ipcMain._invokeHandlers.get('image:update');
  globalThis.__guidedCalls=[];globalThis.__guidedUpdates=[];globalThis.__guidedFinished=0;
  ipcMain.removeHandler('image:update');ipcMain.handle('image:update',async(...args)=>{globalThis.__guidedUpdates.push(structuredClone(args[1]));return update(...args);});
  // Delay delivery only: every success and failure still comes from the real core.
  ipcMain.removeHandler('image:auto-perspective');ipcMain.handle('image:auto-perspective',async(...args)=>{
   const call={request:structuredClone(args[1])},hold=globalThis.__holdGuided;globalThis.__guidedCalls.push(call);
   try{const result=await real(...args);call.result=result;if(hold){globalThis.__guidedHeld=true;await new Promise(resolve=>globalThis.__releaseGuided=resolve);}return result;}
   catch(e){call.error=String(e);throw e;}finally{globalThis.__guidedFinished++;}
  });
 });
}
async function hold(fn){await app.evaluate(()=>{globalThis.__holdGuided=true;globalThis.__guidedHeld=false;});await fn();await expect.poll(()=>app.evaluate(()=>globalThis.__guidedHeld),{timeout:120000}).toBe(true);await expect(button('取消当前操作')).toBeVisible();}
async function release(){
 const n=await app.evaluate(()=>globalThis.__guidedFinished);await app.evaluate(()=>{globalThis.__holdGuided=false;globalThis.__releaseGuided();});await expect.poll(()=>app.evaluate(()=>globalThis.__guidedFinished)).toBe(n+1);
 // A renderer task after the IPC reply drains the promise continuation before checking for stale writes.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function protect(label){
 const forbidden=join(out,`must-not-save-${label}.xmp`);
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});globalThis.__closePrompts=0;dialog.showMessageBox=async()=>{globalThis.__closePrompts++;return {response:0};};},forbidden);
 await page.keyboard.press('Meta+s');await expect(page.getByRole('alert')).toContainText('尚未完成');assert(!existsSync(forbidden));await button('关闭错误').focus();await button('关闭错误').press('Enter');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await expect.poll(()=>app.evaluate(()=>globalThis.__closePrompts)).toBe(1);await expect(page.getByTestId('viewport')).toBeVisible();
}
async function moveEndpoint(index=0){
 const b=await page.getByTestId(`perspective-guide-${index}-0`).boundingBox(),e=await page.getByTestId(`perspective-guide-${index}-1`).boundingBox();assert(b&&e);
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move((b.x+b.width/2+e.x+e.width/2)/2,(b.y+b.height/2+e.y+e.height/2)/2,{steps:6});await page.mouse.up();
}
try{
 await launch();await expect(page.getByRole('img',{name:'CaptRAW 标志'})).toBeVisible();await expect.poll(()=>page.getByRole('img',{name:'CaptRAW 标志'}).evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 await open(source);await panel();const original=await save('original');await start();const initial=await strokes();
 await page.mouse.click(initial[0].start.x,initial[0].start.y);await expect(page.getByTestId('perspective-guide')).toHaveCount(0);await sameDocument('click-only',original);
 await draw(initial[0],false);await protect('stroke');await page.keyboard.press('Escape');await page.mouse.up();await expect(group()).toHaveCount(0);await sameDocument('cancelled-stroke',original);
 pass('click-only saves unchanged; unfinished stroke protects save and native close; Escape before mouse-up discards it');

 let final;
 // Each stroke uses pixels from the new frame, never obsolete pre-correction endpoints.
 for(const order of [[0,1,2,3],[2,3,0,1],[0,2,1,3]]){
  await open(original.path);await panel();await start();let before=original;const history=[original],chosen=[];
  for(const index of order){
   const count=chosen.length+1,total=await calls();chosen.push(index);
   const h=chosen.filter(i=>i<2).length,v=count-h,solves=Math.max(h,v)>=2;
   await settle(async()=>{
    const edge=(await strokes())[index];
    if(order[1]===1&&count===1){await expect(button('撤销')).toBeDisabled();await draw(edge,false);await page.keyboard.press('Meta+z');await expect(button('完成引导校正')).toBeDisabled();await page.mouse.up();}
    else await draw(edge);
   });await guidedReady(count);await selected(count-1);
   assert.equal(await calls(),total+Number(solves),'Only solvable line combinations invoke the core');
   await guideResidual(false,count);if(solves)await aligned(chosen,`automatic-${order.join('')}-${count}`);
   const current=await save(`step-${order.join('')}-${count}`);assert.equal(current.doc.adjustments.perspectiveGuides.length,count);
   for(const guide of current.doc.adjustments.perspectiveGuides)for(const point of [guide.start,guide.end])assert(point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1,'Source anchors must be normalized');
   if(!solves){assert.deepEqual(current.doc.adjustments.perspective,before.doc.adjustments.perspective);assert.equal(current.pixels,before.pixels);}
   await undoable(before,current,`stroke-${order.join('')}-${count}`);await guidedReady(count);history.push(current);before=current;
  }
  await page.screenshot({path:join(out,`automatic-${order.join('')}.png`)});
  for(let i=3;i>=0;i--){await settle(()=>button('撤销').click());await sameDocument(`history-${order.join('')}-${i}`,history[i]);}
  await expect(button('撤销')).toBeDisabled();
  for(let i=1;i<=4;i++){await settle(()=>button('重做').click());await sameDocument(`history-redo-${order.join('')}-${i}`,history[i]);}
  await expect(button('重做')).toBeDisabled();await finish();await sameDocument('finished-'+order.join(''),before);
  if(order[1]===1)final=before;
 }
 pass('first/1H1V anchors save without solve; second same-axis, both mixed thirds and fourth paired strokes auto-solve below 0.25 degrees and stay mapped/selected');
 pass('empty-history Command-Z during the first held stroke does not invalidate it; each completed stroke creates exactly one undoable source-plus-correction entry; Finish adds no edit');
 assert(final);

 await open(final.path);await panel();await start();const total=await calls();await settle(()=>moveEndpoint());await guidedReady(4);await selected(0);assert.equal(await calls(),total+1);await guideResidual();await aligned([0,1,2,3],'endpoint');
 const moved=await save('moved');assert.notDeepEqual(moved.doc.adjustments.perspectiveGuides[0].start,final.doc.adjustments.perspectiveGuides[0].start);assert.deepEqual(moved.doc.adjustments.perspectiveGuides.slice(1),final.doc.adjustments.perspectiveGuides.slice(1));await undoable(final,moved,'endpoint');
 await page.keyboard.press('Escape');await expect(group()).toHaveCount(0);await sameDocument('escape-completed',moved);
 await start();await draw((await strokes())[1],false);await page.keyboard.press('Escape');await page.mouse.up();await sameDocument('escape-later-stroke',moved);
 pass('endpoint mouse-up automatically solves one edit; Escape preserves every earlier completed edit while dropping an unfinished stroke');

 // Hold genuine successful results after solving to exercise all invalidation paths.
 for(const action of ['escape','cancel','photo','tool','settings']){
  await open(final.path);await panel();await start();await hold(()=>moveEndpoint());
  const beforeUpdates=await updates();let expected=final;
  if(action==='escape'){await protect('solver');await page.keyboard.press('Escape');await expect(group()).toHaveCount(0);}
  if(action==='cancel'){await button('取消当前操作').click();await expect(group()).toHaveCount(0);}
  if(action==='photo'){await open(other);expected=await save('other-before-late');assert.equal(expected.doc.adjustments.perspectiveGuides,undefined);}
  if(action==='tool'){await button('蒙版 M').click();await expect(group()).toHaveCount(0);}
  if(action==='settings'){
   const input=page.getByRole('spinbutton',{name:'垂直透视',exact:true});await settle(async()=>{await input.fill('10');await input.press('Tab');});expected=await save('manual-before-late');assert.equal(expected.doc.adjustments.perspective.vertical,10);
  }
  const committed=await updates();await release();assert.deepEqual(await updates(),committed,'A stale reply must not request another document render');
  if(action==='escape'||action==='cancel'||action==='tool')assert.deepEqual(committed,beforeUpdates);
  await sameDocument('late-'+action,expected);await panel();
 }
 pass('drawing/solver protect save and close; Escape, Cancel, photo/tool/settings changes reject delayed real results');

 // These shallow-looking horizontal strokes require an unsupported >20 degree correction.
 // Their genuine core rejection must retain editable draft anchors, never a partial edit.
 await open(original.path);await panel();await start();
 const box=await page.locator('canvas').evaluate(c=>{
  const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data,b=c.getBoundingClientRect();let left=c.width,top=c.height,right=-1,bottom=-1;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<left||bottom<top)throw Error('No painted image pixels');
  return {x:b.x+left*b.width/c.width,y:b.y+top*b.height/c.height,width:(right-left+1)*b.width/c.width,height:(bottom-top+1)*b.height/c.height};
 }),point=(x,y)=>({x:box.x+x*box.width/1000,y:box.y+y*box.height/800});
 const steep=[{start:point(150,100),end:point(650,450)},{start:point(150,300),end:point(650,650)}];
 for(const line of steep)for(const p of [line.start,line.end])assert(p.x>box.x&&p.x<box.x+box.width&&p.y>box.y&&p.y<box.y+box.height,'Failure fixture endpoints must lie inside the painted image');
 await settle(()=>draw(steep[0]));await guidedReady(1);const firstSteep=await save('steep-first'),committed=await updates(),failedFrame=(await frame()).url;
 await draw(steep[1]);await expect(button('重试引导校正')).toBeVisible({timeout:120000});await expect(page.getByTestId('perspective-guide')).toHaveCount(2);await selected(1);
 const failures=await app.evaluate(()=>globalThis.__guidedCalls.filter(c=>c.error));assert(failures.length>0);assert.match(failures.at(-1).error,/[\u4e00-\u9fff]/);assert.deepEqual(await updates(),committed);assert.equal((await frame()).url,failedFrame);assert.equal(hash((await frame()).file),firstSteep.pixels);
 const draft=await page.getByTestId('perspective-guide').evaluateAll(gs=>gs.map(g=>g.innerHTML)),attempts=await calls();await button('重试引导校正').click();await expect.poll(()=>calls()).toBe(attempts+1);await expect(button('重试引导校正')).toBeVisible({timeout:120000});
 assert.deepEqual(await page.getByTestId('perspective-guide').evaluateAll(gs=>gs.map(g=>g.innerHTML)),draft);assert.deepEqual(await updates(),committed);
 await page.screenshot({path:join(out,'failed-retry.png')});await page.keyboard.press('Escape');await expect(group()).toHaveCount(0);await sameDocument('failed-escape',firstSteep);
 await start();await guidedReady(1);await draw(steep[1]);await expect(button('重试引导校正')).toBeVisible({timeout:120000});await button('取消当前操作').click();await expect(group()).toHaveCount(0);await sameDocument('failed-cancel',firstSteep);
 await settle(()=>button('撤销').click());await sameDocument('failed-no-history',original);await expect(button('撤销')).toBeDisabled();
 pass('real failed solve leaves document/pixels/history unchanged, retains draft anchors for retry, and Escape/Cancel drop only the failed step');

 await open(final.path);await panel();await closeElectron(app);app=undefined;await launch();await open(final.path);await panel();await start();await guidedReady(4);await guideResidual();assert.equal(hash((await frame()).file),final.pixels);await finish();await sameDocument('reopened',final);
 pass('full application restart restores exact XMP guide anchors, settings and preview');

 await start();let before=final;const deletions=[final];
 // Delete one H, then one V: three guides solve, 1H1V/one/zero save only metadata.
 for(const index of [0,1,0,0]){
  const guides=before.doc.adjustments.perspectiveGuides,remaining=guides.filter((_,i)=>i!==index),h=remaining.filter(g=>g.axis==='horizontal').length,v=remaining.length-h,solves=Math.max(h,v)>=2,total=await calls();
  await group().getByRole('button',{name:new RegExp(`^${index+1} ·`)}).click();await settle(()=>button('删除引导线').click());await guidedReady(remaining.length);assert.equal(await calls(),total+Number(solves));
  const current=await save('delete-'+remaining.length);assert.deepEqual(current.doc.adjustments.perspectiveGuides,remaining);
  if(solves){await guideResidual(false,remaining.length);await aligned([1,2,3],'delete-three');}
  else{assert.deepEqual(current.doc.adjustments.perspective,before.doc.adjustments.perspective);assert.equal(current.pixels,before.pixels);}
  await undoable(before,current,'delete-'+remaining.length);deletions.push(current);before=current;
 }
 assert.deepEqual(before.doc.adjustments.perspectiveGuides,[]);await finish();await sameDocument('cleared-finished',before);
 for(let i=3;i>=0;i--){await settle(()=>button('撤销').click());await sameDocument('delete-history-'+i,deletions[i]);}await expect(button('撤销')).toBeDisabled();
 pass('deletion auto-solves three anchors; insufficient/empty sets preserve current perspective and pixels; each deletion is one undoable metadata edit');

 await settle(()=>button('顺时针旋转 90 度').click());await start();await expect(button('1 · 垂直')).toBeVisible();await expect(button('3 · 水平')).toBeVisible();await button('1:1').click();await page.waitForFunction(()=>!!document.querySelector('canvas').dataset.detail);
 const v=await page.getByTestId('viewport').boundingBox();await page.keyboard.down('Space');await page.mouse.move(v.x+v.width/2,v.y+v.height/2);await page.mouse.down();await page.mouse.move(v.x+v.width/2+20,v.y+v.height/2+15,{steps:5});await page.mouse.up();await page.keyboard.up('Space');await expect(page.getByTestId('perspective-guide')).toHaveCount(4);await guideResidual(true);await page.screenshot({path:join(out,'guides-1to1.png')});await finish();await button('适屏').click();await settle(()=>button('撤销').click());await sameDocument('rotation-undo',final);
 pass('coarse rotation swaps axes; guides remain aligned with real pixels at physical 1:1 after Space-pan');
 const output=join(out,'desktop.tiff');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);await button('导出').click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:120000});
 const old='/Users/he0xd4c0/Applications/CaptRAW-0.53.app/Contents/Resources/native',reference=new EngineClient({executable:join(old,'captraw-engine'),resources:join(old,'resources'),cache:join(out,'reference')});try{await reference.call('export',{path:source,artProfile:final.doc.artProfile,format:'tiff',output:join(out,'reference.tiff')});}finally{await reference.stop();}
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np,sys,json\na,b=[tifffile.imread(p) for p in sys.argv[1:3]]\nassert a.dtype==b.dtype==np.uint16 and np.array_equal(a,b)\nwith tifffile.TiffFile(sys.argv[1]) as x,tifffile.TiffFile(sys.argv[2]) as y: icc=x.pages[0].tags[34675].value;assert icc==y.pages[0].tags[34675].value\nopen(sys.argv[3],'w').write(json.dumps(dict(shape=list(a.shape),maximumDifference=0,iccBytes=len(icc))))`,output,join(out,'reference.tiff'),join(out,'pixels.json')]);pass('guided TIFF16 and ICC exactly match independent installed 0.53 fixed-profile output');
 await button('关闭导出结果').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720));await panel();await start();await button('完成引导校正').scrollIntoViewIfNeeded();for(const name of ['删除引导线','完成引导校正'])await expect(button(name)).toBeInViewport({ratio:1});await page.screenshot({path:join(out,'minimum-window.png')});await hold(()=>moveEndpoint());await button('取消当前操作').scrollIntoViewIfNeeded();await expect(button('取消当前操作')).toBeInViewport({ratio:1});await button('取消当前操作').click();await release();await sameDocument('minimum-cancel',final);await start();await button('蒙版 M').click();await expect(page.getByTestId('perspective-guide')).toHaveCount(0);
 pass('minimum-window Finish/Delete and pending Cancel buttons are reachable; leaving edit mode hides all guides');
 assert.equal(hash(source),sourceHash);assert.deepEqual(errors,[]);
}catch(e){failure=e.stack;if(app)writeFileSync(join(out,'failure-trace.json'),JSON.stringify(await app.evaluate(()=>({calls:globalThis.__guidedCalls,updates:globalThis.__guidedUpdates})),null,2));if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw e;}finally{if(app)await closeElectron(app);rmSync(join(out,'reference'),{recursive:true,force:true});writeFileSync(join(out,'report.json'),JSON.stringify({passed:!failure&&!errors.length,checks,metrics,errors,failure,executablePath:process.env.CAPTRAW_APP||null,httpBlocked:true},null,2)+'\n');console.log('REPORT',join(out,'report.json'));}
