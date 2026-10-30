import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {BatchExporter,validateBatch} from '@captraw/desktop-core/batch-export';
import {EngineClient} from '../../support/engine-client.mjs';
const out=resolve(process.env.CAPTRAW_OUTPUT_OUT||'artifacts/output-workflow');mkdirSync(out,{recursive:true});
const binary=process.env.CAPTRAW_ENGINE||resolve('build/native/captraw-engine'),resources=process.env.CAPTRAW_RESOURCES||resolve('build/native/resources');
const old=join(homedir(),'Applications/CaptRAW-0.24.app/Contents/Resources/native');
const engine=new EngineClient({cache:join(out,'core')}),reference=new EngineClient({executable:join(old,'captraw-engine'),resources:join(old,'resources'),cache:join(out,'reference')});
const checks=[],pairs=[],sources={},responses={},pass=s=>{checks.push(s);console.log('PASS',s);},hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');let revision=0;
const opts=(mode='original',width=2048,height=2048,dontEnlarge=true,enabled=false)=>({size:{mode,width,height,dontEnlarge},sharpen:{enabled,amount:180,radius:1}});
function section(arp,name,values){const re=new RegExp('(\\['+name+'\\]\\n)([^\\[]*)');assert(re.test(arp));return arp.replace(re,(_,head,body)=>head+Object.entries(values).reduce((b,[key,value])=>{const r=new RegExp('^'+key+'=.*$','m');assert(r.test(b));return b.replace(r,key+'='+value);},body));}
// Independent reference uses the pre-change binary and explicit mature ART ARP fields, never the new adapter's result.
function expectedProfile(arp,o,portrait=false){let s=o.size;arp=section(arp,'Resize',{Enabled:s.mode!=='original',AppliesTo:'Cropped area',DataSpecified:s.mode==='short-edge'?(portrait?1:2):3,Width:s.width,Height:s.mode==='bounds'?s.height:s.width,AllowUpscaling:!s.dontEnlarge,Unit:'px'});return section(arp,'OutputSharpening',{Enabled:o.sharpen.enabled&&o.sharpen.amount>0,Method:'usm',Contrast:25,Radius:o.sharpen.radius,Amount:o.sharpen.amount});}
async function open(name,modify){const path=resolve('build/samples',name);sources[path]=hash(path);const im=await engine.call('open',{path,sessionId:name});const adjustments=modify?modify(im):im.adjustments;const wait=engine.preview(++revision,'fit',120000);const r=await engine.call('update',{revision,adjustments});await wait;return {path,width:im.width,height:im.height,adjustments,artProfile:r.artProfile};}
async function compare(doc,name,o,dimensions,portrait=false){const output=join(out,name+'.tiff'),expected=join(out,name+'-reference.tiff');const result=await engine.call('export',{path:doc.path,artProfile:doc.artProfile,output,format:'tiff',colorSpace:'srgb',...(o?{options:o}:{})});assert.deepEqual([result.width,result.height],dimensions);await reference.call('export',{path:doc.path,artProfile:o?expectedProfile(doc.artProfile,o,portrait):doc.artProfile,output:expected,format:'tiff',colorSpace:'srgb'});pairs.push({actual:output,expected,dimensions});return output;}
try{
 const doc=await open('luminance-range.png');
 await compare(doc,'legacy',undefined,[1024,256]);await compare(doc,'original',opts(),[1024,256]);
 for(const [name,o,d] of [['long',opts('long-edge',512),[512,128]],['short',opts('short-edge',128),[512,128]],['bounds',opts('bounds',300,200),[300,75]],['no-upscale',opts('short-edge',512),[1024,256]],['upscale',opts('short-edge',320,2048,false),[1280,320]],['near-one',opts('long-edge',1024),[1024,256]]])await compare(doc,name,o,d);
 pass('original, long/short edge, bounds, upscale and no-upscale match independent 0.24 ART outputs and exact dimensions');
 responses.off=await compare(doc,'sharp-off',opts('long-edge',512),[512,128]);responses.on=await compare(doc,'sharp-on',opts('long-edge',512,2048,true,true),[512,128]);
 await compare(doc,'sharp-original',opts('original',2048,2048,true,true),[1024,256]);const zero=opts('long-edge',512,2048,true,true);zero.sharpen.amount=0;await compare(doc,'sharp-zero',zero,[512,128]);
 const detail={...doc,path:resolve('build/samples/output-detail.tiff')};sources[detail.path]=hash(detail.path);
 responses.detailOff=await compare(detail,'texture-off',opts('long-edge',256),[256,192]);responses.detailOn=await compare(detail,'texture-on',opts('long-edge',256,2048,true,true),[256,192]);
 pass('output USM uses full-quality ART post-resize stage, including original size and zero amount');
 const inherited={...doc,artProfile:expectedProfile(doc.artProfile,opts('long-edge',256,2048,true,true))};await compare(inherited,'inherited',undefined,[256,64]);await compare(inherited,'explicit-original',opts(),[1024,256]);
 pass('legacy callers retain inherited ART output fields; explicit UI original/off overrides only the export snapshot');
 const invalid=[null,{},opts('invalid'),opts('long-edge',1),opts('short-edge',65000,2048,false),opts('bounds',0,200),opts('bounds',100.5,200),{...opts(),sharpen:{enabled:true,amount:301,radius:.5}},{...opts(),sharpen:{enabled:1,amount:100,radius:.5}},{...opts(),sharpen:{enabled:true,amount:100,radius:0}}];
 for(const [i,options] of invalid.entries()){const output=join(out,'invalid-'+i+'.tiff');rmSync(output,{force:true});await assert.rejects(engine.call('export',{path:doc.path,artProfile:doc.artProfile,output,format:'tiff',options}));assert(!existsSync(output));}
 assert.equal((await engine.call('save')).artProfile,doc.artProfile);pass('malformed settings, zero-rounded edge and excessive output reject without creating files or changing the active recipe');
 const docs=[];
 for(const name of ['nikon-d850.NEF','canon-r5.CR3','fuji-xt4.RAF']){
  const d=await open(name,im=>({...im.adjustments,rotation:90,crop:{x:300/im.width,y:200/im.height,width:512/im.width,height:384/im.height},exposure:.4,sharpening:65,masks:[{id:'m',name:'渐变',type:'linear',enabled:true,inverted:false,feather:40,brightness:.4,contrast:10,saturation:8,points:[],start:{x:.1,y:.1},end:{x:.6,y:.7}}]}));
  const sharpened=await compare(d,name+'-short',opts('short-edge',192,2048,true,true),[192,256],true);
  if(name==='nikon-d850.NEF'){responses.rawOn=sharpened;responses.rawOff=await compare(d,name+'-no-sharp',opts('short-edge',192),[192,256],true);}
  await compare(d,name+'-bounds',opts('bounds',240,240),[180,240],true);docs.push(d);
 }
 pass('NEF CR3 and X-Trans rotated crops with local masks and global sharpening match the independent mature pipeline');
 const events=[],queue=new BatchExporter(binary,resources,join(out,'queue'),j=>events.push(j));
 const directory=join(out,'batch');rmSync(directory,{recursive:true,force:true});mkdirSync(directory);
 const mutable={documents:docs,format:'tiff',colorSpace:'srgb',options:opts('short-edge',192,2048,true,true)};
 const pending=queue.run(mutable,directory);mutable.options.size.width=5;mutable.options.sharpen.enabled=false;const results=await pending;assert.equal(events.at(-1).state,'done');assert(results.every(r=>r.output));
 for(const [i,r]of results.entries())pairs.push({actual:r.output,expected:join(out,docs[i].path.split('/').at(-1)+'-short-reference.tiff'),dimensions:[192,256]});
 for(const options of [null,{},opts('bad')])assert.throws(()=>validateBatch({...mutable,options}));
 pass('batch captures output options immutably for all three RAWs and rejects invalid options before starting');
 for(const [p,h]of Object.entries(sources))assert.equal(hash(p),h);pass('all source images remain byte-identical');
}finally{await engine.stop();await reference.stop();writeFileSync(join(out,'report.json'),JSON.stringify({checks,pairs,sources,responses,engine:binary,engineSHA256:hash(binary),offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE},null,2)+'\n');}
