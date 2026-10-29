#include "source-frame.h"
#include "geometry-reference.h"
#include <algorithm>
#include <stdexcept>
#include <fstream>
#include <cstdint>

namespace art { namespace engine {
using Json=nlohmann::json;
Json checkedContentIdentity(const Json &id) {
    if(!id.is_object()||!id.at("size").is_number_integer()||id.at("size")<0||id.at("size")>9007199254740991ull||!id.at("sha256").is_string())
        throw std::runtime_error("Invalid geometry source identity");
    const auto hash=id.at("sha256").get<std::string>();
    if(hash.size()!=64||!std::all_of(hash.begin(),hash.end(),[](char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');}))
        throw std::runtime_error("Invalid geometry source hash");
    return {{"size",id.at("size")},{"sha256",hash}};
}
Json sourceContentIdentity(const std::string &path) {
    std::ifstream input(path.c_str(),std::ios::binary);
    if(!input)throw std::runtime_error("Cannot read geometry source identity");
    Glib::Checksum checksum(Glib::Checksum::CHECKSUM_SHA256);char buffer[65536];uint64_t size=0;
    while(input){input.read(buffer,sizeof(buffer));const auto n=input.gcount();size+=n;
        if(size>9007199254740991ull)throw std::runtime_error("Geometry source is too large");
        checksum.update(reinterpret_cast<const guchar *>(buffer),n);
    }
    if(input.bad())throw std::runtime_error("Cannot hash geometry source");
    return {{"size",size},{"sha256",std::string(checksum.get_string())}};
}
Json checkedSourceFrame(const Json &f) {
    if(!f.is_object()||f.at("version")!=1||!f.at("policy").is_string()||
       (f.at("policy")!="legacy"&&f.at("policy")!="active-area-v1"))
        throw std::runtime_error("Invalid source frame policy");
    const auto sensor=f.at("sensor").get<std::string>();
    if(f.contains("decoderModel")&&(f.at("decoderModel")!="sensor-crop-v1"||f.at("policy")!="active-area-v1"))
        throw std::runtime_error("Invalid source frame decoder model");
    if(sensor!="rendered"&&sensor!="bayer"&&sensor!="xtrans"&&sensor!="linear"&&sensor!="foveon")
        throw std::runtime_error("Invalid source frame sensor");
    for(const char *key:{"border","fullWidth","fullHeight","width","height","layoutWidth","layoutHeight"})
        if(!f.at(key).is_number_integer()||f.at(key)<(std::string(key)=="border"?0:1)||f.at(key)>65000)
            throw std::runtime_error("Invalid source frame dimensions");
    const int b=f.at("border"),w=f.at("fullWidth"),h=f.at("fullHeight");
    if(f.at("width")!=w-2*b||f.at("height")!=h-2*b||int64_t(w)*h>512000000)
        throw std::runtime_error("Inconsistent source frame dimensions");
    const auto &d=f.at("decoded");
    for(const char *key:{"left","top","width","height","rotation"})
        if(!d.at(key).is_number_integer()||d.at(key)<0||d.at(key)>65000)
            throw std::runtime_error("Invalid decoded source frame");
    if(d.at("width")==0||d.at("height")==0||d.at("rotation").get<int>()%90||d.at("rotation")>270)
        throw std::runtime_error("Invalid decoded source orientation");
    return f;
}
Json checkedRenderBinding(const Json &b) {
    if(!b.is_object()||b.at("version")!=1||!b.at("map").is_array()||b.at("map").size()!=4)
        throw std::runtime_error("Invalid geometry render binding");
    checkedContentIdentity(b.at("source"));checkedSourceFrame(b.at("frame"));
    if(b.at("frame").contains("renderBinding"))throw std::runtime_error("Nested geometry render binding");
    for(const auto &v:b.at("map"))if(!v.is_number()||!std::isfinite(v.get<double>()))throw std::runtime_error("Invalid geometry binding map");
    if(b.at("map").at(0)==0||b.at("map").at(1)==0)throw std::runtime_error("Singular geometry binding map");
    return b;
}
namespace {
using Affine=std::array<double,4>; // normalized X/Y scale, X/Y offset
const Affine identityAffine{{1,1,0,0}};
Json frameOnly(const procparams::ProcParams &p){
    auto f=checkedSourceFrame(Json::parse(p.commonTrans.captrawSourceFrame));f.erase("renderBinding");return f;
}
Affine compose(const Affine &a,const Affine &b){return {{a[0]*b[0],a[1]*b[1],a[0]*b[2]+a[2],a[1]*b[3]+a[3]}};}
Affine inverse(const Affine &a){return {{1/a[0],1/a[1],-a[2]/a[0],-a[3]/a[1]}};}
Coord2D sensorOrigin(const Json &f){
    const auto &d=f.at("decoded");const double x=d.at("left"),y=d.at("top"),w=d.at("width"),h=d.at("height");
    // File orientation rotates physical centers about the same sensor origin;
    // a common translation by sensor dimensions cancels between equal bytes.
    switch(d.at("rotation").get<int>()){
    case 90:return {-y-h,x};case 180:return {-x-w,-y-h};case 270:return {y,-x-w};default:return {x,y};
    }
}
Affine physicalToHolder(const Json &current,const Json &holder){
    if(current.at("decoded").at("rotation")!=holder.at("decoded").at("rotation"))
        throw std::runtime_error("Bound source file orientation changed");
    const auto p=sensorOrigin(current),q=sensorOrigin(holder);
    return {{current.at("fullWidth").get<double>()/holder.at("fullWidth").get<double>(),
             current.at("fullHeight").get<double>()/holder.at("fullHeight").get<double>(),
             (p.x-q.x)/holder.at("fullWidth").get<double>(),(p.y-q.y)/holder.at("fullHeight").get<double>()}};
}
Affine normalizedToReference(const procparams::ProcParams &current,const procparams::ProcParams &reference){
    const auto f=checkedSourceFrame(Json::parse(reference.commonTrans.captrawSourceFrame));
    if(!f.contains("renderBinding")){
        // The old shared-canvas branch retained inherited source reflections.
        // Capture its current rendering when binding an old, unknown author.
        if(current.commonTrans.captrawSourceFrame==reference.commonTrans.captrawSourceFrame){
            auto p=geometrySourceBasis(current),r=geometrySourceBasis(reference);
            if(current.coarse.rotate%180)std::swap(p.first,p.second);
            if(reference.coarse.rotate%180)std::swap(r.first,r.second);
            return {{p.first==r.first?1.:-1.,p.second==r.second?1.:-1.,p.first==r.first?0.:1.,p.second==r.second?0.:1.}};
        }
        return identityAffine;
    }
    const auto b=checkedRenderBinding(f.at("renderBinding"));Affine map;
    for(int i=0;i<4;++i)map[i]=b.at("map").at(i).get<double>();
    if(!current.commonTrans.captrawSourceIdentity.empty()&&
       checkedContentIdentity(Json::parse(current.commonTrans.captrawSourceIdentity))==checkedContentIdentity(b.at("source")))
        map=compose(map,physicalToHolder(frameOnly(current),b.at("frame")));
    return map;
}
}
bool hasRenderBinding(const procparams::ProcParams &p){
    return !p.commonTrans.captrawSourceFrame.empty()&&Json::parse(p.commonTrans.captrawSourceFrame).contains("renderBinding");
}
procparams::ProcParams bindGeometryReference(const procparams::ProcParams &reference,const procparams::ProcParams &holder){
    auto result=reference;
    if(holder.commonTrans.captrawSourceFrame.empty()||holder.commonTrans.captrawSourceIdentity.empty())return result;
    if(result.commonTrans.captrawSourceFrame.empty())result.commonTrans.captrawSourceFrame=holder.commonTrans.captrawSourceFrame;
    const auto map=normalizedToReference(holder,result);auto f=frameOnly(result);
    // Bind the current holder's rendering, never relabel an unknown author.
    // Flatten composition so A->B->B does not retain an unbounded frame chain.
    f["renderBinding"]={{"version",1},{"source",checkedContentIdentity(Json::parse(holder.commonTrans.captrawSourceIdentity))},
        {"frame",frameOnly(holder)},{"map",map}};
    checkedRenderBinding(f.at("renderBinding"));result.commonTrans.captrawSourceFrame=f.dump();return result;
}
bool activeSourceFrame(const procparams::ProcParams &p) {
    if(p.commonTrans.captrawSourceFrame.empty())return false;
    return checkedSourceFrame(Json::parse(p.commonTrans.captrawSourceFrame)).at("policy")=="active-area-v1";
}
bool sourceFrameDecode(const procparams::ProcParams &p) {
    if(p.commonTrans.captrawSourceFrame.empty())return false;
    return checkedSourceFrame(Json::parse(p.commonTrans.captrawSourceFrame)).value("decoderModel",std::string())=="sensor-crop-v1";
}
void attachSourceFrame(procparams::ProcParams &p,const Json &f) {
    if(f.contains("renderBinding"))throw std::runtime_error("A reference binding is not a processing frame");
    p.commonTrans.captrawSourceFrame=checkedSourceFrame(f).dump();
    p.commonTrans.captrawSourceFrameSaved=f.at("policy")=="active-area-v1";
    if(f.at("policy")=="active-area-v1"){
        p.raw.bayersensor.border=f.at("border");p.raw.xtranssensor.border=f.at("border");
    }
}
void applySourceFrame(ImageSource *source,const procparams::ProcParams &p) {
    if(p.commonTrans.captrawSourceFrameSaved){
        const auto frame=checkedSourceFrame(Json::parse(p.commonTrans.captrawSourceFrame));
        if(frame.contains("renderBinding"))throw std::runtime_error("A reference binding is not a processing frame");
        const auto decoded=source->getDecodedSourceFrame();
        const auto type=source->getSensorType();
        const char *sensor=!source->isRAW()?"rendered":type==ST_BAYER?"bayer":type==ST_FUJI_XTRANS?"xtrans":type==ST_FOVEON?"foveon":"linear";
        const auto &d=frame.at("decoded");
        if(sourceFrameDecode(p)!=decoded.sensorCrop)
            throw std::runtime_error("Processing source frame decoder does not match the decoded photo");
        if(frame.at("sensor")!=sensor||frame.at("fullWidth")!=decoded.fullWidth||frame.at("fullHeight")!=decoded.fullHeight||
           d.at("left")!=decoded.left||d.at("top")!=decoded.top||d.at("width")!=decoded.width||d.at("height")!=decoded.height||
           d.at("rotation")!=source->getRotateDegree())
            throw std::runtime_error("Processing source frame does not match the decoded photo");
        const int border=frame.at("border");
        if((!source->isRAW()&&border!=0)||
           (type==ST_BAYER&&p.raw.bayersensor.method==procparams::RAWParams::BayerSensor::Method::PIXELSHIFT&&border<2))
            throw std::runtime_error("Invalid processing source frame boundary");
        // Saved document geometry controls the actual processing boundary.
        // Do not let a contradictory raw Border bypass the checked frame.
        source->setBorder(border);return;
    }
    if(source->getSensorType()==ST_BAYER)
        source->setBorder(p.raw.bayersensor.method==procparams::RAWParams::BayerSensor::Method::PIXELSHIFT?
            std::max(p.raw.bayersensor.border,2):p.raw.bayersensor.border);
    else if(source->getSensorType()==ST_FUJI_XTRANS)source->setBorder(p.raw.xtranssensor.border);
    else if(source->isRAW()&&activeSourceFrame(p))
        source->setBorder(checkedSourceFrame(Json::parse(p.commonTrans.captrawSourceFrame)).at("border"));
}
Json sourceFrame(ImageSource *source,const procparams::ProcParams &p,bool active,int layoutWidth,int layoutHeight) {
    auto info=source->getDecodedSourceFrame();
    if(active){
        int border=info.border;
        // RCD finishes its own nine-pixel interpolation edge. PixelShift and
        // nonrectangular sensors keep ART's established processing boundary.
        if(info.rectangular&&((source->getSensorType()==ST_BAYER&&info.colors==3&&
            p.raw.bayersensor.method==procparams::RAWParams::BayerSensor::Method::RCD)||
            (info.sensorCrop&&source->getSensorType()==ST_FUJI_XTRANS&&
             p.raw.xtranssensor.method!=procparams::RAWParams::XTransSensor::Method::NONE)||
            source->getSensorType()==ST_NONE))border=0;
        source->setBorder(border);info=source->getDecodedSourceFrame();
    }
    const auto type=source->getSensorType();
    const char *sensor=!source->isRAW()?"rendered":type==ST_BAYER?"bayer":type==ST_FUJI_XTRANS?"xtrans":type==ST_FOVEON?"foveon":"linear";
    const int w=info.fullWidth-2*info.border,h=info.fullHeight-2*info.border;
    Json result={{"version",1},{"policy",active?"active-area-v1":"legacy"},{"sensor",sensor},
        {"border",info.border},{"fullWidth",info.fullWidth},{"fullHeight",info.fullHeight},
        {"width",w},{"height",h},{"layoutWidth",layoutWidth?layoutWidth:w},{"layoutHeight",layoutHeight?layoutHeight:h},
        {"decoded",{{"left",info.left},{"top",info.top},{"width",info.width},{"height",info.height},{"rotation",source->getRotateDegree()}}}};
    if(info.sensorCrop&&active)result["decoderModel"]="sensor-crop-v1";
    return checkedSourceFrame(result);
}
SourceFrameTransform::SourceFrameTransform(int width,int height,int referenceWidth,int referenceHeight,const procparams::ProcParams &p,const procparams::ProcParams &r)
    :w(width),h(height),rw(referenceWidth),rh(referenceHeight),rotation(p.coarse.rotate),referenceRotation(r.coarse.rotate),
     legacy(p.commonTrans.captrawSourceFrame.empty()||r.commonTrans.captrawSourceFrame.empty()||p.commonTrans.captrawSourceFrame==r.commonTrans.captrawSourceFrame) {
    const auto pb=geometrySourceBasis(p),rb=geometrySourceBasis(r);
    ph=pb.first;pv=pb.second;rhflip=rb.first;rvflip=rb.second;
    if(legacy)return;
    const auto a=checkedSourceFrame(Json::parse(p.commonTrans.captrawSourceFrame));
    const auto b=checkedSourceFrame(Json::parse(r.commonTrans.captrawSourceFrame));
    // GeometryMap retains the inherited anchor reflections. Remove them only
    // while crossing frames, then restore the reference's own source canvas.
    const int uw=p.coarse.rotate%180?h:w,uh=p.coarse.rotate%180?w:h;
    const int urw=r.coarse.rotate%180?rh:rw,urh=r.coarse.rotate%180?rw:rh;
    const double ab=a.at("border"),bb=b.at("border");
    Affine m=identityAffine;
    if(b.contains("renderBinding"))m=normalizedToReference(p,r);
    else if(a.contains("renderBinding"))m=inverse(normalizedToReference(r,p));
    sx=a.at("width").get<double>()/uw/a.at("fullWidth").get<double>()*m[0]*b.at("fullWidth").get<double>()*urw/b.at("width").get<double>();
    sy=a.at("height").get<double>()/uh/a.at("fullHeight").get<double>()*m[1]*b.at("fullHeight").get<double>()*urh/b.at("height").get<double>();
    ox=((ab/a.at("fullWidth").get<double>()*m[0]+m[2])*b.at("fullWidth").get<double>()-bb)*urw/b.at("width").get<double>()+.5*sx-.5;
    oy=((ab/a.at("fullHeight").get<double>()*m[1]+m[3])*b.at("fullHeight").get<double>()-bb)*urh/b.at("height").get<double>()+.5*sy-.5;
}
Coord2D SourceFrameTransform::map(Coord2D q) const {
    if(legacy)return maskSourceRotation(q,w,h,referenceRotation-rotation);
    q=geometrySourceFlip(q,w,h,ph,pv);q=maskSourceRotation(q,w,h,-rotation);
    q={q.x*sx+ox,q.y*sy+oy};
    q=maskSourceRotation(q,referenceRotation%180?rh:rw,referenceRotation%180?rw:rh,referenceRotation);
    return geometrySourceFlip(q,rw,rh,rhflip,rvflip);
}
Coord2D sourceFramePoint(Coord2D q,int w,int h,int rw,int rh,const procparams::ProcParams &p,const procparams::ProcParams &r) {
    return SourceFrameTransform(w,h,rw,rh,p,r).map(q);
}
}}
