#include "enhanced-table.h"
#include "enhanced-profile.h"
#include <iostream>
#include <stdexcept>
int main(){
    using Json=nlohmann::json;
    std::string line;
    while(std::getline(std::cin,line)){
        try{
            const auto input=Json::parse(line);
            if(input.contains("profile")){
                const auto profile=captraw::enhanced::Profile::parse(input);
                auto result=profile.describe();result["pixels"]=Json::array();
                for(const auto &p:input.value("pixels",Json::array())){
                    captraw::enhanced::Pixel v{p[0].get<float>(),p[1].get<float>(),p[2].get<float>()};
                    const auto stage=input.value("stage","hsv");
                    v=stage=="rgb"?profile.applyRGB(v):stage=="curve"?profile.applyCurve(v):profile.applyHSV(v);
                    result["pixels"].push_back(v);
                }
                std::cout<<Json{{"result",result}}.dump()<<'\n';continue;
            }
            const auto table=captraw::enhanced::Table::decode(input.at("encoded").get<std::string>());
            Json output=table.describe(),pixels=Json::array();
            for(const auto &value:input.value("pixels",Json::array())){
                if(!value.is_array()||value.size()!=3)throw std::runtime_error("Invalid probe pixel");
                const captraw::enhanced::Pixel p{value[0].get<float>(),value[1].get<float>(),value[2].get<float>()};
                const float amount=input.value("amount",1.f);
                pixels.push_back(table.type==0?table.applyHSV(p,amount):table.applyRGB(p,input.contains("tableAmount")?table.rgbAmount(input.at("tableAmount").get<float>(),amount):amount));
            }
            output["pixels"]=pixels;
            if(input.contains("sampleIndices")){output["values"]=Json::array();for(const auto &index:input["sampleIndices"])output["values"].push_back(table.samples.at(index.get<size_t>()));}
            std::cout<<Json{{"result",output}}.dump()<<'\n';
        }catch(const std::exception &error){std::cout<<Json{{"error",error.what()}}.dump()<<'\n';}
    }
}
