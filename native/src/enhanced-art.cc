// Integration uses ART's existing operators; table/curve arithmetic is RAWmakase MIT.
#include "enhanced-art.h"
#include "enhanced-profile.h"
#include "engine/improcfun.h"
#include "engine/iccstore.h"
#include "engine/curves.h"
#include <algorithm>
#include <cmath>
namespace captraw::enhanced {
namespace pp=art::engine::procparams;
std::unique_ptr<pp::ProcParams> processingParams(const pp::ProcParams &source){
    if(source.icm.captrawEnhanced.empty())return {};
    const auto model=Profile::parse(nlohmann::json::parse(source.icm.captrawEnhanced));const auto c=model.controls();
    if(model.isIdentity()){auto p=std::make_unique<pp::ProcParams>(source);p->icm.captrawEnhanced.clear();return p;}
    if(c.empty())return {};
    auto result=std::make_unique<pp::ProcParams>(source);auto &p=*result;
    const auto add=[&](const char *key,double original,double lo=-100,double hi=100){return std::clamp(original+c.value(key,0.),lo,hi);};
    if(c.contains("exposure")){
        if(!p.exposure.enabled)p.exposure=pp::ExposureParams();
        p.exposure.expcomp=add("exposure",p.exposure.enabled?p.exposure.expcomp:0,-5,5);p.exposure.enabled=true;
    }
    if(c.contains("contrast")||c.contains("parametricCurve")){
        if(!p.toneCurve.enabled){const auto hdr=p.toneCurve.captrawHDREditMode;const auto white=p.toneCurve.whitePoint;p.toneCurve=pp::ToneCurveParams();p.toneCurve.captrawHDREditMode=hdr;p.toneCurve.whitePoint=white;}
        p.toneCurve.enabled=true;
        if(c.contains("contrast"))p.toneCurve.contrast=int(std::round(add("contrast",p.toneCurve.contrast)));
    }
    if(c.contains("saturation")){
        if(!p.saturation.enabled)p.saturation=pp::SaturationParams();
        p.saturation.saturation=int(std::round(add("saturation",p.saturation.enabled?p.saturation.saturation:0)));p.saturation.enabled=true;
    }
    if(c.contains("blacks")||c.contains("shadows")||c.contains("highlights")||c.contains("whites")){
        if(!p.toneEqualizer.enabled)p.toneEqualizer=pp::ToneEqualizerParams();
        for(const auto &item:std::array<std::pair<const char *,int>,4>{{{"blacks",0},{"shadows",1},{"highlights",3},{"whites",4}}})
            if(c.contains(item.first))p.toneEqualizer.bands[item.second]=int(std::round(add(item.first,p.toneEqualizer.bands[item.second])));
        p.toneEqualizer.enabled=true;
    }
    if(c.contains("hsl")){
        const double positions[]={0,1./12,1./6,1./3,.5,2./3,.75,5./6};
        if(!p.hsl.enabled){p.hsl.hCurve={double(art::utils::FCT_Linear)};p.hsl.sCurve=p.hsl.hCurve;p.hsl.lCurve=p.hsl.hCurve;}p.hsl.enabled=true;
        const auto merge=[&](std::vector<double> &curve,const char *key){
            const auto &values=c.at("hsl").at(key);if(std::all_of(values.begin(),values.end(),[](const nlohmann::json &v){return v==0;}))return;
            if(curve.size()!=33){if(curve.size()>1)throw std::runtime_error("Look 无法无损叠加当前非八色 HSL 曲线。");curve={double(art::utils::FCT_MinMaxCPoints)};for(double x:positions)curve.insert(curve.end(),{x,.5,0,0});}
            for(size_t i=0;i<8;++i){if(std::abs(curve[1+4*i]-positions[i])>1e-5)throw std::runtime_error("Look 无法无损叠加当前 HSL 曲线。");curve[2+4*i]=std::clamp(curve[2+4*i]+c.at("hsl").at(key)[i].get<double>()/200.,0.,1.);}
        };merge(p.hsl.hCurve,"hue");merge(p.hsl.sCurve,"saturation");merge(p.hsl.lCurve,"luminance");
    }
    if(c.contains("parametricCurve")){
        auto &curve=p.toneCurve.captrawParametric;
        if(curve.size()!=8)curve={double(art::utils::DCT_Parametric),.25,.5,.75,0,0,0,0};
        const auto &v=c.at("parametricCurve");for(int i=0;i<3;++i)curve[i+1]=v.at("splits")[i].get<double>()/100.;
        int i=4;for(const char *key:{"highlights","lights","darks","shadows"}){curve[i]=std::clamp(curve[i]+v.value(key,0.),-100.,100.);++i;}
    }
    if(c.value("clarity",0.)!=0){
        if(!p.textureBoost.enabled)p.textureBoost=pp::TextureBoostParams();
        pp::TextureBoostParams::Region r;r.strength=c.at("clarity").get<double>()/50.;r.detailThreshold=4.;
        p.textureBoost.regions.push_back(r);pp::Mask mask;mask.name="profile:clarity";p.textureBoost.masks.push_back(mask);p.textureBoost.enabled=true;
    }
    if(c.contains("blackWhite")){if(!p.blackwhite.enabled)p.blackwhite=pp::BlackWhiteParams();p.blackwhite.enabled=true;}
    if(c.contains("toning")){
        if(p.captrawGrading.empty())p.captrawGrading={0,0,0,0,0,0,0,0,0,0,0,0,50,0};
        const auto &v=c.at("toning");
        p.captrawGrading[0]=v.at("shadowHue");p.captrawGrading[1]=v.at("shadowSaturation");
        p.captrawGrading[6]=v.at("highlightHue");p.captrawGrading[7]=v.at("highlightSaturation");p.captrawGrading[13]=v.at("balance");
    }
    if(c.contains("vignette")){
        if(p.captrawEffects.empty())p.captrawEffects={0,0,25,50,0,0,50,0,50,0};
        const auto &v=c.at("vignette");p.captrawEffects[4]=std::max(1.,v.at("style").get<double>());
        p.captrawEffects[5]=std::clamp(v.at("amount").get<double>(),-100.,100.);
        p.captrawEffects[6]=v.at("midpoint");p.captrawEffects[7]=v.at("roundness");p.captrawEffects[8]=v.at("feather");p.captrawEffects[9]=v.at("highlights");
    }
    return result;
}
}
namespace art::engine {
namespace {
void profilePixels(Imagefloat *img,const procparams::ProcParams &params,const captraw::enhanced::Profile &look,bool rgb,bool multithread){
    auto *store=ICCStore::getInstance();
    const auto work=store->workingSpaceMatrix(params.icm.workingProfile),inverse=store->workingSpaceInverseMatrix(params.icm.workingProfile);
    const auto destination=store->workingSpaceMatrix(rgb?"sRGB":"ProPhoto"),to=store->workingSpaceInverseMatrix(rgb?"sRGB":"ProPhoto");
    img->setMode(Imagefloat::Mode::RGB,multithread);const int width=img->getWidth(),height=img->getHeight();
    const auto multiply=[](const float m[3][3],const captraw::enhanced::Pixel &p){captraw::enhanced::Pixel out{};for(int i=0;i<3;++i)out[i]=m[i][0]*p[0]+m[i][1]*p[1]+m[i][2]*p[2];return out;};
#ifdef _OPENMP
#pragma omp parallel for if(multithread) schedule(static)
#endif
    for(int y=0;y<height;++y)for(int x=0;x<width;++x){
        captraw::enhanced::Pixel p{img->r(y,x)/65535.f,img->g(y,x)/65535.f,img->b(y,x)/65535.f};
        p=multiply(to,multiply(work,p));p=rgb?look.applyRGB(p):look.applyCurve(look.applyHSV(p));p=multiply(inverse,multiply(destination,p));
        img->r(y,x)=p[0]*65535.f;img->g(y,x)=p[1]*65535.f;img->b(y,x)=p[2]*65535.f;
    }
}
}
void ImProcFunctions::captrawEnhancedEarly(Imagefloat *img){
    if(params->icm.captrawEnhanced.empty())return;
    const auto look=captraw::enhanced::Profile::parse(nlohmann::json::parse(params->icm.captrawEnhanced));
    if(look.hasHSV()||look.hasCurve())profilePixels(img,*params,look,false,multiThread);
}
void ImProcFunctions::captrawEnhancedRGB(Imagefloat *img){
    if(params->icm.captrawEnhanced.empty())return;
    const auto look=captraw::enhanced::Profile::parse(nlohmann::json::parse(params->icm.captrawEnhanced));
    if(look.hasRGB())profilePixels(img,*params,look,true,multiThread);
}
}
