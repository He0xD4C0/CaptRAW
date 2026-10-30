import {ENGINE_VERSION} from '@captraw/contracts';
import {Documents} from '@captraw/desktop-core/documents';
import {XMP} from '@captraw/desktop-core/xmp';
import {readDocument} from '../../support/xmp-test.mjs';
import {EngineClient} from '../../support/engine-client.mjs';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import assert from 'node:assert/strict';import {resolve,join} from 'node:path';import {homedir} from 'node:os';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';import {createHash} from 'node:crypto';
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
const out=resolve(process.env.CAPTRAW_RASTER_OUT||'artifacts/raster-masks');mkdirSync(out,{recursive:true});
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const engine=new EngineClient({cache:join(out,'cache')}),old=join(homedir(),'Applications/CaptRAW-0.27.app/Contents/Resources/native'),reference=new EngineClient({executable:join(old,'captraw-engine'),resources:join(old,'resources'),cache:join(out,'reference')});engine.on('error',()=>{});reference.on('error',()=>{});
const rows=[],checks=[];let revision=0;const pass=s=>{checks.push(s);console.log('PASS',s);};
const mask=(kind='full')=>({id:'raster',name:'对象选区',type:'raster',enabled:true,inverted:false,feather:0,brightness:.6,contrast:0,saturation:0,points:[],start:{x:0,y:0},end:{x:1,y:1},raster:{path:join(out,kind+'.png'),sha256:sha(join(out,kind+'.png')),width:kind==='full'?641:160,height:kind==='full'?479:120}});
async function render(image,adjustments,name,profile=''){
 const wait=engine.preview(++revision,'fit',120000);const result=await engine.call('update',{revision,adjustments,artProfile:profile,maskId:'raster'}),frame=await wait;
 if(frame.mask?.file)copyFileSync(frame.mask.file,join(out,name+'-coverage.png'));copyFileSync(frame.file,join(out,name+'-preview.png'));
 return {...result,frame,adjustments};
}
try{
 const image=await engine.call('open',{path:join(out,'原片 网格.png'),sessionId:'raster-tests'});const baseline=await render(image,image.adjustments,'baseline');
 for(const kind of ['full','small'])for(const rotation of [0,90,180,270])for(const cropped of [false,true]){
  const name=kind+'-'+rotation+(cropped?'-crop':''),a={...image.adjustments,rotation,crop:cropped?{x:.12,y:.14,width:.63,height:.57}:null,masks:[mask(kind)]};
  const result=await render(image,a,name);assert(/CaptRAWRaster(?:_\d+)?=true/.test(result.artProfile));assert(new RegExp('CaptRAWRasterRotation(?:_\\d+)?='+rotation).test(result.artProfile));
  const actual=join(out,name+'.tiff'),expected=join(out,name+'-reference.tiff');await engine.call('export',{path:image.path,artProfile:result.artProfile,output:actual,format:'tiff'});
  const ref=(await reference.call('maskAssets',{artProfile:result.artProfile,replacements:{[mask(kind).raster.path]:join(out,`${kind}-${rotation}-reference.png`)}})).artProfile;
  await reference.call('export',{path:image.path,artProfile:ref,output:expected,format:'tiff'});
  const detailWait=engine.preview(++revision,'detail',120000);await engine.call('viewport',{revision,x:35,y:47,width:260,height:210});const detail=await detailWait;assert(detail.mask?.file);copyFileSync(detail.mask.file,join(out,name+'-detail-coverage.png'));
  rows.push({name,kind,rotation,cropped,actual,expected,frame:result.frame,detail});
 }
 pass('two raster resolutions across four rotations, crop, full output and true detail preview');
 const brush={id:'brush',name:'修正画笔',type:'brush',enabled:true,inverted:false,feather:0,points:[{x:.2,y:.24,radius:.5}],start:{x:0,y:0},end:{x:1,y:1},operation:'add'};
 await render(image,{...image.adjustments,masks:[{...mask(),components:[brush]}]},'brush');
 for(const operation of ['add','subtract','intersect']){const a={...image.adjustments,masks:[{...mask(),raster:undefined,components:[{...mask(),operation:'add'},{...brush,operation}]}]};await render(image,a,'combined-'+operation);}
 await render(image,{...image.adjustments,masks:[{...mask(),inverted:true}]},'inverse');
 const off=await render(image,{...image.adjustments,masks:[{...mask(),enabled:false}]},'disabled');assert.equal(sha(join(out,'disabled-preview.png')),sha(join(out,'baseline-preview.png')));
 pass('brush addition, subtraction and intersection; group inversion and disable');
 for(const rotation of [0,90,180,270]){
  const name='feather-'+rotation,feathered={...image.adjustments,rotation,crop:{x:.12,y:.14,width:.63,height:.57},masks:[{...mask(),feather:85}]};const feather=await render(image,feathered,name);
  const wait=engine.preview(++revision,'detail');await engine.call('viewport',{revision,x:35,y:47,width:260,height:210});const fd=await wait;copyFileSync(fd.mask.file,join(out,name+'-detail-coverage.png'));rows.push({name,feather:true,frame:feather.frame,detail:fd});
 }
 const valid=await render(image,{...image.adjustments,masks:[mask()]},'valid');
 for(const invalid of [{sha256:'0'.repeat(64)},{width:642},{height:1.5},{sha256:'bad'},{path:join(out,'missing.png')}])await assert.rejects(engine.call('update',{revision:++revision,adjustments:{...image.adjustments,masks:[{...mask(),raster:{...mask().raster,...invalid}}]}}));
 assert.equal((await engine.call('save')).artProfile,valid.artProfile);
 // A different but decodable image must not be accepted as the same mask.
 const full=join(out,'full.png'),saved=readFileSync(full);copyFileSync(join(out,'small.png'),full);
 await assert.rejects(engine.call('export',{path:image.path,artProfile:valid.artProfile,output:join(out,'must-not-exist.tiff'),format:'tiff'}));assert(!existsSync(join(out,'must-not-exist.tiff')));writeFileSync(full,saved);
 const restored=await render(image,valid.adjustments,'identity-restored',valid.artProfile);assert.equal(sha(join(out,'identity-restored-coverage.png')),sha(join(out,'valid-coverage.png')));
 pass('checksum and dimensions checked through cache, update and export; failure preserves current parameters');
 for(const enabled of [true,false]){
  const a={...image.adjustments,rotation:90,masks:[{...mask(),enabled,raster:undefined,components:[{...mask(),operation:'add'},brush]}]};
  const result=await render(image,a,enabled?'document-on':'document-off');
  const recipe={engineVersion:ENGINE_VERSION,baselineVersion:4,source:{path:image.path,size:readFileSync(image.path).length,sha256:sha(image.path)},artProfile:result.artProfile,adjustments:a};
  const file=join(out,enabled?'栅格.xmp':'停用栅格.xmp');await saveRecipeWithMasks(engine,file,recipe,value=>documents.serialize(value));const stored=(await readDocument(file));assert.equal(stored.maskAssets.files.length,1);assert(stored.adjustments.masks[0].components[0].raster.path.startsWith('captraw-mask:'));
  const opened=await restoreRecipeMasks(engine,file,stored,join(out,'restored-assets'));assert(opened.adjustments.masks[0].components[0].raster.path.startsWith(join(out,'restored-assets')));
  const again=await render(image,opened.adjustments,enabled?'document-on-restored':'document-off-restored',opened.artProfile);assert.equal(sha(join(out,enabled?'document-on-preview.png':'document-off-preview.png')),sha(join(out,enabled?'document-on-restored-preview.png':'document-off-restored-preview.png')));
 }
 pass('active and disabled raster components save all assets and restore their projected paths');
 const protectedFile=join(out,'栅格.xmp'),protectedBytes=readFileSync(protectedFile);
 const incomplete={call:async(method,params)=>{const result=await engine.call(method,params);if(method==='maskAssets'&&params.replacements)delete result.adjustments;return result;}};
 const savedRecipe=(await readDocument(protectedFile)),liveRecipe=await restoreRecipeMasks(engine,protectedFile,savedRecipe,join(out,'contract-assets'));
 await assert.rejects(saveRecipeWithMasks(incomplete,protectedFile,liveRecipe,value=>documents.serialize(value)),/完整蒙版配方/);assert.deepEqual(readFileSync(protectedFile),protectedBytes);
 await assert.rejects(restoreRecipeMasks(incomplete,protectedFile,savedRecipe,join(out,'contract-assets')),/完整蒙版配方/);pass('incomplete core response cannot replace a saved document');
 const large=await engine.call('open',{path:join(out,'uniform-large.png'),sessionId:'raster-large'});
 const largeResult=await render(large,{...large.adjustments,masks:[{...mask(),feather:100}]},'large-feather');
 const largeWait=engine.preview(++revision,'detail');await engine.call('viewport',{revision,x:0,y:150,width:1200,height:900});const ld=await largeWait;copyFileSync(ld.mask.file,join(out,'large-feather-detail-coverage.png'));
 rows.push({name:'large-feather',uniform:true,frame:largeResult.frame,detail:ld});pass('downscaled preview and full-resolution feather use the same image-relative radius');
 const loaded=await reference.call('open',{path:image.path,sessionId:'legacy'});const oldNeutral=await reference.call('compose',{path:image.path,width:image.width,height:image.height,adjustments:loaded.adjustments,artProfile:loaded.artProfile});const currentNeutral=await engine.call('compose',{path:image.path,width:image.width,height:image.height,adjustments:loaded.adjustments,artProfile:loaded.artProfile});assert.equal(currentNeutral.artProfile,oldNeutral.artProfile);pass('legacy no-raster profiles remain byte-identical');
}finally{await engine.stop();await reference.stop();writeFileSync(join(out,'report.json'),JSON.stringify({checks,rows,engine:process.env.CAPTRAW_ENGINE||resolve('build/native/captraw-engine')},null,2)+'\n');}
