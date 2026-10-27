#include "core.h"
#include <iostream>
#include <cstdio>
#include <mutex>
#include <unistd.h>
int main(int argc,char **argv){
    // Keep a dedicated protocol descriptor; upstream diagnostics may use stdout.
    FILE *protocol=fdopen(dup(STDOUT_FILENO),"w");dup2(STDERR_FILENO,STDOUT_FILENO);
    std::mutex output;
    auto send=[&](const captraw::Json &j){std::lock_guard<std::mutex> lock(output);const auto s=j.dump();fprintf(protocol,"%s\n",s.c_str());fflush(protocol);};
    try {
        if(argc!=3)throw std::runtime_error("Usage: captraw-engine RESOURCE_DIRECTORY CACHE_DIRECTORY");
        captraw::Engine engine(argv[1],argv[2],send);send({{"event","ready"},{"engineVersion","CaptRAW-20_ART-1.26.10_LibRaw-3b20539"}});
        std::string line;
        while(std::getline(std::cin,line)){
            captraw::Json request;int id=-1;
            try{request=captraw::Json::parse(line);id=request.at("id");auto result=engine.call(request.at("method"),request.value("params",captraw::Json::object()));send({{"id",id},{"result",result}});}
            catch(const std::exception &e){send({{"id",id},{"error",e.what()}});}
        }
    }catch(const std::exception &e){send({{"event","error"},{"message",e.what()}});return 1;}
    fclose(protocol);return 0;
}
