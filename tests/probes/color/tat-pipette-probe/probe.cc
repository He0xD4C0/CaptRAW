#include "core.h"
#include "recipe.h"
#include "geometry-map.h"
#include "source-frame.h"
#include "engine/dcrop.h"
#include "engine/imagesource.h"
#include "engine/refreshmap.h"
#include "gui/edit.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <stdexcept>

namespace ae=art::engine;
namespace ag=art::gui;
namespace au=art::utils;
namespace pp=ae::procparams;
using Json=nlohmann::json;
static void require(bool ok,const std::string &why){if(!ok)throw std::runtime_error(why);}

struct Preview final:ae::PreviewImageListener {
    std::mutex mutex;std::condition_variable condition;bool ready=false;
    void setImage(ae::IImage8 *,double,const pp::CropParams &) override {}
    void delImage(ae::IImage8 *image) override {delete image;}
    void imageReady(const pp::CropParams &) override {
        std::lock_guard<std::mutex> lock(mutex);ready=true;condition.notify_all();
    }
    void wait(ae::StagedImageProcessor *p,int flags,const pp::ProcParams *params=nullptr){
        {std::lock_guard<std::mutex> lock(mutex);ready=false;}
        if(params){*p->beginUpdateParams()=*params;p->endUpdateParams(flags);}
        else p->startProcessing(flags);
        std::unique_lock<std::mutex> lock(mutex);
        const bool done=condition.wait_for(lock,std::chrono::seconds(90),[&]{return ready;});
        lock.unlock();p->stopProcessing();require(done,"Pipette preview timed out");
    }
};
struct Provider final:ag::EditDataProvider {
    int width=0,height=0;
    void getImageSize(int &w,int &h) override {w=width;h=height;}
};
struct Subscription {
    Provider provider;ag::EditSubscriber subscriber{au::ET_PIPETTE};
    Subscription(au::EditUniqueID id,au::BufferType type){
        subscriber.setEditID(id,type);subscriber.setEditProvider(&provider);subscriber.subscribe();
    }
    ~Subscription(){subscriber.unsubscribe();subscriber.setEditProvider(nullptr);}
};
struct ImageOwner {ae::InitialImage *p;~ImageOwner(){if(p)p->decreaseRef();}};
struct ProcessorOwner {
    ae::StagedImageProcessor *p;
    ~ProcessorOwner(){if(p){p->stopProcessing();ae::StagedImageProcessor::destroy(p);}}
};
struct Target {const char *name;au::EditUniqueID id;au::BufferType type;};
static const Target targets[]={
    {"tone",au::EUID_ToneCurve1,au::BT_IMAGEFLOAT},
    {"red",au::EUID_RGB_R,au::BT_SINGLEPLANE_FLOAT},
    {"green",au::EUID_RGB_G,au::BT_SINGLEPLANE_FLOAT},
    {"blue",au::EUID_RGB_B,au::BT_SINGLEPLANE_FLOAT},
    {"hsl",au::EUID_HSL_H,au::BT_SINGLEPLANE_FLOAT}
};

