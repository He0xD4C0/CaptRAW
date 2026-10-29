import {createHash} from 'node:crypto';
import type {XMPNode,XMPProperty} from './xmp.js';

const CRS='http://ns.adobe.com/camera-raw-settings/1.0/';
const CT='https://captraw.org/ns/develop/1.0/';
export const BAKED_CRS_PROPERTY='BakedCRS';
export type ImageXMPKind='active'|'baked'|'legacy-active';
export interface PreparedXMP {properties:XMPProperty[];changes:XMPProperty[]}
const key=(p:XMPProperty)=>p.ns+'|'+p.name;
const field=(name:string,node:XMPNode):XMPProperty=>({ns:CT,name,node});
const value=(text:string):XMPNode=>({value:text});
const find=(properties:XMPProperty[],ns:string,name:string)=>properties.find(p=>p.ns===ns&&p.name===name)?.node??undefined;
const applied=(properties:XMPProperty[])=>['true','1'].includes(find(properties,CRS,'AlreadyApplied')?.value?.trim().toLowerCase()||'');

// Normalize RDF bookkeeping/order, never the values or ordered array members.
function canonicalNode(node:XMPNode|null):unknown {
 if(!node)return node;
 const result:Record<string,unknown>={};
 for(const name of ['localized','lang','type'] as const)if(node[name]!==undefined)result[name]=node[name];
 if(node.value!==undefined&&!node.fields&&!node.items)result.value=node.value;
 if((node.options||0)&0x1f00)result.options=node.options!&0x1f00;
 for(const name of ['fields','qualifiers'] as const)if(node[name])result[name]=canonicalProperties(node[name]!);
 if(node.items)result.items=node.items.map(canonicalNode);
 return result;
}
function canonicalProperties(properties:XMPProperty[]):unknown {
 return properties.map(p=>({ns:p.ns,name:p.name,node:canonicalNode(p.node)})).sort((a,b)=>(a.ns+'|'+a.name).localeCompare(b.ns+'|'+b.name));
}
const equal=(a:XMPNode|null,b:XMPNode|null)=>JSON.stringify(canonicalNode(a))===JSON.stringify(canonicalNode(b));
const digest=(properties:XMPProperty[])=>createHash('sha256').update(JSON.stringify(canonicalProperties(properties))).digest('hex');

function archive(properties:XMPProperty[]):XMPNode|undefined {
 const root=find(properties,CT,BAKED_CRS_PROPERTY);
 if(!root)return undefined;
 const version=root.fields&&find(root.fields,CT,'Version');
 const entries=root.fields&&find(root.fields,CT,'Entries');
 if(!root.fields||version?.value!=='1'||!entries?.items)throw new Error('已烘焙 CRS 归档结构或版本无效，未修改原文件。');
 for(const entry of entries.items){
  const crs=entry.fields&&find(entry.fields,CT,'CRS');
  if(!entry.fields||!crs?.fields||crs.fields.some(p=>p.ns!==CRS))throw new Error('已烘焙 CRS 归档节点无效，未修改原文件。');
 }
 return root;
}
function mergeProperties(base:XMPProperty[],incoming:XMPProperty[],ignored:Set<string>):XMPProperty[] {
 const result=structuredClone(base);
 for(const p of incoming){
  if(ignored.has(key(p)))continue;
  const old=result.find(q=>key(q)===key(p));
  if(!old)result.push(structuredClone(p));
  else if(!equal(old.node,p.node))throw new Error('已烘焙 CRS 归档的扩展字段冲突，未覆盖原数据。');
 }
 return result;
}
function mergeMetadata(base:XMPNode,incoming:XMPNode):XMPNode {
 const result=structuredClone(base);
 for(const name of ['localized','lang','type'] as const){
  if(result[name]!==undefined&&incoming[name]!==undefined&&result[name]!==incoming[name])throw new Error('已烘焙 CRS 归档的节点限定符冲突，未覆盖原数据。');
  if(incoming[name]!==undefined)result[name]=incoming[name];
 }
 const qualifiers=mergeProperties(result.qualifiers||[],incoming.qualifiers||[],new Set());
 if(qualifiers.length)result.qualifiers=qualifiers;
 return result;
}
function mergedArchive(roots:XMPNode[],entry?:XMPNode):XMPNode|undefined {
 if(!roots.length&&!entry)return undefined;
 let root: XMPNode=roots.length?structuredClone(roots[0]):{options:0x100,fields:[field('Version',value('1'))]};
 const ignored=new Set([CT+'|Version',CT+'|Entries']);
 let fields=root.fields!;
 let version=find(fields,CT,'Version')!,array=find(fields,CT,'Entries');
 const entries:XMPNode[]=[];
 const seen=new Set<string>();
 const add=(node:XMPNode)=>{const semantic={...node,fields:node.fields?.filter(p=>!(p.ns===CT&&p.name==='Digest'))};const id=JSON.stringify(canonicalNode(semantic));if(!seen.has(id)){seen.add(id);entries.push(structuredClone(node));}};
 for(const candidate of roots){
  root=mergeMetadata(root,candidate);
  fields=mergeProperties(fields,candidate.fields!,ignored);
  version=mergeMetadata(version,find(candidate.fields!,CT,'Version')!);
  const nextArray=find(candidate.fields!,CT,'Entries')!;
  array=array?mergeMetadata(array,nextArray):structuredClone(nextArray);
  for(const node of find(candidate.fields!,CT,'Entries')!.items!)add(node);
 }
 if(entry)add(entry);
 const nextEntries={...array,options:(array?.options||0)|0x600,items:entries};
 root.fields=[...fields.filter(p=>!ignored.has(key(p))),field('Version',version),field('Entries',nextEntries)];
 return root;
}
function imageKind(properties:XMPProperty[]):ImageXMPKind {
 if(!applied(properties))return 'active';
 // Keep existing native document interpretation, including old unversioned
 // profiles. The normal document decoder still validates their payload/version.
 return properties.some(p=>p.ns===CT&&['ARTProfile','ARTAdjustments'].includes(p.name)&&p.node!==null)?'legacy-active':'baked';
}

