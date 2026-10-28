import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from './engine-client.mjs';
import {capturePreset,validatePreset,presetValidationBase} from '@captraw/contracts/presets';
import {synchronizedAdjustments,DEFAULT_SYNC_GROUPS} from '@captraw/contracts/synchronize';
const root=resolve(process.env.CAPTRAW_PERSPECTIVE_OUT||'artifacts/perspective');mkdirSync(root,{recursive:true});const out=mkdtempSync(join(root,'run-'));
const source=join(out,'grid.png'),python=resolve('build/qa-venv/bin/python'),old=resolve('/Users/he0xd4c0/Applications/CaptRAW-0.51.app/Contents/Resources/native');
const current=new EngineClient({cache:join(out,'current-cache')}),reference=new EngineClient({executable:join(old,'captraw-engine'),resources:join(old,'resources'),cache:join(out,'reference-cache')});
const checks=[],pairs=[],errors=[],rejections=[];let failure,revision=0;
for(const engine of [current,reference])engine.on('error',e=>errors.push(e));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const pass=s=>{checks.push(s);console.log('PASS',s);};
const defaults={enabled:false,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1};
const fieldNames={enabled:'Enabled',horizontal:'Horizontal',vertical:'Vertical',angle:'Angle',shear:'Shear',focalLength:'FocalLength',cropFactor:'CropFactor',aspect:'Aspect'};
function profile(p,settings){const part=p.match(/\[Perspective\]\n[\s\S]*?(?=\n\[|$)/);assert(part);let text=part[0];for(const [key,value] of Object.entries(settings)){const pattern=new RegExp('^'+fieldNames[key]+'=.*$','m');assert(pattern.test(text));text=text.replace(pattern,fieldNames[key]+'='+value);}return p.replace(part[0],text);}
async function render(engine,adjustments,artProfile){const next=++revision,pending=engine.preview(next);const result=await engine.call('update',{revision:next,adjustments,artProfile});return {...result,frame:await pending};}
try{
 execFileSync(python,['-c',`from PIL import Image,ImageDraw\nimport sys\na=Image.new('RGB',(640,480),(60,60,60));d=ImageDraw.Draw(a)\nfor x in range(30,640,70):d.line((x,0,x,479),fill=(230,60,30),width=5)\nfor y in range(20,480,60):d.line((0,y,639,y),fill=(30,180,220),width=5)\na.save(sys.argv[1])`,source]);
 const sourceHash=hash(source),im=await current.call('open',{path:source,sessionId:'perspective'});await reference.call('open',{path:source,sessionId:'reference'});
 assert.deepEqual(im.adjustments.perspective,defaults);const base={...im.adjustments};delete base.perspective;
 const neutral=await render(current,base,im.artProfile);
 const cases=[defaults,...['horizontal','vertical','angle','shear'].flatMap(key=>[-1,1].map(sign=>({...defaults,enabled:true,[key]:sign*({horizontal:40,vertical:35,angle:7,shear:12}[key])}))),{...defaults,enabled:true,horizontal:25,vertical:-15,angle:2,shear:3,focalLength:10,cropFactor:1.5}];
 for(const [i,settings] of cases.entries()){
  const a={...base,perspective:settings},expected=profile(im.artProfile,settings),actual=await render(current,a,im.artProfile),oracle=await render(reference,base,expected);
  assert.equal(actual.artProfile,oracle.artProfile);assert.equal(hash(actual.frame.file),hash(oracle.frame.file));if(i)assert.notEqual(hash(actual.frame.file),hash(neutral.frame.file),'Control must change actual pixels');
  const checked=await current.call('validate',{adjustments:a,artProfile:im.artProfile});assert.deepEqual(checked.perspective,settings);
  for(const [engine,name,p] of [[current,'current',actual.artProfile],[reference,'reference',expected]])await engine.call('export',{path:source,artProfile:p,format:'tiff',output:join(out,name+'.tiff')});
  const pixels=JSON.parse(execFileSync(python,['-c',`import tifffile,numpy as np,json,sys\na,b=[tifffile.imread(p) for p in sys.argv[1:]]\nassert a.dtype==b.dtype==np.uint16 and np.array_equal(a,b)\nwith tifffile.TiffFile(sys.argv[1]) as x,tifffile.TiffFile(sys.argv[2]) as y: icc=x.pages[0].tags[34675].value;assert icc==y.pages[0].tags[34675].value\nprint(json.dumps(dict(shape=list(a.shape),maximumDifference=0,iccBytes=len(icc))))`,join(out,'current.tiff'),join(out,'reference.tiff')],{encoding:'utf8'}));
  pairs.push({settings,...pixels});
 }
 pass('10 neutral, signed and combined cases: actual preview and TIFF16/ICC match independent installed 0.51 with manually authored ART parameters');
 const inherited={...cases.at(-1),enabled:false,aspect:1.2},stored=profile(im.artProfile,inherited);
 assert.deepEqual((await current.call('validate',{artProfile:stored,adjustments:base})).perspective,inherited);
 assert.equal((await current.call('compose',{path:source,width:640,height:480,artProfile:stored,adjustments:base})).artProfile,stored);
 const off=await render(current,{...base,perspective:inherited},stored);assert.equal(hash(off.frame.file),hash(neutral.frame.file));
 pass('omitted metadata preserves imported enabled state and all ART parameters; disabled nonzero settings render neutral');
 for(const [key,value] of [['enabled',1],['horizontal',201],['vertical',-201],['angle',20.1],['shear',-51],['focalLength',-1],['cropFactor',0],['aspect',3],['horizontal','1'],['vertical',null]]){
  await assert.rejects(current.call('validate',{artProfile:im.artProfile,adjustments:{...base,perspective:{...defaults,[key]:value}}}));rejections.push({key,value});
 }
 for(const value of [null,[],{},true])await assert.rejects(current.call('validate',{artProfile:im.artProfile,adjustments:{...base,perspective:value}}));
 const recovered=await render(current,{...base,perspective:defaults},im.artProfile);assert.equal(hash(recovered.frame.file),hash(neutral.frame.file));pass('14 malformed or out-of-range configurations rejected; valid rendering remains usable');
 const from={image:{path:source,width:640,height:480},adjustments:{...base,perspective:cases.at(-1)},profile:stored},to={...from,adjustments:{...base,perspective:defaults}};
 const preset=capturePreset({name:'透视',group:'测试',groups:['perspective'],adjustments:from.adjustments});validatePreset(preset);assert.deepEqual(Object.keys(preset.adjustments),['perspective']);
 assert.deepEqual(synchronizedAdjustments(from,to,['perspective']).perspective,from.adjustments.perspective);assert.deepEqual(synchronizedAdjustments(from,to,['light']).perspective,defaults);assert(!DEFAULT_SYNC_GROUPS.includes('perspective'));
 await current.call('validate',{artProfile:'',adjustments:{...presetValidationBase,...preset.adjustments}});pass('perspective has an explicit independent preset/sync group; default tonal sync preserves target geometry');
 assert.equal(hash(source),sourceHash);assert.deepEqual(errors,[]);
}catch(e){failure=e.stack;throw e;}finally{
 await current.stop();await reference.stop();for(const name of ['current-cache','reference-cache'])rmSync(join(out,name),{recursive:true,force:true});
 writeFileSync(join(out,'report.json'),JSON.stringify({passed:!failure&&!errors.length,checks,pairs,rejections,errors,failure},null,2)+'\n');console.log('REPORT',join(out,'report.json'));
}