// sampleX/Y are full transformed canvas pixel centers, not source coordinates.
// ART buffers include the crop's processing border; never assume that is 32.
static Json sample(ae::Crop &crop,const Target &target,int x,int y,int ox,int oy,int size){
    require(crop.isReady()&&crop.bufferCreated(),"Native pipette buffer was not filled");
    const int bx=(x-ox)/crop.get_skip()+crop.getLeftBorder();
    const int by=(y-oy)/crop.get_skip()+crop.getUpperBorder();
    auto *rgb=crop.getImgFloatBuffer();auto *plane=crop.getSinglePlaneBuffer();
    const int w=target.type==au::BT_IMAGEFLOAT?rgb->getWidth():plane->getWidth();
    const int h=target.type==au::BT_IMAGEFLOAT?rgb->getHeight():plane->getHeight();
    const int left=std::max(0,bx-size/2),top=std::max(0,by-size/2);
    const int right=std::min(w,bx-size/2+size),bottom=std::min(h,by-size/2+size);
    require(left<right&&top<bottom,"Empty pipette footprint");
    Json pixels=Json::array();std::array<double,3> sums{};double cosine=0,sine=0;
    for(int iy=top;iy<bottom;++iy)for(int ix=left;ix<right;++ix){
        std::array<float,3> v{};
        if(target.type==au::BT_IMAGEFLOAT)v={rgb->r(iy,ix),rgb->g(iy,ix),rgb->b(iy,ix)};
        else v[0]=plane->v(iy,ix);
        for(int c=0;c<(target.type==au::BT_IMAGEFLOAT?3:1);++c){
            require(std::isfinite(v[c])&&v[c]>=0&&v[c]<=1,"Invalid native pipette value");sums[c]+=v[c];
        }
        if(std::string(target.name)=="hsl"){
            pixels.push_back({{"buffer",{ix,iy}},{"hue",v[0]}});
            cosine+=std::cos(v[0]*2*3.141592653589793);sine+=std::sin(v[0]*2*3.141592653589793);
        }
    }
    const int count=(right-left)*(bottom-top);
    Json row={{"display",{x,y}},{"buffer",{bx,by}},{"bufferSize",{w,h}},
        {"border",{crop.getLeftBorder(),crop.getUpperBorder()}},{"pixels",count},{"skip",crop.get_skip()}};
    if(std::string(target.name)=="hsl"){
        double angle=std::atan2(sine,cosine)/(2*3.141592653589793);if(angle<0)angle+=1;
        row["hues"]=pixels;row["circularMeanDiagnostic"]=angle;
        row["resultantLength"]=std::hypot(cosine,sine)/count;
        row["scope"]="Per-pixel ART YUV hue; no saturation confidence or Adobe band weights asserted";
    }else{
        float native[3];crop.getPipetteData(native,bx,by,size);Json values=Json::array();
        for(int c=0;c<(target.type==au::BT_IMAGEFLOAT?3:1);++c){
            const double mean=sums[c]/count;
            require(std::abs(native[c]-mean)<2e-6,"Pipette API differs from independent buffer mean");values.push_back(mean);
        }
        row["values"]=values;
    }
    return row;
}

