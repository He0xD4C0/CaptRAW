import {EngineClient} from './engine-client.mjs';import {readFileSync} from 'node:fs';import {resolve,join} from 'node:path';import {homedir} from 'node:os';
const out=resolve(process.env.CAPTRAW_PRESETS_E2E_OUT||'artifacts/presets-installed-0.31'),r=JSON.parse(readFileSync(join(out,'applied.captraw.json'))),native=join(homedir(),'Applications/CaptRAW-0.28.app/Contents/Resources/native');
const engine=new EngineClient({executable:join(native,'captraw-engine'),resources:join(native,'resources'),cache:join(out,'reference')});engine.on('error',()=>{});
try{await engine.call('export',{path:r.source.path,artProfile:r.artProfile,output:join(out,'reference.tiff'),format:'tiff'});}finally{await engine.stop();}
