import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {parseEnhancedProfile,enhancedLookProperties,preserveEnhancedLookField} from '@captraw/desktop-core/enhanced-profiles';
import {encodeAdjustments,decodeAdjustments,encode,decode,mergeXMPNode,CRS,CT} from '@captraw/desktop-core/xmp';
import {InputProfiles} from '@captraw/desktop-core/input-profiles';
import {SYNC_GROUPS,synchronizedAdjustments,adjustmentCommand,applyEditCommand} from '@captraw/contracts/synchronize';
import {presetAmount} from '@captraw/contracts/presets';
const id='1234567890ABCDEF1234567890ABCDEF',uuid='ABCDEF1234567890ABCDEF1234567890';
const value=(name,value)=>({ns:CRS,name,node:{value}});
const properties=()=>[value('PresetType','Look'),value('UUID',uuid),value('SupportsAmount','True'),value('CameraProfile','Adobe Standard'),value('RGBTable',id),value('RGBTableAmount','0.5'),value('Table_'+id,'independently-validated-by-native'),{ns:CRS,name:'Name',node:{items:[{value:'中文 Look 空格',lang:'x-default'}]}},{ns:CRS,name:'Group',node:{items:[{value:'测试',lang:'x-default'}]}}];
const colorProfile=p=>({mode:'auto',toneCurve:false,lookTable:false,hueSatMap:true,baselineExposure:true,illuminant:0,look:{profile:p,amount:1.5}});
test('asset-incomplete Look is rejected before application; scene settings cannot substitute for tables',()=>{
 const p=properties().filter(v=>!v.name.startsWith('Table_'));p.push(value('Exposure2012','+1.0'));
 assert.throws(()=>parseEnhancedProfile(p,'original'),/缺少 RGBTable 资产/);
 assert.throws(()=>parseEnhancedProfile(properties().filter(v=>v.name!=='UUID'),'original'),/UUID/);
 assert.throws(()=>parseEnhancedProfile(properties().map(p=>p.name==='RGBTable'?value('RGBTable','../../asset'):p),'original'),/标识无效/);
});
test('standard nested Look preserves amount, non-English metadata, arbitrary fields and qualifiers',()=>{
 const profile=parseEnhancedProfile(properties(),'original').profile;
 const custom={ns:'https://example.invalid/opaque/',name:'Metadata',node:{fields:[{ns:'https://example.invalid/opaque/',name:'Value',node:{value:'保留',qualifiers:[{ns:'https://example.invalid/opaque/',name:'Unit',node:{value:'原文'}}]}}]}};
 profile.standardLook.fields.push(custom);
 const result=enhancedLookProperties(colorProfile(profile),[]),look=result.find(p=>p.name==='Look');
 const parsed=parseEnhancedProfile(result,'saved');assert.equal(parsed.amount,1.5);assert.equal(parsed.profile.name,'中文 Look 空格');
 assert.deepEqual(look.node.fields.find(p=>p.name==='Metadata'),custom);
 const packet=encodeAdjustments({colorProfile:colorProfile(profile)});
 const restored=decodeAdjustments(packet).adjustments.colorProfile;
 assert.equal(restored.look.amount,1.5);assert.equal(restored.look.profile.xmpPacket,'original');
 const group=look.node.fields.find(p=>p.name==='Group').node;assert.equal(group.localized,undefined);assert.equal(group.options,0x1e00);assert(group.items.some(p=>p.lang==='x-default'&&p.value==='测试'));
});
test('switching Look replaces managed Parameters while retaining unrelated unknown structure',()=>{
 const profile=parseEnhancedProfile(properties(),'original').profile,old=enhancedLookProperties(colorProfile(profile),[]);
 const params=old.find(p=>p.name==='Look').node.fields.find(p=>p.name==='Parameters').node.fields;
 params.push(value('LookTable','FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'),value('Clarity2012','50'),{ns:'https://example.invalid/opaque/',name:'Keep',node:{value:'yes'}});
 const next=enhancedLookProperties(colorProfile(profile),old).find(p=>p.name==='Look').node.fields.find(p=>p.name==='Parameters').node.fields;
 assert(!next.some(p=>p.name==='LookTable'||p.name==='Clarity2012'));assert(next.some(p=>p.name==='Keep'));
 assert.equal(enhancedLookProperties({...colorProfile(profile),look:undefined},old).find(p=>p.name==='Look').node,null);
 assert(!encodeAdjustments({exposure:1},old).some(p=>p.name==='Look'));
});
test('Look edit commands replace complete asset bundles, preserve arrays and explicitly clear across JSON IPC',()=>{
 const before={colorProfile:{mode:'auto',toneCurve:false,lookTable:false,hueSatMap:true,baselineExposure:true,illuminant:0}},profile=parseEnhancedProfile(properties(),'original').profile;
 profile.curve=[{x:0,y:0},{x:.4,y:.6},{x:1,y:1}];
 const after={colorProfile:{...before.colorProfile,look:{profile,amount:1.5}}},command=JSON.parse(JSON.stringify(adjustmentCommand(before,after,'look'))),result=applyEditCommand(before,command);
 assert.deepEqual(result,after);assert(Array.isArray(result.colorProfile.look.profile.tables));assert(Array.isArray(result.colorProfile.look.profile.curve));
 const next=structuredClone(after);next.colorProfile.look.amount=.5;
 assert.deepEqual(applyEditCommand(result,JSON.parse(JSON.stringify(adjustmentCommand(result,next,'amount')))),next);
 const cleared={colorProfile:{...before.colorProfile,look:null}},clear=JSON.parse(JSON.stringify(adjustmentCommand(result,cleared,'clear')));
 assert.equal(clear.merge.colorProfile.look,null);assert.deepEqual(applyEditCommand(result,clear),cleared);
});
test('lossless Look merge removes old curve and controls without dropping unknown nested fields or surviving qualifiers',()=>{
 const profile=parseEnhancedProfile(properties(),'original').profile,settings=colorProfile(profile),opaque={ns:'urn:opaque-look',name:'Nested',node:{fields:[{ns:'urn:opaque-look',name:'Text',node:{value:'未知',qualifiers:[{ns:'urn:opaque-look',name:'Unit',node:{value:'原文'}}]}}]}};
 const old=enhancedLookProperties(settings,[]).find(p=>p.name==='Look').node;
 const parameters=old.fields.find(p=>p.name==='Parameters').node;
 parameters.fields.push({ns:CRS,name:'ToneCurvePV2012',node:{items:[{value:'0, 0'},{value:'255, 204'}]}},value('Clarity2012','50'),opaque);
 parameters.qualifiers=[{ns:'urn:opaque-look',name:'StructNote',node:{value:'保留'}}];
 const table=parameters.fields.find(p=>p.name==='RGBTable');table.node.qualifiers=[{ns:'urn:opaque-look',name:'TableNote',node:{value:'限定符'}}];
 const next=enhancedLookProperties(settings,[]).find(p=>p.name==='Look').node,merged=mergeXMPNode(old,next,preserveEnhancedLookField,'Look').fields.find(p=>p.name==='Parameters').node;
 assert(!merged.fields.some(p=>['ToneCurvePV2012','Clarity2012'].includes(p.name)));assert.deepEqual(merged.fields.find(p=>p.name==='Nested'),opaque);assert.deepEqual(merged.qualifiers,parameters.qualifiers);assert.deepEqual(merged.fields.find(p=>p.name==='RGBTable').node.qualifiers,table.node.qualifiers);
 const oldPrivate=encode({colorProfile:{look:{profile:{...profile,curve:[{x:0,y:0},{x:1,y:.8}],parameters:{...profile.parameters,Clarity2012:'50'},FutureMetadata:{nested:'保留'}}}}});
 const newPrivate=encode({colorProfile:{look:{profile}}});
 const restored=decode(mergeXMPNode(oldPrivate,newPrivate,preserveEnhancedLookField,'ARTAdjustments')).colorProfile.look.profile;
 assert.equal(restored.curve,undefined);assert.equal(restored.parameters.Clarity2012,undefined);assert.deepEqual(restored.FutureMetadata,{nested:'保留'});
});
test('curve-only Look needs no table, while a referenced absent table remains an error',()=>{
 const points={ns:CRS,name:'ToneCurvePV2012',node:{options:0x600,items:[{value:'0, 0'},{value:'102, 153'},{value:'255, 255'}]}};
 const curveOnly=properties().filter(p=>!['CameraProfile','RGBTable','RGBTableAmount'].includes(p.name)&&!p.name.startsWith('Table_'));curveOnly.push(points);
 const parsed=parseEnhancedProfile(curveOnly,'curve-only');assert.deepEqual(parsed.profile.tables,[]);assert.equal(parsed.profile.curve.length,3);assert.equal(parsed.profile.baseProfile,'');
 assert.throws(()=>parseEnhancedProfile([...curveOnly,value('RGBTable',id)],''),/缺少 RGBTable/);
 const empty=curveOnly.filter(p=>p.name!=='ToneCurvePV2012');assert.throws(()=>parseEnhancedProfile(empty,''),/没有表、曲线或支持/);
});
test('standard Look conflicts reject instead of silently rebinding an edited profile to another table',()=>{
 const profile=parseEnhancedProfile(properties(),'original').profile,packet=encodeAdjustments({colorProfile:colorProfile(profile)});
 const look=packet.find(p=>p.name==='Look');look.node.fields.find(p=>p.name==='Parameters').node.fields.find(p=>p.name==='RGBTableAmount').node.value='1.5';
 assert.throws(()=>decodeAdjustments(packet),/表资产冲突/);
});
test('profile/Look is an explicit synchronization group; ordinary preset amount does not invent ICC/DCP strength',()=>{
 assert(SYNC_GROUPS.find(g=>g.id==='profile').fields.includes('colorProfile'));
 const p=colorProfile(parseEnhancedProfile(properties(),'original').profile),source={adjustments:{colorProfile:p}},target={adjustments:{exposure:0,colorProfile:{mode:'matrix'}}};
 const copied=synchronizedAdjustments(source,target,['profile']);assert.deepEqual(copied.colorProfile,p);assert.notEqual(copied.colorProfile,p);
 const scaled=presetAmount({colorProfile:p},50);assert.deepEqual(scaled.adjustments.colorProfile,p);assert(scaled.warnings.some(w=>w.includes('colorProfile')));
});
test('base DCP must resolve uniquely and match camera; portable existing references survive library removal',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'captraw-enhanced-contract-'));let success=false;
 try{
  const root=join(scratch,'library');await mkdir(root);const imported=Buffer.from('DCP Adobe Standard fixture'),sha=createHash('sha256').update(imported).digest('hex'),path=join(root,sha+'.dcp');
  const core={call:async(method,{path})=>{assert.equal(method,'inspectInputProfile');return {id:'inherited',reference:'file:'+path,kind:'dcp',name:'Adobe Standard',cameraModel:'NIKON D850',dcp:{toneCurve:true,lookTable:true,hueSatMap:true,baselineExposure:true,illuminants:[]}};}};
  const library=new InputProfiles(root,core),profile=parseEnhancedProfile(properties(),'original').profile,option={id:'inherited',kind:'look',name:profile.name,enhanced:profile};
  await assert.rejects(library.resolveLook(option,'NIKON D850',true),/缺少基础 DCP/);
  await writeFile(path,imported);const resolved=await library.resolveLook(option,'NIKON D850',true);assert.equal(resolved.settings.reference,'file:'+path);assert.equal(resolved.settings.toneCurve,true);
  await assert.rejects(library.resolveLook(option,'NIKON D850',false),/不能应用于已渲染/);
  await assert.rejects(library.resolveLook(option,'OTHER CAMERA',true),/缺少基础 DCP/);
  const portable=join(scratch,'document.dcp');await writeFile(portable,imported);await rm(path);
  const settings=await library.resolveSettings({...resolved.settings,reference:'file:'+portable},'NIKON D850',true);assert.equal(settings.reference,'file:'+portable);
  const unnamed=structuredClone(option);unnamed.enhanced.baseProfile='';delete unnamed.enhanced.parameters.CameraProfile;
  const fallback=await library.resolveLook(unnamed,'NIKON D850',true);assert.equal(fallback.settings.mode,'auto');assert.equal(fallback.settings.reference,undefined);
  const explicitCurrent={...fallback.settings,mode:'inherited',reference:'file:'+portable};assert.deepEqual(await library.resolveSettings(explicitCurrent,'NIKON D850',true),explicitCurrent);
  success=true;
 }finally{if(success)await rm(scratch,{recursive:true,force:true});else console.error('Retained enhanced profile failure:',scratch);}
});
