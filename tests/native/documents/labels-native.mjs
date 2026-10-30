import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,writeFile,mkdir,rm,stat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ENGINE_VERSION} from '@captraw/contracts';
import {presetValidationBase} from '@captraw/contracts/presets';
import {Documents,BatchDocumentSaver,validateBatchSave} from '@captraw/desktop-core/documents';
import {SessionDocumentSaver} from '@captraw/desktop-core/session-save';
import {validateBatch} from '@captraw/desktop-core/batch-export';
import {XMP,XMP_BASIC,lookup,property} from '@captraw/desktop-core/xmp';
import {EngineClient} from '../../support/engine-client.mjs';
import {electron,closeElectron,electronDiagnostics} from '../../support/electron-background.mjs';
const servicesOnly=process.argv.includes('--services-only'),noIPC=servicesOnly||process.argv.includes('--no-ipc');
const binary=resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resources=resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources');
const xmp=new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')),documents=new Documents(xmp),ns='urn:label-provenance';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function qualified(label,proof='保留 颜色标签限定符'){
 const node={value:label,lang:'zh-CN',qualifiers:[property(ns,'Origin',{value:proof}),property(ns,'Details',{fields:[property(ns,'Note',{value:'不可删除'})]})]};
 return (await xmp.call('write','',[property(XMP_BASIC,'Label',node),property(ns,'Unknown',{value:'opaque'})])).packet;
}
async function scenario(run){
 const root=await mkdtemp(join(tmpdir(),'captraw-labels-'));let passed=false;
 try{
  const raw=join(root,'source.dng');await copyFile(resolve('build/samples/synthetic.dng'),raw);const bytes=await readFile(raw),before=digest(bytes);
  const base={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:raw,size:bytes.length,sha256:before},artProfile:'',adjustments:structuredClone(presetValidationBase)};
  const snapshot={path:raw,width:1024,height:768,artProfile:'',adjustments:structuredClone(presetValidationBase)};
  await run({root,raw,base,snapshot});assert.equal(digest(await readFile(raw)),before);passed=true;
 }finally{if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained failure:',root);}
}
async function images(root){
 const packet=join(root,'embedded-source-packet.xmp'),custom=join(root,'embedded-custom-packet.xmp'),empty=join(root,'embedded-empty-packet.xmp');
 await writeFile(packet,await qualified('Red','source-origin'));await writeFile(custom,await qualified('自定义 🟪 / 任意 текст'));await writeFile(empty,await qualified(''));
 const red=join(root,'embedded-red.tiff'),unicode=join(root,'custom.png'),cleared=join(root,'empty.png'),plain=join(root,'plain.png');
 execFileSync('build/qa-venv/bin/python',['-c',`import sys,tifffile,numpy as np
from PIL import Image,PngImagePlugin
from pathlib import Path
rgb=np.tile(np.linspace(1000,55000,160,dtype=np.uint16),(96,1));rgb=np.stack([rgb,rgb,rgb],axis=2)
packet=Path(sys.argv[1]).read_bytes();tifffile.imwrite(sys.argv[4],rgb,photometric='rgb',metadata=None,extratags=[(700,'B',len(packet),packet,False)])
for src,dst in [(sys.argv[2],sys.argv[5]),(sys.argv[3],sys.argv[6])]:
 info=PngImagePlugin.PngInfo();info.add_itxt('XML:com.adobe.xmp',Path(src).read_text());Image.new('RGB',(160,96),(128,100,70)).save(dst,pnginfo=info)
Image.new('RGB',(160,96),(128,100,70)).save(sys.argv[7])`,packet,custom,empty,red,unicode,cleared,plain]);
 return {red,unicode,cleared,plain};
}

test('Documents retains arbitrary Unicode/whitespace Label text and arbitrary qualifiers',()=>scenario(async({root})=>{
 const file=join(root,'imported.xmp');
 for(const label of ['Red','蓝色','自定义 🟪 / 任意 текст','','  空白 & <标签>\n保留  ']){
  await writeFile(file,await qualified(label));assert.equal((await documents.read(file)).label,label);
 }
}));

test('omitted label preserves existing XMP; explicit empty Text remains a present property with all qualifiers',()=>scenario(async({root,base})=>{
 const previous=await qualified('非英文 自定义标签'),oldLabel=lookup((await xmp.call('read',previous)).properties,XMP_BASIC,'Label');
 const untouched=await documents.serialize({...base,xmpPacket:previous});
 assert.deepEqual(lookup((await xmp.call('read',untouched)).properties,XMP_BASIC,'Label'),oldLabel);
 const cleared=await documents.serialize({...base,xmpPacket:previous,label:''}),node=lookup((await xmp.call('read',cleared)).properties,XMP_BASIC,'Label');
 assert.equal(node.value,'');assert.deepEqual(node.qualifiers,oldLabel.qualifiers);assert.equal(node.lang,oldLabel.lang);
 const file=join(root,'cleared.xmp');await writeFile(file,cleared);assert.equal((await documents.read(file)).label,'');
 const custom='客户 🟧 & <优先>  ';const changed=await documents.serialize({...base,xmpPacket:cleared,label:custom});
 assert.equal(lookup((await xmp.call('read',changed)).properties,XMP_BASIC,'Label').value,custom);
 assert.deepEqual(lookup((await xmp.call('read',changed)).properties,XMP_BASIC,'Label').qualifiers,oldLabel.qualifiers);
 assert.equal(lookup((await xmp.call('read',await documents.serialize(base))).properties,XMP_BASIC,'Label'),undefined);
 const firstClear=await documents.serialize({...base,label:''});assert.equal(lookup((await xmp.call('read',firstClear)).properties,XMP_BASIC,'Label').value,'','first save must create a present empty Text, never delete/omit the override');
}));

