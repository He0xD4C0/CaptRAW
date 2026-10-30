#include "segmentation.h"
#include <iostream>
#include <cstdio>
#include <unistd.h>
int main(int argc,char **argv){
    FILE *protocol=fdopen(dup(STDOUT_FILENO),"w");dup2(STDERR_FILENO,STDOUT_FILENO);
    const auto send=[&](const nlohmann::json &value){const auto line=value.dump();fprintf(protocol,"%s\n",line.c_str());fflush(protocol);};
    try{
        if(argc!=3)throw std::runtime_error("Usage: captraw-segment MODEL_DIRECTORY PRIVATE_CACHE_DIRECTORY");
        captraw::Segmentation worker(argv[1],argv[2],send);send({{"event","ready"},{"info",worker.info()}});
        std::string line;
        while(std::getline(std::cin,line)){
            int id=-1;try{
                if(line.size()>65536)throw std::runtime_error("Segmentation request exceeds 64 KB");
                const auto request=nlohmann::json::parse(line);id=request.at("id");const auto method=request.at("method").get<std::string>();
                nlohmann::json result;
                if(method=="predict")result=worker.predict(request.at("params"));
                else if(method=="parts")result=worker.parts(request.at("params"));
                else if(method=="semantic-masks")result=worker.semanticMasks(request.at("params"));
                else if(method=="sky")result=worker.sky(request.at("params"));
                else if(method=="info")result=worker.info();
                else if(method=="close"){worker.close();result=nlohmann::json::object();}
                else throw std::runtime_error("Unknown segmentation operation");
                send({{"id",id},{"result",result}});
            }catch(const std::exception &error){send({{"id",id},{"error",error.what()}});}
        }
    }catch(const std::exception &error){send({{"event","error"},{"message",error.what()}});fclose(protocol);return 1;}
    fclose(protocol);return 0;
}
