import {_electron as electron,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,cpSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),out=resolve('artifacts/workbench');mkdirSync(out,{recursive:true});
const executablePath=process.env.CAPTRAW_APP;
const app=await electron.launch({executablePath,args:executablePath?[]:[root]});
const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(String(e)));
const report={packaged:!!executablePath,checks:[],inputFeedbackMs:[],globalControlUpdateMs:[]};
const check=name=>{report.checks.push(name);console.log('PASS',name);};
async function frameCount(){return page.evaluate(()=>window.__frames.length);}
async function settle(action){const count=await frameCount();await action();await page.waitForFunction(n=>window.__frames.length>n,count);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function open(paths){await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},paths.map(p=>resolve(p)));await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function output(path){await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path);}
async function save(name='state'){const file=resolve(out,`${name}.captraw.json`);rmSync(file,{force:true});await output(file);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(file)).toBe(true);return JSON.parse(readFileSync(file,'utf8'));}
async function value(label,n){await settle(async()=>{await page.getByRole('spinbutton',{name:label,exact:true}).fill(String(n));await page.getByRole('spinbutton',{name:label,exact:true}).press('Tab');});}
async function hash(){return page.locator('canvas').evaluate(c=>{const data=c.toDataURL();let h=0;for(let i=0;i<data.length;i+=127)h=(h*31+data.charCodeAt(i))|0;return h;});}
async function stroke(from=[.35,.4],to=[.55,.55]){const b=await page.getByTestId('viewport').boundingBox();await settle(async()=>{await page.mouse.move(b.x+b.width*from[0],b.y+b.height*from[1]);await page.mouse.down();await page.mouse.move(b.x+b.width*to[0],b.y+b.height*to[1],{steps:8});await page.mouse.up();});}
try{
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].webContents.session.enableNetworkEmulation({offline:true});});
 await open(['build/samples/nikon-d850.NEF']);check('RAW opens while network is disabled');
 const baseline=await hash();
 writeFileSync(resolve(out,'baseline-canvas.png'),Buffer.from((await page.locator('canvas').evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
 writeFileSync(resolve(out,'baseline-preview.png'),readFileSync(await page.evaluate(()=>window.__frames.at(-1).file)));
 await value('曝光',.7);expect(await hash()).not.toBe(baseline);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());
 writeFileSync(resolve(out,'undo-canvas.png'),Buffer.from((await page.locator('canvas').evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
 writeFileSync(resolve(out,'undo-preview.png'),readFileSync(await page.evaluate(()=>window.__frames.at(-1).file)));
 expect(await hash()).toBe(baseline);
 await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('0.7');
 check('visible image, undo and redo follow adjustment state');
 await page.locator('canvas').click({position:{x:10,y:10}});
 await settle(()=>page.keyboard.press('Meta+z'));await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('0');
 await settle(()=>page.keyboard.press('Meta+Shift+z'));await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('0.7');check('macOS undo and redo keyboard shortcuts work');
 // Verify every global control through actual pixels, restoring the baseline between controls.
 for(const [label,n] of [['色温',8000],['色调',20],['对比度',30],['饱和度',30],['自然饱和度',30]]){
  const before=await hash(),start=performance.now();await value(label,n);report.globalControlUpdateMs.push({label,ms:performance.now()-start});expect(await hash(),label).not.toBe(before);await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());
 }
 check('white balance, tint, contrast, saturation and vibrance affect pixels');
 report.globalUpdateP95Ms=report.globalControlUpdateMs.map(x=>x.ms).sort((a,b)=>a-b).at(-1);expect(report.globalUpdateP95Ms).toBeLessThan(1000);
 await page.getByLabel('多点色调曲线').scrollIntoViewIfNeeded();const curve=await page.getByLabel('多点色调曲线').boundingBox();
 await settle(()=>page.mouse.click(curve.x+curve.width*.45,curve.y+curve.height*.35));
 expect((await save('curve')).adjustments.curve.length).toBe(3);check('tone curve controls reach the native recipe');
 const edited=await hash();const compare=page.getByRole('button',{name:'按住对比',exact:true});
 await settle(async()=>{await compare.hover();await page.mouse.down();});expect(await hash()).toBe(baseline);
 await settle(()=>page.mouse.up());expect(await hash()).toBe(edited);check('hold comparison restores initial rendering and then current edits');
 await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await settle(()=>page.getByRole('button',{name:'画笔',exact:true}).click());
 await stroke();const painted=await save('painted');expect(painted.adjustments.masks[0].components[0].points.length).toBeGreaterThan(2);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());expect((await save('undo-stroke')).adjustments.masks[0].components[0].points.length).toBe(0);
 await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());
 await page.getByRole('button',{name:'蒙版橡皮擦',exact:true}).click();await stroke();
 expect((await save('erased')).adjustments.masks[0].components[0].points.some(p=>p.erase)).toBe(true);check('one brush stroke is one history step; eraser persists in the native recipe');
 for(const name of ['线性','径向']){await settle(()=>page.getByRole('button',{name,exact:true}).click());await stroke([.3,.3],[.65,.65]);}
 await value('局部亮度',1);await value('局部对比度',15);await value('局部饱和度',20);await value('羽化',55);
 await settle(()=>page.getByRole('button',{name:'反选',exact:true}).click());
 await page.getByRole('textbox',{name:'蒙版名称'}).fill('树木 径向');await page.getByRole('textbox',{name:'蒙版名称'}).press('Tab');
 const allMasks=await save('all-masks');expect(allMasks.adjustments.masks.map(m=>m.type)).toEqual(['brush','linear','radial']);
 expect(allMasks.adjustments.masks[2].name).toBe('树木 径向');check('all mask types, local adjustments, rename, feather and inversion persist');
 await settle(()=>page.getByTitle('停用蒙版').last().click());await settle(()=>page.getByTitle('启用蒙版').click());
 await settle(()=>page.getByTitle('删除蒙版').click());expect((await save('deleted')).adjustments.masks.length).toBe(2);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());check('mask enable, delete and undo work');
 await page.getByRole('button',{name:'裁切 C',exact:true}).click();await stroke([.25,.25],[.7,.7]);await page.locator('.crop-actions').getByRole('button',{name:'完成',exact:true}).click();
 const crop=await save('crop');expect(crop.adjustments.crop.width).toBeLessThan(1);
 await settle(()=>page.getByRole('button',{name:'顺时针旋转 90 度',exact:true}).click());expect((await save('rotated')).adjustments.rotation).toBe(90);
 check('crop and rotation preserve the canonical image coordinates');
 await page.getByRole('button',{name:'1:1',exact:true}).click();
 await page.waitForFunction(()=>window.__frames.some(f=>f.kind==='detail'));
 const previous=await page.evaluate(()=>window.__frames.filter(f=>f.kind==='detail').at(-1).url);
 const b=await page.getByTestId('viewport').boundingBox();await page.getByRole('button',{name:'平移 H',exact:true}).click();
 await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.5+100,b.y+b.height*.5+70,{steps:6});await page.mouse.up();
 await page.waitForFunction(url=>window.__frames.filter(f=>f.kind==='detail').at(-1).url!==url,previous);check('1:1 panning receives a fresh native region');
 await page.getByTitle('适应窗口').click();
 await page.screenshot({path:resolve(out,'editing.png')});
 const durable=await save('durable');
 await open(['build/samples/canon-r5.CR3','build/samples/fuji-xt4.RAF']);await expect(page.locator('.film-item')).toHaveCount(3);
 await settle(()=>page.locator('.film-item').filter({hasText:'nikon-d850.NEF'}).click());
 expect((await save('returned')).adjustments).toEqual(durable.adjustments);check('three-camera session switches without losing edits');
 report.mainRSSKiB=Number(execFileSync('ps',['-p',String(app.process().pid),'-o','rss='],{encoding:'utf8'}).trim());
 // Terminate only the engine child owned by this app and exercise the visible recovery action.
 const pids=execFileSync('pgrep',['-P',String(app.process().pid)],{encoding:'utf8'}).trim().split(/\s+/);
 const pid=pids.find(pid=>execFileSync('ps',['-p',pid,'-o','comm='],{encoding:'utf8'}).includes('captraw-engine'));
 expect(pid).toBeTruthy();process.kill(Number(pid),'SIGKILL');await expect(page.getByRole('alert')).toContainText('退出');
 await settle(()=>page.getByRole('button',{name:'重新载入当前编辑'}).click());
 expect((await save('recovered')).adjustments).toEqual(durable.adjustments);check('engine crash is visible and retry preserves current edits');
 const cancelled=resolve(out,'cancelled.tiff');rmSync(cancelled,{force:true});await output(cancelled);
 await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:'TIFF · 16 位'}).click();
 await expect(page.getByRole('button',{name:'取消',exact:true})).toBeVisible();await page.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.locator('.job-toast.cancelled')).toBeVisible();expect(existsSync(cancelled)).toBe(false);check('cancelled export leaves no final output');
 const jpeg=resolve(out,'中文 空格.jpg');rmSync(jpeg,{force:true});await output(jpeg);await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('button',{name:/^JPEG/}).click();
 await expect(page.locator('.job-toast.done')).toBeVisible({timeout:60000});expect(existsSync(jpeg)).toBe(true);check('JPEG export accepts Chinese and spaces');
 await open([resolve(out,'durable.captraw.json')]);expect((await save('reopened')).adjustments).toEqual(durable.adjustments);check('saved document restores crop, masks and adjustments');
 const beforeFailure=await hash();
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},resolve('artifacts/native-acceptance/broken.NEF'));
 await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await hash()).toBe(beforeFailure);await settle(()=>page.getByRole('button',{name:'重新载入当前编辑'}).click());check('corrupt RAW reports an actionable error and current edits can be restored');
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 for(let i=0;i<8;i++){
  const input=page.getByRole('spinbutton',{name:'曝光',exact:true});await input.focus();
  const start=await page.evaluate(()=>performance.now());await input.press(i%2?'ArrowDown':'ArrowUp');
  const end=await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r(performance.now()))));report.inputFeedbackMs.push(end-start);
 }
 report.inputP95Ms=[...report.inputFeedbackMs].sort((a,b)=>a-b)[Math.ceil(report.inputFeedbackMs.length*.95)-1];expect(report.inputP95Ms).toBeLessThan(100);check('visible input feedback meets 100 ms target');
 const unicodeSource=resolve(out,'中文 原片.NEF');cpSync(resolve('build/samples/nikon-d850.NEF'),unicodeSource);
 await open([unicodeSource]);await expect(page.locator('.document-title')).toContainText('中文 原片.NEF');check('RAW path with Chinese and spaces opens');
 expect(errors).toEqual([]);report.errors=errors;await page.screenshot({path:resolve(out,'final.png')});
}catch(e){await page.screenshot({path:resolve(out,'failure.png')});console.error(await page.locator('body').innerText());throw e;}
finally{writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await app.close();}
