import {_electron} from '@playwright/test';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {dirname,resolve,join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const launches=new WeakMap();
const processes=new WeakMap();

// Read native logs before app.close(): the main process removes its preview cache on quit.
export function electronDiagnostics(app){
 const state=launches.get(app);
 if(!state)return undefined;
 const scan=directory=>{
  let entries;try{entries=readdirSync(directory,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')state.diagnosticErrors.push(String(error));return;}
  for(const entry of entries){
   const path=join(directory,entry.name);
   if(entry.isDirectory())scan(path);
   else if(entry.isFile()&&entry.name.endsWith('.log')){
    try{state.nativeLogs[relative(state.userData,path)]=readFileSync(path,'utf8');}catch(error){state.diagnosticErrors.push(String(error));}
   }
  }
 };
 scan(join(state.userData,'preview-cache'));
 const child=processes.get(app);
 return {...state,stdout:state.stdout.join(''),stderr:state.stderr.join(''),pid:child?.pid,exitCode:child?.exitCode,signalCode:child?.signalCode};
}

export async function closeElectron(app){
 const child=processes.get(app);let timer;
 try{
  await Promise.race([(async()=>{
   await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});
   await app.close();
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Electron shutdown timed out')),5000);})]);
 }catch(error){
  if(child&&child.exitCode===null&&child.signalCode===null){
   const exited=new Promise(done=>child.once('exit',done));
   child.kill('SIGKILL');
   let killTimer;try{await Promise.race([exited,new Promise((_,reject)=>{killTimer=setTimeout(()=>reject(new Error('Electron process did not exit after SIGKILL')),5000);})]);}finally{clearTimeout(killTimer);}
  }
  throw error;
 }finally{clearTimeout(timer);}
}

// All E2E entry points use this launcher. Older packages must not flash a window.
export const electron={async launch(options={}){
 const env={...process.env,...options.env,CAPTRAW_E2E_BACKGROUND:'1'};
 const executablePath=options.executablePath||env.CAPTRAW_APP;
 const temporary=!env.CAPTRAW_E2E_USER_DATA;
 const userData=temporary?mkdtempSync(join(tmpdir(),'captraw-e2e-')):resolve(env.CAPTRAW_E2E_USER_DATA);
 env.CAPTRAW_E2E_USER_DATA=userData;
 const diagnostics={userData,stdout:[],stderr:[],nativeLogs:{},diagnosticErrors:[]};
 let app;
 try{
  if(!temporary)mkdirSync(userData,{recursive:true});
  const main=executablePath?resolve(dirname(executablePath),'../Resources/app.asar'):resolve(root,JSON.parse(readFileSync(join(root,'package.json'),'utf8')).main);
  assert(readFileSync(main).includes(Buffer.from('CAPTRAW_E2E_BACKGROUND')),'Rebuild this application with background E2E support before testing');
  app=await _electron.launch({...options,executablePath,args:options.args??(executablePath?[]:[root]),timeout:options.timeout??60000,env});
  launches.set(app,diagnostics);
  const child=app.process();
  processes.set(app,child);
  child?.stdout?.on('data',chunk=>diagnostics.stdout.push(chunk.toString()));
  child?.stderr?.on('data',chunk=>diagnostics.stderr.push(chunk.toString()));
  if(temporary)app.once('close',()=>rmSync(userData,{recursive:true,force:true}));
  await app.firstWindow({timeout:options.timeout??60000});
  const state=await app.evaluate(({BrowserWindow,dialog})=>{
   // Each test must supply its intended dialog response; an omitted stub must never display native UI.
   for(const name of Object.keys(dialog).filter(name=>name.startsWith('show'))){
    dialog[name]=()=>{throw new Error(`Background E2E requires an explicit response for dialog.${name}`);};
   }
   return BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable(),throttled:w.webContents.backgroundThrottling}));
  });
  assert(state.length>0&&state.every(w=>!w.visible&&!w.focused&&!w.focusable&&!w.throttled),'E2E window must stay hidden and unfocused with rendering enabled');
  console.log('E2E background window verified:',JSON.stringify(state));
  return app;
 }catch(error){
  if(app){
   error.electronDiagnostics=electronDiagnostics(app);
   const page=app.windows()[0];
   if(page)error.electronScreenshot=await page.screenshot({timeout:2000}).catch(()=>undefined);
   await closeElectron(app).catch(cleanup=>{diagnostics.diagnosticErrors.push(String(cleanup));});
   error.electronDiagnostics=electronDiagnostics(app);
  }else error.electronDiagnostics={...diagnostics,stdout:'',stderr:'',launchError:error.stack||String(error)};
  if(temporary)rmSync(userData,{recursive:true,force:true});
  throw error;
 }
}};
