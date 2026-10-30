// --build is reserved for the parent's coordinated build window. All compiler
// outputs live in this script's independent scratch, never the shared build.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {curveRefineProbeKernel} from '../../../native/patches/patch-curve-refine.mjs';
const work=mkdtempSync(join(tmpdir(),'captraw-curve-refine-probe-')),source=join(work,'probe.cc'),object=join(work,'probe.o'),binary=join(work,'probe');let passed=false;
const root=resolve('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/src/engine');
const tone=readFileSync(join(root,'iptonecurve.cc'),'utf8');
const between=(a,b)=>{const i=tone.indexOf(a),j=tone.indexOf(b,i+a.length);assert(i>=0&&j>i);return tone.slice(i,j);};
const expand=between('float expand_range(float whitept, float x)','void satcurve_lut(').replace('float expand_range(','float probe_expand_range(');
const adjust=between('        const auto expand =','        DiagonalCurve tcurve2').replace('expand_range(whitept, x)','probe_expand_range(whitept, x)');
const doubleCurve=between('class DoubleCurve: public Curve {','} // namespace').replaceAll('DoubleCurve','ProbeDoubleCurve');
const contrast=between('class ContrastCurve: public Curve {','// tone mapping from').replaceAll('ContrastCurve','ProbeContrastCurve');
const cpp=`#include "core.h"
#include "engine/color.h"
#include "engine/curves.h"
#include "engine/imagefloat.h"
#include "engine/iccmatrices.h"
#include "engine/rt_math.h"
#include <nlohmann/json.hpp>
#include <array>
#include <cmath>
#include <cstring>
#include <iostream>
#include <fstream>
#include <limits>
#include <stdexcept>
namespace art { namespace engine {
${curveRefineProbeKernel()}
${expand}
${doubleCurve}
${contrast}
std::vector<double> probe_adjust(std::vector<double> points,float whitept) {
${adjust}
 return adjust(points);
}
}}
using Json=nlohmann::json;
int main(int argc,char **argv) {
 try {
  captraw::Engine engine(argv[1],argv[2],[](const Json &){});
  using namespace art::engine;
  const auto raw=std::vector<double>{double(art::utils::DCT_Spline),0,0,32./255,16./255,64./255,50./255,128./255,128./255,192./255,202./255,1,1};
  Json rows=Json::array(),residuals=Json::array();int failures=0;
  const auto wrapped=[](double h){while(h>180)h-=360;while(h<-180)h+=360;return h;};
  const auto hue=[](const Json &v,double wp){
   double xyz[3]={};for(int i=0;i<3;++i)for(int j=0;j<3;++j)xyz[i]+=xyz_rec2020[i][j]*v[j].get<double>()/wp;
   xyz[0]/=Color::D50x;xyz[2]/=Color::D50z;
   for(double &x:xyz)x=x>216./24389?std::cbrt(x):(24389./27*x+16)/116;
   const double a=500*(xyz[0]-xyz[1]),b=200*(xyz[1]-xyz[2]);
   return std::atan2(b,a)*180/std::acos(-1.);
  };
  for(float white:{1.f,2.f,8.f,16.f}) {
   DiagonalCurve primary(probe_adjust(raw,white)),second(probe_adjust(raw,white));
   const double pivot=.18/white,c=std::pow(.25,1.5)*16,b=1+c;
   const double a=std::log((std::exp(std::log(b)*pivot)-1)/(b-1))/std::log(pivot);
   ProbeContrastCurve contrast(a,b,white);ProbeDoubleCurve tail(primary,second),complete(contrast,tail);
   ToneCurve p,q,cc,combined;p.Set(primary,white);q.Set(second,white);cc.Set(contrast,white);combined.Set(complete,white);
   const auto &stdp=static_cast<const StandardToneCurve &>(p);
   const auto &stdb=static_cast<const StandardToneCurve &>(combined);
   const float wp=p.whitept;
   const auto residualCheck=[&](const ToneCurve &tc,const std::array<float,3> &v,float amount){
    const auto &s=static_cast<const StandardToneCurve &>(tc);const auto &w=static_cast<const WeightedStdToneCurve &>(tc);
    auto base=v;s.Apply(base[0],base[1],base[2]);auto expected=base,actual=v;
    const bool bypass=amount==0.f||(v[0]==v[1]&&v[1]==v[2])||tc.curve->isIdentity();
    if(!bypass){
     std::array<float,3> c;for(int ch=0;ch<3;++ch)c[ch]=std::max(0.f,std::min(tc.whitept,v[ch]));auto sc=c,wc=c;s.Apply(sc[0],sc[1],sc[2]);
     float low=0.f,high=tc.whitept,unused=0.f;s.Apply(low,high,unused);
     if(low==0.f&&high==tc.whitept)w.Apply(wc[0],wc[1],wc[2]);
     else {
      // Independent barycentric reference, not the inserted Triangle helper.
      const auto triangle=[&](int anchor,int target){const double a=c[anchor],b=c[target],mapped=sc[anchor],peak=tc.whitept;if(a==b)return float(mapped);return float(b<a ? ((a-b)*low+b*mapped)/a : ((b-a)*high+(peak-b)*mapped)/(peak-a));};
      for(int ch=0;ch<3;++ch){float terms[3];for(int anchor=0;anchor<3;++anchor)terms[anchor]=triangle(anchor,ch)*(anchor==ch?.5f:.25f);wc[ch]=(terms[0]+terms[1])+terms[2];}
     }
     for(int ch=0;ch<3;++ch)if(wc[ch]!=sc[ch])expected[ch]+=amount/100.f*(wc[ch]-sc[ch]);
    }
    refine_point_rgb(tc,amount,actual[0],actual[1],actual[2]);double error=0;
    if(bypass&&std::memcmp(actual.data(),base.data(),sizeof(actual))!=0)++failures;
    for(int ch=0;ch<3;++ch){error=std::max(error,std::abs(double(actual[ch])-expected[ch]));if(!std::isfinite(actual[ch])||std::abs(actual[ch]-expected[ch])>4*std::numeric_limits<float>::epsilon()*std::max(1.f,std::abs(expected[ch])))++failures;}
    residuals.push_back({{"whitept",tc.whitept},{"input",v},{"amount",amount},{"baseline",base},{"expected",expected},{"actual",actual},{"residualMax16",error},{"exactBypass",bypass}});return actual;
   };
   for(const auto &v:std::vector<std::array<float,3>>{{-.01f*wp,.18f*wp,.04f*wp},{1.01f*wp,.18f*wp,.04f*wp},{.5f*wp,.5f*wp,.5f*wp}}) {
    for(float amount:{0.f,50.f,100.f})residualCheck(p,v,amount);
   }
   DiagonalCurve identity({double(art::utils::DCT_Linear),0,0,1,1});ToneCurve id;id.Set(identity,white);residualCheck(id,{1.01f*wp,.18f*wp,.04f*wp},100.f);
   // A real ART linear curve with a super-white tail detects replacing B by
   // STD(clamp(input)) or hard-clamping the final HDR signal.
   DiagonalCurve boost({double(art::utils::DCT_Linear),0,0,64,96});ToneCurve high;high.Set(boost,white);
   const auto extended=residualCheck(high,{2.f*wp,.18f*wp,.04f*wp},100.f);if(extended[0]<=wp)++failures;
   for(const auto &ends:std::vector<std::array<float,2>>{{.0625f,.9375f},{.5f,.5f},{.9375f,.0625f}}){
    DiagonalCurve affine({double(art::utils::DCT_Linear),0,double(ends[0]*white),double(white),double(ends[1]*white)});ToneCurve affineTC;affineTC.Set(affine,white);
    residualCheck(affineTC,{.02f*wp,.4f*wp,.98f*wp},100.f);
    residualCheck(affineTC,{.4f*wp,.4f*wp,.4f*wp},100.f);
   }
   Imagefloat gray(4096,1);for(int x=0;x<4096;++x)gray.r(0,x)=gray.g(0,x)=gray.b(0,x)=wp*x/4095.f;
   std::vector<std::array<float,3>> reference(4096);
   for(int x=0;x<4096;++x){auto &v=reference[x];v={gray.r(0,x),gray.g(0,x),gray.b(0,x)};stdb.Apply(v[0],v[1],v[2]);}
   apply_combined_curve_refine(&gray,combined,&cc,p,&q,100.f,false);
   for(int x=0;x<4096;++x){std::array<float,3> actual{gray.r(0,x),gray.g(0,x),gray.b(0,x)};if(std::memcmp(actual.data(),reference[x].data(),sizeof(actual))!=0)++failures;}
   for(float boundary:{0.f,wp}) {
    Json levels=Json::array();double coarse=0,fine=0,coarseHue=0,fineHue=0;
    for(float fraction:{1e-4f,1e-6f}) {
     const float step=wp*fraction;Imagefloat ramp(3,1);Json before=Json::array();
     for(int i=0;i<3;++i){ramp.r(0,i)=boundary+(i-1)*step;ramp.g(0,i)=wp*.18f;ramp.b(0,i)=wp*.04f;std::array<float,3> v{ramp.r(0,i),ramp.g(0,i),ramp.b(0,i)};stdp.Apply(v[0],v[1],v[2]);before.push_back(v);}
     apply_point_curve_refine(&ramp,p,100.f,false);Json after=Json::array();double jump=0;
     for(int i=0;i<3;++i)after.push_back(std::array<float,3>{ramp.r(0,i),ramp.g(0,i),ramp.b(0,i)});
     for(int ch=0;ch<3;++ch){const double d=(after[2][ch].get<double>()-after[0][ch].get<double>())-(before[2][ch].get<double>()-before[0][ch].get<double>());jump=std::max(jump,std::abs(d));}
     const double hueJump=std::abs(wrapped(wrapped(hue(after[2],wp)-hue(before[2],wp))-wrapped(hue(after[0],wp)-hue(before[0],wp))));
     if(fraction>1e-5f)coarse=jump;else fine=jump;
     if(fraction>1e-5f)coarseHue=hueJump;else fineHue=hueJump;
     levels.push_back({{"stepFraction",fraction},{"std",before},{"refined",after},{"extraJump16",jump},{"peakRelativeLabHueCorrectionJumpDeg",hueJump}});
    }
    // A finite nonzero limit when step shrinks indicates a guard discontinuity.
    const bool discontinuous=fine>1. && fine>coarse*.25;if(discontinuous)++failures;
    const bool hueDiscontinuous=fineHue>1e-3 && fineHue>coarseHue*.25;if(hueDiscontinuous)++failures;
    rows.push_back({{"whitecoeff",white},{"whitept",wp},{"boundary",boundary},{"levels",levels},{"discontinuous",discontinuous},{"hueDiscontinuous",hueDiscontinuous}});
   }
   const int count=1025;Imagefloat colored(count,1);std::vector<std::array<float,3>> denseBase(count),denseResult(count);int addedWorkingClips=0;double largestStep=0,largestHueStep=0,previousHue=0;
   for(int i=0;i<count;++i){colored.r(0,i)=wp*(-.02f+1.04f*i/(count-1));colored.g(0,i)=wp*.18f;colored.b(0,i)=wp*.04f;denseBase[i]={colored.r(0,i),colored.g(0,i),colored.b(0,i)};stdp.Apply(denseBase[i][0],denseBase[i][1],denseBase[i][2]);}
   apply_point_curve_refine(&colored,p,100.f,false);
   for(int i=0;i<count;++i){auto &v=denseResult[i];v={colored.r(0,i),colored.g(0,i),colored.b(0,i)};bool added=false;
    for(int ch=0;ch<3;++ch){if(!std::isfinite(v[ch]))++failures;const float b=denseBase[i][ch],slack=4*std::numeric_limits<float>::epsilon()*wp;if(b>=0&&b<=wp&&(v[ch]<-slack||v[ch]>wp+slack))added=true;if(i)largestStep=std::max(largestStep,std::abs(double(v[ch])-denseResult[i-1][ch]));}
    if(added)++addedWorkingClips;const double correction=wrapped(hue(Json(v),wp)-hue(Json(denseBase[i]),wp));if(i)largestHueStep=std::max(largestHueStep,std::abs(wrapped(correction-previousHue)));previousHue=correction;
   }
   if(addedWorkingClips)++failures;
   const auto file=std::string(argv[2])+"/ramp-w"+std::to_string(int(white))+".rgb32f";std::ofstream stream(file,std::ios::binary);if(!stream)throw std::runtime_error("Cannot write actual probe ramp");for(const auto &v:denseBase)stream.write(reinterpret_cast<const char *>(v.data()),3*sizeof(float));for(const auto &v:denseResult)stream.write(reinterpret_cast<const char *>(v.data()),3*sizeof(float));
   rows.push_back({{"whitecoeff",white},{"whitept",wp},{"denseColoredRamp",{{"samples",count},{"inputRangeRelative",{-.02,1.02}},{"addedWorkingClips",addedWorkingClips},{"maxAdjacentOutputStep16",largestStep},{"maxAdjacentHueCorrectionStepDeg",largestHueStep},{"file",file},{"format","2x1025x3-float32-le: baseline then refined"}}}});
   // Existing point-editor operations: lifted black / lowered white. Exercise
   // a second channel exactly at the same boundary, not only interior colors.
   // Keep these results separate from the original eight normal-endpoint ramps.
   for(bool lift:{true,false}) {
    auto endpoints=raw;if(lift)endpoints[2]=16./255;else endpoints.back()=240./255;
    DiagonalCurve endpointCurve(probe_adjust(endpoints,white));ToneCurve endpoint;endpoint.Set(endpointCurve,white);
    const auto &baseline=static_cast<const StandardToneCurve &>(endpoint);const float boundary=lift?0.f:wp;
    for(float amount:{0.f,50.f,100.f})residualCheck(endpoint,{boundary,boundary,.04f*wp},amount);
    residualCheck(endpoint,{.4f*wp,.4f*wp,.4f*wp},100.f);
    Json levels=Json::array();double coarse=0,fine=0,coarseHue=0,fineHue=0;
    for(float fraction:{1e-4f,1e-6f}){
     Json before=Json::array(),after=Json::array();const float step=wp*fraction;
     for(int side:{-1,1}){std::array<float,3> input{boundary+side*step,boundary,.04f*wp},a=input,b=input;baseline.Apply(b[0],b[1],b[2]);refine_point_rgb(endpoint,100.f,a[0],a[1],a[2]);before.push_back(b);after.push_back(a);}
     double jump=0;for(int ch=0;ch<3;++ch)jump=std::max(jump,std::abs((after[1][ch].get<double>()-after[0][ch].get<double>())-(before[1][ch].get<double>()-before[0][ch].get<double>())));
     const double hueJump=std::abs(wrapped(wrapped(hue(after[1],wp)-hue(before[1],wp))-wrapped(hue(after[0],wp)-hue(before[0],wp))));
     if(fraction>1e-5f){coarse=jump;coarseHue=hueJump;}else{fine=jump;fineHue=hueJump;}
     levels.push_back({{"stepFraction",fraction},{"std",before},{"refined",after},{"extraJump16",jump},{"peakRelativeLabHueCorrectionJumpDeg",hueJump}});
    }
    const bool discontinuous=fine>1.&&fine>coarse*.25;if(discontinuous)++failures;
    const bool hueDiscontinuous=fineHue>1e-3&&fineHue>coarseHue*.25;if(hueDiscontinuous)++failures;
    // Dense colored corner ramp retains the ordinary ramp's no-extra-clipping
    // guard. Moving an endpoint must not hide a new finite-step seam.
    int cornerClips=0;double maxHueStep=0,previous=0;
    for(int i=0;i<1025;++i){
     const float x=boundary+wp*(-.02f+.04f*i/1024);std::array<float,3> base{x,boundary,.04f*wp},out=base;
     baseline.Apply(base[0],base[1],base[2]);refine_point_rgb(endpoint,100.f,out[0],out[1],out[2]);bool added=false;
     const float slack=4*std::numeric_limits<float>::epsilon()*wp;
     for(int ch=0;ch<3;++ch){if(!std::isfinite(out[ch]))++failures;if(base[ch]>=0&&base[ch]<=wp&&(out[ch]<-slack||out[ch]>wp+slack))added=true;}
     if(added)++cornerClips;const double correction=wrapped(hue(Json(out),wp)-hue(Json(base),wp));if(i)maxHueStep=std::max(maxHueStep,std::abs(wrapped(correction-previous)));previous=correction;
    }
    if(cornerClips)++failures;
    rows.push_back({{"whitecoeff",white},{"whitept",wp},{"endpointCorner",lift?"lifted-black-16":"lowered-white-240"},{"boundary",boundary},{"levels",levels},{"discontinuous",discontinuous},{"hueDiscontinuous",hueDiscontinuous},{"denseCornerRamp",{{"samples",1025},{"addedWorkingClips",cornerClips},{"maxAdjacentHueCorrectionStepDeg",maxHueStep}}}});
   }
  }
  std::cout<<Json{{"scope","compiled inserted kernel plus real ART LUT/curve/image types; not full App acceptance; Lab hue is peak-relative D50 working-space diagnostic, not output ICC or photographic skin validation"},{"rows",rows},{"baselineResiduals",residuals},{"failures",failures}}.dump()<<std::endl;return failures?1:0;
 }catch(const std::exception &e){std::cerr<<e.what()<<std::endl;return 1;}
}
`;
try{
 writeFileSync(source,cpp);
 const commands=execFileSync('ninja',['-C',resolve('build/native'),'-t','commands','captraw-wb-probe'],{encoding:'utf8',maxBuffer:8*1024*1024}).split('\n');
 const oldSource=resolve('tests/native/color/white-balance-probe.cc'),compile=commands.find(c=>c.includes(oldSource)&&c.includes(' -c ')),link=commands.find(c=>c.includes(' -o captraw-wb-probe '));assert(compile&&link,'Missing existing native probe toolchain');
 const oldObject=compile.match(/ -o (\S+) /)?.[1];assert(oldObject&&link.includes(oldObject));
 const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 assert(compile.endsWith(' -c '+oldSource),'Unexpected native probe source argument');
 const compileCommand=compile.replace(' -c '+oldSource,' -c '+quote(source)).replace(' -o '+oldObject+' ',' -o '+quote(object)+' ').replace(' -MT '+oldObject+' ',' -MT '+quote(object)+' ').replace(/ -MF \S+ /,' -MF '+quote(join(work,'probe.d'))+' ');
 assert(!compileCommand.includes(oldSource),'Old source/object/dependency reference remains in isolated compile command');
 const linkCommand=link.replace(oldObject,quote(object)).replace(' -o captraw-wb-probe ',' -o '+quote(binary)+' ');
 if(process.argv.includes('--build')){
  execFileSync('/bin/zsh',['-c',compileCommand],{cwd:resolve('build/native'),stdio:'inherit'});
  execFileSync('/bin/zsh',['-c',linkCommand],{cwd:resolve('build/native'),stdio:'inherit'});
  const strings=execFileSync('strings',[binary],{encoding:'utf8',maxBuffer:8*1024*1024});
  assert(strings.includes('compiled inserted kernel plus real ART LUT/curve/image types'),'Wrong probe main linked; kernel result identity missing');
  execFileSync(binary,[resolve('build/native/resources'),join(work,'cache')],{stdio:'inherit'});passed=true;
 }else console.log(JSON.stringify({scope:'prepare only; no compiler invoked',source,compileCommand,linkCommand,binary}));
}finally{if(passed)rmSync(work,{recursive:true,force:true});else console.error('Prepared/failed probe retained:',work);}
