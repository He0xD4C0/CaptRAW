import {readDocument} from '../../support/xmp-test.mjs';
import {restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {EngineClient} from '../../support/engine-client.mjs';
import {resolve} from 'node:path';
let recipe=await readDocument(process.argv[2]||'artifacts/人工 验收.xmp');
const engine=new EngineClient({cache:'build/desktop-consistency-cache',executable:process.env.CAPTRAW_ENGINE,resources:process.env.CAPTRAW_RESOURCES});
try{
 if(recipe.maskAssets||recipe.inputProfileAsset)recipe=await restoreRecipeMasks(engine,resolve(process.argv[2]||'artifacts/人工 验收.xmp'),recipe,resolve('build/desktop-consistency-cache'));
 await engine.call('export',{path:recipe.source.path,artProfile:recipe.artProfile,output:resolve(process.argv[3]||'artifacts/headless-export.tiff'),format:'tiff'});
 console.log('Headless desktop recipe export complete');
}finally{await engine.stop();}
