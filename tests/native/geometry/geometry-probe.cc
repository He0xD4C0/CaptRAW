#include "core.h"
#include "geometry-map.h"
#include "geometry-field.h"
#include "engine/improcfun.h"
#include "engine/imagefloat.h"
#include "engine/imagesource.h"
#include "engine/rtengine.h"
#include <algorithm>
#include <cmath>
#include <chrono>
#include <random>
#include <iostream>
#include <stdexcept>

namespace ae=art::engine;
namespace pp=ae::procparams;
using Json=nlohmann::json;
static void require(bool condition,const std::string &message) {
    if(!condition)throw std::runtime_error(message);
}
static Json fields(const ae::FramesMetaData *metadata,int rawRotation) {
    Json rows=Json::array();std::mt19937 random(4317);
    for(int large:{0,1})for(int optics:{0,1,2})for(double angle:{-31.,23.}) {
        const int width=large?8256:641,height=large?5504:427;
        pp::ProcParams current,reference;current.rotate.enabled=true;current.rotate.degree=angle;
        current.commonTrans.autofill=true;
        if(optics){current.lensProf.lcMode=pp::LensProfParams::LcMode::LENSFUNAUTOMATCH;current.lensProf.useDist=true;current.lensProf.useCA=true;current.lensProf.useVign=false;}
        if(optics==2){current.perspective.enabled=true;current.perspective.horizontal=18;current.perspective.vertical=-12;current.perspective.angle=2;}
        reference=current;reference.rotate.degree=0;
        ae::GeometryMap from(current,width,height,metadata,rawRotation),to(reference,width,height,metadata,rawRotation);
        const auto started=std::chrono::steady_clock::now();
        ae::GeometryField field(from,to,width,height);
        const double buildMs=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-started).count();
        double maximumError=0;int successful=0,failed=0;
        for(int i=0;i<3000;++i){
            ae::Coord2D q(double(random()%1000000)/999999*(width-1),double(random()%1000000)/999999*(height-1)),actual,expected;
            const bool valid=to.toDisplay(from.toSource(q),expected),mapped=field.map(q,actual);
            require(valid==mapped,"Field must preserve failed inverse results");
            if(!valid){++failed;continue;}
            maximumError=std::max(maximumError,std::hypot(actual.x-expected.x,actual.y-expected.y));++successful;
        }
        require(successful>2800,"Too many failed ordinary mask coordinates");
        require(maximumError<.05,"Geometry field exceeds .05 pixels: "+std::to_string(maximumError));
        ae::array2D<float> source(width,height),output(width,height);
        for(int y=0;y<height;++y)for(int x=0;x<width;++x){
            const double dx=(x-width*.4)/(width*.08),dy=(y-height*.45)/(height*.1);
            source[y][x]=std::exp(-(dx*dx+dy*dy)/2);
        }
        const auto warpStart=std::chrono::steady_clock::now();
        field.warp(source,{0,0},output,{0,0},true);
        const double warpMs=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-warpStart).count();
        const int ox=width/3,oy=height/3,rw=157,rh=103;
        ae::array2D<float> region(rw,rh);field.warp(source,{0,0},region,{double(ox),double(oy)},false);
        for(int y=0;y<rh;++y)for(int x=0;x<rw;++x)
            require(region[y][x]==output[y+oy][x+ox],"Crop and parallel warp must equal the full mask");
        // Compare a smooth reference mask to its analytical value at exact
        // inverse coordinates, independently of the field interpolation.
        double maskError=0;
        for(int i=0;i<500;++i){
            const int x=random()%width,y=random()%height;ae::Coord2D q;
            if(!to.toDisplay(from.toSource({double(x),double(y)}),q))continue;
            const double dx=(q.x-width*.4)/(width*.08),dy=(q.y-height*.45)/(height*.1);
            const double expected=q.x<-.5||q.y<-.5||q.x>=width-.5||q.y>=height-.5?0:std::exp(-(dx*dx+dy*dy)/2);
            maskError=std::max(maskError,std::abs(output[y][x]-expected));
        }
        require(maskError<.0003,"Scalar mask disagrees with analytical transported coverage");
        rows.push_back({{"width",width},{"height",height},{"angle",angle},{"optics",optics},{"nodes",field.nodeCount()},
            {"exactCells",field.exactCellCount()},{"coordinateErrorPixels",maximumError},{"maskError",maskError},
            {"mappedSamples",successful},{"failedSamples",failed},{"buildMs",buildMs},{"warpMs",warpMs},{"cropAndThreadingExact",true}});
    }
    pp::ProcParams p;ae::GeometryMap map(p,97,53,metadata,rawRotation);
    ae::GeometryField identity(map,map,97,53);ae::array2D<float> signedMask(97,53),copy(97,53);
    for(int y=0;y<53;++y)for(int x=0;x<97;++x)signedMask[y][x]=float((x+y)%11-5)/5;
    identity.warp(signedMask,{0,0},copy,{0,0},true);
    for(int y=0;y<53;++y)for(int x=0;x<97;++x)require(signedMask[y][x]==copy[y][x],"Identity must preserve signed brush coverage exactly");
    ae::array2D<float> outside(3,3);identity.warp(signedMask,{0,0},outside,{-3,-3},false);
    for(int y=0;y<3;++y)for(int x=0;x<3;++x)require(outside[y][x]==0,"Outside reference canvas must have zero coverage");
    return rows;
}
int main(int argc,char **argv) {
    try {
        require(argc==4,"Usage: geometry-probe resources cache sample");
        captraw::Engine runtime(argv[1],argv[2],[](const Json &){});
        int error=0;
        auto *image=ae::InitialImage::load(argv[3],false,&error,nullptr);
        require(image!=nullptr,"Cannot load geometry metadata sample");
        struct ImageOwner {ae::InitialImage *image;~ImageOwner(){image->decreaseRef();}} owner{image};
        auto *metadata=image->getMetaData();
        const int rawRotation=image->getImageSource()->getRotateDegree();
        Json rows=Json::array();
        double maximumPixelError=0,maximumRoundTrip=0;
        for(int previewScale:{1,4})for(int rotation:{0,90})for(bool fill:{false,true})for(double angle:{-45.,-17.,0.,13.,45.})for(int optics=0;optics<4;++optics) {
            const int width=rotation==0?641:427,height=rotation==0?427:641;
            const int fullWidth=width*previewScale+(previewScale>1?3:0),fullHeight=height*previewScale+(previewScale>1?1:0);
            pp::ProcParams params;
            params.coarse.rotate=rotation;
            params.rotate.enabled=true;params.rotate.degree=angle;params.commonTrans.autofill=fill;
            // Retained disabled coefficients must not leak into coordinate maps.
            params.cacorrection.red=.012;params.cacorrection.blue=-.009;
            if(optics>0){params.lensProf.lcMode=pp::LensProfParams::LcMode::LENSFUNAUTOMATCH;params.lensProf.useDist=true;params.lensProf.useCA=optics>1;params.lensProf.useVign=false;}
            if(optics==3){params.distortion.enabled=true;params.distortion.amount=.12;params.cacorrection.enabled=true;params.perspective.enabled=true;params.perspective.horizontal=18;params.perspective.vertical=-12;params.perspective.angle=2;params.perspective.shear=3;}
            ae::ImProcFunctions processor(&params,false);processor.setScale(1);
            const auto lens=processor.getLensCorrection(width,height,metadata,rawRotation);
            if(optics>0)require(lens!=nullptr,"Lensfun metadata must resolve to a real profile");
            if(optics>1)require(lens->isCACorrectionAvailable(),"Lensfun fixture must have real CA correction");
            ae::GeometryMap map(params,width,height,metadata,rawRotation,fullWidth,fullHeight);
            double pixelError=0,roundTrip=0;int samples=0;
            for(int axis=0;axis<2;++axis) {
                ae::Imagefloat input(width,height),output(width,height);
                for(int y=0;y<height;++y)for(int x=0;x<width;++x) {
                    const float value=6000.f+30000.f*(axis==0?double(x)/(width-1):double(y)/(height-1));
                    input.r(y,x)=input.g(y,x)=input.b(y,x)=value;
                }
                if(processor.needsTransform())processor.transform(&input,&output,0,0,0,0,width,height,fullWidth,fullHeight,metadata,rawRotation,true);
                else input.copyTo(&output);
                for(int y=height/6;y<height*5/6;y+=height/8)for(int x=width/6;x<width*5/6;x+=width/8)for(int channel=0;channel<3;++channel) {
                    const ae::Coord2D display(x,y),source=map.toSource(display,channel);
                    if(source.x<8||source.y<8||source.x>width-9||source.y>height-9)continue;
                    const float rendered=channel==0?output.r(y,x):channel==1?output.g(y,x):output.b(y,x);
                    const double measured=(rendered-6000.)/30000.*(axis==0?width-1:height-1);
                    const double expected=axis==0?source.x:source.y;
                    pixelError=std::max(pixelError,std::abs(measured-expected));
                    ae::Coord2D inverse;
                    require(map.toDisplay(source,inverse,channel),"Geometry inverse did not converge");
                    roundTrip=std::max(roundTrip,std::hypot(inverse.x-x,inverse.y-y));
                    ++samples;
                }
            }
            const Json row={{"previewScale",previewScale},{"rotation",rotation},{"angle",angle},{"autofill",fill},{"optics",optics},{"samples",samples},{"renderedCoordinateErrorPixels",pixelError},{"roundTripErrorPixels",roundTrip}};
            require(samples>50,"Insufficient interior test pixels: "+row.dump());
            require(pixelError<.6,"Coordinate map disagrees with ART float rendering: "+row.dump());
            require(roundTrip<.01,"Coordinate inverse disagrees with forward map: "+row.dump());
            rows.push_back(row);maximumPixelError=std::max(maximumPixelError,pixelError);maximumRoundTrip=std::max(maximumRoundTrip,roundTrip);
        }
        pp::ProcParams params;params.rotate.enabled=true;params.rotate.degree=37;params.commonTrans.autofill=false;
        ae::GeometryMap unfilled(params,8256,5504,metadata,rawRotation);
        const auto outside=unfilled.toSource({0,0});
        require(outside.x<0||outside.y<0||outside.x>8255||outside.y>5503,"Outside sampling coordinates were silently clamped");
        ae::Coord2D restored;
        require(unfilled.toDisplay(outside,restored)&&std::hypot(restored.x,restored.y)<.01,"Unclipped border must remain invertible");
        params.lensProf.lcMode=pp::LensProfParams::LcMode::LENSFUNAUTOMATCH;params.lensProf.useDist=true;params.lensProf.useCA=true;
        ae::GeometryMap full(params,8256,5504,metadata,rawRotation);
        double fullError=0;
        for(int y=200;y<5300;y+=700)for(int x=200;x<8050;x+=850)for(int c=0;c<3;++c){
            const auto point=full.toSource({double(x),double(y)},c);ae::Coord2D back;
            require(full.toDisplay(point,back,c),"Full resolution geometry inverse did not converge");
            fullError=std::max(fullError,std::hypot(back.x-x,back.y-y));
        }
        require(fullError<.01,"Full resolution inverse exceeded .01 pixels");
        std::cout<<Json{{"rows",rows},{"fields",fields(metadata,rawRotation)},{"maximumRenderedCoordinateErrorPixels",maximumPixelError},{"maximumRoundTripErrorPixels",maximumRoundTrip},{"fullResolutionRoundTripErrorPixels",fullError},{"unclippedBorder",true}}.dump(2)<<'\n';
    }catch(const std::exception &error){std::cerr<<error.what()<<'\n';return 1;}
}
