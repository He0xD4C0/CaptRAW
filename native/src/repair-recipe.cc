#include "repair-recipe.h"
#include <cmath>
#include <stdexcept>
namespace captraw {
void applyRepairs(art::engine::procparams::ProcParams &p,const Json &spots,int width,int height,int rotation){
    namespace pp=art::engine::procparams;
    if(!spots.is_array()||spots.size()>10000)throw std::runtime_error("Invalid repair list");
    const auto value=[](const Json &j,const char *key,double fallback,double low,double high){
        const double v=j.value(key,fallback);
        if(!std::isfinite(v)||v<low||v>high)throw std::runtime_error(std::string("Invalid repair ")+key);
        return v;
    };
    const auto position=[&](const Json &v){
        double x=value(v,"x",0,0,1),y=value(v,"y",0,0,1),u=x;
        switch(rotation){case 90:x=1-y;y=u;break;case 180:x=1-x;y=1-y;break;case 270:x=y;y=1-u;break;}
        return std::pair<double,double>{x*(width-1),y*(height-1)};
    };
    p.spot.entries.clear();p.spot.enabled=false;
    for(const auto &s:spots){
        pp::SpotEntry entry;
        const auto source=position(s.at("source")),target=position(s.at("target"));
        entry.sourcePos.set(std::lround(source.first),std::lround(source.second));
        entry.targetPos.set(std::lround(target.first),std::lround(target.second));
        entry.radius=int(value(s,"radius",40,pp::SpotParams::minRadius,pp::SpotParams::maxRadius));
        entry.feather=value(s,"feather",50,0,100)/100.;entry.opacity=value(s,"opacity",100,0,100)/100.;
        const auto method=s.at("method").get<std::string>();
        if(method!="clone"&&method!="heal")throw std::runtime_error("Invalid repair method");
        entry.detail=method=="heal"?2+int(value(s,"detail",0,0,3)):(s.value("retainTexture",false)?1:0);
        if(s.contains("sourceMode")&&s.at("sourceMode")!="auto"&&s.at("sourceMode")!="manual")throw std::runtime_error("Invalid repair source mode");
        if(s.contains("path")){
            const auto &path=s.at("path");
            if(!path.is_array()||path.size()<2||path.size()>32768)throw std::runtime_error("Invalid repair path");
            if(path.front().at("x")!=s.at("target").at("x")||path.front().at("y")!=s.at("target").at("y"))throw std::runtime_error("Repair path must start at target");
            if(method=="clone"&&s.value("retainTexture",false))throw std::runtime_error("Continuous clone does not support retained target detail");
            for(const auto &point:path){
                if(!point.at("x").is_number()||!point.at("y").is_number())throw std::runtime_error("Invalid repair path coordinate");
                const auto q=position(point);entry.repairPath.push_back(q.first);entry.repairPath.push_back(q.second);
                const double sx=q.first+source.first-target.first,sy=q.second+source.second-target.second;
                if(sx<-.000001||sx>width-1+.000001||sy<-.000001||sy>height-1+.000001)throw std::runtime_error("Repair source path extends outside image");
            }
        }
        if(s.at("enabled").get<bool>()){p.spot.entries.push_back(entry);p.spot.enabled=true;}
    }
}
}
