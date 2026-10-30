import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {patchSourceFrame} from '../../../native/patches/patch-source-frame.mjs';

const root=await mkdtemp(join(tmpdir(),'captraw-source-frame-source-'));let passed=false;
try{
 const upstream=resolve('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b');
 const files=['procparams.h','procparams.cc','imagesource.h','rawimage.h','rawimage.cc','rawimagesource.h','rawimagesource.cc','simpleprocess.cc','improccoordinator.cc','masks.cc','rtengine.h','loadinitial.cc'];
 await mkdir(join(root,'src/engine'),{recursive:true});
 for(const file of files)await copyFile(join(upstream,'src/engine',file),join(root,'src/engine',file));
 patchSourceFrame(root);
 const once=await Promise.all(files.map(file=>readFile(join(root,'src/engine',file),'utf8')));
 patchSourceFrame(root);
 assert.deepEqual(await Promise.all(files.map(file=>readFile(join(root,'src/engine',file),'utf8'))),once,'ART patch is idempotent');
 assert(once[1].includes('commonTrans.captrawSourceFrameSaved &&'),'legacy runtime geometry is not serialized');
 assert(once[6].includes('if(FC(row,col)==3)result.colors=4;'),'non RGB CFA retains its boundary');
 assert(once[9].includes('geometry->referenceWidth()'),'warp allocates the authoring frame');
 assert(once[7].includes('sourceFrameDecode(job->pparams)'),'independent export selects the decoder before loading');
 assert(once[11].includes('raw->captrawSourceFrameDecode=sensorCrop'),'initial load selects the decoder without global state');
 assert(once[4].includes('captrawSourceFrameDecode?new SourceFrameLibRaw():new LibRaw()'),'absent decoder model keeps the original LibRaw path');
 const source=stripTypeScriptTypes(await readFile(resolve('packages/contracts/source-frame.ts'),'utf8'));
 const policy=await import('data:text/javascript,'+encodeURIComponent(source));
 assert.equal(policy.sourceFramePolicyForDocument(),'active-area-v1');
 assert.equal(policy.sourceFramePolicyForDocument({engineVersion:'',artProfile:'',adjustments:{crop:{x:.1,y:.2,width:.5,height:.6}}}),'active-area-v1','standard Adobe import uses the original decoded frame');
 assert.equal(policy.sourceFramePolicyForDocument({engineVersion:'art-historical',artProfile:''}),'legacy');
 assert.equal(policy.sourceFramePolicyForDocument({engineVersion:'',artProfile:'[RAW Bayer]\nBorder=0\n'}),'legacy','explicit old ARP Border is preserved');
 const frame={version:1,policy:'active-area-v1',sensor:'bayer',border:0,fullWidth:1536,fullHeight:1024,width:1536,height:1024,layoutWidth:1536,layoutHeight:1024,decoded:{left:0,top:0,width:1536,height:1024,rotation:0}};
 policy.validateSourceFrame(frame);
 policy.validateSourceFrame({...frame,decoderModel:'sensor-crop-v1'});
 assert.throws(()=>policy.validateSourceFrame({...frame,decoderModel:'unknown'}));
 assert.throws(()=>policy.validateSourceFrame({...frame,policy:'legacy',decoderModel:'sensor-crop-v1'}));
 assert.throws(()=>policy.validateSourceFrame({...frame,border:4}));
 assert.throws(()=>policy.validateSourceFrame({...frame,decoded:{...frame.decoded,rotation:45}}));
 const snapshot=policy.sourceFrameOpenSnapshot({sourceFrame:frame},'arp');
 assert.deepEqual(snapshot,{artProfile:'arp',sourceFrame:frame});assert.notEqual(snapshot.sourceFrame,frame);
 assert.deepEqual(policy.sourceFrameOpenSnapshot({},'arp',{...frame,policy:'legacy'}).sourceFrame.policy,'legacy');
 passed=true;console.log('PASS source-frame patch anchors/idempotence; new, Adobe, old CT and explicit ARP policies; typed snapshot validation');
}catch(error){await writeFile(join(root,'failure.txt'),String(error.stack||error));throw error;}
finally{if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained source-frame failure:',root);}
