import {expect} from '@playwright/test';
import {electron,closeElectron} from './electron-background.mjs';
import {readDocument} from './xmp-test.mjs';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';

const out=resolve(process.env.CAPTRAW_WB_OPTICS_GUI_OUT||'artifacts/wb-optics-gui');mkdirSync(out,{recursive:true});
const app=await electron.launch(),page=await app.firstWindow(),checks=[],errors=[];
page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(String(error)));
const passed=name=>{checks.push(name);console.log('PASS',name);};
async function settle(action){
 const n=await page.evaluate(()=>window.__frames.length);await action();
 await page.waitForFunction(n=>window.__frames.length>n,n);
 await page.locator('.rendering').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind==='fit').at(-1)?.url);
}
async function save(name){
 const path=join(out,name+'.xmp');rmSync(path,{force:true});
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);
 return readDocument(path);
}
async function open(path){
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},resolve(path));
 await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());
}
async function pick(crop=null,actual=false){
 await page.getByRole('button',{name:'白平衡 I',exact:true}).click();
 await page.getByRole('combobox',{name:'取样大小'}).selectOption('5');
 const target=await page.evaluate(async()=>{
  const frame=window.__frames.filter(f=>f.kind==='fit').at(-1),image=new Image();image.crossOrigin='anonymous';image.src=frame.url;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const data=ctx.getImageData(0,0,image.width,image.height).data;let sx=0,sy=0,n=0;
  for(let y=0;y<150;y++)for(let x=0;x<150;x++){const i=(y*image.width+x)*4;if(data[i+2]>data[i]+30){sx+=x;sy+=y;n++;}}
  if(n<4)throw new Error('Rendered blue target is missing');
  return {x:(sx/n+.5)/image.width,y:(sy/n+.5)/image.height,width:frame.fullWidth,height:frame.fullHeight,dpr:devicePixelRatio};
 });
 const b=await page.getByTestId('viewport').boundingBox(),c=crop||{x:0,y:0,width:1,height:1};
 const scale=actual?1/target.dpr:Math.min((b.width-64)/(target.width*c.width),(b.height-64)/(target.height*c.height));
 const x=b.x+b.width/2+(target.x-c.x-c.width/2)*target.width*scale,y=b.y+b.height/2+(target.y-c.y-c.height/2)*target.height*scale;
 expect(x).toBeGreaterThan(b.x);expect(y).toBeGreaterThan(b.y);expect(x).toBeLessThan(b.x+b.width);expect(y).toBeLessThan(b.y+b.height);
 await settle(()=>page.mouse.click(x,y));await page.keyboard.press('Escape');
}
try{
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 for(const file of ['wb-optics.png','wb-optics.dng']){
  await open('build/samples/'+file);await pick();const reference=(await save(file+'-reference')).adjustments.wbMultipliers;
  await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());
  const optics=page.locator('details.adjust-section').filter({has:page.locator('summary',{hasText:'光学'})});
  if(await optics.getAttribute('open')===null)await optics.locator('summary').click();
  await settle(()=>page.getByRole('checkbox',{name:'启用镜头配置文件校正',exact:true}).check());
  // Vignetting changes RAW sample intensity; isolate the geometric corrections.
  await settle(()=>page.getByRole('checkbox',{name:'暗角校正',exact:true}).uncheck());
  await expect(page.getByRole('checkbox',{name:'畸变校正',exact:true})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'色差校正',exact:true})).toBeChecked();
  for(const rotation of [0,90,180,270]){
   if(rotation)await settle(()=>page.getByRole('button',{name:'顺时针旋转 90 度',exact:true}).click());
   await pick();const sampled=await save(file+'-'+rotation);
   expect(sampled.adjustments.wbMultipliers).toEqual(reference);
   await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());
   passed(`${file}: visible corrected target at ${rotation} degrees matches the uncorrected WB sample`);
  }
  await settle(()=>page.getByRole('button',{name:'顺时针旋转 90 度',exact:true}).click());
  await page.getByRole('button',{name:'裁切 C',exact:true}).click();
  const box=await page.getByTestId('viewport').boundingBox(),frame=await page.evaluate(()=>window.__frames.filter(f=>f.kind==='fit').at(-1));
  const scale=Math.min((box.width-64)/frame.fullWidth,(box.height-64)/frame.fullHeight);
  await settle(async()=>{
   await page.mouse.move(box.x+box.width/2-.48*frame.fullWidth*scale,box.y+box.height/2-.48*frame.fullHeight*scale);await page.mouse.down();
   await page.mouse.move(box.x+box.width/2+.48*frame.fullWidth*scale,box.y+box.height/2+.48*frame.fullHeight*scale,{steps:8});await page.mouse.up();
  });
  await page.keyboard.press('Enter');const cropped=await save(file+'-crop');expect(cropped.adjustments.crop.width).toBeLessThan(1);
  await pick(cropped.adjustments.crop);expect((await save(file+'-cropped-sample')).adjustments.wbMultipliers).toEqual(reference);
  await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());
  await page.getByRole('button',{name:'1:1',exact:true}).click();await page.waitForFunction(()=>{
   const fit=window.__frames.filter(f=>f.kind==='fit').at(-1),detail=window.__frames.filter(f=>f.kind==='detail'&&f.sessionId===fit.sessionId&&f.revision===fit.revision).at(-1);
   return detail&&document.querySelector('canvas').dataset.detail===detail.url;
  });
  await pick(cropped.adjustments.crop,true);const saved=await save(file+'-detail-sample');expect(saved.adjustments.wbMultipliers).toEqual(reference);
  await page.screenshot({path:join(out,file+'-sampled.png')});
  await open(join(out,file+'-detail-sample.xmp'));expect((await save(file+'-restored')).adjustments).toEqual(saved.adjustments);
  await page.getByRole('button',{name:'适屏',exact:true}).click();
  passed(`${file}: cropped fit and physical 1:1 picker, undo and XMP reopen preserve the same coefficients`);
 }
 expect(errors).toEqual([]);
}catch(error){await page.screenshot({path:join(out,'failure.png')});throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify({packaged:!!process.env.CAPTRAW_APP,backgroundWindow:true,checks,errors},null,2)+'\n');await closeElectron(app);}