test('label type boundaries reject non-text save/export snapshots without a colour-name whitelist',()=>scenario(async({base,snapshot})=>{
 for(const label of [null,0,true,[],{}]){
  assert.throws(()=>validateBatchSave({documents:[{...snapshot,label}]}),/标签/);
  assert.throws(()=>validateBatch({documents:[{...snapshot,label}],format:'jpeg',colorSpace:'srgb'}),/标签/);
  await assert.rejects(documents.serialize({...base,label}),/标签/);
 }
 for(const label of [undefined,'','Green','not-a-colour-name','标签 🟥']){
  validateBatchSave({documents:[{...snapshot,label}]});validateBatch({documents:[{...snapshot,label}],format:'tiff',colorSpace:'srgb'});
 }
}));

test('session and legacy batch save carry independent per-image labels, including clear and omitted snapshots',()=>scenario(async({root,raw,snapshot})=>{
 const paths=[raw,join(root,'clear.dng'),join(root,'untouched.dng')];for(const path of paths.slice(1))await copyFile(raw,path);
 const labels=['Blue','',undefined],original='原始 自定义 🟦',packet=await qualified(original);
 const snapshots=paths.map((path,i)=>({...snapshot,path,xmpPacket:packet,...(labels[i]===undefined?{}:{label:labels[i]})}));
 const saver=new SessionDocumentSaver(binary,resources,join(root,'session-cache'),documents,async()=>true,()=>{});
 const saved=await saver.run({sessionId:'labels-session',documents:snapshots});assert.equal(saved.results.length,3);
 for(const [index,row] of saved.results.entries()){
  assert.equal(row.error,undefined);assert.equal((await documents.read(row.output)).label,labels[index]??original);
  const node=lookup((await xmp.call('read',row.xmpPacket)).properties,XMP_BASIC,'Label');assert.equal(node.value,labels[index]??original);assert(node.qualifiers.some(q=>q.name==='Origin'));
 }
 const directory=join(root,'batch');await mkdir(directory);
 const batch=new BatchDocumentSaver(binary,resources,join(root,'batch-cache'),documents,()=>{}),result=await batch.run({documents:snapshots},directory);assert.equal(result.results.length,3);
 for(const [index,row] of result.results.entries()){assert.equal(row.error,undefined);assert.equal((await documents.read(row.output)).label,labels[index]??original);}
 for(const directory of ['session-cache','batch-cache'])assert.deepEqual(await readdir(join(root,directory)),[]);
}));

test('native open projects embedded standard text labels, including empty/custom values, without modifying source images',{skip:servicesOnly},()=>scenario(async({root})=>{
 const files=await images(root),before=Object.fromEntries(await Promise.all(Object.values(files).map(async path=>[path,digest(await readFile(path))]))),engine=new EngineClient({cache:join(root,'native-cache')});engine.on('error',()=>{});
 try{for(const [key,label] of Object.entries({red:'Red',unicode:'自定义 🟪 / 任意 текст',cleared:'',plain:undefined})){const image=await engine.call('open',{path:files[key],sessionId:key});assert.equal(image.label,label);assert.equal(digest(await readFile(files[key])),before[files[key]]);}}
 finally{await engine.stop();}
}));

test('real main IPC saves an empty sidecar over embedded Red and reopens raw/recipe without inheriting Red',{skip:noIPC},()=>scenario(async({root})=>{
 const {red}=await images(root),before=digest(await readFile(red));let app;
 try{
  app=await electron.launch({env:{CAPTRAW_E2E_USER_DATA:join(root,'user-data'),CAPTRAW_DEV_URL:''}});const page=await app.firstWindow();
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async(_,options)=>{assertNoUnexpectedDialog(options);return {response:1};};function assertNoUnexpectedDialog(options){if(options.message!=='确认保存这些 XMP 旁车？')throw new Error('Unexpected dialog: '+options.message);}});
  const image=await page.evaluate(path=>window.captraw.open(path),red);assert.equal(image.label,'Red');
  const sidecar=red.replace(/\.tiff$/,'.xmp');await writeFile(sidecar,await qualified('外部侧车 标签','sidecar-origin'));
  const request={sessionId:'clear-label-session',documents:[{path:red,width:image.width,height:image.height,artProfile:image.artProfile||'',adjustments:image.adjustments,label:''}]};
  const saved=await page.evaluate(request=>window.captraw.saveSession(request),request);assert.equal(saved.results[0].error,undefined);
  const node=lookup((await xmp.call('read',saved.results[0].xmpPacket)).properties,XMP_BASIC,'Label');assert.equal(node.value,'');assert.equal(node.qualifiers.find(q=>q.name==='Origin').node.value,'sidecar-origin');
  for(const path of [red,sidecar]){await page.evaluate(()=>window.captraw.close());const reopened=await page.evaluate(path=>window.captraw.open(path),path);assert.equal(reopened.label,'');assert.equal(reopened.recipe.label,'');}
  const unchangedPacket=(await xmp.read(sidecar)).packet;
  const omitted=await page.evaluate(request=>{delete request.documents[0].label;return window.captraw.saveSession(request);},request);assert.equal(lookup((await xmp.call('read',omitted.results[0].xmpPacket)).properties,XMP_BASIC,'Label').value,'');
  assert.equal((await documents.read(sidecar)).label,'');assert(unchangedPacket.includes('sidecar-origin'));
  assert.equal(digest(await readFile(red)),before);
  const states=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused()})));assert(states.every(w=>!w.visible&&!w.focused));
 }catch(error){if(app)await writeFile(join(root,'ipc-failure.json'),JSON.stringify({error:String(error),diagnostics:electronDiagnostics(app)},null,2));throw error;}
 finally{if(app)await closeElectron(app);}
}));
