import {expect} from '@playwright/test';
import {electron,closeElectron} from './electron-background.mjs';
import {resolve,join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const out=resolve(process.env.CAPTRAW_WIDE_GUI_OUT||'artifacts/wide-detail-gui');mkdirSync(out,{recursive:true});
const source=resolve('build/samples/nikon-d850.NEF'),hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash(),checks=[],errors=[],regions=[];
const app=await electron.launch(),page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(String(e)));const pass=s=>{checks.push(s);console.log('PASS',s);};
async function idle(){await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.framesAfter.filter(f=>f.kind==='fit').at(-1)?.url);}
async function settle(fn){const n=await page.evaluate(()=>window.framesAfter.length);await fn();await page.waitForFunction(n=>window.framesAfter.length>n,n);await idle();}
async function detail(mode,pan={x:0,y:0}){
 await page.waitForFunction(({mode,pan})=>{
  const c=document.querySelector('canvas'),f=window.framesAfter.filter(f=>f.kind==='fit').at(-1);if(!f||c.dataset.layout!==mode)return false;
  const b=c.getBoundingClientRect(),pw=mode==='left-right'?b.width/2:b.width,ph=mode==='top-bottom'?b.height/2:b.height,dpr=devicePixelRatio;
  const left=(f.fullWidth-pw*dpr)/2-pan.x*dpr,top=(f.fullHeight-ph*dpr)/2-pan.y*dpr,x=Math.floor(Math.max(0,left)),y=Math.floor(Math.max(0,top)),width=Math.ceil(Math.min(f.fullWidth,left+pw*dpr))-x,height=Math.ceil(Math.min(f.fullHeight,top+ph*dpr))-y;
  const matches=(list,url)=>{const f=list.filter(f=>f.kind==='detail').at(-1);return f&&url===f.url&&f.x===x&&f.y===y&&f.width===width&&f.height===height;};
  return matches(window.framesAfter,c.dataset.detail)&&(mode==='off'||matches(window.framesBefore,c.dataset.beforeDetail));
 },{mode,pan});
 const result=await page.evaluate(async({mode,pan})=>{
  const c=document.querySelector('canvas'),ref=window.reference||document.createElement('canvas');window.reference=ref;ref.width=c.width;ref.height=c.height;const ctx=ref.getContext('2d'),b=c.getBoundingClientRect(),dpr=devicePixelRatio,pw=mode==='left-right'?b.width/2:b.width,ph=mode==='top-bottom'?b.height/2:b.height;
  const frames=mode==='off'?[window.framesAfter.filter(f=>f.kind==='detail').at(-1)]:[window.framesBefore.filter(f=>f.kind==='detail').at(-1),window.framesAfter.filter(f=>f.kind==='detail').at(-1)];
  for(const [i,f] of frames.entries()){
   const img=new Image();img.crossOrigin='anonymous';img.src=f.url;await img.decode();ctx.save();ctx.imageSmoothingEnabled=false;
   if(mode!=='off'){const horizontal=mode==='top-bottom'||mode==='split-horizontal';ctx.beginPath();ctx.rect(horizontal?0:i*c.width/2,horizontal?i*c.height/2:0,horizontal?c.width:c.width/2,horizontal?c.height/2:c.height);ctx.clip();}
   const offsetX=i&&mode==='left-right'?b.width/2:0,offsetY=i&&mode==='top-bottom'?b.height/2:0;
   ctx.drawImage(img,(pw/2+pan.x+offsetX)*dpr-f.fullWidth/2+f.x,(ph/2+pan.y+offsetY)*dpr-f.fullHeight/2+f.y);ctx.restore();
  }
  const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data,expected=ctx.getImageData(0,0,c.width,c.height).data;let max=0,count=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-expected[i]);max=Math.max(max,d);if(d)count++;}
  return {mode,pan,canvas:[c.width,c.height],frames:frames.map(f=>({x:f.x,y:f.y,width:f.width,height:f.height})),maximumDifference:max,differentSamples:count,...(max?{actualPNG:c.toDataURL(),expectedPNG:ref.toDataURL(),frame:frames[0]}:{})};
 },{mode,pan});if(result.actualPNG){writeFileSync(join(out,'actual.png'),Buffer.from(result.actualPNG.split(',')[1],'base64'));writeFileSync(join(out,'expected.png'),Buffer.from(result.expectedPNG.split(',')[1],'base64'));delete result.actualPNG;delete result.expectedPNG;}regions.push(result);expect(result.maximumDifference).toBe(0);expect(result.frames[0].width>2048||result.frames[0].height>2048).toBe(true);return result;
}
try{
 await page.evaluate(()=>{window.framesAfter=[];window.framesBefore=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.framesAfter.push(e.frame);if(e.event==='comparison-preview')window.framesBefore.push(e.frame);});});
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());
 await page.getByRole('button',{name:'裁切 C',exact:true}).click();await settle(()=>page.getByRole('button',{name:'清除裁切',exact:true}).click());await page.keyboard.press('Enter');
 await settle(async()=>{const c=page.getByRole('spinbutton',{name:'曝光',exact:true});await c.fill('0.7');await c.press('Tab');});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(2400,1800));await expect.poll(()=>page.locator('canvas').evaluate(c=>c.width)).toBeGreaterThan(2048);
 await page.getByRole('button',{name:'1:1',exact:true}).click();await detail('off');pass('large single-image 1:1 covers every canvas pixel with native detail, including beyond 2048');
 for(const mode of ['left-right','top-bottom','split-vertical','split-horizontal']){await page.getByRole('combobox',{name:'前后对比视图'}).selectOption(mode);await detail(mode);pass(mode+' both panes cover the whole visible image with native full-resolution regions');}
 await page.screenshot({path:join(out,'large-comparison.png')});
 const bounds=await page.getByTestId('viewport').boundingBox();await page.mouse.move(bounds.x+bounds.width*.3,bounds.y+bounds.height*.4);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.3+71,bounds.y+bounds.height*.4-43,{steps:5});await page.mouse.up();await detail('split-horizontal',{x:71,y:-43});pass('panning both panes refreshes the full visible area without stale low-resolution edges');
 await page.getByRole('combobox',{name:'前后对比视图'}).selectOption('off');await page.getByRole('button',{name:'适屏',exact:true}).click();await expect(page.locator('canvas')).toHaveAttribute('data-detail','');await expect(page.locator('canvas')).toHaveAttribute('data-before-detail','');pass('returning to fit clears detail overlays');
 expect(hash()).toBe(before);expect(errors).toEqual([]);await expect(page.getByRole('alert')).toHaveCount(0);
}catch(error){await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({packaged:!!process.env.CAPTRAW_APP,checks,errors,regions,sourceUnchanged:hash()===before},null,2)+'\n');await closeElectron(app);}
