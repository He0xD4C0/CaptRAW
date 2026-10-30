// Run only after the coordinated native build has integrated patch-effects and effects.cc.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EngineClient} from '../../support/engine-client.mjs';
const work=mkdtempSync(join(tmpdir(),'captraw-effects-native-')),python=process.env.CAPTRAW_PYTHON||resolve('build/qa-venv/bin/python');
const source=join(work,'fixture.tif'),engine=new EngineClient({cache:join(work,'cache')});let success=false,revision=0;
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
try{
 execFileSync(python,['-c',`import numpy as np,tifffile,sys
y,x=np.mgrid[0:384,0:512];a=np.empty((384,512,3),np.uint16)
for c in range(3):a[:,:,c]=np.clip(5000+40000*(x/511)**(1+c*.4)+7000*(y/383),0,65535)
tifffile.imwrite(sys.argv[1],a,photometric='rgb')`,source]);
 const original=hash(source);let lastProfile,opened=await engine.call('open',{path:source,sessionId:'effects',baselineVersion:4});
 const render=async(adjustments,profile=lastProfile??opened.artProfile)=>{const rev=++revision,pending=engine.preview(rev,'fit',120000);const result=await engine.call('update',{revision:rev,adjustments,artProfile:profile});const frame=await pending;lastProfile=result.artProfile;return {...result,hash:hash(frame.file)};};
 assert.equal(opened.adjustments.grainModel,undefined,'Missing open policy preserves legacy projection');
 assert.equal(opened.adjustments.postCropVignetteStyle,undefined);
 const neutralLegacy=await render(opened.adjustments);
 const currentOpened=await engine.call('open',{path:source,sessionId:'effects-current',baselineVersion:4,effectsDefaults:'current'});
 assert.equal(currentOpened.adjustments.grainModel,'procedural-v1');assert.equal(currentOpened.adjustments.postCropVignetteStyle,'highlight-priority');
 assert.equal(currentOpened.adjustments.grain,0);assert.equal(currentOpened.adjustments.vignette,0);
 assert.equal((await render(currentOpened.adjustments,currentOpened.artProfile)).hash,neutralLegacy.hash,'Current zero amounts must be a pixel-exact bypass');
 opened=await engine.call('open',{path:source,sessionId:'effects-legacy',baselineVersion:4,effectsDefaults:'legacy'});
 lastProfile=opened.artProfile;assert.equal(opened.adjustments.grainModel,undefined);assert.equal(opened.adjustments.postCropVignetteStyle,undefined);
 const base=opened.adjustments,legacy=await render({...base,grain:35,vignette:-40});
 const settings={...base,grain:35,grainModel:'procedural-v1',grainSize:25,grainRoughness:50,vignette:-40,postCropVignetteStyle:'highlight-priority',postCropVignetteMidpoint:50,postCropVignetteRoundness:0,postCropVignetteFeather:50,postCropVignetteHighlights:0};
 const current=await render(settings);assert.match(current.artProfile,/\[CaptRAW Effects\]/,'Reject an engine without the new algorithm');
 assert.notEqual(current.hash,legacy.hash);
 for(const [key,value] of Object.entries({grainSize:80,grainRoughness:100,postCropVignetteStyle:'color-priority',postCropVignetteMidpoint:10,postCropVignetteRoundness:100,postCropVignetteFeather:0,postCropVignetteHighlights:100})){
  const changed=await render({...settings,[key]:value});assert.notEqual(changed.hash,current.hash,key+' must affect actual pixels');
 }
 assert.equal((await render({...base,grain:35,vignette:-40},current.artProfile)).hash,legacy.hash,'Undo returns to the exact legacy appearance');
 assert.equal((await render(settings,current.artProfile)).hash,current.hash,'Redo is deterministic');
 const a=join(work,'a.tif'),b=join(work,'b.tif');await engine.call('export',{path:source,artProfile:current.artProfile,output:a,format:'tiff',colorSpace:'srgb'});
 const fresh=new EngineClient({cache:join(work,'fresh')});try{await fresh.call('export',{path:source,artProfile:current.artProfile,output:b,format:'tiff',colorSpace:'srgb'});}finally{await fresh.stop();}
 console.log(execFileSync(python,['-c',`import tifffile,numpy as np,sys
a=tifffile.imread(sys.argv[1]);b=tifffile.imread(sys.argv[2]);assert a.dtype==np.uint16;assert np.array_equal(a,b)
with tifffile.TiffFile(sys.argv[1]) as f:assert 34675 in f.pages[0].tags
print('16-bit TIFF, ICC, independent-worker pixels: passed')`,a,b],{encoding:'utf8'}).trim());
 assert.equal(hash(source),original);success=true;console.log('Every control changes pixels; exact legacy undo / redo / source protection: passed');
}finally{await engine.stop();if(success)rmSync(work,{recursive:true,force:true});else console.error('Failure retained:',work);}
