#include "recipe.h"
#include "engine/curves.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
namespace captraw {
namespace pp = art::engine::procparams;
Json defaults(double temperature, double green) {
    return {{"wbMode","camera"},{"wbMultipliers",nullptr},{"wbApproximate",false},{"exposure",0},{"temperature",temperature},{"tint",std::log(green)*100.0},
        {"contrast",0},{"saturation",0},{"vibrance",0},{"rotation",0},{"crop",nullptr},
        {"curve",Json::array({{{"x",0},{"y",0}},{{"x",1},{"y",1}}})},{"masks",Json::array()},
        {"highlights",0},{"shadows",0},{"whites",0},{"blacks",0},{"sharpening",0},{"sharpenRadius",1},
        {"luminanceNoise",0},{"colorNoise",0},{"dehaze",0},{"vignette",0},{"grain",0},{"lensCorrections",false},
        {"redCurve",Json::array({{{"x",0},{"y",0}},{{"x",1},{"y",1}}})},
        {"greenCurve",Json::array({{{"x",0},{"y",0}},{{"x",1},{"y",1}}})},
        {"blueCurve",Json::array({{{"x",0},{"y",0}},{{"x",1},{"y",1}}})},
        {"hsl",{{"hue",std::vector<int>(8,0)},{"saturation",std::vector<int>(8,0)},{"luminance",std::vector<int>(8,0)}}}};
}
static double num(const Json &j, const char *key, double def, double low, double high) {
    const double v=j.value(key,def);
    if(!std::isfinite(v) || v<low || v>high) throw std::runtime_error(std::string("Invalid ")+key);
    return v;
}
Json inputProfileSettings(const pp::ColorManagementParams &p) {
    const std::string mode=p.inputProfile=="(cameraICC)"?"auto":p.inputProfile=="(camera)"||p.inputProfile.empty()?"matrix":p.inputProfile=="(embedded)"?"embedded":"inherited";
    Json state={{"mode",mode},{"toneCurve",p.toneCurve},{"lookTable",p.applyLookTable},{"hueSatMap",p.applyHueSatMap},
        {"baselineExposure",p.applyBaselineExposureOffset},{"illuminant",p.dcpIlluminant}};
    if(mode=="inherited")state["reference"]=std::string(p.inputProfile);
    return state;
}
void applyAdjustments(pp::ProcParams &p, const Json &a, int width, int height, std::vector<std::string> *maskIds) {
    if(maskIds)maskIds->clear();
    if(a.contains("colorProfile")){
        const auto &c=a.at("colorProfile");const auto mode=c.at("mode").get<std::string>();
        if(mode=="auto")p.icm.inputProfile="(cameraICC)";
        else if(mode=="matrix")p.icm.inputProfile="(camera)";
        else if(mode=="embedded")p.icm.inputProfile="(embedded)";
        else if(mode=="inherited"){
            p.icm.inputProfile=c.at("reference").get<std::string>();
            if(inputProfileSettings(p.icm).at("mode")!="inherited")throw std::runtime_error("Invalid inherited input profile");
        }else throw std::runtime_error("Invalid input profile mode");
        p.icm.toneCurve=c.value("toneCurve",p.icm.toneCurve);p.icm.applyLookTable=c.value("lookTable",p.icm.applyLookTable);
        p.icm.applyHueSatMap=c.value("hueSatMap",p.icm.applyHueSatMap);p.icm.applyBaselineExposureOffset=c.value("baselineExposure",p.icm.applyBaselineExposureOffset);
        if(c.contains("illuminant")&&(!c.at("illuminant").is_number_integer()||c.at("illuminant")<0||c.at("illuminant")>2))throw std::runtime_error("Invalid DCP illuminant");
        p.icm.dcpIlluminant=c.value("illuminant",p.icm.dcpIlluminant);
    }
    p.exposure.enabled=true;
    p.exposure.expcomp=num(a,"exposure",0,-5,5);
    p.exposure.hrmode=pp::ExposureParams::HR_COLORSOFT;
    p.wb.enabled=true; p.wb.method=pp::WBParams::CUSTOM_TEMP;
    p.wb.temperature=int(num(a,"temperature",6500,1500,60000));
    p.wb.green=std::exp(num(a,"tint",0,-100,100)/100.0); p.wb.equal=1;
    if(a.contains("wbMultipliers")&&!a["wbMultipliers"].is_null()){
        const auto &m=a["wbMultipliers"];if(!m.is_array()||m.size()!=3)throw std::runtime_error("Invalid white balance multipliers");
        for(int i=0;i<3;++i){const double v=m[i].get<double>();if(!std::isfinite(v)||v<=0||v>100)throw std::runtime_error("Invalid white balance multiplier");p.wb.mult[i]=v;}
        p.wb.method=pp::WBParams::CUSTOM_MULT;
    }
    p.toneCurve.enabled=true; p.toneCurve.contrast=int(num(a,"contrast",0,-100,100));
    p.toneCurve.curveMode=pp::ToneCurveParams::TcMode::STD;
    p.toneCurve.curve={double(art::gui::DCT_Spline)};
    double last=-1;
    if(a.at("curve").size()<2||a.at("curve").size()>128)throw std::runtime_error("Invalid curve point count");
    for(const auto &point:a.at("curve")) {
        double x=num(point,"x",0,0,1), y=num(point,"y",0,0,1);
        if(x<=last)throw std::runtime_error("Curve points must be ordered");
        p.toneCurve.curve.push_back(x); p.toneCurve.curve.push_back(y); last=x;
    }
    p.saturation.enabled=true;
    p.saturation.saturation=int(num(a,"saturation",0,-100,100));
    p.saturation.vibrance=int(num(a,"vibrance",0,-100,100));
    const auto curve=[&](const char *name){std::vector<double> out{double(art::gui::DCT_Spline)};double last=-1;
        if(!a.contains(name))return std::vector<double>{double(art::gui::DCT_Spline),0,0,1,1};
        if(a.at(name).size()<2||a.at(name).size()>128)throw std::runtime_error("Invalid curve point count");
        for(const auto &point:a.at(name)){const double x=num(point,"x",0,0,1);if(x<=last)throw std::runtime_error("Curve points must be ordered");out.push_back(x);out.push_back(num(point,"y",0,0,1));last=x;}return out;};
    p.rgbCurves.rcurve=curve("redCurve");p.rgbCurves.gcurve=curve("greenCurve");p.rgbCurves.bcurve=curve("blueCurve");
    p.rgbCurves.enabled=true;
    p.toneEqualizer.bands={int(num(a,"blacks",0,-100,100)),int(num(a,"shadows",0,-100,100)),0,int(num(a,"highlights",0,-100,100)),int(num(a,"whites",0,-100,100))};
    p.toneEqualizer.enabled=std::any_of(p.toneEqualizer.bands.begin(),p.toneEqualizer.bands.end(),[](int x){return x!=0;});
    p.sharpening.enabled=num(a,"sharpening",0,0,150)>0;p.sharpening.method="usm";
    p.sharpening.amount=int(num(a,"sharpening",0,0,150));p.sharpening.radius=num(a,"sharpenRadius",1,.1,3);
    p.denoise.enabled=num(a,"luminanceNoise",0,0,100)>0||num(a,"colorNoise",0,0,100)>0;
    p.denoise.luminance=num(a,"luminanceNoise",0,0,100);p.denoise.chrominance=num(a,"colorNoise",0,0,100);
    p.denoise.chrominanceMethod=pp::DenoiseParams::ChrominanceMethod::MANUAL;
    const double dehaze=num(a,"dehaze",0,-100,100);p.dehaze.enabled=dehaze!=0;
    p.dehaze.strength={double(art::utils::FCT_MinMaxCPoints),0,.5+dehaze/200,0,0,1,.5+dehaze/200,0,0};
    const double vignette=num(a,"vignette",0,-100,100);p.pcvignette.enabled=vignette!=0;p.pcvignette.strength=-vignette/100;
    p.grain.enabled=num(a,"grain",0,0,100)>0;p.grain.strength=int(num(a,"grain",0,0,100));
    p.lensProf.lcMode=a.value("lensCorrections",false)?pp::LensProfParams::LcMode::LENSFUNAUTOMATCH:pp::LensProfParams::LcMode::NONE;
    p.lensProf.useDist=true;p.lensProf.useCA=true;p.lensProf.useVign=true;
    p.hsl.enabled=a.contains("hsl");
    if(p.hsl.enabled){const std::array<double,8> positions{0,1./12,1./6,1./3,.5,2./3,.75,5./6};
        const auto hsl=[&](const char *name){const auto &values=a.at("hsl").at(name);if(values.size()!=8)throw std::runtime_error("Invalid HSL bands");std::vector<double> out{double(art::utils::FCT_MinMaxCPoints)};
            for(int i=0;i<8;i++){const double v=values[i];if(!std::isfinite(v)||v< -100||v>100)throw std::runtime_error("Invalid HSL value");out.insert(out.end(),{positions[i],.5+v/200,0,0});}return out;};
        p.hsl.hCurve=hsl("hue");p.hsl.sCurve=hsl("saturation");p.hsl.lCurve=hsl("luminance");}
    int rotation=a.value("rotation",0);
    if(rotation!=0 && rotation!=90 && rotation!=180 && rotation!=270)throw std::runtime_error("Invalid rotation");
    p.coarse.rotate=rotation;
    const auto rotate=[&](double x,double y)->std::pair<double,double>{switch(rotation){case 90:return {1-y,x};case 180:return {1-x,1-y};case 270:return {y,1-x};default:return {x,y};}};
    if(rotation==90 || rotation==270)std::swap(width,height);
    p.crop.enabled=!a.at("crop").is_null();
    if(p.crop.enabled) {
        const auto &c=a.at("crop");
        double x=num(c,"x",0,0,1),y=num(c,"y",0,0,1);
        double w=num(c,"width",1,0.001,1),h=num(c,"height",1,0.001,1);
        if(x+w>1.00001 || y+h>1.00001)throw std::runtime_error("Crop extends outside image");
        const auto first=rotate(x,y),second=rotate(x+w,y+h);
        p.crop.x=std::round(std::min(first.first,second.first)*width);p.crop.y=std::round(std::min(first.second,second.second)*height);
        p.crop.w=std::max(1,int(std::round(std::abs(second.first-first.first)*width)));p.crop.h=std::max(1,int(std::round(std::abs(second.second-first.second)*height)));
    }
    p.colorcorrection.regions.clear();p.colorcorrection.masks.clear();p.colorcorrection.showMask=-1;
    std::function<pp::Mask(const Json &,int)> makeMask;
    makeMask=[&](const Json &m,int depth)->pp::Mask{
        pp::Mask mask; mask.enabled=m.value("enabled",true);mask.inverted=m.value("inverted",false);
        mask.name=m.value("name",std::string("Mask"));
        if(depth>8)throw std::runtime_error("Mask group nesting limit exceeded");
        if(m.contains("components")){
            if(!m["components"].is_array()||m["components"].size()>32)throw std::runtime_error("Invalid mask components");
            for(const auto &child:m["components"]){
                if(!child.value("enabled",true)||!child.value("initialized",true)||(child.value("type",std::string())=="brush"&&child.at("points").empty()))continue;
                auto component=makeMask(child,depth+1);if(!component.enabled)continue;
                const auto operation=child.value("operation",std::string("add"));
                if(operation!="add"&&operation!="subtract"&&operation!="intersect")throw std::runtime_error("Invalid mask operation");
                mask.componentModes.push_back(operation=="subtract"?1:operation=="intersect"?2:0);
                mask.components.push_back(component);
            }
            mask.enabled=!mask.components.empty();return mask;
        }
        const double feather=num(m,"feather",30,0,100);
        std::string type=m.value("type",std::string("brush"));
        if(type=="brush") {
            mask.drawnMask.enabled=true;mask.drawnMask.feather=feather;
            mask.drawnMask.smoothness=feather/100.0;
            for(const auto &point:m.at("points")) {
                pp::DrawnMask::Stroke s;
                s.x=num(point,"x",0,0,1);s.y=num(point,"y",0,0,1);
                const auto rotated=rotate(s.x,s.y);s.x=rotated.first;s.y=rotated.second;
                s.radius=num(point,"radius",0.2,0.001,5);s.opacity=1;s.erase=point.value("erase",false);
                mask.drawnMask.strokes.push_back(s);
            }
        } else {
            const auto &s=m.at("start"), &e=m.at("end");
            double sx=num(s,"x",0.3,0,1),sy=num(s,"y",0.3,0,1);
            double ex=num(e,"x",0.7,0,1),ey=num(e,"y",0.7,0,1);
            const auto first=rotate(sx,sy),second=rotate(ex,ey);sx=first.first;sy=first.second;ex=second.first;ey=second.second;
            mask.areaMask.enabled=true;mask.areaMask.feather=feather;
            if(type=="radial") {
                auto shape=std::make_unique<pp::AreaMask::Rectangle>();
                shape->x=(sx+ex-1)*100;shape->y=(sy+ey-1)*100;
                shape->width=std::max(0.1,std::abs(ex-sx)*100);shape->height=std::max(0.1,std::abs(ey-sy)*100);
                shape->roundness=100;shape->feather=feather;
                mask.areaMask.shapes.push_back(std::move(shape));
            } else if(type=="linear") {
                auto shape=std::make_unique<pp::AreaMask::Gradient>();
                shape->x=(sx+ex-1)*100;shape->y=(sy+ey-1)*100;
                shape->angle=std::atan2((ex-sx)*width,(ey-sy)*height)*180.0/3.141592653589793;
                shape->strengthStart=100;shape->strengthEnd=0;
                shape->feather=std::max(.01,std::hypot((ex-sx)*width,(ey-sy)*height)/std::hypot(width,height)*100.0*(.5+feather/100.0));
                mask.areaMask.shapes.push_back(std::move(shape));
            } else throw std::runtime_error("Unknown mask type");
        }
        return mask;
    };
    for(const auto &m:a.at("masks")){
        if(!m.value("enabled",true)||!m.value("initialized",true)||(m.value("type",std::string())=="brush"&&!m.contains("components")&&m.at("points").empty()))continue;
        auto mask=makeMask(m,0);if(!mask.enabled)continue;
        pp::ColorCorrectionParams::Region region;
        region.mode=pp::ColorCorrectionParams::Mode::RGB;
        const double gain=std::exp2(num(m,"brightness",0,-3,3));
        const double contrast=std::exp2(num(m,"contrast",0,-100,100)/100.0);
        for(int i=0;i<3;++i){region.slope[i]=gain;region.power[i]=1.0/contrast;region.pivot[i]=0.18;}
        region.outSaturation=num(m,"saturation",0,-100,100);
        p.colorcorrection.regions.push_back(region);p.colorcorrection.masks.push_back(mask);
        if(maskIds)maskIds->push_back(m.value("id",std::string()));
    }
    p.colorcorrection.enabled=!p.colorcorrection.regions.empty();
    p.icm.outputProfile="RTv4_sRGB";p.icm.outputIntent=art::engine::RI_RELATIVE;p.icm.outputBPC=true;
}
std::string profileText(const pp::ProcParams &p) {
    pp::KeyFile k;if(p.save(nullptr,k)!=0)throw std::runtime_error("Cannot serialize ART profile");return k.to_data();
}
void loadProfile(pp::ProcParams &p,const std::string &text) {
    if(text.empty())return;
    pp::KeyFile k;
    if(!k.load_from_data(text) || p.load(nullptr,k)!=0)throw std::runtime_error("Invalid ART profile");
}
}
