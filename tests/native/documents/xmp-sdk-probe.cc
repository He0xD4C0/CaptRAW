#include "xmp.h"
#include <fstream>
#include <filesystem>
#include <iostream>
#include <nlohmann/json.hpp>
using Json=nlohmann::json;
Json snapshot(const SXMPMeta &meta){
 Json result=Json::object();
 SXMPIterator i(meta);std::string ns,path,value;XMP_OptionBits options=0;
 while(i.Next(&ns,&path,&value,&options))result[ns+"|"+path]={{"value",value},{"options",options}};
 std::string name;meta.GetObjectName(&name);result["@object"]=name;return result;
}
int main(int argc,char**argv){
 try{if(argc!=3&&argc!=5)throw std::runtime_error("Usage: xmp-probe input output [crs-property value]");captraw::xmp::initialize();
 {if(std::filesystem::weakly_canonical(argv[1])==std::filesystem::weakly_canonical(argv[2]))throw std::runtime_error("Input must remain unchanged");if(std::filesystem::file_size(argv[1])>64*1024*1024)throw std::runtime_error("Input exceeds limit");std::ifstream in(argv[1],std::ios::binary);if(!in)throw std::runtime_error("Input missing");std::string bytes((std::istreambuf_iterator<char>(in)),{});if(bytes.size()>64*1024*1024)throw std::runtime_error("Input exceeds limit");auto meta=captraw::xmp::parse(bytes);const auto original=snapshot(meta);
 if(argc==5)meta.SetProperty(kXMP_NS_CameraRaw,argv[3],argv[4]);
 const auto expected=snapshot(meta);std::string serialized;meta.SerializeToBuffer(&serialized,kXMP_UseCompactFormat|kXMP_OmitPacketWrapper);auto restored=captraw::xmp::parse(serialized);if(snapshot(restored)!=expected)throw std::runtime_error("Roundtrip lost XMP nodes");
 std::ofstream out(argv[2],std::ios::binary);out<<serialized;if(!out)throw std::runtime_error("Output failed");std::string version,process;meta.GetProperty(kXMP_NS_CameraRaw,"Version",&version,nullptr);meta.GetProperty(kXMP_NS_CameraRaw,"ProcessVersion",&process,nullptr);
 Json report={{"nodes",expected.size()},{"roundtripEqual",true},{"inputBytes",bytes.size()},{"outputBytes",serialized.size()},{"version",version},{"processVersion",process}};report["nodesChanged"]=Json::diff(original,expected).size();std::cout<<report.dump()<<"\n";}
 SXMPMeta::Terminate();return 0;
 }catch(const XMP_Error&e){std::cerr<<e.GetErrMsg()<<"\n";return 2;}catch(const std::exception&e){std::cerr<<e.what()<<"\n";return 1;}
}
