import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {EngineClient} from './engine-client.mjs';
import {XMP} from '@captraw/desktop-core/xmp';
import {enhancedFixtures} from './enhanced-profile-fixtures.mjs';
import {rgbTable,lookDefinition} from './enhanced-table-native.mjs';
const root=await mkdtemp(join(tmpdir(),'captraw-enhanced-identity-'));let engine,passed=false;
const field=(arp,section,key,value)=>{
 const expression=new RegExp('(\\['+section+'\\]\\n)([^\\[]*)'),match=arp.match(expression);assert(match,'Missing ARP section '+section);
 const line=new RegExp('^'+key+'=.*$','m'),body=line.test(match[2])?match[2].replace(line,key+'='+value):key+'='+value+'\n'+match[2];return arp.replace(expression,()=>match[1]+body);
};
try{
 const xmp=new XMP(resolve('build/xmp/captraw-xmp')),f=await enhancedFixtures(root,xmp);engine=new EngineClient({cache:join(root,'engine')});engine.on('error',()=>{});
 const image=await engine.call('open',{path:f.png,sessionId:'identity'}),profile=lookDefinition(rgbTable({dimensions:1,divisions:2,identity:true,gamut:1}));profile.parameters.RGBTableAmount='1';
 const exportARP=async(arp,name)=>{const output=join(root,name+'.tiff');await writeFile(join(root,name+'.arp'),arp);await engine.call('export',{path:f.png,artProfile:arp,output,format:'tiff',colorSpace:'srgb'});return output;};
 const changes=[['Exposure',{Enabled:'false',Compensation:2},'Exposure2012','0.25'],['Saturation',{Enabled:'false',Saturation:72,Vibrance:36},'Saturation','15'],['ToneEqualizer',{Enabled:'false',Band0:40,Band1:-32,Band3:27,Band4:-21},'Highlights2012','20']],results=[];
 for(const [section,values,control,increment] of changes){let arp=image.artProfile;for(const [key,value] of Object.entries(values))arp=field(arp,section,key,value);
  const original=await exportARP(arp,section+'-disabled'),identity=await exportARP(field(arp,'Color Management','CaptRAWEnhancedProfile',JSON.stringify({profile,amount:1})),section+'-identity');
  const result=JSON.parse(execFileSync(process.env.CAPTRAW_QA_PYTHON||'build/qa-venv/bin/python',['-c','import sys,json,tifffile,numpy as np;a=tifffile.imread(sys.argv[1]).astype(np.int64);b=tifffile.imread(sys.argv[2]).astype(np.int64);d=np.abs(a-b);print(json.dumps({"max":int(d.max()),"mean":float(d.mean()),"changedChannels":int(np.count_nonzero(d))}))',original,identity],{encoding:'utf8'}));
  results.push({section,...result});console.log('IDENTITY disabled legacy ARP',JSON.stringify(results.at(-1)));
  const zeroProfile=structuredClone(profile);zeroProfile.parameters[control]='0';
  const explicitZero=await exportARP(field(arp,'Color Management','CaptRAWEnhancedProfile',JSON.stringify({profile:zeroProfile,amount:1})),section+'-explicit-zero');
  const compare=(a,b)=>JSON.parse(execFileSync(process.env.CAPTRAW_QA_PYTHON||'build/qa-venv/bin/python',['-c','import sys,json,tifffile,numpy as np;a=tifffile.imread(sys.argv[1]).astype(np.int64);b=tifffile.imread(sys.argv[2]).astype(np.int64);d=np.abs(a-b);print(json.dumps({"max":int(d.max()),"mean":float(d.mean())}))',a,b],{encoding:'utf8'}));
  const zeroDifference=compare(original,explicitZero);results.push({section:section+' explicit zero',...zeroDifference});console.log('IDENTITY explicit zero control',JSON.stringify(results.at(-1)));
  const nonzero=structuredClone(profile);nonzero.parameters[control]=increment;
  let neutralARP=arp;for(const key of Object.keys(values))if(key!=='Enabled')neutralARP=field(neutralARP,section,key,0);
  const actual=await exportARP(field(arp,'Color Management','CaptRAWEnhancedProfile',JSON.stringify({profile:nonzero,amount:1})),section+'-nonzero-hidden');
  const expected=await exportARP(field(neutralARP,'Color Management','CaptRAWEnhancedProfile',JSON.stringify({profile:nonzero,amount:1})),section+'-nonzero-neutral');
  const hiddenDifference=compare(actual,expected);results.push({section:section+' nonzero excludes hidden values',...hiddenDifference});console.log('LOOK nonzero excludes disabled values',JSON.stringify(results.at(-1)));
 }
 assert(results.every(r=>r.max===0),'Identity Look must not enable disabled legacy operators or change their pixels: '+JSON.stringify(results));passed=true;
}finally{if(engine){await engine.stop();if(engine.child.exitCode===null&&engine.child.signalCode===null)await new Promise(done=>engine.child.once('exit',done));}if(passed)await rm(root,{recursive:true,force:true});else console.error('Retained enhanced identity failure:',root);}
