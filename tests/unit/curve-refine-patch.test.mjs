// Source-only: imports .mjs directly. No contracts/dist, compiler or engine.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {patchCurveRefine} from '../../native/patches/patch-curve-refine.mjs';
import {patchParametricCurve} from '../../native/patches/patch-art.mjs';
import {compareCurveRefineChains} from '../support/curve-refine-chain-fixture.mjs';

const files=['procparams.h','procparams.cc','iptonecurve.cc','iprgbcurves.cc'];
const prefix='ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/';
const sourceFixture=process.env.CAPTRAW_ART_SOURCE_ARCHIVE||resolve('build/upstream/art.tar.gz'),fixtureTest=(name,run)=>test(name,{skip:existsSync(sourceFixture)?false:'Requires the pinned ART source archive'},run);
let lastFailure;
function fixture(run){
 const work=mkdtempSync(join(tmpdir(),'captraw-curve-refine-patch-'));let passed=false;
 try{
  execFileSync('tar',['-xzf',sourceFixture,'-C',work,'--strip-components=1',...files.map(f=>prefix+'src/engine/'+f)]);
  const path=name=>join(work,'src/engine',name),read=name=>readFileSync(path(name),'utf8');
  run({work,path,read});passed=true;
 }finally{
  if(passed)rmSync(work,{recursive:true,force:true});
  else{
   if(lastFailure)rmSync(lastFailure,{recursive:true,force:true});
   lastFailure=work;console.error('Retained failing source fixture:',work);
  }
 }
}
const section=(s,start,end)=>{const i=s.indexOf(start);assert(i>=0,start);const j=s.indexOf(end,i+start.length);assert(j>i,end);return s.slice(i,j);};

fixtureTest('pinned source patch prepares opt-in state, equality and ARP ownership',()=>fixture(({work,read})=>{
 patchCurveRefine(work);
 const h=read('procparams.h'),cc=read('procparams.cc');
 assert(h.includes('std::string captrawCurveRefineModel;'));
 assert(h.includes('double captrawCurveRefineAmount = 0.;'));
 assert(cc.includes('captrawCurveRefineModel == other.captrawCurveRefineModel'));
 assert(cc.includes('captrawCurveRefineAmount == other.captrawCurveRefineAmount'));
 const saved=section(cc,'// CaptRAW: preserve opt-in point-curve refinement.','            saveToKeyfile("ToneCurve", "Saturation"');
 assert(saved.includes('if (!toneCurve.captrawCurveRefineModel.empty())'));
 for(const field of ['CaptRAWCurveRefineModel','CaptRAWCurveRefineAmount'])assert(saved.includes('"'+field+'"'));
 const loaded=section(cc,'                toneCurve.captrawCurveRefineModel.clear();','                assignFromKeyfile(keyFile, "ToneCurve", "Enabled",');
 assert(loaded.includes('captrawCurveRefineAmount = 0.'));
 assert(loaded.includes('keyFile.get_string('));
 assert(loaded.includes('\"ToneCurve\", \"CaptRAWCurveRefineModel\").raw()'));
 assert(!/assignFromKeyfile\([\s\S]*?captrawCurveRefineModel\)/.test(loaded));
 assert(loaded.includes('== "weighted-std-v1"'));
 assert(loaded.includes('!= "weighted-std-v1") return 1;'));
 assert(loaded.includes('!hasRefineAmount'));
 assert(loaded.includes('!std::isfinite'));
 assert(loaded.includes('captrawCurveRefineAmount > 100.'));
 assert(!cc.includes('CurveRefineSaturation'),'Unknown standard XMP must not become a native activation signal');
}));

fixtureTest('zero and identity dispatch retain the complete old rendering branch verbatim',()=>fixture(({work,read})=>{
 const before=read('iptonecurve.cc');patchCurveRefine(work);const after=read('iptonecurve.cc');
 const legacy=section(before,'        if (single_curve) {','        if (editWhatever) {');
 const retained=section(after,'        if (single_curve) {','        if (editWhatever) {');
 const recovered=retained.replace(/            if \(refine_point_curve\) \{[\s\S]*?            \} else \{\n([\s\S]*?)\n            \}/,'$1').replace(/                if \(refine_point_curve\) apply_point_curve_refine\(img,tc,\n[\s\S]*?multiThread\);\n                else apply_tc/,'                apply_tc');
 assert.equal(recovered,legacy);
 const enabled=section(after,'        const bool refine_point_curve =','        if (single_curve && editImgFloat');
 assert(enabled.includes('captrawCurveRefineModel == "weighted-std-v1"'));
 assert(enabled.includes('captrawCurveRefineAmount > 0.'));
 assert(enabled.includes('curveMode == ToneCurveParams::TcMode::STD'));
 assert(enabled.includes('!tcurve1.isIdentity()'));
 assert(after.includes('if (amount == 0.f || (ir == ig && ig == ib) || (tc.curve && tc.curve->isIdentity())) return;'));
}));

fixtureTest('only the primary point curve is mixed; gamma, RGB channels and parametric code stay intact',()=>fixture(({work,read})=>{
 patchParametricCurve(work);
 const before=read('iptonecurve.cc'),rgb=read('iprgbcurves.cc');patchCurveRefine(work);const after=read('iptonecurve.cc');
 assert.equal(section(after,'        const auto adjust =','        DiagonalCurve tcurve2'),section(before,'        const auto adjust =','        DiagonalCurve tcurve2'));
 assert.equal(section(after,'        // CaptRAW: apply the native parametric curve','        auto satcurve_pts'),section(before,'        // CaptRAW: apply the native parametric curve','        auto satcurve_pts'));
 assert.equal(read('iprgbcurves.cc'),rgb);
 const active=section(after,'        if (single_curve) {','        if (editWhatever) {');
 assert.equal(active.split('apply_point_curve_refine(').length-1,1);
 assert.equal(active.split('apply_combined_curve_refine(').length-1,1);
 assert(active.includes('tc.Set(*tcurve, whitept);'));
 assert(active.includes('tc.Set(tcurve2, whitept);\n                apply_tc('));
 assert(active.includes('tc.Set(*ccurve, whitept);\n                apply_tc('));
}));

