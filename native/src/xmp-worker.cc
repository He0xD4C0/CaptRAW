#include "xmp.h"
#include "XMP.incl_cpp"
#include <iostream>
using captraw::xmp::Json;
int main(){
 try{captraw::xmp::initialize();if(!SXMPFiles::Initialize())throw std::runtime_error("XMP file initialization failed");}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}
 std::string line;
 while(std::getline(std::cin,line)){
  Json id=nullptr;
  try{
   if(line.size()>128*1024*1024)throw std::runtime_error("XMP request too large");
   const auto request=Json::parse(line);id=request.at("id");const std::string method=request.at("method"),packet=request.value("packet",std::string());
   auto meta=packet.empty()?SXMPMeta():captraw::xmp::parse(packet);
   if(method=="file-read"||method=="file-write"){
    const std::string path=request.at("path"),format=request.at("format");
    if(format!="jpeg"&&format!="tiff")throw std::runtime_error("XMP file operation supports rendered JPEG/TIFF only");
    SXMPFiles file;const auto kind=format=="jpeg"?kXMP_JPEGFile:kXMP_TIFFFile;
    const auto mode=(method=="file-write"?kXMPFiles_OpenForUpdate:kXMPFiles_OpenForRead)|kXMPFiles_OpenUseSmartHandler|kXMPFiles_OpenOnlyXMP;
    if(!file.OpenFile(path.c_str(),kind,mode))throw std::runtime_error("Cannot open output XMP container");
    if(method=="file-write")file.PutXMP(meta);else file.GetXMP(&meta);
    file.CloseFile(method=="file-write"?kXMPFiles_UpdateSafely:0);
    std::cout<<Json({{"id",id},{"result",{{"packet",captraw::xmp::serialize(meta)},{"properties",captraw::xmp::properties(meta)}}}}).dump()<<std::endl;continue;
   }
   if(method=="write")captraw::xmp::update(meta,request.at("changes"));else if(method!="read")throw std::runtime_error("Unknown XMP operation");
   Json result={{"properties",captraw::xmp::properties(meta)}};
   if(method=="write"){
    result["packet"]=captraw::xmp::serialize(meta);auto restored=captraw::xmp::parse(result["packet"]);
    if(captraw::xmp::properties(restored)!=result["properties"])throw std::runtime_error("XMP roundtrip mismatch at "+Json::diff(result["properties"],captraw::xmp::properties(restored)).at(0).at("path").get<std::string>());
   }
   std::cout<<Json({{"id",id},{"result",result}}).dump()<<std::endl;
  }catch(const XMP_Error&e){std::cout<<Json({{"id",id},{"error",e.GetErrMsg()}}).dump()<<std::endl;}
  catch(const std::exception&e){std::cout<<Json({{"id",id},{"error",e.what()}}).dump()<<std::endl;}
 }
 SXMPFiles::Terminate();SXMPMeta::Terminate();
}