/** Prepare an active save without decoding a baked Look, mask, or future field. */
export function prepareActiveSave(properties:XMPProperty[],carried:readonly XMPProperty[][]=[]):PreparedXMP {
 const kind=imageKind(properties),baked=kind!=='active';
 const roots=[archive(properties),...carried.map(p=>archive(prepareActiveSave(p).properties))].filter((n):n is XMPNode=>n!==undefined);
 let entry:XMPNode|undefined;
 if(baked){
  const original=structuredClone(properties.filter(p=>p.ns===CRS));
  entry={options:0x100,fields:[field('Kind',value(kind)),field('Digest',value(digest(original))),field('CRS',{options:0x100,fields:original})]};
  const engine=find(properties,CT,'EngineVersion');
  if(engine)entry.fields!.push(field('SourceEngineVersion',structuredClone(engine)));
 }
 const combined=mergedArchive(roots,entry);
 const result=structuredClone(properties.filter(p=>!baked||p.ns!==CRS));
 const changes:XMPProperty[]=baked?properties.filter(p=>p.ns===CRS).map(p=>({ns:p.ns,name:p.name,node:null})):[];
 if(combined){
  const index=result.findIndex(p=>p.ns===CT&&p.name===BAKED_CRS_PROPERTY);
  const property=field(BAKED_CRS_PROPERTY,combined);
  if(index<0)result.push(property);else result[index]=property;
  const previous=find(properties,CT,BAKED_CRS_PROPERTY);
  if(!previous||!equal(previous,combined))changes.push(property);
 }
 return {properties:result,changes};
}

/** Opening and explicit extraction have different purposes; do not gate decode. */
export function prepareImageXMP(properties:XMPProperty[]):PreparedXMP&{kind:ImageXMPKind;decodeProperties:XMPProperty[]} {
 const kind=imageKind(properties),prepared=prepareActiveSave(properties);
 return {...prepared,kind,decodeProperties:kind==='baked'?prepared.properties:structuredClone(properties)};
}

/** Exported pixels get current annotations only, never private baked provenance. */
export function sanitizeOutputXMP(properties:XMPProperty[]):XMPProperty[] {
 const baked=applied(properties);
 const keep=(p:XMPProperty)=>!(p.ns===CT&&p.name===BAKED_CRS_PROPERTY);
 const node=(n:XMPNode):XMPNode=>{
  const result=structuredClone(n);
  for(const name of ['fields','qualifiers'] as const)if(result[name])result[name]=result[name]!.filter(keep).map(p=>({...p,node:p.node?node(p.node):null}));
  if(result.items)result.items=result.items.map(node);
  return result;
 };
 return properties.filter(p=>keep(p)&&(!baked||p.ns!==CRS)).map(p=>({...p,node:p.node?node(p.node):null}));
}
