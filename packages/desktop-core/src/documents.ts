import {ENGINE_VERSION,type EditDocument} from '@captraw/contracts';
import {XMP,CRS,CT,property,text,encode,readExtension,encodeAdjustments,decodeAdjustments,type XMPProperty} from './xmp.js';
export class Documents {
 constructor(readonly xmp:XMP){}
 async read(path:string){
  const result=await this.xmp.read(path);
  const engineVersion=readExtension(result.properties,'EngineVersion')||'';
  if(engineVersion&&engineVersion!==ENGINE_VERSION)throw new Error('XMP 使用了不支持的 ART 显影版本。');
  const {adjustments,warnings}=decodeAdjustments(result.properties);
  const source=readExtension(result.properties,'Source');
  if(source&&(!source.path||!Number.isSafeInteger(source.size)||!/^[a-f0-9]{64}$/.test(source.sha256)))throw new Error('XMP 原片关联无效。');
  const baselineVersion=readExtension(result.properties,'BaselineVersion');if(baselineVersion!==undefined&&baselineVersion!==4)throw new Error('XMP 初始显影版本不受支持。');
  const artProfile=readExtension(result.properties,'ARTProfile')||'';if(typeof artProfile!=='string')throw new Error('无效的 ART 配置。');
  return {xmpPacket:result.packet,engineVersion,source,artProfile,adjustments,warnings,baselineVersion:4 as const,maskAssets:readExtension(result.properties,'MaskAssets'),inputProfileAsset:readExtension(result.properties,'InputProfileAsset')};
 }
 async serialize(doc:EditDocument){
  const changes:XMPProperty[]=[...encodeAdjustments(doc.adjustments),property(CT,'EngineVersion',encode(ENGINE_VERSION)),property(CT,'Source',encode(doc.source)),property(CT,'ARTProfile',encode(doc.artProfile)),property(CT,'BaselineVersion',encode(4)),property(CT,'MaskAssets',doc.maskAssets?encode(doc.maskAssets):null),property(CT,'InputProfileAsset',doc.inputProfileAsset?encode(doc.inputProfileAsset):null),property(CRS,'HasSettings',text('True'))];
  // Do not claim the Adobe renderer version for an ART-produced image.
  if(!doc.xmpPacket)changes.push(property(CRS,'ProcessVersion',text('15.4')));
  const result=await this.xmp.call('write',doc.xmpPacket||'',changes);return result.packet!;
 }
}
