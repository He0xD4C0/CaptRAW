import type {ExportDocumentSnapshot,ExportFormat} from '@captraw/contracts';
import type {ExportOptions,OutputMetadataOptions} from '@captraw/contracts/export-options';
import {XMP,CRS,CT,TIFF,XMP_BASIC,mergeXMPNode,property,text,type XMPNode,type XMPProperty} from '../documents/xmp.js';
import {sanitizeOutputXMP} from '../documents/baked-crs.js';

const DC='http://purl.org/dc/elements/1.1/',RIGHTS='http://ns.adobe.com/xap/1.0/rights/',EXIF='http://ns.adobe.com/exif/1.0/';
const IPTC_CORE='http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/',IPTC_EXT='http://iptc.org/std/Iptc4xmpExt/2008-02-29/',PHOTOSHOP='http://ns.adobe.com/photoshop/1.0/';
const policyDefault:OutputMetadataOptions={include:'all-except-develop',removeLocation:false};
const develop=(p:XMPProperty)=>p.ns===CRS||p.ns===CT;
function location(p:XMPProperty){
 return (p.ns===EXIF&&p.name.startsWith('GPS'))||
  (p.ns===IPTC_CORE&&p.name==='Location')||
  (p.ns===IPTC_EXT&&['LocationCreated','LocationShown','LocationId','LocationName','City','CountryCode','CountryName','ProvinceState','Sublocation','WorldRegion'].includes(p.name))||
  (p.ns===PHOTOSHOP&&['City','State','Country'].includes(p.name))||
  /(?:dj[iI]\.com|drone-dji)/.test(p.ns);
}
function copyright(p:XMPProperty){return (p.ns===DC&&['creator','rights'].includes(p.name))||p.ns===RIGHTS||(p.ns===PHOTOSHOP&&['Credit','Source'].includes(p.name));}
function filterNode(node:XMPNode,removeLocation:boolean):XMPNode {
 const result=structuredClone(node);
 const properties=(ps:XMPProperty[])=>ps.filter(p=>!develop(p)&&(!removeLocation||!location(p))).map(p=>({...p,node:p.node?filterNode(p.node,removeLocation):null}));
 if(result.fields)result.fields=properties(result.fields);
 if(result.qualifiers)result.qualifiers=properties(result.qualifiers);
 if(result.items)result.items=result.items.map(item=>filterNode(item,removeLocation));
 return result;
}
// XMP Toolkit performs parsing and serialization; never manipulate XML strings.
// Rebuild the filtered packet so removed qualifiers cannot be merged back by
// the normal lossless editing writer. Sidecars and input bytes stay untouched.
export async function outputXMP(xmp:XMP,sourcePacket:string,document:ExportDocumentSnapshot,format:ExportFormat,options:ExportOptions|undefined,width:number,height:number,outputProfile?:string){
 const policy=options?.metadata??policyDefault;
 const source=sanitizeOutputXMP(sourcePacket?(await xmp.call('read',sourcePacket)).properties:[]);
 const current=sanitizeOutputXMP(document.xmpPacket?(await xmp.call('read',document.xmpPacket)).properties:[]);
 const merged=new Map(source.map(p=>[p.ns+'|'+p.name,p]));
 for(const p of current){
  const key=p.ns+'|'+p.name,old=merged.get(key);
  merged.set(key,{...p,node:old?.node&&p.node?mergeXMPNode(old.node,p.node):p.node});
 }
 const put=(ns:string,name:string,value:unknown)=>{const old=merged.get(ns+'|'+name)?.node;merged.set(ns+'|'+name,property(ns,name,old?mergeXMPNode(old,text(value)):text(value)));};
 if(document.rating!==undefined)put(XMP_BASIC,'Rating',document.rating);
 if(document.label!==undefined)put(XMP_BASIC,'Label',document.label);
 // Even legacy "all" means photo metadata, never develop instructions.
 const filtered=[...merged.values()].filter(p=>!develop(p)&&
  (policy.include==='all'||policy.include==='all-except-develop'||policy.include==='copyright'&&copyright(p))&&
  (!policy.removeLocation||!location(p))).map(p=>({...p,node:p.node?filterNode(p.node,policy.removeLocation):null}));
 const replace=(p:XMPProperty)=>{
  const index=filtered.findIndex(v=>v.ns===p.ns&&v.name===p.name);
  if(index<0)filtered.push(p);
  else filtered[index]={...p,node:filtered[index].node&&p.node?mergeXMPNode(filtered[index].node!,p.node):p.node};
 };
 // Pixel interpretation describes this rendered file, not the original sensor.
 for(const p of [property(TIFF,'Orientation',text(1)),property(TIFF,'ImageWidth',text(width)),property(TIFF,'ImageLength',text(height)),property(EXIF,'PixelXDimension',text(width)),property(EXIF,'PixelYDimension',text(height)),property(EXIF,'ColorSpace',text(outputProfile==='RTv4_sRGB'?1:65535)),property(DC,'format',text(format==='jpeg'?'image/jpeg':'image/tiff'))]){
  if(policy.include==='all'||policy.include==='all-except-develop')replace(p);
 }
 if(options?.resolution)for(const name of ['XResolution','YResolution','ResolutionUnit']){
  replace(property(TIFF,name,text(name==='ResolutionUnit'?2:options.resolution+'/1')));
 }
 // Avoid stale sensor/encoding declarations inherited from the input packet.
 for(const name of ['BitsPerSample','Compression','PhotometricInterpretation','SamplesPerPixel']){
  const index=filtered.findIndex(v=>v.ns===TIFF&&v.name===name);if(index>=0)filtered.splice(index,1);
 }
 return filtered.length?(await xmp.call('write','',filtered)).packet!:'';
}

export async function finishOutputMetadata(worker:{call:(method:string,params:any)=>Promise<any>},xmp:XMP,document:ExportDocumentSnapshot,format:ExportFormat,options:ExportOptions|undefined,output:{path:string;width:number;height:number;outputProfile?:string}){
 if(format==='avif')return; // Existing HDR metadata policy remains unchanged this round.
 const source=await worker.call('metadataPacket',{path:document.path});
 const packet=source.format==='jpeg'||source.format==='tiff'?(await xmp.call('file-read','',[],{path:document.path,format:source.format})).packet!:source.packet;
 const xmpPacket=await outputXMP(xmp,packet,document,format,options,output.width,output.height,output.outputProfile);
 await worker.call('outputMetadata',{path:output.path,xmpPacket,policy:options?.metadata??policyDefault});
 await xmp.call('file-write',xmpPacket,[],{path:output.path,format});
}