static Json run(captraw::Engine &bootstrap,const Json &job){
    const std::string path=job.at("path");
    auto opened=bootstrap.call("open",{{"path",path},{"sessionId","pipette-probe"},
        {"sourceFramePolicy","active-area-v1"},{"whiteBalanceDefaults","current"}});
    pp::ProcParams params;params.setDefaults();captraw::loadProfile(params,opened.at("artProfile"));
    auto adjustments=opened.at("adjustments");
    for(auto it=job.at("adjustments").begin();it!=job.at("adjustments").end();++it)adjustments[it.key()]=it.value();
    captraw::applyAdjustments(params,adjustments,opened.at("width"),opened.at("height"));
    bootstrap.call("close",{});
    int error=0;
    ImageOwner image{ae::InitialImage::load(path,job.value("raw",false),&error,nullptr,ae::sourceFrameDecode(params))};
    require(image.p,"Cannot decode probe source: "+std::to_string(error));
    ae::applySourceFrame(image.p->getImageSource(),params);
    const int rawRotation=image.p->getImageSource()->getRotateDegree();
    Json rows=Json::array();
    for(const auto &target:targets){
        if(job.contains("targets")&&std::find(job["targets"].begin(),job["targets"].end(),target.name)==job["targets"].end())continue;
        Preview preview;Subscription subscription(target.id,target.type);
        image.p->increaseRef();ProcessorOwner processor{ae::StagedImageProcessor::create(image.p)};
        processor.p->setPreviewImageListener(&preview);processor.p->setPreviewScale(4);
        processor.p->setMonitorProfile("RTv4_sRGB",ae::RI_RELATIVE);
        std::unique_ptr<ae::DetailedCrop> full(processor.p->createCrop(&subscription.provider,true));
        // Register a skip=1 crop before the high-quality preview handshake.
        full->setWindow(0,0,opened.at("width"),opened.at("height"),1);
        preview.wait(processor.p,ae::FIRST,&params);
        if(!processor.p->getHighQualComputed()){
            preview.wait(processor.p,ae::M_HIGHQUAL);processor.p->setHighQualComputed();
        }
        const int w=processor.p->getFullWidth(),h=processor.p->getFullHeight();
        subscription.provider.width=w;subscription.provider.height=h;
        full->setWindow(0,0,w,h,1);full->fullUpdate();
        auto *buffer=dynamic_cast<ae::Crop *>(full.get());require(buffer,"DetailedCrop is not ART Crop");
        ae::GeometryMap map(params,w,h,image.p->getMetaData(),rawRotation);
        for(const auto &point:job.at("points")){
            double sx=point.at("source").at(0),sy=point.at("source").at(1),saved=sx;
            switch(params.coarse.rotate){case 90:sx=1-sy;sy=saved;break;case 180:sx=1-sx;sy=1-sy;break;case 270:sx=sy;sy=1-saved;break;}
            const ae::Coord2D source(sx*(w-1),sy*(h-1));
            ae::Coord2D display;require(map.toDisplay(source,display),"Source anchor cannot map to display");
            const auto inverse=map.toSource(display);
            const double errorPixels=std::hypot(inverse.x-source.x,inverse.y-source.y);
            require(errorPixels<.05,"Geometry round trip exceeds .05 pixels");
            const int x=std::lround(display.x),y=std::lround(display.y),size=job.value("sampleSize",8);
            require(x>=size&&y>=size&&x<w-size&&y<h-size,"Anchor lies outside valid display footprint");
            Json row={{"id",point.at("id")},{"target",target.name},{"fullSize",{w,h}},
                {"source",{source.x,source.y}},{"mappedDisplay",{display.x,display.y}},{"roundTripErrorPixels",errorPixels},
                {"full",sample(*buffer,target,x,y,0,0,size)}};
            if(std::string(target.name)!="hsl"){
                const int ox=std::max(0,x-48),oy=std::max(0,y-40),rw=std::min(96,w-ox),rh=std::min(80,h-oy);
                std::unique_ptr<ae::DetailedCrop> detail(processor.p->createCrop(&subscription.provider,true));
                detail->setWindow(ox,oy,rw,rh,1);detail->fullUpdate();
                auto *roi=dynamic_cast<ae::Crop *>(detail.get());require(roi,"ROI is not ART Crop");
                row["roi"]=sample(*roi,target,x,y,ox,oy,size);
                double delta=0;for(size_t c=0;c<row["full"]["values"].size();++c)
                    delta=std::max(delta,std::abs(row["full"]["values"][c].get<double>()-row["roi"]["values"][c].get<double>()));
                row["fullRoiMaxDifference"]=delta;
                require(delta<1e-5,"Full/ROI pipette disagreement: "+std::to_string(delta));
                if(target.type==au::BT_IMAGEFLOAT&&point.contains("acrInput")){
                    double mean=0;for(const auto &v:row["full"]["values"])mean+=v.get<double>()/3.;
                    row["acrComparison"]={{"input",point["acrInput"]},{"displayRGB",point.value("acrDisplayRGB",Json())},
                        {"nativeMean255",mean*255},{"residual",mean*255-point["acrInput"].get<double>()},
                        {"scope","Midgray patch comparison only; exact ACR click coordinate not recorded"}};
                }
            }
            rows.push_back(row);
        }
        processor.p->stopProcessing();
    }
    return {{"id",job.at("id")},{"path",path},{"adjustments",job.at("adjustments")},{"rows",rows}};
}

int main(int argc,char **argv){
    try{
        require(argc==4,"Usage: probe resources private-cache requests.json");
        std::ifstream input(argv[3]);Json requests;input>>requests;Json rows=Json::array();
        captraw::Engine bootstrap(argv[1],argv[2],[](const Json &){});
        for(const auto &job:requests)rows.push_back(run(bootstrap,job));
        std::cout<<Json{{"scope","Actual headless ART EditDataProvider/pipette; no GTK window, no replacement kernel"},
            {"acrscope","166 comparison is reported, not fitted or asserted equal"},{"rows",rows}}.dump()<<'\n';
    }catch(const std::exception &error){std::cerr<<error.what()<<'\n';return 1;}
}
