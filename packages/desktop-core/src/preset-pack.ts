import {createHash} from 'node:crypto';
import {readFile,mkdir,rename,rm,writeFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ENGINE_VERSION} from '@captraw/contracts';
import type {PresetPackManifest} from '@captraw/contracts/presets';
const id='604bd4a0-2611-4ac8-991d-b0d8c2532001';
// A small first-party validation pack, independent of user edits and favorites.
const packet='<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:PresetType="Normal" crs:UUID="604BD4A026114AC8991DB0D8C2532001" crs:SupportsAmount="True" crs:Exposure2012="0.5"><crs:Name><rdf:Alt><rdf:li xml:lang="x-default">曝光 +0.50</rdf:li></rdf:Alt></crs:Name><crs:Group><rdf:Alt><rdf:li xml:lang="x-default">CaptRAW 验证</rdf:li></rdf:Alt></crs:Group></rdf:Description></rdf:RDF></x:xmpmeta>';
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const builtinPresetPack:PresetPackManifest={id:'org.captraw.validation',version:'1.0.0',engineVersions:[ENGINE_VERSION],presets:[{id,path:'exposure.xmp',sha256:sha(packet)}],assets:[]};
export class PresetPacks {
 private packs=new Map<string,{manifest:PresetPackManifest;root:string}>();
 constructor(private root:string){}
 async initialize(){await this.install(builtinPresetPack,async path=>{if(path!=='exposure.xmp')throw new Error('未知内置资产。');return Buffer.from(packet);});}
 async install(manifest:PresetPackManifest,read:(path:string)=>Promise<Buffer>){
  if(!manifest||!/^[a-z0-9][a-z0-9.-]{1,100}$/.test(manifest.id)||!/^\d+\.\d+\.\d+$/.test(manifest.version)||!manifest.engineVersions.includes(ENGINE_VERSION))throw new Error('预设包版本或处理版本不兼容。');
  const entries=[...manifest.presets,...manifest.assets];
  if(!manifest.presets.length||new Set(entries.map(e=>e.path)).size!==entries.length||new Set(manifest.presets.map(e=>e.id)).size!==manifest.presets.length||manifest.presets.some(e=>!e.id.match(/^[0-9a-f-]{36}$/)))throw new Error('预设包清单无效。');
  const target=join(this.root,manifest.id,manifest.version),staging=target+'.'+randomUUID();await mkdir(staging,{recursive:true});
  try{
   for(const entry of entries){
    const path=relative(staging,resolve(staging,entry.path));if(!path||isAbsolute(entry.path)||path.startsWith('..')||entry.path.includes('\\')||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('预设包资产路径或校验值无效。');
    const bytes=await read(entry.path);if(sha(bytes)!==entry.sha256)throw new Error('预设包资产校验失败。');
    const destination=join(staging,path);await mkdir(resolve(destination,'..'),{recursive:true});await writeFile(destination,bytes);
   }
   await writeFile(join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
   // Existing versions are immutable; only switch the in-memory package index.
   try{await rename(staging,target);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code||''))throw error;
    for(const entry of entries)if(sha(await readFile(join(target,entry.path)))!==entry.sha256)throw new Error('已安装预设包内容不一致。');}
   this.packs.set(manifest.id,{manifest:structuredClone(manifest),root:target});
  }finally{await rm(staging,{recursive:true,force:true});}
 }
 list(){return [...this.packs.values()].map(p=>structuredClone(p.manifest));}
 entries(){return [...this.packs.values()].flatMap(p=>p.manifest.presets.map(e=>({id:e.id,path:join(p.root,e.path),packageId:p.manifest.id,packageVersion:p.manifest.version})));}
}
