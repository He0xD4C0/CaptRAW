import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {validatePerspective} from '@captraw/contracts';
import {adjustmentCommand,applyEditCommand} from '@captraw/contracts/synchronize';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {encodeAdjustments,decodeAdjustments,CRS,CT,property,text,encode,lookup,readExtension} from '@captraw/desktop-core/xmp';
const old={enabled:true,horizontal:0,vertical:0,angle:0,shear:0,focalLength:0,cropFactor:1,aspect:1,manualModel:'art-perspective-v1',scale:1,offsetX:0,offsetY:0,constrainCrop:false};
const signed=extra=>({...old,aspect:0,manualModel:'signed-framing-v1',...extra});
test('native UI ranges have a distinct model; legacy ART ranges remain valid',()=>{
 for(const aspect of [-100,0,100])for(const scale of [.5,1,1.5])for(const offsetX of [-100,100])validatePerspective(signed({aspect,scale,offsetX,offsetY:-offsetX}));
 for(const extra of [{aspect:101},{aspect:-101},{scale:.499},{scale:1.501},{offsetX:100.1},{offsetY:-100.1}])assert.throws(()=>validatePerspective(signed(extra)));
 validatePerspective({...old,aspect:2,scale:4,offsetX:.5});assert.throws(()=>validatePerspective({...old,aspect:25}));
});
test('signed framing uses standard-only active values and exact public units',()=>{
 const p=signed({aspect:25,scale:1.1,offsetX:10,offsetY:-10}),properties=encodeAdjustments({perspective:p}),privateP=readExtension(properties,'ARTAdjustments').perspective;
 for(const key of ['aspect','scale','offsetX','offsetY'])assert(!Object.hasOwn(privateP,key));
 for(const [key,value] of [['PerspectiveAspect','25'],['PerspectiveScale','110'],['PerspectiveX','10'],['PerspectiveY','-10']])assert.equal(lookup(properties,CRS,key).value,value);
 assert.deepEqual(decodeAdjustments(properties).adjustments.perspective,p);
 const paused={...p,enabled:false},pausedProperties=encodeAdjustments({perspective:paused});assert.deepEqual(decodeAdjustments(pausedProperties).adjustments.perspective,paused);
 assert.equal(readExtension(pausedProperties,'ARTAdjustments').perspective.aspect,25);assert.equal(lookup(pausedProperties,CRS,'PerspectiveAspect').value,'0');
 assert.throws(()=>decodeAdjustments([...properties.filter(n=>n.name!=='ARTAdjustments'),property(CT,'ARTAdjustments',encode({perspective:p}))]),/重复定义/);
});
test('foreign neutral does not activate; old private and inherited ARP are not reinterpreted',()=>{
 const fields=[property(CRS,'PerspectiveAspect',text(0)),property(CRS,'PerspectiveScale',text(100)),property(CRS,'PerspectiveX',text(0)),property(CRS,'PerspectiveY',text(0))];assert.equal(decodeAdjustments(fields).adjustments.perspective,undefined);
 const nonzero=fields.map(p=>p.name==='PerspectiveAspect'?property(CRS,p.name,text(25)):p);assert.equal(decodeAdjustments(nonzero).adjustments.perspective.aspect,25);assert.equal(decodeAdjustments(nonzero).adjustments.perspective.manualModel,'signed-framing-v1');
 const inherited=decodeAdjustments([...nonzero,property(CT,'ARTProfile',encode('[Perspective]\nAspect=1.3\n'))]);assert.equal(inherited.adjustments.perspective,undefined);
 const privateState=decodeAdjustments([...nonzero,property(CT,'ARTAdjustments',encode({perspective:{...old,aspect:1.3}}))]);assert.equal(privateState.adjustments.perspective.aspect,1.3);assert.equal(privateState.adjustments.perspective.manualModel,'art-perspective-v1');
});
test('same-model edits stay sparse and cross-model offsets preserve target geometry and model',()=>{
 const before={perspective:signed({aspect:25,scale:1.1})},after={perspective:{...before.perspective,offsetX:10}},command=adjustmentCommand(before,after,'signed-x');
 assert.deepEqual(command.perspectiveModelSnapshot,after.perspective);
 const target={perspective:signed({aspect:-30,scale:.8,offsetY:20})},result=applyEditCommand(target,command);assert.equal(result.perspective.aspect,-30);assert.equal(result.perspective.scale,.8);assert.equal(result.perspective.offsetY,20);assert.equal(result.perspective.offsetX,10);
 const legacy={rotation:90,fineRotation:2,flipHorizontal:true,perspective:{...old,aspect:1.3,scale:1.4,offsetX:.1,vertical:12,horizontal:-8,angle:3,shear:2,focalLength:100,cropFactor:1.5}},applied=applyEditCommand(legacy,command),converted=applied.perspective;
 assert.equal(converted.manualModel,'art-perspective-v1');assert.equal(converted.offsetX,.072);for(const key of ['aspect','scale','offsetY','vertical','horizontal','angle','shear','focalLength','cropFactor'])assert.equal(converted[key],legacy.perspective[key],key);for(const key of ['rotation','fineRotation','flipHorizontal'])assert.equal(applied[key],legacy[key],key);
 const invalid=structuredClone(command);delete invalid.perspectiveModelSnapshot;assert.throws(()=>applyEditCommand(legacy,invalid),/完整参数快照/);
 const fresh={perspective:{enabled:false,horizontal:7,vertical:12,angle:2,shear:3,focalLength:0,cropFactor:1,aspect:1}},promoted=applyEditCommand(fresh,command).perspective;assert.equal(promoted.manualModel,'signed-framing-v1');assert.equal(promoted.aspect,0);assert.equal(promoted.offsetX,10);for(const key of ['horizontal','vertical','angle','shear'])assert.equal(promoted[key],fresh.perspective[key]);
 const firstUse=adjustmentCommand({perspective:{...fresh.perspective,horizontal:0,vertical:0,angle:0,shear:0}},{perspective:signed({offsetX:10})},'first-use');for(const key of ['aspect','scale','offsetY','constrainCrop'])assert(!Object.hasOwn(firstUse.merge.perspective,key),'neutral model spelling is not a user edit: '+key);
 const firstConverted=applyEditCommand(legacy,firstUse).perspective;assert.equal(firstConverted.aspect,1.3);assert.equal(firstConverted.scale,1.4);assert.equal(firstConverted.vertical,12);assert.equal(firstConverted.manualModel,'art-perspective-v1');
});
test('cross-model aspect and scale preserve the target complementary framing quantity',()=>{
 const before={perspective:signed({aspect:25,scale:1.1})},target={perspective:{...old,aspect:1.2,scale:1.4,vertical:12}};
 const aspect=applyEditCommand(target,adjustmentCommand(before,{perspective:{...before.perspective,aspect:50}},'aspect')).perspective;
 assert(Math.abs(aspect.aspect-1/1.1)<1e-14);assert(Math.abs(aspect.scale-1.4/Math.sqrt(1.2)*Math.sqrt(1.1))<1e-14);assert.equal(aspect.vertical,12);
 const scale=applyEditCommand(target,adjustmentCommand(before,{perspective:{...before.perspective,scale:1.3}},'scale')).perspective;
 assert.equal(scale.aspect,1.2);assert(Math.abs(scale.scale-1.3*Math.sqrt(1.2))<1e-14);
 const reverseBefore={perspective:old},reverseTarget={perspective:signed({aspect:50,scale:1.1,vertical:-9})};
 const reverse=applyEditCommand(reverseTarget,adjustmentCommand(reverseBefore,{perspective:{...old,aspect:1.1}},'reverse-aspect')).perspective;
 assert(Math.abs(reverse.aspect+50)<1e-12);assert(Math.abs(reverse.scale-1.1)<1e-14);assert.equal(reverse.vertical,-9);assert.equal(reverse.manualModel,'signed-framing-v1');
});
test('unrepresentable mixed edits reject before any mutation; explicit model reset remains complete',()=>{
 const before={perspective:signed({})},target={perspective:{...old,vertical:11}},prior=structuredClone(target);
 assert.throws(()=>applyEditCommand(target,adjustmentCommand(before,{perspective:signed({offsetX:100})},'outside')),/无法无损转换/);assert.deepEqual(target,prior);
 const source={perspective:{...old,scale:4}},signedTarget={perspective:signed({})};assert.throws(()=>applyEditCommand(signedTarget,adjustmentCommand(source,{perspective:{...source.perspective,scale:3}},'large-scale')),/无法无损转换/);
 const reset=adjustmentCommand(target,{perspective:signed({enabled:false})},'explicit-reset');assert(reset.set.perspective);assert.deepEqual(applyEditCommand(target,reset).perspective,signed({enabled:false}));
});
test('one unrepresentable target rejects the whole service request before worker creation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'captraw-mixed-model-'));let passed=false;
 try{
 const before={perspective:signed({}),masks:[]},after={...before,perspective:signed({offsetX:100})},source={image:{path:'source'},adjustments:before,profile:''};
 const targets=[{image:{path:'first'},adjustments:{...before,perspective:signed({vertical:7})},profile:''},{image:{path:'second'},adjustments:{...before,perspective:{...old,vertical:11}},profile:''}],prior=structuredClone(targets),progress=[];
 const service=new Synchronizer(join(root,'must-not-start-worker'),'',join(root,'must-not-create-cache'),message=>progress.push(message));
 await assert.rejects(service.run({source,targets,groups:[],command:adjustmentCommand(before,after,'atomic-mixed')}),/无法无损转换/);
 assert.deepEqual(targets,prior);assert.deepEqual(progress,[]);assert.equal(service.worker,undefined);assert.deepEqual(await readdir(root),[]);passed=true;
 }finally{if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained mixed-model failure:',root);}
});
