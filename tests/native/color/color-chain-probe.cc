#include "core.h"
#include "float-preview.h"
#include "engine/imagefloat.h"
#include "engine/halffloat.h"
#include "engine/procparams.h"
#include <iostream>
#include <stdexcept>
namespace ae=art::engine;
int main(int argc,char **argv){
 try{
  if(argc!=3)throw std::runtime_error("Usage: color-chain-probe <resources> <cache>");
  captraw::Engine engine(argv[1],argv[2],[](const captraw::Json &){});
  captraw::Json input;std::cin>>input;
  if(!input.is_array()||input.empty()||input.size()>10000)throw std::runtime_error("Expected RGB samples");
  ae::Imagefloat pixels(input.size(),1);pixels.assignColorSpace("Rec2020");
  for(size_t i=0;i<input.size();++i){pixels.r(0,i)=input[i][0].get<float>()*65535.f;pixels.g(0,i)=input[i][1].get<float>()*65535.f;pixels.b(0,i)=input[i][2].get<float>()*65535.f;}
  ae::procparams::ProcParams params;
  const auto converted=captraw::linearPixels(pixels,params.icm,0,0,input.size(),1,"display-p3-linear");
  const auto encoded=captraw::linearPixels(pixels,params.icm,0,0,input.size(),1,"display-p3");
  const auto proof=captraw::linearPixels(pixels,params.icm,0,0,input.size(),1,"display-p3","srgb");
  captraw::Json output=captraw::Json::array(),display=captraw::Json::array(),proofPixels=captraw::Json::array();
  for(size_t i=0;i<input.size();++i){
   if(pixels.r(0,i)!=input[i][0].get<float>()*65535.f||pixels.g(0,i)!=input[i][1].get<float>()*65535.f||pixels.b(0,i)!=input[i][2].get<float>()*65535.f)throw std::runtime_error("Borrowed working pixels changed");
   output.push_back({ae::DNG_HalfToFloat(converted.rgba[i*4]),ae::DNG_HalfToFloat(converted.rgba[i*4+1]),ae::DNG_HalfToFloat(converted.rgba[i*4+2])});
   display.push_back({ae::DNG_HalfToFloat(encoded.rgba[i*4]),ae::DNG_HalfToFloat(encoded.rgba[i*4+1]),ae::DNG_HalfToFloat(encoded.rgba[i*4+2])});
   proofPixels.push_back({ae::DNG_HalfToFloat(proof.rgba[i*4]),ae::DNG_HalfToFloat(proof.rgba[i*4+1]),ae::DNG_HalfToFloat(proof.rgba[i*4+2])});
   if(converted.rgba[i*4+3]!=0x3c00)throw std::runtime_error("Invalid alpha");
  }
  std::cout<<captraw::Json{{"working","Rec2020-linear"},{"monitor","display-p3-linear"},{"pixels",output},{"displayPixels",display},{"proofPixels",proofPixels},{"sourceUnchanged",true}}.dump()<<'\n';
 }catch(const std::exception &error){std::cerr<<error.what()<<'\n';return 1;}
}
