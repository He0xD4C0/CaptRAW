import type {EnhancedProfileData,ColorProfileSettings} from '@captraw/contracts';
import type {XMPProperty,XMPNode} from '../documents/xmp.js';
import {mergeXMPNode} from '../documents/xmp.js';
const CRS='http://ns.adobe.com/camera-raw-settings/1.0/';
const node=(fields:XMPProperty[],key:string)=>fields.find(p=>p.ns===CRS&&p.name===key)?.node;
const label=(n?:XMPNode|null)=>n?.items?.find(v=>v.lang==='x-default')?.value??n?.items?.[0]?.value??n?.value??'';
const scalar=(n:XMPNode|null|undefined,key:string)=>{if(!n)return '';if(n.fields||n.items||n.value===undefined)throw new Error('Look 字段必须为文本：'+key);return n.value;};
const fingerprint=(id:string)=>/^[a-f0-9]{32}$/i.test(id);
const managedParameter=(name:string)=>['Version','ProcessVersion','CameraProfile','LookTable','RGBTable','RGBTableAmount','RequiresRGBTables','ConvertToGrayscale','Exposure2012','Highlights2012','Shadows2012','Whites2012','Blacks2012','Clarity2012','Contrast2012','Saturation'].includes(name)||/^ToneCurvePV2012(Red|Green|Blue)?$/.test(name)||/^Parametric(Shadows|Darks|Lights|Highlights|ShadowSplit|MidtoneSplit|HighlightSplit)$/.test(name)||/^SplitToning(ShadowHue|ShadowSaturation|HighlightHue|HighlightSaturation|Balance)$/.test(name)||/^PostCropVignette(Amount|Midpoint|Feather|Roundness|Style|HighlightContrast)$/.test(name)||/^(Hue|Saturation|Luminance)Adjustment(Red|Orange|Yellow|Green|Aqua|Blue|Purple|Magenta)$/.test(name);
// Removed managed values must not return during a second lossless document merge.
// Unknown fields and qualifiers still belong to the imported/external packet.
export function preserveEnhancedLookField(path:string,field:XMPProperty){
 if(path==='Look/Parameters'&&field.ns===CRS)return !managedParameter(field.name);
 if(field.ns==='https://captraw.org/ns/develop/1.0/'){
  if(path==='ARTAdjustments/colorProfile'&&field.name==='look')return false;
  if(path==='ARTAdjustments/colorProfile/look/profile'&&['curve','standardLook'].includes(field.name))return false;
  if(path==='ARTAdjustments/colorProfile/look/profile/parameters')return !managedParameter(field.name);
 }
 return true;
}
export function isEnhancedProfile(properties:XMPProperty[]){return scalar(node(properties,'PresetType'),'PresetType')==='Look'||!!node(properties,'Look');}
export function parseEnhancedProfile(properties:XMPProperty[],packet:string):{profile:EnhancedProfileData;amount:number}{
 const look=node(properties,'Look');
 if(look&&!look.fields)throw new Error('Look 必须为标准 XMP 结构。');
 if(!look&&scalar(node(properties,'PresetType'),'PresetType')!=='Look')throw new Error('此 XMP 不是增强配置文件。');
 const metadata=look?.fields??properties,parameterNode=node(metadata,'Parameters');
 if(parameterNode&&!parameterNode.fields)throw new Error('Look Parameters 必须为 XMP 结构。');
 const fields=parameterNode?.fields??metadata;
 const get=(key:string)=>scalar(node(fields,key),key);
 const meta=(key:string)=>label(node(metadata,key));
 const flag=(key:string,defaultValue:boolean)=>{const v=meta(key).toLowerCase();if(!v)return defaultValue;if(v!=='true'&&v!=='false')throw new Error('Look 布尔字段无效：'+key);return v==='true';};
 const parameters:Record<string,string>={},tables:EnhancedProfileData['tables']=[];
 const metadataKeys=new Set(['PresetType','Cluster','UUID','Name','ShortName','SortName','Group','Description','Copyright','ContactInfo','CameraModelRestriction','SupportsAmount','SupportsColor','SupportsMonochrome','SupportsHighDynamicRange','SupportsNormalDynamicRange','SupportsSceneReferred','SupportsOutputReferred','ShowInPresets','ShowInQuickActions','HasSettings','Amount','Parameters']);
 let curve:EnhancedProfileData['curve'];
 for(const p of fields){
  if(p.ns!==CRS||p.name.startsWith('Table_')||metadataKeys.has(p.name))continue;
  if(p.name.startsWith('ToneCurvePV2012')){
   if(!p.node?.items)throw new Error('Look 色调曲线必须为 RDF 数组。');
   const points=p.node.items.map(v=>{const values=scalar(v,p.name).split(',').map(s=>Number(s.trim())/255);if(values.length!==2||values.some(n=>!Number.isFinite(n)||n<0||n>1))throw new Error('Look 曲线点无效。');return {x:values[0],y:values[1]};});
   if(p.name==='ToneCurvePV2012')curve=points;
   else if(!['ToneCurvePV2012Red','ToneCurvePV2012Green','ToneCurvePV2012Blue'].includes(p.name)||points.length!==2||points[0].x!==0||points[0].y!==0||points[1].x!==1||points[1].y!==1)throw new Error('尚不支持此 Look 的独立通道曲线：'+p.name);
  }else{if(['__proto__','prototype','constructor'].includes(p.name))throw new Error('不支持的必要 Look 参数：'+p.name);parameters[p.name]=scalar(p.node,p.name);}
 }
 for(const key of ['LookTable','RGBTable']){
  const id=get(key);if(!id)continue;
  if(!fingerprint(id))throw new Error('Look 表标识无效：'+key);
  const table=node(fields,'Table_'+id)??node(metadata,'Table_'+id)??node(properties,'Table_'+id)??[...fields,...metadata,...properties].find(p=>p.ns===CRS&&p.name.toLowerCase()==='table_'+id.toLowerCase())?.node;
  const data=scalar(table,'Table_'+id);if(!data)throw new Error(`Look 缺少 ${key} 资产 ${id}，未应用。请导入包含实际表数据的配置文件。`);
  if(!tables.some(t=>t.fingerprint.toLowerCase()===id.toLowerCase()))tables.push({fingerprint:id,data});
 }
 if(!tables.length&&!curve&&!Object.keys(parameters).some(key=>!['Version','ProcessVersion','RGBTableAmount','RequiresRGBTables'].includes(key)))throw new Error('Look 没有表、曲线或支持的显影参数。');
 const amountText=scalar(node(metadata,'Amount'),'Amount'),amount=amountText===''?1:Number(amountText);
 if(!Number.isFinite(amount)||amount<0||amount>2)throw new Error('Look 强度必须在 0–200% 之间。');
 const standardLook: XMPNode=look?structuredClone(look):{fields:metadata.filter(p=>p.ns!==CRS||['UUID','Group','Copyright','CameraModelRestriction','SupportsColor','SupportsMonochrome','SupportsSceneReferred','SupportsOutputReferred','SupportsHighDynamicRange','SupportsNormalDynamicRange'].includes(p.name)).map(p=>structuredClone(p))};
 const baseProfile=get('CameraProfile')||(look?scalar(node(properties,'CameraProfile'),'CameraProfile'):'');
 const profile:EnhancedProfileData={schemaVersion:1,uuid:meta('UUID'),name:meta('Name'),group:meta('Group'),copyright:meta('Copyright'),baseProfile,cameraModelRestriction:meta('CameraModelRestriction'),supportsAmount:flag('SupportsAmount',!!look&&amountText!==''),supportsSceneReferred:flag('SupportsSceneReferred',true),supportsOutputReferred:flag('SupportsOutputReferred',true),supportsColor:flag('SupportsColor',true),supportsMonochrome:flag('SupportsMonochrome',true),supportsHighDynamicRange:flag('SupportsHighDynamicRange',true),supportsNormalDynamicRange:flag('SupportsNormalDynamicRange',true),parameters,tables,curve,xmpPacket:packet,standardLook};
 if(!fingerprint(profile.uuid)||!profile.name)throw new Error('Look 缺少有效 UUID 或名称。');
 return {profile,amount:profile.supportsAmount?amount:1};
}
// Standard CRS structures remain authoritative; the retained packet supplies arbitrary qualifiers.
export function enhancedLookProperties(settings:ColorProfileSettings|undefined,previous:XMPProperty[]):XMPProperty[]{
 if(!settings?.look)return [{ns:CRS,name:'Look',node:null}];
 const {profile,amount}=settings.look;
 const old=node(previous,'Look');
 const value=(name:string,value:string):XMPProperty=>({ns:CRS,name,node:{value}});
 const metadata=[value('Name',profile.name),value('UUID',profile.uuid),value('Amount',String(amount))];
 if(profile.group){
  const previousGroup=node(profile.standardLook?.fields??[],'Group'),externalGroup=node(old?.fields??[],'Group');
  const items=structuredClone(previousGroup?.items??[]);
  for(const item of externalGroup?.items??[]){const i=items.findIndex(value=>value.lang===item.lang);if(i<0)items.push(structuredClone(item));else items[i]=mergeXMPNode(item,items[i]);}
  const index=items.findIndex(item=>item.lang==='x-default');
  if(index<0)items.unshift({value:profile.group,lang:'x-default'});else items[index]={...items[index],value:profile.group};
  metadata.push({ns:CRS,name:'Group',node:{...previousGroup,options:0x1e00,items}});
 }
 if(profile.copyright)metadata.push(value('Copyright',profile.copyright));
 const fields=Object.entries(profile.parameters).map(([name,v])=>value(name,v));
 if(profile.curve)fields.push({ns:CRS,name:'ToneCurvePV2012',node:{options:0x600,items:profile.curve.map(p=>({value:`${p.x*255}, ${p.y*255}`}))}});
 metadata.push({ns:CRS,name:'Parameters',node:{fields}});
 // Merge is performed by the existing generic XMP writer, including the old Look qualifiers.
 let lookNode:XMPNode={fields:metadata};
 if(profile.standardLook)lookNode=mergeXMPNode(profile.standardLook,lookNode,preserveEnhancedLookField,'Look');
 if(old)lookNode=mergeXMPNode(old,lookNode,preserveEnhancedLookField,'Look');
 return [{ns:CRS,name:'Look',node:lookNode},...(profile.baseProfile?[value('CameraProfile',profile.baseProfile)]:[]),...profile.tables.map(t=>{const next=value('Table_'+t.fingerprint,t.data),old=node(previous,next.name);return old?{...next,node:mergeXMPNode(old,next.node!)}:next;})];
}
