// Source-only preparation. Parent compiles in a private directory; no shared build.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const work=mkdtempSync(join(tmpdir(),'captraw-glow-tonal-probe-'));
const source=join(work,'probe.cc'),object=join(work,'probe.o'),binary=join(work,'probe');
const build=resolve('build/native'),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const cpp=String.raw`// SPDX-License-Identifier: GPL-3.0-or-later
#include "core.h"
#include "engine/color.h"
#include "engine/rt_algo.h"
#include "engine/iccmatrices.h"
#include <nlohmann/json.hpp>
#include <array>
#include <cmath>
#include <cstring>
#include <iostream>
#include <stdexcept>
using Json=nlohmann::json;
using namespace art::engine;
constexpr float amount=.4f;
// ART ipsoftlight.cc sl(blend=1): its existing sRGB LUTs and Pegtop self blend.
// This diagnostic is explicitly SDR-only. No HDR clamp or invented extension.
float tonal(float x){
 if(!std::isfinite(x)||x<0||x>65535)throw std::runtime_error("SDR probe domain only");
 float v=Color::gamma_srgb(x)/65535.f;
 const float v2=v*v,v22=2*v2;
 return Color::igamma_srgb((v2+v22-v22*v)*65535.f);
}
// Fixed operator hypothesis, not an Adobe mapping:
// F(I,a)=(1-a)I+a*K(SoftLight_100(I)). K is ART's normalized Gaussian.
// Thus F(c,a)-c=a*(SoftLight_100(c)-c), rather than zero on constants.
void candidate(array2D<float> &input,array2D<float> &output,float a,float sigma){
 const int W=input.width(),H=input.height();
 if(a==0){for(int y=0;y<H;++y)for(int x=0;x<W;++x)output[y][x]=input[y][x];return;}
 array2D<float> layer(W,H),blurred(W,H),kernel;
 for(int y=0;y<H;++y)for(int x=0;x<W;++x)layer[y][x]=tonal(input[y][x]);
 build_gaussian_kernel(sigma,kernel);Convolution convolve(kernel,W,H,false);convolve(layer,blurred);
 for(int y=0;y<H;++y)for(int x=0;x<W;++x)output[y][x]=input[y][x]+a*(blurred[y][x]-input[y][x]);
}
int main(int argc,char **argv){
 try{
  if(argc!=3)throw std::runtime_error("resources and private cache required");
  captraw::Engine engine(argv[1],argv[2],[](const Json &){});
  constexpr int W=513,H=129,CX=256,CY=64;constexpr float sigma=6.4f;
  array2D<float> input(W,H),out(W,H),zero(W,H);Json constants=Json::array();int failures=0;
  for(double y:{.05,.3813473506920673,.8,1.}){
   const float value=float(y*65535);
   for(int j=0;j<H;++j)for(int i=0;i<W;++i)input[j][i]=value;
   candidate(input,out,amount,sigma);candidate(input,zero,0,sigma);
   double maximumDCResidual=0;for(int j=32;j<H-32;++j)for(int i=32;i<W-32;++i){
    if(zero[j][i]!=input[j][i])++failures;
    const float expected=value+amount*(tonal(value)-value);
    maximumDCResidual=std::max(maximumDCResidual,std::abs(double(out[j][i]-expected)));
   }
   constants.push_back({{"linearInput",y},{"actualInput16",value},{"outputCenter16",out[CY][CX]},
    {"deltaLinear",(out[CY][CX]-value)/65535.},{"DCFormulaMaxResidual16",maximumDCResidual},
    {"darktableSoftenDefaultDCOnly",y+double(amount)*(std::min(1.,y*std::exp2(.33))-y)}});
   if(maximumDCResidual>.25)++failures;
  }
  for(int j=0;j<H;++j)for(int i=0;i<W;++i)input[j][i]=0;input[CY][CX]=65535;
  candidate(input,out,amount,sigma);Json halo=Json::array();
  for(int d:{0,1,4,8,16,21,22,40})halo.push_back({{"distance",d},{"output16",out[CY][CX+d]}});
  if(!(out[CY][CX+1]>0))++failures;
  Json colors=Json::array();
  for(const auto &rgb:std::vector<std::array<float,3>>{{.95f,.02f,.02f},{.02f,.95f,.02f},{.02f,.02f,.95f}}){
   std::array<float,3> delta{};double dy=0;for(int c=0;c<3;++c){delta[c]=amount*(tonal(rgb[c]*65535)/65535-rgb[c]);dy+=xyz_rec2020[1][c]*delta[c];}
   colors.push_back({{"workingRGB",rgb},{"constantDeltaRGB",delta},{"workingRec2020DeltaY",dy}});
  }
  int domainRejections=0;for(float value:{-1.f,65536.f})try{tonal(value);}catch(const std::runtime_error &){++domainRejections;}
  if(domainRejections!=2)++failures;
  std::cout<<Json{{"identity","compiled ART tonal-layer plus normalized Gaussian; fixed a=.4, sigma6.4; no fit"},
   {"formula","I+a*(K(SoftLight_100(I))-I)"},{"constants",constants},{"blackImpulseHalo",halo},
   {"constantWorkingColors",colors},{"domainRejections",domainRejections},{"failures",failures},
   {"limits",{"Synthetic working SDR only, not full native/ICC/App acceptance","No Range/Warmth/style/local signed mapping","No HDR or negative-gamut extension","No fitted amount transfer or Adobe-kernel equivalence"}}}.dump()<<std::endl;
  return failures?1:0;
 }catch(const std::exception &e){std::cerr<<e.what()<<std::endl;return 1;}
}
`;
try{
 writeFileSync(source,cpp);
 const commands=execFileSync('ninja',['-C',build,'-t','commands','captraw-wb-probe'],{encoding:'utf8',maxBuffer:8*1024*1024}).split('\n');
 const oldSource=resolve('tests/native/color/white-balance-probe.cc'),compile=commands.find(c=>c.endsWith(' -c '+oldSource)),link=commands.find(c=>c.includes(' -o captraw-wb-probe '));assert(compile&&link);
 const oldObject=compile.match(/ -o (\S+) /)?.[1];assert(oldObject&&link.includes(oldObject));
 const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
 const once=(s,a,b)=>{assert.equal(s.split(a).length-1,1);return s.replace(a,b);};
 let compileCommand=once(compile,' -c '+oldSource,' -c '+q(source));
 compileCommand=once(compileCommand,' -o '+oldObject+' ',' -o '+q(object)+' ');
 compileCommand=once(compileCommand,' -MT '+oldObject+' ',' -MT '+q(object)+' ');
 compileCommand=compileCommand.replace(/ -MF \S+ /,' -MF '+q(join(work,'probe.d'))+' ');assert(!compileCommand.includes(oldSource));
 const linkCommand=once(once(link,oldObject,q(object)),' -o captraw-wb-probe ',' -o '+q(binary)+' ');
 writeFileSync(join(work,'compile-command.txt'),compileCommand+'\n');writeFileSync(join(work,'link-command.txt'),linkCommand+'\n');
 const manifest={scope:'prepare only; no compiler/linker/runtime invoked',work,source,object,binary,cwd:build,
  sourceSHA256:hash(source),sharedEngineSHA256:hash(join(build,'captraw-engine')),
  artSoftLightSourceSHA256:hash(resolve('build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/src/engine/ipsoftlight.cc')),
  fixedFormula:'I+a*(K(SoftLight_100(I))-I)',amount:.4,sigma:6.4,
  purpose:'Test nonzero DC plus scatter without a new fitted tone curve; deliberately no Adobe amount correspondence asserted',
  unsupported:['HDR and negative gamut','Range/Warmth/styles','local signed processing','preview/export/ICC quality equivalence'],
  run:[binary,resolve('build/native/resources'),join(work,'cache')],
  nativeResult:'pending parent isolated compile/run; keep source/library pairing fixed'};
 writeFileSync(join(work,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
}catch(error){writeFileSync(join(work,'failure.json'),JSON.stringify({error:String(error)}));throw error;}
