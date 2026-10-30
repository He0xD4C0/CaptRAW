// Preparation only. The parent executes the private compile script.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=resolve('.'),build=join(root,'build/native'),upstream=join(root,'build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/src/engine');
const work=mkdtempSync(join(tmpdir(),'captraw-hsl-projection-')),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
let complete=false;
try{
 assert(process.argv.slice(2).every(a=>a==='--check'),'Only --check is supported; no shared build');
 const original=join(upstream,'iphsl.cc'),recipe=join(root,'native/src/recipe.cc'),text=readFileSync(original,'utf8'),recipeText=readFileSync(recipe,'utf8');
 const start=recipeText.indexOf('static std::array<double,8> blackWhiteHues('),end=recipeText.indexOf('\nJson blackWhiteSettings(',start);
 assert(start>=0&&end>start,'Existing domain projection helper missing');
 const helper=recipeText.slice(start,end),anchor='    hslEqualizerWithParams(img, params->hsl);';
 assert.equal(text.split(anchor).length,2,'HSL entry is no longer unique');
 const replacement=`    auto projected = params->hsl;
    const auto positions = blackWhiteHues(params->icm.workingProfile);
    const std::array<double,8> oldPositions{0,1./12,1./6,1./3,.5,2./3,.75,5./6};
    const auto project = [&](std::vector<double> &curve) {
        if (curve.size() == 1) return;
        if (curve.size() != 33 || curve[0] != art::utils::FCT_MinMaxCPoints)
            throw std::runtime_error("Probe requires the existing eight-band curve");
        for (int i=0; i<8; ++i) {
            if (std::abs(curve[1+4*i]-oldPositions[i]) > 1e-7 || curve[3+4*i] != 0 || curve[4+4*i] != 0)
                throw std::runtime_error("Probe refuses to reinterpret an arbitrary ART curve");
            curve[1+4*i] = positions[i];
        }
    };
    project(projected.hCurve); project(projected.sCurve); project(projected.lCurve);
    hslEqualizerWithParams(img, projected, true);`;
 const source=join(work,'iphsl.cc'),object=join(work,'iphsl.o'),binary=join(work,'captraw-engine');
 const prepared=text.replace('#include "array2D.h"','#include <array>\n#include <stdexcept>\n#include "iccstore.h"\n#include "array2D.h"')
  .replace('void ImProcFunctions::hslEqualizer(Imagefloat *img)',helper+'\n\nvoid ImProcFunctions::hslEqualizer(Imagefloat *img)').replace(anchor,replacement);
 // The actual operator after the wrapper must remain byte-for-byte unchanged.
 const operator='void ImProcFunctions::hslEqualizerWithParams(';
 assert.equal(prepared.slice(prepared.indexOf(operator)),text.slice(text.indexOf(operator)));
 writeFileSync(source,prepared);
 const commands=execFileSync('ninja',['-C',build,'-t','commands','captraw-engine'],{encoding:'utf8',maxBuffer:8*1024*1024}).split('\n');
 const compile=commands.find(c=>c.endsWith(' -c '+original)),link=commands.find(c=>c.includes(' -o captraw-engine '));
 assert(compile&&link,'Existing native toolchain missing');
 const oldObject=compile.match(/ -o (\S+) /)?.[1];assert(oldObject);
 const compileCommand=compile.replace(' -c '+original,' -c '+quote(source)).replace(' -o '+oldObject+' ',' -o '+quote(object)+' ')
  .replace(' -MT '+oldObject+' ',' -MT '+quote(object)+' ').replace(/ -MF \S+ /,' -MF '+quote(join(work,'iphsl.d'))+' ')
  .replace(' -c '+quote(source),' -I'+quote(upstream)+' -c '+quote(source));
 // Resolve both HSL symbols before the archive is searched; its original HSL
 // object is not extracted. Every other object/library is the existing build.
 assert.equal(link.split('src/engine/libart_engine.a').length,2);
 const linkCommand=link.replace(' -o captraw-engine ',' -o '+quote(binary)+' ').replace('src/engine/libart_engine.a',quote(object)+' src/engine/libart_engine.a');
 assert(!compileCommand.includes(' -o '+oldObject+' ')&&!linkCommand.includes(' -o captraw-engine '));
 const cohortPaths=[original,recipe,join(root,'native/patches/patch-art.mjs'),join(build,'captraw-engine'),join(build,'libcaptraw-core.a'),join(build,'src/engine/libart_engine.a'),join(build,'src/utils/libart_utils.a'),
  ...['procparams.h','improcfun.h','color.h','iccstore.h','iccmatrices.h'].map(p=>join(upstream,p))];
 const identities=Object.fromEntries(cohortPaths.map(p=>[p,hash(p)]));
 const manifest={scope:'Isolated fixed projection plus existing project chromaWeighted extension; no gain or sweep. Not unmodified upstream ART.',
  identities,preparedSourceSHA256:hash(source),copiedHelperSHA256:createHash('sha256').update(helper).digest('hex'),operatorUnchanged:true,compileCommand,linkCommand,binary};
 writeFileSync(join(work,'manifest.json'),JSON.stringify(manifest,null,2));
 const verify=`import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';const m=JSON.parse(readFileSync(process.argv[2]));for(const [p,h] of Object.entries(m.identities)){if(createHash('sha256').update(readFileSync(p)).digest('hex')!==h)throw Error('Shared input changed: '+p);}`;
 writeFileSync(join(work,'verify.mjs'),verify);
 writeFileSync(join(work,'compile.sh'),`#!/bin/sh\nset -eu\nnode ${quote(join(work,'verify.mjs'))} ${quote(join(work,'manifest.json'))}\ncd ${quote(build)}\n${compileCommand}\n${linkCommand}\nnode ${quote(join(work,'verify.mjs'))} ${quote(join(work,'manifest.json'))}\n`,{mode:0o700});
 console.log(JSON.stringify({scope:'Preparation only; parent compiles',work,compile:['/bin/sh',join(work,'compile.sh')],binary,manifest:join(work,'manifest.json')}));
 complete=process.argv.includes('--check');
}finally{if(complete)rmSync(work,{recursive:true,force:true});else console.error('Private probe prepared:',work);}
