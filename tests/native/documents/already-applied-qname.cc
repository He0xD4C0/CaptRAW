#include "../../../native/include/xmp-qnames.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
using Json=nlohmann::json;
int main(int argc,char **argv) {
    try {
        if(argc<4)throw std::runtime_error("mode output-directory inputs...");
        Exiv2::XmpParser::initialize();Json results=Json::array();Exiv2::XmpData cached;std::string cachedInput;
        const bool raw=std::string(argv[1])=="raw";
        const auto encode=[&](const Exiv2::XmpData &input,const std::string &source,const std::string &name){
            const auto normalized=std::filesystem::path(argv[2])/(name+".normalized.xmp");
            if(!raw){std::ofstream file(normalized);file<<captraw::xmp_metadata::namespacePacket(input.xmpPacket());}
            const auto data=raw?input:captraw::xmp_metadata::sourceXMP(input);
            if(!raw&&data.xmpPacket()!=input.xmpPacket())throw std::runtime_error("Authoritative source packet was modified");
            std::string packet;const auto code=Exiv2::XmpParser::encode(packet,data);
            const auto output=std::filesystem::path(argv[2])/name;
            if(!code){std::ofstream file(output);file<<packet;}
            Json keys=Json::array();for(const auto &datum:input)keys.push_back(datum.key());
            results.push_back({{"input",source},{"output",output.string()},{"normalized",normalized.string()},{"keys",keys},{"code",code}});
        };
        for(int i=3;i<argc;++i){
            Exiv2::XmpData data;
            if(std::string(argv[1])=="packet"){
                std::ifstream file(argv[i],std::ios::binary);std::string packet((std::istreambuf_iterator<char>(file)),{});data.setPacket(packet);
            }else{auto image=Exiv2::ImageFactory::open(argv[i]);image->readMetadata();data=image->xmpData();}
            // Cache the second input: its root prefix was inherited from the
            // first input and is absent from its own original XML packet.
            if(i==4){cached=data;cachedInput=argv[i];}
            encode(data,argv[i],std::to_string(i)+".xmp");
        }
        if(!raw&&!cachedInput.empty())encode(cached,cachedInput,"cached.xmp");
        std::cout<<results.dump()<<std::endl;Exiv2::XmpParser::terminate();return 0;
    }catch(const std::exception &error){std::cerr<<error.what()<<std::endl;return 1;}
}
