// Independent characterization only. Candidates are not a production crop API.
#include "core.h"
#include "geometry-map.h"
#include "geometry-reference.h"
#include "engine/improcfun.h"
#include "engine/imagefloat.h"
#include "engine/imagesource.h"
#include "engine/perspectivecorrection.h"
#include "engine/rtengine.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace ae=art::engine;
namespace pp=ae::procparams;
using Json=nlohmann::json;
constexpr int BaseWidth=641,BaseHeight=427;
constexpr float Signal=30000.f;
constexpr double Complete=.999;
static void require(bool ok,const std::string &message){if(!ok)throw std::runtime_error(message);}
struct Rect {int x,y,w,h;};
static Json rectangle(Rect r,int width,int height){
    return {{"indices",{r.x,r.y,r.x+r.w,r.y+r.h}},
            {"normalizedDisplay",{{"x",double(r.x)/width},{"y",double(r.y)/height},{"width",double(r.w)/width},{"height",double(r.h)/height}}}};
}
static Rect affine(Rect r,int width,int height,const pp::PerspectiveParams &p){
    const double zoom=p.enabled&&p.captrawManual?p.captrawScale:1;
    const double dx=p.enabled&&p.captrawManual?p.captrawOffsetX*width:0;
    const double dy=p.enabled&&p.captrawManual?p.captrawOffsetY*height:0;
    const auto x=[&](double v){return width*.5+(v-width*.5)*zoom+dx;};
    const auto y=[&](double v){return height*.5+(v-height*.5)*zoom+dy;};
    // Only intersect an existing ashift rectangle with the canvas. No search
    // or replacement rectangle algorithm, and no claim of maximum safe area.
    const int left=std::max(0,std::min(width,int(std::ceil(x(r.x-.5)+.5))));
    const int top=std::max(0,std::min(height,int(std::ceil(y(r.y-.5)+.5))));
    const int right=std::max(0,std::min(width,int(std::floor(x(r.x+r.w-.5)+.5))));
    const int bottom=std::max(0,std::min(height,int(std::floor(y(r.y+r.h-.5)+.5))));
    return {left,top,std::max(0,right-left),std::max(0,bottom-top)};
}
static bool inSource(ae::GeometryMap &map,ae::Coord2D p,int width,int height){
    for(int channel=0;channel<3;++channel){
        const auto q=map.toSource(p,channel);
        if(!std::isfinite(q.x)||!std::isfinite(q.y)||q.x<-.5||q.y<-.5||q.x>=width-.5||q.y>=height-.5)return false;
    }
    return true;
}
static double response(const ae::Imagefloat &image,int x,int y){
    return std::min({image.r(y,x),image.g(y,x),image.b(y,x)})/Signal;
}
static void pgm(const std::string &path,int width,int height,const std::vector<float> &plane){
    std::ofstream file(path,std::ios::binary);require(bool(file),"Cannot create diagnostic plane");
    file<<"P5\n"<<width<<' '<<height<<"\n65535\n";
    for(float v:plane){const auto n=static_cast<unsigned>(std::round(std::max(0.,std::min(1.,double(v)))*65535));
        file.put(char(n>>8));file.put(char(n&255));}
    require(bool(file),"Cannot finish diagnostic plane");
}
static Json inspect(Rect r,int width,int height,ae::GeometryMap &map,const ae::Imagefloat &unit){
    Json row=rectangle(r,width,height);
    const bool bounded=r.x>=0&&r.y>=0&&r.w>0&&r.h>0&&r.x+r.w<=width&&r.y+r.h<=height;
    row["bounded"]=bounded;
    size_t incomplete=0,outside=0,boundaryOutside=0,centers=0,boundary=0;double minimum=1;
    if(bounded){
        // Exhaustive integer centers use ART's actual staged rendering; the
        // independent subpixel boundary samples use the unclipped point map.
        for(int y=r.y;y<r.y+r.h;++y)for(int x=r.x;x<r.x+r.w;++x){
            const double v=response(unit,x,y);++centers;
            incomplete+=!std::isfinite(v)||v<Complete;minimum=std::min(minimum,v);
            outside+=!inSource(map,{double(x),double(y)},width,height);
        }
        const auto sample=[&](double x,double y){++boundary;boundaryOutside+=!inSource(map,{x,y},width,height);};
        for(int i=0;i<=256;++i){
            const double u=double(i)/256,epsilon=1e-5;
            const double x=r.x-.5+epsilon+u*(r.w-2*epsilon),y=r.y-.5+epsilon+u*(r.h-2*epsilon);
            sample(x,r.y-.5+epsilon);sample(x,r.y+r.h-.5-epsilon);
            sample(r.x-.5+epsilon,y);sample(r.x+r.w-.5-epsilon,y);
        }
    }
    row["renderedCenterSamples"]=centers;row["incompleteRenderedCenters"]=incomplete;
    row["minimumUnitResponse"]=minimum;row["sourceDomainOutsideCenters"]=outside;
    row["boundaryPointSamples"]=boundary;row["boundaryPointsOutsideSource"]=boundaryOutside;
    row["passesSampledValidation"]=bounded&&!incomplete&&!outside&&!boundaryOutside;
    return row;
}
static Json storedCrop(Rect r,int width,int height,const pp::ProcParams &p){
    // Crop is an unrotated canvas-edge rectangle, not a source-content polygon.
    // Reverse exactly Viewport's relative reflection then coarse rotation.
    const auto basis=ae::geometrySourceBasis(p);
    const auto reverse=[&](double x,double y){
        if(p.coarse.hflip!=basis.first)x=1-x;
        if(p.coarse.vflip!=basis.second)y=1-y;
        switch(p.coarse.rotate){case 90:return ae::Coord2D(y,1-x);case 180:return ae::Coord2D(1-x,1-y);case 270:return ae::Coord2D(1-y,x);default:return ae::Coord2D(x,y);}
    };
    const auto a=reverse(double(r.x)/width,double(r.y)/height),b=reverse(double(r.x+r.w)/width,double(r.y+r.h)/height);
    return {{"x",std::min(a.x,b.x)},{"y",std::min(a.y,b.y)},{"width",std::abs(b.x-a.x)},{"height",std::abs(b.y-a.y)}};
}
int main(int argc,char **argv){
    try{
        require(argc==5,"Usage: geometry-coverage-probe resources cache metadata-image output-directory");
        captraw::Engine runtime(argv[1],argv[2],[](const Json &){});
        int error=0;auto *image=ae::InitialImage::load(argv[3],false,&error,nullptr);
        require(image!=nullptr,"Cannot decode metadata fixture");
        struct Owner{ae::InitialImage *p;~Owner(){p->decreaseRef();}} owner{image};
        const auto *metadata=image->getMetaData();const int rawRotation=image->getImageSource()->getRotateDegree();
        Json rows=Json::array();size_t unsafe=0,checked=0;
        for(int rotation:{0,90,180,270})for(bool horizontal:{false,true})for(bool vertical:{false,true})
        for(const std::string kind:{"neutral","affine","shrink-shift","projective-affine","lensfun-ca"}){
            const int width=rotation%180?BaseHeight:BaseWidth,height=rotation%180?BaseWidth:BaseHeight;
            pp::ProcParams p;p.coarse.rotate=rotation;p.coarse.hflip=horizontal;p.coarse.vflip=vertical;
            p.rotate.captrawSourceBasisSet=true;p.rotate.captrawSourceBasisHorizontal=false;p.rotate.captrawSourceBasisVertical=false;
            p.commonTrans.autofill=false;
            auto &v=p.perspective;v.enabled=kind!="neutral";v.captrawManual=v.enabled;v.captrawConstrain=false;
            // Match PerspectiveCorrection::import_meta explicitly for the
            // lower-level autocrop helper, whose view-size call uses raw params.
            v.flength=metadata->getFocalLen();
            if(v.flength>0&&metadata->getFocalLen35mm()>0)v.cropfactor=metadata->getFocalLen35mm()/v.flength;
            if(v.enabled){v.captrawScale=1.1;v.captrawOffsetX=.07;v.captrawOffsetY=-.04;}
            if(kind=="shrink-shift"){v.captrawScale=.75;v.captrawOffsetX=-.09;v.captrawOffsetY=.06;}
            if(kind=="projective-affine"||kind=="lensfun-ca"){
                v.horizontal=12;v.vertical=-9;v.angle=1.5;v.shear=2;v.aspect=1.08;
                p.rotate.enabled=true;p.rotate.degree=13;
                p.distortion.enabled=true;p.distortion.amount=.08;
                p.cacorrection.enabled=true;p.cacorrection.red=.004;p.cacorrection.blue=-.003;
            }
            if(kind=="lensfun-ca"){
                p.lensProf.lcMode=pp::LensProfParams::LcMode::LENSFUNAUTOMATCH;
                p.lensProf.useDist=true;p.lensProf.useCA=true;p.lensProf.useVign=false;
            }
            ae::ImProcFunctions ipf(&p,false);ipf.setScale(1);
            const auto lens=ipf.getLensCorrection(width,height,metadata,rawRotation);
            double lensShift=0;
            if(kind=="lensfun-ca"){
                require(lens&&lens->isCACorrectionAvailable(),"Fixture must resolve real Lensfun distortion and CA");
                double x=10,y=10;lens->correctDistortion(x,y,0,0,1);lensShift=std::hypot(x-10,y-10);
                require(lensShift>.001,"Resolved lens must actually move coordinates");
            }
            ae::GeometryMap map(p,width,height,metadata,rawRotation);
            ae::Imagefloat unitIn(width,height),unitOut(width,height),rampIn(width,height),rampOut(width,height),blackIn(width,height),blackOut(width,height);
            for(int y=0;y<height;++y)for(int x=0;x<width;++x){
                unitIn.r(y,x)=unitIn.g(y,x)=unitIn.b(y,x)=Signal;
                rampIn.r(y,x)=6000.f+30000.f*x/(width-1);rampIn.g(y,x)=6000.f+30000.f*y/(height-1);rampIn.b(y,x)=Signal;
                blackIn.r(y,x)=blackIn.g(y,x)=blackIn.b(y,x)=0;
            }
            // GeometryMap returns the retained unflipped source basis; ART's
            // transform receives the already coarse-flipped source canvas.
            if(horizontal)rampIn.hflip();if(vertical)rampIn.vflip();
            const auto render=[&](ae::Imagefloat &from,ae::Imagefloat &to){
                if(ipf.needsTransform())ipf.transform(&from,&to,0,0,0,0,width,height,width,height,metadata,rawRotation,true);
                else from.copyTo(&to);
            };
            render(unitIn,unitOut);render(rampIn,rampOut);render(blackIn,blackOut);
            std::vector<float> responsePlane(size_t(width)*height),domainPlane(responsePlane.size()),blackPlane(responsePlane.size());
            size_t complete=0,trueBlack=0,rampSamples=0;double rampError=0;
            for(int y=0;y<height;++y)for(int x=0;x<width;++x){
                const size_t i=size_t(y)*width+x;const double value=response(unitOut,x,y);
                require(std::isfinite(value),"Nonfinite unit response");responsePlane[i]=value;
                domainPlane[i]=inSource(map,{double(x),double(y)},width,height)?1:0;
                blackPlane[i]=std::max({std::abs(blackOut.r(y,x)),std::abs(blackOut.g(y,x)),std::abs(blackOut.b(y,x))})/Signal;
                complete+=value>=Complete;trueBlack+=value>=Complete&&blackPlane[i]<1e-5;
                if(value>=Complete&&x%19==0&&y%17==0)for(int channel=0;channel<2;++channel){
                    const auto q=map.toSource({double(x),double(y)},channel);
                    if(q.x<8||q.y<8||q.x>width-9||q.y>height-9)continue;
                    const double sample=channel==0?rampOut.r(y,x):rampOut.g(y,x);
                    const double measured=(sample-6000)/30000*(channel==0?width-1:height-1);
                    rampError=std::max(rampError,std::abs(measured-(channel==0?q.x:q.y)));++rampSamples;
                }
            }
            require(trueBlack>1000,"Opaque true black must retain independent geometric support");
            require(rampSamples>50&&rampError<.75,"Coordinate ramps disagree with rendered affine/lens/flip pipeline: "+std::to_string(rampError));
            double directionError=0;
            if(kind=="affine"||kind=="shrink-shift"){
                const ae::Coord2D source(width*.37,height*.42);ae::Coord2D actual;
                require(map.toDisplay(source,actual),"Affine direction inverse failed");
                const double x=horizontal?width-1-source.x:source.x,y=vertical?height-1-source.y:source.y;
                directionError=std::hypot(actual.x-(width*.5+(x-width*.5)*v.captrawScale+v.captrawOffsetX*width),actual.y-(height*.5+(y-height*.5)*v.captrawScale+v.captrawOffsetY*height));
                require(directionError<.025,"Affine offset direction changed across coarse flips");
            }
            const std::string name=kind+"-r"+std::to_string(rotation)+"-h"+std::to_string(horizontal)+"-v"+std::to_string(vertical);
            pgm(std::string(argv[4])+"/"+name+"-unit-response.pgm",width,height,responsePlane);
            pgm(std::string(argv[4])+"/"+name+"-source-domain.pgm",width,height,domainPlane);
            pgm(std::string(argv[4])+"/"+name+"-true-black.pgm",width,height,blackPlane);
            Json candidates=Json::array();
            for(bool fixed:{false,true}){
                auto projective=v;projective.captrawManual=false;Rect raw;
                ae::PerspectiveCorrection::autocrop(width,height,fixed,projective,metadata,raw.x,raw.y,raw.w,raw.h);
                const auto framed=affine(raw,width,height,v);
                auto candidate=inspect(framed,width,height,map,unitOut);
                candidate["ashiftFixOriginalAspect"]=fixed;candidate["ashiftRaw"]=rectangle(raw,width,height);
                candidate["storedCrop"]=storedCrop(framed,width,height,p);
                candidate["solverScope"]="ashift projective + existing positive affine + canvas intersection; Lensfun/fine/manual distortion/CA validated, not solved";
                unsafe+=!candidate["passesSampledValidation"].get<bool>();++checked;candidates.push_back(candidate);
            }
            rows.push_back({{"name",name},{"width",width},{"height",height},{"rotation",rotation},{"flipHorizontal",horizontal},{"flipVertical",vertical},
                {"lensfunCA",kind=="lensfun-ca"},{"lensCoordinateShiftPixels",lensShift},{"fineRotation",p.rotate.enabled?p.rotate.degree:0},
                {"scale",v.captrawScale},{"offsetX",v.captrawOffsetX},{"offsetY",v.captrawOffsetY},{"completeUnitResponsePixels",complete},
                {"coveredTrueBlackPixels",trueBlack},{"rampSamples",rampSamples},{"maximumRampErrorPixels",rampError},{"affineDirectionErrorPixels",directionError},
                {"diagnosticPrefix",name},{"candidates",candidates}});
        }
        std::cout<<Json{{"probeVersion",1},{"rows",rows},{"candidateCount",checked},{"unsafeCandidates",unsafe},
            {"unitResponseThreshold",Complete},{"pixelBounds","candidate indices [x,y,x+w,y+h); pixel-center domain [-.5,W-.5)"},
            {"limitations",{"unit response is actual ART RGB sampler support, not fractional alpha","point-domain samples alone cannot prove intermediate-stage validity","sampled safety does not prove continuous support or a maximum-area crop","no Adobe parity claim; no recipe or input file is changed"}}}.dump(2)<<'\n';
    }catch(const std::exception &e){std::cerr<<e.what()<<'\n';return 1;}
}
