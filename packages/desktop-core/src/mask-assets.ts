import {readFile,writeFile,mkdir,rename,rm,lstat,stat} from 'node:fs/promises';
import {join,dirname,basename,extname,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {EditDocument,Adjustments} from '@captraw/contracts';
type AssetDocument={artProfile:string;adjustments:Partial<Adjustments>;maskAssets?:EditDocument['maskAssets']};
type Core={call(method:string,params:unknown):Promise<any>};
const prefix='captraw-mask:';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const limit=256*1024*1024;
async function bytes(path:string){
  const info=await stat(path);if(!info.isFile()||info.size<1||info.size>limit)throw new Error('蒙版资产大小无效：'+path);
  const value=await readFile(path);if(value.length<1||value.length>limit)throw new Error('蒙版资产大小无效：'+path);return value;
}
async function directory(path:string){
  await mkdir(path,{recursive:true});const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('蒙版资产目录不能是链接或其他文件：'+path);
}
async function existing(path:string,expected:string){
  try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||hash(await bytes(path))!==expected)throw new Error('已有蒙版资产与校验值不符，未覆盖：'+path);return true;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}
async function publish(core:Core,path:string,data:Buffer,id:string){
  if(await existing(path,id))return;
  const temporary=path+'.'+randomUUID()+'.tmp';
  try{
    await writeFile(temporary,data,{flag:'wx',mode:0o600});
    if(!await core.call('publish',{temporary,destination:path})){
      if(!await existing(path,id))throw new Error('蒙版资产发布失败：'+path);
    }
  }finally{await rm(temporary,{force:true});}
}
// Assets are immutable and published before the recipe. Failed saves leave the
// previous recipe intact; unreferenced content is not deleted behind other copies.
export async function saveRecipeWithMasks<T extends AssetDocument>(core:Core,path:string,supplied:T,serialize:(value:T)=>Promise<string>){
  const recipe=structuredClone(supplied);
  const inventory:{paths:string[]}=await core.call('maskAssets',{artProfile:recipe.artProfile,adjustments:recipe.adjustments,validate:true});
  const replacements:Record<string,string>={},files:NonNullable<EditDocument['maskAssets']>['files']=[];
  if(inventory.paths.length){
    const folder=basename(path)+'.assets',assetDirectory=join(dirname(path),folder);await directory(assetDirectory);
    for(const source of inventory.paths){
      if(!isAbsolute(source))throw new Error('蒙版资产缺少已解析的本地路径：'+source);
      const data=await bytes(source),id=hash(data);let entry=files.find(f=>f.id===id);
      if(!entry){
        const extension=extname(source).toLowerCase();if(!/^\.[a-z0-9]{1,8}$/.test(extension))throw new Error('蒙版资产缺少可识别的文件扩展名：'+source);
        entry={id,path:folder+'/'+id+extension,bytes:data.length};
        await publish(core,join(dirname(path),entry.path),data,id);files.push(entry);
      }
      replacements[source]=prefix+id;
    }
    // Decode the exact copied files too; the source may have changed since preflight.
    const copied=Object.fromEntries(inventory.paths.map(source=>{const id=replacements[source].slice(prefix.length);return [source,join(dirname(path),files.find(f=>f.id===id)!.path)];}));
    await core.call('maskAssets',{artProfile:recipe.artProfile,adjustments:recipe.adjustments,replacements:copied,validate:true});
    const bound=await core.call('maskAssets',{artProfile:recipe.artProfile,adjustments:recipe.adjustments,replacements});
    if(typeof bound.artProfile!=='string'||!bound.adjustments||typeof bound.adjustments!=='object')throw new Error('显影核心未返回完整蒙版配方，操作已停止。');
  recipe.artProfile=bound.artProfile;recipe.adjustments=bound.adjustments;
    recipe.maskAssets={schemaVersion:1,files};
  }else delete recipe.maskAssets;
  const temporary=path+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,await serialize(recipe),{flag:'wx',mode:0o600});await rename(temporary,path);}
  finally{await rm(temporary,{force:true});}
}
// Materialize checked bytes inside the app's private cache, so later edits and
// exports never depend on a transient model result or a movable recipe folder.
export async function restoreRecipeMasks<T extends AssetDocument>(core:Core,path:string,supplied:T,cache:string):Promise<T>{
  const recipe=structuredClone(supplied);
  if(recipe.maskAssets===undefined)return recipe;
  const manifest=recipe.maskAssets;
  if(!manifest||manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>4096)throw new Error('蒙版资产清单版本或格式无效。');
  const inventory:{paths:string[]}=await core.call('maskAssets',{artProfile:recipe.artProfile,adjustments:recipe.adjustments});
  const ids=new Set<string>(),replacements:Record<string,string>={};const store=join(cache,'document-assets');
  for(const file of manifest.files){
    if(!file||typeof file.id!=='string'||!/^[0-9a-f]{64}$/.test(file.id)||ids.has(file.id)||typeof file.path!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>limit)throw new Error('蒙版资产清单包含无效或重复条目。');
    const parts=file.path.split('/');
    if(parts.length!==2||!parts[0].endsWith('.assets')||/[\\:]/.test(parts[0])||parts[0]==='.assets'||!new RegExp('^'+file.id+'\\.[a-z0-9]{1,8}$').test(parts[1]))throw new Error('蒙版资产路径必须位于配方旁的资产文件夹。');
    const folder=join(dirname(path),parts[0]),source=join(folder,parts[1]);
    const info=await lstat(folder);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('蒙版资产目录无效：'+folder);
    if(!await existing(source,file.id))throw new Error('配方的蒙版资产缺失，请恢复配套资产文件夹：'+file.path);
    const data=await bytes(source);if(data.length!==file.bytes||hash(data)!==file.id)throw new Error('配方的蒙版资产已改变，停止加载：'+file.path);
    ids.add(file.id);await directory(store);const destination=join(store,parts[1]);await publish(core,destination,data,file.id);replacements[prefix+file.id]=destination;
  }
  if(inventory.paths.length!==ids.size||inventory.paths.some(p=>!Object.hasOwn(replacements,p)))throw new Error('配方的蒙版引用与资产清单不一致。');
  const bound=await core.call('maskAssets',{artProfile:recipe.artProfile,adjustments:recipe.adjustments,replacements,validate:true});
  if(typeof bound.artProfile!=='string'||!bound.adjustments||typeof bound.adjustments!=='object')throw new Error('显影核心未返回完整蒙版配方，操作已停止。');
  recipe.artProfile=bound.artProfile;recipe.adjustments=bound.adjustments;
  return recipe;
}
