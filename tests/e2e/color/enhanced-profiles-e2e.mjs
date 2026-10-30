import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {mkdtemp,readFile,writeFile,rm,copyFile,cp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
import {enhancedFixtures,digest} from '../../support/enhanced-profile-fixtures.mjs';
import {XMP,CRS,CT,lookup,property} from '@captraw/desktop-core/documents';
import {Documents} from '@captraw/desktop-core/documents';
const scratch=await mkdtemp(join(tmpdir(),'captraw-enhanced-gui-')),xmp=new XMP(resolve('build/xmp/captraw-xmp')),documents=new Documents(xmp);
let app,page,passed=false,beforeReopen;const errors=[],checks=[],regressions=[];
const pass=message=>{checks.push(message);console.log('PASS',message);};
const select=()=>page.getByRole('combobox',{name:'输入配置文件',exact:true});
const importer=()=>page.getByRole('button',{name:'导入 DCP / ICC / Look…',exact:true});
const amount=()=>page.getByRole('spinbutton',{name:'Look 强度',exact:true});
const amountSlider=()=>page.getByRole('slider',{name:'Look 强度滑杆',exact:true});
const pixels=async()=>digest(Buffer.from(await page.locator('canvas').evaluate(c=>c.toDataURL())));
async function launch(){
 app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(scratch,'user-data'),CAPTRAW_DEV_URL:''}});page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async(_,options)=>{if(options.message==='确认保存这些 XMP 旁车？'||options.message.startsWith('放弃 '))return {response:1};throw new Error('Unexpected confirmation: '+options.message);};});
 await app.evaluate(({ipcMain})=>{globalThis.__lookRPC={opens:[],updates:[],saves:[]};for(const [channel,key] of [['image:open','opens'],['image:update','updates'],['session:save','saves']]){const original=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);ipcMain.handle(channel,async(...args)=>{const result=await original(...args);globalThis.__lookRPC[key].push({args:args.slice(1),result});return result;});}});
 await page.evaluate(()=>{window.__frames=[];window.captraw.onEvent(e=>{if(e.event==='preview')window.__frames.push(e.frame);});});
}
async function idle(){await page.locator('.rendering').waitFor({state:'hidden'});await expect(page.locator('.workbench')).not.toHaveAttribute('inert','');await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.frame===window.__frames.filter(f=>f.kind==='fit').at(-1)?.url);}
async function settle(action){const before=await page.evaluate(()=>window.__frames.length);await action();await page.waitForFunction(n=>window.__frames.length>n,before);await idle();}
async function choose(paths){await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},Array.isArray(paths)?paths:[paths]);}
async function open(paths){await choose(paths);await settle(()=>page.getByRole('button',{name:'打开',exact:true}).click());}
async function importProfile(path){await choose(path);await importer().click();await expect(importer()).toBeEnabled();await idle();}
async function save(path){await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);return documents.read(path);}
async function exportTIFF(path){await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},path);await page.getByRole('button',{name:'导出',exact:true}).click();await page.getByRole('dialog',{name:'导出设置',exact:true}).getByRole('button',{name:/^TIFF · 16 位/}).click();await expect(page.locator('.job-toast.done')).toBeVisible({timeout:90000});assert((await readFile(path)).length>1000);}
try{
 const f=await enhancedFixtures(scratch,xmp);await launch();await open([f.png,f.other]);
 await page.locator('.film-item').filter({hasText:basename(f.png)}).locator('.film-open').click();await idle();
 await expect(select()).toBeVisible();await expect(importer()).toBeVisible();await expect(amount()).toHaveCount(0);
 const baseline=await pixels(),originalSelection=await select().inputValue();
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});await importer().click();await expect(importer()).toBeEnabled();assert.equal(await pixels(),baseline);assert.equal(await select().inputValue(),originalSelection);
 await choose(f.missing);await importer().click();await expect(page.getByRole('alert').filter({hasText:'缺少 RGBTable'})).toBeVisible();assert.equal(await pixels(),baseline);assert.equal(await select().inputValue(),originalSelection);
 await choose(f.unsupported);await importer().click();await expect(page.getByRole('alert').filter({hasText:'不支持的必要 Look 参数'})).toBeVisible();assert.equal(await pixels(),baseline);
 pass('visible import chooser cancels safely; missing tables and unsupported required features reject without enabling a placeholder or changing current pixels');
 await settle(()=>importProfile(f.files.rgb));await expect(select().locator('option:checked')).toContainText('彩色 Look 中文');await expect(amount()).toBeVisible();await expect(amount()).toHaveValue('100');const rgb100=await pixels();assert.notEqual(rgb100,baseline);
 await settle(()=>amountSlider().press('End'));await expect(amount()).toHaveValue('200');const rgb200=await pixels();assert.notEqual(rgb200,rgb100);
 await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(amount()).toHaveValue('100');assert.equal(await pixels(),rgb100);
 await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());await expect(amount()).toHaveValue('200');assert.equal(await pixels(),rgb200);
 pass('actual visible Look selection and keyboard amount edit change canvas pixels with exact undo/redo');
 await settle(()=>importProfile(f.files.curveOnly));await expect(select().locator('option:checked')).toContainText('仅曲线 无表 Look');await expect(amount()).toBeVisible();assert.notEqual(await pixels(),baseline);
 const curveSaved=await save(f.png.replace(/\.png$/,'.xmp'));assert.deepEqual(curveSaved.adjustments.colorProfile.look.profile.tables,[]);assert.equal(curveSaved.adjustments.colorProfile.look.profile.curve.length,3);
 pass('visible curve-only Look imports and saves with no invented table or Adobe base dependency; actual canvas pixels change');
 await settle(()=>importProfile(f.files.fixed));await expect(amount()).toHaveCount(0);await expect(page.getByText('此 Look 固定为 100%，不提供强度调节。',{exact:true})).toBeVisible();
 await settle(()=>importProfile(f.icc));await expect(amount()).toHaveCount(0);await expect(page.getByText('RGB ICC 不提供机型约束',{exact:false})).toBeVisible();await expect(page.getByRole('checkbox',{name:'配置文件色调曲线',exact:true})).toHaveCount(0);
 pass('fixed Look has no amount control; ordinary ICC retains its normal UI without invented strength or DCP controls');
 await settle(async()=>select().selectOption(await select().locator('option').filter({hasText:'彩色 Look 中文'}).getAttribute('value')));await expect(amount()).toHaveValue('100');
 const exposure=page.getByRole('spinbutton',{name:'曝光',exact:true}),exposureBefore=await exposure.inputValue();
 await settle(()=>amountSlider().press('End'));assert.equal(await exposure.inputValue(),exposureBefore);
 const sidecar=f.png.replace(/\.png$/,'.xmp'),saved=await save(sidecar);assert.equal(saved.adjustments.colorProfile.look.amount,2);
 const standard=await xmp.read(sidecar);assert.equal(lookup(standard.properties,CRS,'Look').fields.find(p=>p.name==='Amount').node.value,'2');assert(standard.properties.some(p=>p.name.startsWith('Table_')));
 const persisted=await pixels();const output=join(scratch,'实际 Look.tiff');await exportTIFF(output);
 beforeReopen=await app.evaluate(()=>globalThis.__lookRPC);await writeFile(join(scratch,'before-reopen.png'),Buffer.from(await page.locator('canvas').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 pass('save writes standard nested Look/Amount and actual inline tables; real TIFF16 export completes without changing user exposure');
 await closeElectron(app);app=undefined;await rm(join(scratch,'user-data','input-profiles'),{recursive:true,force:true});
 await launch();await open(sidecar);await expect(amount()).toHaveValue('200');const reopenedPixels=await pixels();await expect(select().locator('option:checked')).toContainText('彩色 Look 中文');
 if(reopenedPixels!==persisted){regressions.push('Saving after curve-only -> RGB Look restores the removed curve and changes fresh-process pixels');console.error('FAIL',regressions.at(-1));await writeFile(join(scratch,'reopen-rpc.json'),JSON.stringify({beforeReopen,after:await app.evaluate(()=>globalThis.__lookRPC)},null,2));}
 else pass('fresh application process restores Look and exact preview after the imported library has been removed');
 await page.getByRole('button',{name:'预设',exact:true}).click();await page.getByRole('button',{name:'创建预设',exact:true}).click();
 const presetDialog=page.getByRole('dialog',{name:'创建预设',exact:true});await presetDialog.getByRole('textbox',{name:'预设名称',exact:true}).fill('Look 完整设置');
 for(const checkbox of await presetDialog.getByRole('checkbox').all())await checkbox.uncheck();
 await presetDialog.getByRole('checkbox',{name:'输入配置文件与 Look',exact:true}).check();await presetDialog.getByRole('button',{name:'保存预设',exact:true}).click();await expect(presetDialog).not.toBeVisible();
 await expect(page.getByRole('button',{name:'Look 完整设置',exact:true})).toBeVisible();
 await open(f.other);await page.getByRole('button',{name:'Look 完整设置',exact:true}).click();await idle();await page.getByRole('button',{name:'编辑',exact:true}).click();
 if(await page.getByRole('alert').filter({hasText:'配置文件资产清单缺失'}).count()){
  regressions.push('Profile/Look preset drops the imported ICC asset manifest and cannot apply');console.error('FAIL',regressions.at(-1));
  await page.getByRole('button',{name:'关闭错误',exact:true}).click();await settle(()=>importProfile(f.files.rgb));
 }else{
  await expect(amount()).toHaveValue('200');assert.equal(await pixels(),reopenedPixels);await settle(()=>page.getByRole('button',{name:'撤销',exact:true}).click());await expect(amount()).toHaveCount(0);
  await settle(()=>page.getByRole('button',{name:'重做',exact:true}).click());await expect(amount()).toHaveValue('200');
  pass('visible preset creation includes the profile/Look group; applying to another photo changes real pixels and supports undo/redo');
 }
 await settle(()=>amountSlider().press('Home'));await expect(amount()).toHaveValue('0');
 const photo=path=>page.locator('.film-item').filter({hasText:basename(path)}).locator('.film-open');
 await photo(f.png).click();await idle();await expect(photo(f.png)).toHaveAttribute('aria-current','true');await expect(amount()).toHaveValue('200');
 await photo(f.other).click({modifiers:['Shift']});await expect(page.locator('.film-open[aria-pressed=true]')).toHaveCount(2);await idle();
 await page.getByRole('button',{name:'同步设置…',exact:true}).click();const syncDialog=page.getByRole('dialog',{name:'同步设置',exact:true});
 await syncDialog.getByRole('button',{name:'全不选',exact:true}).click();await syncDialog.getByRole('checkbox',{name:'输入配置文件与 Look',exact:true}).check();
 await syncDialog.getByRole('button',{name:'同步 1 张照片',exact:true}).click();await expect(syncDialog).not.toBeVisible();await idle();
 await photo(f.other).click();await idle();await expect(amount()).toHaveValue('200');
 await page.getByRole('button',{name:'保存',exact:true}).click();const otherSidecar=f.other.replace(/\.png$/,'.xmp');await expect(page.locator('.document-title .dirty-dot')).toHaveCount(0);
 assert.equal((await documents.read(otherSidecar)).adjustments.colorProfile.look.amount,2);
 pass('visible profile-only synchronization copies Look assets and strength to the other photo and saves the actual result');
 await open(f.raw);await choose(f.files.rawLook);await importer().click();await expect(page.getByRole('alert').filter({hasText:'缺少基础 DCP'})).toBeVisible();await expect(amount()).toHaveCount(0);
 await settle(()=>importProfile(f.dcp));await expect(page.getByRole('checkbox',{name:'配置文件色调曲线',exact:true})).toBeVisible();await expect(amount()).toHaveCount(0);
 await settle(()=>importProfile(f.files.rawLook));await expect(amount()).toBeVisible();await expect(select().locator('option:checked')).toContainText('RAW 基础 DCP Look');
 const rawSidecar=f.raw.replace(/\.dng$/,'.xmp'),rawSaved=await save(rawSidecar);assert(rawSaved.inputProfileAsset);assert.match(rawSaved.adjustments.colorProfile.reference,/^captraw-profile:/);assert.equal(rawSaved.adjustments.colorProfile.look.profile.tables.length,2);
 const standardOnly=join(scratch,'标准 命名基础.xmp');
 await writeFile(standardOnly,(await xmp.call('write',(await xmp.read(rawSidecar)).packet,[property(CT,'ARTAdjustments',null),property(CT,'ARTProfile',null),property(CT,'InputProfileAsset',null),property(CT,'EngineVersion',null)])).packet);
 await open(standardOnly);await expect(select().locator('option:checked')).toContainText('RAW 基础 DCP Look');
 const resolved=await save(rawSidecar);assert.equal(resolved.inputProfileAsset.id,rawSaved.inputProfileAsset.id);
 pass('opening standard Look XMP resolves its explicitly named compatible DCP before native validation and saves the actual bound asset');
 const rawPixels=await pixels();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('button',{name:'保存',exact:true})).toBeDisabled();await closeElectron(app);app=undefined;
 const moved=join(scratch,'移动 后');await mkdir(moved);const movedRaw=join(moved,basename(f.raw)),movedXMP=join(moved,basename(rawSidecar));await copyFile(f.raw,movedRaw);await copyFile(rawSidecar,movedXMP);await cp(rawSidecar+'.assets',movedXMP+'.assets',{recursive:true});
 await rm(join(scratch,'user-data','input-profiles'),{recursive:true,force:true});await launch();await open(movedXMP);await expect(amount()).toHaveValue('100');assert.equal(await pixels(),rawPixels);
 pass('RAW base dependency fails explicitly, then real DCP+Look selection saves portably and reopens after moving source/XMP/assets and removing the library');
 const stable=await pixels(),valid=await documents.read(movedXMP);
 const wrongCamera=structuredClone(valid);wrongCamera.adjustments.colorProfile.look.profile.cameraModelRestriction='Different Camera';
 const wrongFile=join(moved,'错误机型.xmp');await writeFile(wrongFile,await documents.serialize(wrongCamera));
 await choose(wrongFile);await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'不匹配'})).toBeVisible();await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();assert.equal(await pixels(),stable);await expect(amount()).toHaveValue('100');
 const missingAsset=structuredClone(valid);missingAsset.inputProfileAsset.path='missing.xmp.assets/'+basename(missingAsset.inputProfileAsset.path);
 const missingFile=join(moved,'缺失基础资产.xmp');await writeFile(missingFile,await documents.serialize(missingAsset));
 await choose(missingFile);await page.getByRole('button',{name:'打开',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'资产缺失'})).toBeVisible();await expect(page.getByRole('button',{name:'打开',exact:true})).toBeEnabled();assert.equal(await pixels(),stable);await expect(amount()).toHaveValue('100');
 pass('failed recipe open preserves the current visible Look and exact canvas for camera restrictions and missing base assets, including a warm cache');
 if(process.env.CAPTRAW_ENHANCED_LOOK_ASSET){
  const installed=resolve(process.env.CAPTRAW_ENHANCED_LOOK_ASSET),original=digest(await readFile(installed)),before=await pixels();
  await settle(()=>importProfile(installed));await expect(select().locator('option:checked')).not.toHaveText('RAW 基础 DCP Look');assert.notEqual(await pixels(),before);
  await expect(amount()).toBeVisible();await settle(()=>amountSlider().press('End'));await expect(amount()).toHaveValue('200');
  const actualSaved=await save(movedXMP);assert(actualSaved.adjustments.colorProfile.look.profile.tables.length>0);assert.equal(actualSaved.adjustments.colorProfile.look.amount,2);
  await exportTIFF(join(scratch,'本机真实 Look.tiff'));assert.equal(digest(await readFile(installed)),original);
  pass('optional installed real Look changes visible canvas, supports amount, saves its real table assets and exports; original installed bytes remain unchanged (no ACR pixel-parity claim)');
 }
 for(const [path,hash] of f.before)assert.equal(digest(await readFile(path)),hash);
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));assert(windows.length&&windows.every(w=>!w.visible&&!w.focused&&!w.focusable));assert.deepEqual(errors,[]);
 pass('all windows remain hidden/unfocused and all fixture source/profile bytes remain unchanged');assert.deepEqual(regressions,[],'Located product regressions must be fixed before full acceptance');passed=true;
}catch(error){
 if(page)await page.screenshot({path:join(scratch,'failure.png')}).catch(()=>{});
 if(app)await writeFile(join(scratch,'rpc-failure.json'),JSON.stringify({beforeReopen,after:await app.evaluate(()=>globalThis.__lookRPC).catch(()=>undefined)},null,2));
 await writeFile(join(scratch,'failure.json'),JSON.stringify({error:String(error),checks,regressions,errors,diagnostics:app?electronDiagnostics(app):undefined},null,2));throw error;
}finally{if(app)await closeElectron(app);if(passed)await rm(scratch,{recursive:true,force:true});else console.error('Retained enhanced GUI failure:',scratch);}
