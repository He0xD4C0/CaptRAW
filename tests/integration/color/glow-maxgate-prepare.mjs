// Prepare only. The coordinating build owner compiles/links the isolated object.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=resolve('.'),build=resolve('build/native'),original=resolve('native/src/effects.cc');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const before=hash(original),source=readFileSync(original,'utf8');
const work=mkdtempSync(join(tmpdir(),'captraw-glow-maxgate-'));
const candidate=join(work,'effects.cc'),object=join(work,'effects.cc.o'),binary=join(work,'captraw-engine');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const replaceOnce=(s,from,to)=>{assert.equal(s.split(from).length-1,1,'Expected one exact replacement: '+from);return s.replace(from,to);};
try{
 const marker='void ImProcFunctions::captrawGlow(Imagefloat *img){',split=source.indexOf(marker);assert(split>=0);
 let glow=source.slice(split);
 glow=replaceOnce(glow,'    const auto ws=ICCStore::getInstance()->workingSpaceMatrix(params->icm.workingProfile);\n','');
 glow=replaceOnce(glow,'const double l=(ws[1][0]*img->r(y,x)+ws[1][1]*img->g(y,x)+ws[1][2]*img->b(y,x))/65535.;',
  'const double l=std::max({double(img->r(y,x)),double(img->g(y,x)),double(img->b(y,x))})/65535.;');
 writeFileSync(candidate,source.slice(0,split)+glow);
 const commands=execFileSync('ninja',['-C',build,'-t','commands','captraw-engine'],{encoding:'utf8',maxBuffer:8*1024*1024}).split('\n');
 const compile=commands.find(c=>c.endsWith(' -c '+original)),link=commands.find(c=>c.includes(' -o captraw-engine '));
 assert(compile&&link,'Missing existing effects/toolchain commands');
 const oldObject=compile.match(/ -o (\S+) /)?.[1];assert(oldObject);
 let compileCommand=replaceOnce(compile,' -c '+original,' -c '+quote(candidate));
 compileCommand=replaceOnce(compileCommand,' -o '+oldObject+' ',' -o '+quote(object)+' ');
 compileCommand=replaceOnce(compileCommand,' -MT '+oldObject+' ',' -MT '+quote(object)+' ');
 const dependency=compileCommand.match(/ -MF (\S+) /)?.[1];assert(dependency);
 compileCommand=replaceOnce(compileCommand,' -MF '+dependency+' ',' -MF '+quote(join(work,'effects.d'))+' ');
 assert(!compileCommand.includes(original),'Original source/object path survived command rewrite');
 // Directly link the complete replacement object before the ordinary archive.
 // Both effects entry points resolve here; the archive's effects object stays
 // unextracted. No shared archive, upstream source or build entry is mutated.
 const archive='src/engine/libart_engine.a';assert(existsSync(join(build,archive)));
 assert(!/-all_load|-force_load|-whole-archive/.test(link),'Archive forced loading would invalidate object isolation');
 let linkCommand=replaceOnce(link,' -o captraw-engine ',' -o '+quote(binary)+' ');
 linkCommand=replaceOnce(linkCommand,' '+archive+' ',' '+quote(object)+' '+archive+' ');
 writeFileSync(join(work,'compile-command.txt'),compileCommand+'\n');
 writeFileSync(join(work,'link-command.txt'),linkCommand+'\n');
 const manifest={scope:'Source preparation only; no compiler, linker, engine or renderer invoked',
  hypothesis:'Replace working-linear RGB luminance emitter gate by max(R,G,B); not an Adobe algorithm claim',
  work,candidate,object,binary,cwd:build,root,
  originalEffectsSHA256:before,candidateEffectsSHA256:hash(candidate),
  sharedEngineSHA256:hash(join(build,'captraw-engine')),sharedArtArchiveSHA256:hash(join(build,archive)),
  changed:['Only captrawGlow emitter scalar Y -> max(working R,G,B); remove its now-unused matrix lookup'],
  unchanged:['gate smoothstep/threshold','Gaussian and halation kernels/sigma','amount/.65 coefficient/tint','style composition','signed local coverage and clamp','all grain/vignette code'],
  requires:'Parent compiles/links after confirming headers/archive are stable; regenerate preparation if shared build inputs change',
  falsification:['Uniform neutral center remains unchanged for a normalized difference kernel',
   'Compare saturated red/blue interior and edge separately; do not use near-edge darkening to claim flat-interior matching',
   'Measure near/far halo sign and support, green response and all local positive/negative reference states',
   'Zero must remain exact; no parameter search or best-case substitutions'],
  nativeResults:'pending-parent-isolated-compilation'};
 assert.equal(hash(original),before,'Shared effects source changed during preparation');
 writeFileSync(join(work,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({work,candidate,binary,manifest:join(work,'manifest.json'),compilerInvoked:false}));
}catch(error){writeFileSync(join(work,'failure.json'),JSON.stringify({error:String(error)},null,2));throw error;}
