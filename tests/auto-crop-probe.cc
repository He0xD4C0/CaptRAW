#include "core.h"
#include "geometry-map.h"
#include "engine/improcfun.h"
#include "engine/imagefloat.h"
#include "engine/imagesource.h"
#include "engine/refreshmap.h"
#include "engine/rtengine.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <stdexcept>

namespace ae=art::engine;
namespace pp=ae::procparams;
using Json=nlohmann::json;

struct Preview:ae::PreviewImageListener {
    std::mutex mutex;
    std::condition_variable condition;
    bool ready=false;
    void setImage(ae::IImage8 *,double,const pp::CropParams &)override {}
    void delImage(ae::IImage8 *image)override {delete image;}
    void imageReady(const pp::CropParams &)override {
        std::lock_guard<std::mutex> lock(mutex);ready=true;condition.notify_all();
    }
    void update(ae::StagedImageProcessor *processor,const pp::ProcParams &params) {
        {std::lock_guard<std::mutex> lock(mutex);ready=false;}
        *processor->beginUpdateParams()=params;
        processor->endUpdateParams(ae::FIRST);
        std::unique_lock<std::mutex> lock(mutex);
        if(!condition.wait_for(lock,std::chrono::seconds(30),[&]{return ready;}))
            throw std::runtime_error("Auto-crop probe preview timed out");
        lock.unlock();processor->stopProcessing();
    }
};

int main(int argc,char **argv) {
    try {
        if(argc!=4)throw std::runtime_error("Usage: auto-crop-probe resources cache PNG-with-lens-metadata");
        captraw::Engine runtime(argv[1],argv[2],[](const Json &){});
        int error=0;auto *image=ae::InitialImage::load(argv[3],false,&error,nullptr);
        if(!image)throw std::runtime_error("Cannot load crop fixture");
        struct ImageOwner {ae::InitialImage *p;~ImageOwner(){p->decreaseRef();}} owner{image};
        const auto *metadata=image->getMetaData();const int rawRotation=image->getImageSource()->getRotateDegree();
        Preview listener;image->increaseRef();auto *processor=ae::StagedImageProcessor::create(image);
        struct ProcessorOwner {ae::StagedImageProcessor *p;~ProcessorOwner(){p->stopProcessing();ae::StagedImageProcessor::destroy(p);}} processorOwner{processor};
        processor->setPreviewImageListener(&listener);processor->setPreviewScale(2);
        Json rows=Json::array();int unsafe=0,needlessCrop=0;
        for(int rotation:{0,90})for(bool fill:{false,true})for(bool optics:{false,true})for(bool perspective:{false,true})for(double angle:{0.,17.}) {
            pp::ProcParams params;params.coarse.rotate=rotation;params.commonTrans.autofill=fill;
            params.rotate.enabled=angle!=0;params.rotate.degree=angle;
            params.perspective.enabled=perspective;params.perspective.horizontal=25;
            params.perspective.vertical=-15;params.perspective.angle=2;params.perspective.shear=3;
            params.perspective.flength=10;params.perspective.cropfactor=1.5;
            if(optics){params.lensProf.lcMode=pp::LensProfParams::LcMode::LENSFUNAUTOMATCH;params.lensProf.useDist=true;params.lensProf.useCA=true;params.lensProf.useVign=false;}
            listener.update(processor,params);
            const int width=processor->getFullWidth(),height=processor->getFullHeight();
            if(width<2||height<2)throw std::runtime_error("Processor dimensions unavailable");
            ae::ImProcFunctions functions(&params,false);functions.setScale(1);
            const auto lens=functions.getLensCorrection(width,height,metadata,rawRotation);
            if(optics&&(!lens||!lens->isCACorrectionAvailable()))
                throw std::runtime_error("Fixture must resolve real Lensfun distortion and CA");
            if(optics){double x=10,y=10;lens->correctDistortion(x,y,0,0,1);if(std::hypot(x-10,y-10)<.001)throw std::runtime_error("Fixture distortion must move actual coordinates");}
            ae::Imagefloat input(width,height),output(width,height);
            for(int y=0;y<height;++y)for(int x=0;x<width;++x)input.r(y,x)=input.g(y,x)=input.b(y,x)=10000.f;
            if(functions.needsTransform())functions.transform(&input,&output,0,0,0,0,width,height,width,height,metadata,rawRotation,true);
            else input.copyTo(&output);
            const auto empty=[&](int x,int y){return std::min({output.r(y,x),output.g(y,x),output.b(y,x)})<5000.f;};
            int fullEmpty=0;for(int y=0;y<height;++y)for(int x=0;x<width;++x)fullEmpty+=empty(x,y);
            ae::GeometryMap map(params,width,height,metadata,rawRotation);
            for(double ratio:{0.,1.,double(width)/height}) {
                int x,y,w,h;processor->getAutoCrop(ratio,x,y,w,h);
                const bool bounded=x>=0&&y>=0&&w>0&&h>0&&x+w<=width&&y+h<=height;
                int croppedEmpty=0,mappedOutside=0;
                if(bounded)for(int j=y;j<y+h;++j)for(int i=x;i<x+w;++i){
                    croppedEmpty+=empty(i,j);
                    if(i==x||j==y||i==x+w-1||j==y+h-1)for(int channel=0;channel<3;++channel){
                        const auto q=map.toSource({double(i),double(j)},channel);
                        mappedOutside+=!std::isfinite(q.x)||!std::isfinite(q.y)||q.x<0||q.y<0||q.x>width-1||q.y>height-1;
                    }
                }
                const bool safe=bounded&&croppedEmpty==0;
                unsafe+=!safe;
                const bool unnecessary=fullEmpty==0&&ratio==0&&w*h<width*height*.99;needlessCrop+=unnecessary;
                rows.push_back({{"rotation",rotation},{"autofill",fill},{"optics",optics},{"perspective",perspective},{"angle",angle},{"ratio",ratio},
                    {"width",width},{"height",height},{"crop",{{"x",x},{"y",y},{"width",w},{"height",h}}},{"bounded",bounded},
                    {"fullEmptyPixels",fullEmpty},{"croppedEmptyPixels",croppedEmpty},{"outsideBoundaryChannelSamples",mappedOutside},
                    {"safe",safe},{"unnecessaryCrop",unnecessary}});
            }
        }
        // This is a characterization report, not an assertion of feature parity.
        std::cout<<Json{{"rows",rows},{"unsafeCandidates",unsafe},{"unnecessaryCandidates",needlessCrop},{"allCandidatesSafe",unsafe==0}}.dump(2)<<'\n';
    }catch(const std::exception &e){std::cerr<<e.what()<<'\n';return 1;}
}
