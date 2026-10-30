// Diagnostic only: prove where ART's existing film LUT sits relative to B&W.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
const out=resolve('artifacts/color-grading-candidates/art-order'),cache=resolve('build/grading-research');
mkdirSync(out,{recursive:true});mkdirSync(cache,{recursive:true});
const source=join(cache,'order-input.png'),lut=join(cache,'diagnostic-blue_sRGB.png');
execFileSync('build/qa-venv/bin/python',['-c',`
from PIL import Image
import sys
im=Image.new('RGB',(256,32));im.putdata([(x,x,x) for y in range(32) for x in range(256)]);im.save(sys.argv[1])
# Hald level 4: a 16^3 cube, R fastest. Deliberately non-neutral diagnostic.
im=Image.new('RGB',(64,64));im.putdata([(round(r*255/15*.8),round(g*255/15*.8),round(b*255/15)) for b in range(16) for g in range(16) for r in range(16)]);im.save(sys.argv[2])
`,source,lut]);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');const inputHash=sha(source),lutHash=sha(lut);
const base=join(homedir(),'Applications/CaptRAW-0.16.app/Contents/Resources/native');
const executable=process.env.CAPTRAW_ENGINE||join(base,'captraw-engine');
const engine=new EngineClient({executable,resources:process.env.CAPTRAW_RESOURCES||join(base,'resources'),cache:join(cache,'art-order-cache')});
const cases=[{name:'baseline',film:false,bw:false},{name:'film',film:true,bw:false},{name:'black-white',film:false,bw:true},{name:'film-black-white',film:true,bw:true}];
try{
 const img=await engine.call('open',{path:source,sessionId:'grading-order'});
 for(const c of cases){
  let profile=img.artProfile.replace(/\[Film Simulation\][^[]*/,`[Film Simulation]\nEnabled=${c.film}\nClutFilename=${lut}\nStrength=100\nAfterToneCurve=true\n\n`);
  profile=profile.replace(/\[Black & White\]([^[]*)/,(_whole,body)=>'[Black & White]'+body.replace(/Enabled=false/,'Enabled='+c.bw));
  assert(profile.includes(`Enabled=${c.film}\nClutFilename=${lut}`));
  assert.equal(/\[Black & White\][^[]*Enabled=true/.test(profile),c.bw);
  writeFileSync(join(out,c.name+'.arp'),profile);
  await engine.call('export',{path:source,artProfile:profile,output:join(out,c.name+'.tiff'),format:'tiff'});
  console.log('Rendered',c.name);
 }
 assert.equal(sha(source),inputHash);assert.equal(sha(lut),lutHash);
 writeFileSync(join(out,'report.json'),JSON.stringify({engine:executable,engineSHA256:sha(executable),offlineAndHomebrewDenied:!!process.env.CAPTRAW_SANDBOX_PROFILE,noGUI:true,inputSHA256:inputHash,lutSHA256:lutHash,sourceUnchanged:true,cases,scope:'Existing ART Film Simulation after tone curve, before B&W. Deliberate diagnostic LUT, not a proposed grading algorithm or ACR output.'},null,2)+'\n');
}finally{await engine.stop();}
