import {readDocument} from './xmp-test.mjs';
import {EngineClient} from './engine-client.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const recipe=await readDocument(process.argv[2]||'artifacts/人工 验收.xmp');
const engine=new EngineClient({cache:'build/desktop-consistency-cache',executable:process.env.CAPTRAW_ENGINE,resources:process.env.CAPTRAW_RESOURCES});
try{
 await engine.call('export',{path:recipe.source.path,artProfile:recipe.artProfile,output:resolve(process.argv[3]||'artifacts/headless-export.tiff'),format:'tiff'});
 console.log('Headless desktop recipe export complete');
}finally{await engine.stop();}
