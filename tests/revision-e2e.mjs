import {_electron as electron,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
const out=resolve('artifacts/revision');mkdirSync(out,{recursive:true});
const executablePath=process.env.CAPTRAW_APP,app=await electron.launch({executablePath,args:executablePath?[]:[process.cwd()]});
const page=await app.firstWindow();page.setDefaultTimeout(20000);const errors=[],checks=[];page.on('pageerror',e=>errors.push(String(e)));
const passed=name=>{checks.push(name);console.log('PASS',name);};
const openFile=process.env.CAPTRAW_TEST_RAW||resolve('build/samples/nikon-d850.NEF');
async function frames(){return page.evaluate(()=>window.__frames.length);}
async function settle(action){const count=await frames();await action();await page.waitForFunction(n=>window.__frames.length>n,count);await page.locator('.rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('canvas').dataset.frame===window.__frames.filter(f=>f.kind!=='detail').at(-1)?.url);}
async function dialog(response){await app.evaluate(({dialog},response)=>{dialog.showMessageBox=async()=>({response});},response);}
async function open(path=openFile){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function save(name){const path=resolve(out,name+'.captraw.json');rmSync(path,{force:true});await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},path);await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>existsSync(path)).toBe(true);return JSON.parse(readFileSync(path,'utf8'));}
async function draw(from,to){const b=await page.getByTestId('viewport').boundingBox();await settle(async()=>{await page.mouse.move(b.x+b.width*from[0],b.y+b.height*from[1]);await page.mouse.down();await page.mouse.move(b.x+b.width*to[0],b.y+b.height*to[1],{steps:6});await page.mouse.up();});}
try{
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});await open();
 await expect(page.getByRole('img',{name:'RGB 直方图'})).toBeVisible();
 await expect(page.getByRole('button',{name:'画笔蒙版 K',exact:true})).toHaveCount(0);passed('edit mode hides mask tools');
 const curve=page.getByLabel('多点色调曲线');await curve.scrollIntoViewIfNeeded();
 for(const [x,y] of [[.23,.3],[.48,.68],[.78,.84]]){const b=await curve.boundingBox();await settle(()=>page.mouse.click(b.x+b.width*x,b.y+b.height*(1-y)));}
 const recipe=await save('multi-point');expect(recipe.adjustments.curve).toHaveLength(5);expect(await page.getByTestId('curve-path').getAttribute('d')).toContain('L');
 await expect(page.getByRole('spinbutton',{name:'曲线输入',exact:true})).toBeVisible();passed('multiple independent curve points persist with a sampled spline');
 await page.getByRole('button',{name:'蒙版 M',exact:true}).click();await settle(()=>page.getByRole('button',{name:'径向',exact:true}).click());
 await draw([.2,.2],[.6,.75]);
 await expect(page.getByTestId('mask-coverage')).toBeVisible();
 expect(await page.getByTestId('mask-coverage').getAttribute('href')).toBe(await page.evaluate(()=>window.__frames.filter(f=>f.kind==='fit').at(-1).mask.url));
 await page.keyboard.press('y');await expect(page.getByTestId('mask-coverage')).toHaveCount(0);
 await settle(()=>page.keyboard.press('y'));await expect(page.getByTestId('mask-coverage')).toBeVisible();passed('overlay displays native group coverage and Y toggles it');
 const originalShape=(await save('before-move')).adjustments.masks[0].components[0];
 const center=await page.getByTestId('mask-move-handle').boundingBox();
 await settle(async()=>{await page.mouse.move(center.x+center.width/2,center.y+center.height/2);await page.mouse.down();await page.mouse.move(center.x+center.width/2+30,center.y+center.height/2-20,{steps:6});await page.mouse.up();});
 const moved=(await save('after-move')).adjustments.masks[0].components[0];
 expect(moved.start.x).toBeGreaterThan(originalShape.start.x);expect(moved.start.y).toBeLessThan(originalShape.start.y);
 expect(moved.end.x-moved.start.x).toBeCloseTo(originalShape.end.x-originalShape.start.x,8);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());
 expect((await save('undo-move')).adjustments.masks[0].components[0]).toEqual(originalShape);
 const endHandle=await page.getByTestId('mask-end-handle').boundingBox();
 await settle(async()=>{await page.mouse.move(endHandle.x+endHandle.width/2,endHandle.y+endHandle.height/2);await page.mouse.down();await page.mouse.move(endHandle.x+endHandle.width/2+25,endHandle.y+endHandle.height/2-15,{steps:5});await page.mouse.up();});
 const resized=(await save('after-resize')).adjustments.masks[0].components[0];expect(resized.start).toEqual(originalShape.start);expect(resized.end.x).toBeGreaterThan(originalShape.end.x);
 passed('mask center and endpoint handles move, resize and undo without redrawing');
 await page.getByRole('combobox',{name:'组件运算'}).selectOption('subtract');await settle(()=>page.getByRole('button',{name:'减去径向',exact:true}).click());await draw([.4,.3],[.75,.65]);
 await page.getByRole('combobox',{name:'组件运算'}).selectOption('intersect');await settle(()=>page.getByRole('button',{name:'相交线性',exact:true}).click());await draw([.3,.3],[.65,.7]);
 await settle(()=>page.getByTitle('显示或隐藏组件').click());await expect(page.getByTestId('mask-move-handle')).toHaveCount(0);
 await settle(()=>page.getByTitle('显示或隐藏组件').click());await expect(page.getByTestId('mask-move-handle')).toHaveCount(1);
 const grouped=await save('grouped');expect(grouped.adjustments.masks[0].components.map(c=>c.operation)).toEqual(['add','subtract','intersect']);expect(grouped.artProfile).toContain('CaptRAWComponentCount');passed('mask components draw, subtract, intersect and save in the native profile');
 for(let i=0;i<3;i++)await settle(()=>page.getByTitle('删除组件').click());
 await expect(page.getByTestId('mask-move-handle')).toHaveCount(0);await expect(page.getByRole('spinbutton',{name:'羽化',exact:true})).toHaveCount(0);
 for(let i=0;i<3;i++)await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());
 passed('hidden and empty mask components show no editing guides');
 await expect(page.getByRole('button',{name:'画笔蒙版 K',exact:true})).toBeVisible();
 await settle(()=>page.getByTitle('复制蒙版').click());await expect(page.locator('.mask-row')).toHaveCount(2);
 await settle(()=>page.getByTitle('上移蒙版').click());expect((await save('ordered')).adjustments.masks[0].name).toContain('副本');
 await settle(()=>page.getByTitle('删除蒙版').click());await expect(page.locator('.mask-row')).toHaveCount(1);passed('mask duplicate, reorder and delete are visible and persistent');
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 await expect(page.locator('.mask-overlay ellipse')).toHaveCount(0);await expect(page.getByRole('button',{name:'画笔蒙版 K',exact:true})).toHaveCount(0);passed('leaving masking removes all editing guides and mask painting tools');
 const beforeX=await save('edit-mode-mask');await page.keyboard.press('x');expect((await save('edit-mode-X')).adjustments.masks).toEqual(beforeX.adjustments.masks);
 await settle(()=>page.keyboard.press('Shift+k'));await expect(page.getByRole('button',{name:'画笔蒙版 K',exact:true})).toBeVisible();
 expect((await save('shift-K')).adjustments.masks[0].components.length).toBe(4);
 await page.getByRole('button',{name:'编辑',exact:true}).click();passed('X is confined to masking and Shift-K activates the component in mask mode');
 await page.screenshot({path:resolve(out,'workbench.png')});
 await settle(()=>page.getByRole('spinbutton',{name:'曝光',exact:true}).fill('1'));
 await dialog(2);await page.getByRole('button',{name:'关闭当前文件',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(1);passed('cancel close retains edits');
 await dialog(0);await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});await page.getByRole('button',{name:'关闭当前文件',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(1);passed('cancel save keeps the document open');
 await dialog(1);await page.getByRole('button',{name:'关闭当前文件',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(0);await expect(page.getByRole('heading',{name:'从光线，开始。'})).toBeVisible();passed('discard closes the file and clears canvas');
 await open();await settle(()=>page.getByRole('spinbutton',{name:'曝光',exact:true}).fill('.5'));await dialog(0);
 const saved=resolve(out,'saved-close.captraw.json');rmSync(saved,{force:true});await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},saved);
 await page.getByRole('button',{name:'关闭当前文件',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(0);expect(existsSync(saved)).toBe(true);passed('save-and-close writes a recipe before closing');
 await open(saved);await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('0.5');passed('closed saved edits reopen');
 const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true});await exposure.focus();await exposure.press('Meta+a');await settle(async()=>{await exposure.pressSequentially('-1.25');await exposure.press('Enter');});await expect(exposure).toHaveValue('-1.25');passed('negative decimal values can be typed normally');
 const finished=resolve(out,'finished.captraw.json');rmSync(finished,{force:true});await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},finished);await page.getByRole('button',{name:'完成',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(0);expect(existsSync(finished)).toBe(true);passed('Done saves and closes the current document');
 await open();await page.keyboard.press('Meta+w');await expect(page.locator('.film-item')).toHaveCount(0);passed('Command-W closes the active file');
 await open();await open(resolve('build/samples/canon-r5.CR3'));
 await settle(()=>page.getByRole('spinbutton',{name:'曝光',exact:true}).fill('0.8'));
 await page.locator('.film-item').filter({hasText:openFile.split('/').at(-1)}).getByRole('button',{name:/^关闭 /}).click();
 await expect(page.locator('.film-item')).toHaveCount(1);await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('0.8');
 await open();await dialog(1);await page.getByRole('button',{name:'关闭当前文件',exact:true}).click();await expect(page.locator('.film-item')).toHaveCount(1);
 await expect(page.getByRole('spinbutton',{name:'曝光',exact:true})).toHaveValue('0.8');passed('closing inactive or active documents preserves neighboring edits');
 await app.evaluate(({dialog,BrowserWindow})=>{globalThis.__quitDialogs=0;dialog.showMessageBox=async()=>{globalThis.__quitDialogs++;return {response:0};};BrowserWindow.getAllWindows()[0].close();});
 await expect.poll(()=>app.evaluate(()=>globalThis.__quitDialogs)).toBe(1);expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);
 await app.evaluate(({app})=>{app.quit();});await expect.poll(()=>app.evaluate(()=>globalThis.__quitDialogs)).toBe(2);expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);passed('window close and application quit both retain unsaved edits when cancelled');
 await expect(page.getByRole('button',{name:'关闭文件',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
}catch(e){await page.screenshot({path:resolve(out,'failure.png')});console.error(await page.locator('body').innerText());throw e;}
finally{writeFileSync(resolve(out,'report.json'),JSON.stringify({packaged:!!executablePath,checks,errors},null,2)+'\n');await dialog(1);await app.close();}