fixtureTest('finite compensation extends boundary deltas without replacing or clamping the STD baseline',()=>fixture(({work,read})=>{
 patchCurveRefine(work);const source=read('iptonecurve.cc'),body=section(source,'void refine_point_rgb(','void apply_point_curve_refine(');
 const std=body.indexOf('standard.Apply(r, g, b);'),gray=body.indexOf('if (amount == 0.f || (ir == ig && ig == ib)'),guard=body.indexOf('if (!std::isfinite(ir)'),weighted=body.indexOf('WeightedStdToneCurve');
 assert(std<gray&&gray<guard&&guard<weighted);
 for(const name of ['ir','ig','ib','r','g','b','sr','sg','sb','wr','wg','wb','tc.whitept'])assert(body.includes('!std::isfinite('+name+')'));
 assert(!/\b(?:CLIP|LIM)\s*\(/.test(body));
 assert(!body.includes('65535.f'));
 for(const [a,b,c] of [['r','wr','sr'],['g','wg','sg'],['b','wb','sb']])assert(body.includes(`if (${b} != ${c}) ${a} += strength * (${b} - ${c});`));
 for(const name of ['ir','ig','ib'])assert(body.includes('std::max(0.f,std::min(tc.whitept,'+name+'))'));
 assert(body.includes('standard.Apply(sr,sg,sb);'));
 assert(body.includes('ends.black == 0.f && ends.white == tc.whitept'));
 assert(body.includes('!std::isfinite(ends.black) || !std::isfinite(ends.white)'));
 const triangle=section(source,'float curve_refine_triangle(','void refine_point_rgb(');
 assert(triangle.includes('if (a == b) return mapped;'));
 assert(triangle.includes('b < a ? ends.black : ends.white'));
 assert(triangle.includes('return float((1.-t)*end+t*mapped);'));
 assert(!triangle.includes('ends.white-ends.black'),'Equal/reversed spans cannot require an endpoint-span division');
 assert(source.includes('const PointCurveRefineEndpoints ends(tc);'));
 assert(source.includes('const PointCurveRefineEndpoints ends(point);'));
 // This establishes source dispatch/domain guards, not compiled HDR quality.
 const combined=section(source,'void apply_combined_curve_refine(','void apply_tc(');
 assert(combined.includes('baseline.Apply(r, g, b);'));
 assert(combined.includes('tail.Apply(sr,sg,sb); tail.Apply(mr,mg,mb);'));
 assert(combined.includes('if (mr != sr) r += mr - sr;'));
}));

fixtureTest('patch composes after existing parametric patch and replays byte-exactly',()=>fixture(({work,read})=>{
 patchParametricCurve(work);patchCurveRefine(work);const once=files.map(read);
 patchParametricCurve(work);patchCurveRefine(work);assert.deepEqual(files.map(read),once);
 assert(read('procparams.cc').includes('captrawParametric == other.captrawParametric'));
}));

fixtureTest('missing source anchor rejects before any file is written',()=>fixture(({work,path,read})=>{
 writeFileSync(path('iptonecurve.cc'),read('iptonecurve.cc').replace('        if (single_curve && editImgFloat &&','        if (changed_fixture && editImgFloat &&'));
 const before=files.map(read);assert.throws(()=>patchCurveRefine(work),/anchor mismatch/);assert.deepEqual(files.map(read),before);
}));

test('nonzero Contrast and inherited curve2 keep the optimized gray baseline in the numerical source fixture',()=>{
 const result=compareCurveRefineChains();assert.equal(result.rows.length,3);
 assert.equal(result.corners.length,2);
 for(const corner of result.corners){
  assert(corner.legacyExtraJump16[1]>corner.legacyExtraJump16[0]*.25,'Retain the original endpoint discontinuity reproduction');
  assert(corner.reanchoredExtraJump16[1]<corner.reanchoredExtraJump16[0]*.25,'Endpoint correction must converge with the step, not a fixed fade threshold');
 }
 for(const row of result.rows){
  assert(row.oldDraftGrayMax16>0,'Fixture must expose the former chain-switch offset');
  for(const amount of row.amounts)assert.equal(amount.anchoredGrayChangedSamples,0);
  assert.equal(row.amounts[0].anchoredRGBMaxChange16,0);
  assert(row.amounts[1].anchoredRGBMaxChange16<.01,'No fixed chain-switch offset near amount zero');
 }
});

fixtureTest('partially applied patch cannot be mistaken for a complete replay',()=>fixture(({work,path,read})=>{
 const before=read('procparams.cc');patchCurveRefine(work);writeFileSync(path('procparams.cc'),before);
 const partial=files.map(read);assert.throws(()=>patchCurveRefine(work),/Partial curve-refine patch/);assert.deepEqual(files.map(read),partial);
}));

fixtureTest('tampered mixer rejects replay before touching other files',()=>fixture(({work,path,read})=>{
 patchCurveRefine(work);writeFileSync(path('iptonecurve.cc'),read('iptonecurve.cc').replace('std::min(tc.whitept,ir)','std::min(65535.f,ir)'));
 const before=files.map(read);assert.throws(()=>patchCurveRefine(work),/Modified curve-refine patch/);assert.deepEqual(files.map(read),before);
}));
