#include "recipe.h"
#include "enhanced-profile.h"
#include "input-profile.h"
#include "geometry-reference.h"
#include "source-frame.h"
#include "brush.h"
#include "repair-recipe.h"
#include "white-balance.h"
#include "engine/curves.h"
#include "engine/rtlensfun.h"
#include "engine/dcp.h"
#include "engine/iccstore.h"
#include "engine/color.h"
#include "engine/colortemp.h"
#include "engine/iccmatrices.h"
#include "engine/masks.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <fstream>
namespace captraw {
namespace pp = art::engine::procparams;
Json defaults() {
    return {{"wbMode","camera"},{"wbMultipliers",nullptr},{"wbApproximate",false},{"exposure",0},{"temperature",6500},{"tint",0},
        {"contrast",0},{"saturation",0},{"vibrance",0},{"rotation",0},{"crop",nullptr},
        {"curve",Json::array({{{"x",0},{"y",0}},{{"x",1},{"y",1}}})},{"masks",Json::array()},
        {"highlights",0},{"shadows",0},{"whites",0},{"blacks",0},{"sharpening",0},{"sharpenRadius",1},
        {"luminanceNoise",0},{"colorNoise",0},{"dehaze",0},{"vignette",0},{"grain",0},{"lensCorrections",false},{"lensManualDistortion",0},{"lensVignette",0},
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
Json maskGeometryReference(const pp::ProcParams &params) {
    if(!params.commonTrans.captrawSourceFrame.empty()&&!params.commonTrans.captrawSourceIdentity.empty()){
        const auto bound=art::engine::bindGeometryReference(art::engine::maskGeometryParams(params),params);
        return {{"version",3},{"data",art::engine::geometryReference(bound,true)}};
    }
    const bool frame=art::engine::activeSourceFrame(params);
    return {{"version",frame?2:1},{"data",art::engine::geometryReference(params,frame)}};
}
std::string maskGeometryReferenceData(const Json &reference) {
    if(!reference.is_object()||(reference.at("version")!=1&&reference.at("version")!=2&&reference.at("version")!=3)||!reference.at("data").is_string())
        throw std::runtime_error("Invalid mask geometry reference version");
    auto data=reference.at("data").get<std::string>();
    const auto p=art::engine::geometryReferenceParams(data);
    if(reference.at("version")==3){
        const auto frame=art::engine::checkedSourceFrame(Json::parse(p.commonTrans.captrawSourceFrame));
        art::engine::checkedRenderBinding(frame.at("renderBinding"));
    }else if(reference.at("version")==2){
        art::engine::checkedSourceFrame(Json::parse(p.commonTrans.captrawSourceFrame));
        if(art::engine::hasRenderBinding(p))throw std::runtime_error("A render binding requires reference version 3");
    }
    else if(!p.commonTrans.captrawSourceFrame.empty())throw std::runtime_error("A framed reference requires version 2");
    return data;
}
Json referencedMasks(const Json &adjustments,const pp::ProcParams &params,bool bindFrame) {
    auto masks=adjustments.at("masks");
    const double reference=params.rotate.captrawMaskCoordinates?params.rotate.captrawMaskReferenceDegree:
        (params.rotate.enabled?params.rotate.degree:0);
    const auto framedReference=[&](const Json &old,double angle){
        auto p=old.is_null()?art::engine::maskGeometryParams(params):
            art::engine::geometryReferenceParams(maskGeometryReferenceData(old));
        if(old.is_null()){p.rotate.degree=angle;p.rotate.enabled=angle!=0;}
        if(p.commonTrans.captrawSourceFrame.empty())p.commonTrans.captrawSourceFrame=params.commonTrans.captrawSourceFrame;
        if(p.commonTrans.captrawSourceFrame.empty())return old;
        p=art::engine::bindGeometryReference(p,params);
        return Json{{"version",art::engine::hasRenderBinding(p)?3:2},{"data",art::engine::geometryReference(p,true)}};
    };
    std::function<void(Json &,int)> bind=[&](Json &mask,int depth){
        if(depth>8)throw std::runtime_error("Mask group nesting limit exceeded");
        if(mask.contains("components")){
            for(auto &child:mask.at("components"))bind(child,depth+1);
        }else{
            const auto type=mask.at("type").get<std::string>();
            if(type=="brush"||type=="linear"||type=="radial"||type=="raster"){
                if(mask.contains("geometryReference"))maskGeometryReferenceData(mask.at("geometryReference"));
                if(!mask.contains("referenceAngle")&&mask.value("initialized",true))mask["referenceAngle"]=reference;
                num(mask,"referenceAngle",0,-45,45);
                if(bindFrame&&mask.value("initialized",true)){
                    const auto ref=framedReference(mask.value("geometryReference",Json()),mask.value("referenceAngle",reference));
                    if(!ref.is_null())mask["geometryReference"]=ref;
                    if(mask.contains("brush"))for(auto &stroke:mask.at("brush").at("strokes"))
                        stroke["geometryReference"]=framedReference(stroke.at("geometryReference"),reference);
                }
            }
        }
    };
    for(auto &mask:masks)bind(mask,0);
    return masks;
}
Json perspectiveSettings(const pp::ProcParams &p) {
    const auto &v=p.perspective;
    Json result={{"enabled",v.enabled},{"horizontal",v.horizontal},{"vertical",v.vertical},{"angle",v.angle},{"shear",v.shear},{"focalLength",v.flength},{"cropFactor",v.cropfactor},{"aspect",v.aspect}};
    if(v.captrawManual){result["manualModel"]=v.captrawSignedFraming?"signed-framing-v1":"art-perspective-v1";result["scale"]=v.captrawScale;
        result["offsetX"]=v.captrawOffsetX;result["offsetY"]=v.captrawOffsetY;result["constrainCrop"]=v.captrawConstrain;}
    return result;
}
Json colorGradingSettings(const pp::ProcParams &p) {
    const auto &values=p.captrawGrading;Json result=Json::object();int i=0;
    for(const char *region:{"shadows","midtones","highlights","global"}){
        result[region]={{"hue",values.empty()?0:values[i]},{"saturation",values.empty()?0:values[i+1]},{"luminance",values.empty()?0:values[i+2]}};i+=3;
    }
    result["blending"]=values.empty()?50:values[12];result["balance"]=values.empty()?0:values[13];return result;
}
std::vector<double> parametricCurve(const Json &settings) {
    if(!settings.is_object())throw std::runtime_error("Invalid parametric curve");
    const auto &splits=settings.at("splits");
    if(!splits.is_array()||splits.size()!=3)throw std::runtime_error("Invalid curve splits");
    std::vector<double> curve{double(art::utils::DCT_Parametric)};double previous=0;
    for(const auto &split:splits){const double v=num({{"v",split}},"v",0,1,99);if(v-previous<1)throw std::runtime_error("Curve splits must be ordered with a one percent gap");curve.push_back(v/100.);previous=v;}
    bool changed=false;for(const char *key:{"highlights","lights","darks","shadows"}){const double v=num(settings,key,0,-100,100);curve.push_back(v);changed|=v!=0;}
    return changed?curve:std::vector<double>{double(art::utils::DCT_Linear)};
}
Json adjustmentBase(const pp::ProcParams &p,const Json &groups) {
    if(!groups.is_array()||groups.size()>5)throw std::runtime_error("Invalid adjustment projection groups");
    Json result=Json::object();
    for(const auto &group:groups){
        if(group=="colorGrading"){
            if(!p.captrawGrading.empty()&&p.captrawGrading.size()!=14)throw std::runtime_error("Invalid stored color grading");
            result["colorGrading"]=colorGradingSettings(p);
        }else if(group=="curveRefine"){
            const auto &t=p.toneCurve;
            if(!t.captrawCurveRefineModel.empty()){
                if(t.captrawCurveRefineModel!="weighted-std-v1"||!std::isfinite(t.captrawCurveRefineAmount)||t.captrawCurveRefineAmount<0||t.captrawCurveRefineAmount>100||std::round(t.captrawCurveRefineAmount)!=t.captrawCurveRefineAmount)throw std::runtime_error("Invalid stored curve refinement");
                result["curveRefineModel"]=t.captrawCurveRefineModel;result["curveRefineSaturation"]=t.captrawCurveRefineAmount;
            }
        }else if(group=="parametricCurve"){
            Json values={{"shadows",0},{"darks",0},{"lights",0},{"highlights",0},{"splits",{25,50,75}}};
            const auto &curve=p.toneCurve.captrawParametric;
            if(curve.size()>1){
                if(curve.size()!=8||curve[0]!=double(art::utils::DCT_Parametric))throw std::runtime_error("原生参数曲线无法无损投影为当前控件，已停止载入");
                values["splits"]=Json::array();
                for(int i=1;i<=3;++i){const double value=curve[i]*100.;if(!std::isfinite(value)||std::abs(value-std::round(value))>1e-5)throw std::runtime_error("原生参数曲线分界无法无损投影");values["splits"].push_back(int(std::round(value)));}
                values["highlights"]=curve[4];values["lights"]=curve[5];values["darks"]=curve[6];values["shadows"]=curve[7];
            }
            result["parametricCurve"]=values;
        }else if(group=="calibration"){
            const auto &m=p.chmixer;
            if(m.enabled&&m.mode!=pp::ChannelMixerParams::PRIMARIES_CHROMA)throw std::runtime_error("原生通道混合无法无损投影为原色校准，已停止载入");
            result["calibration"]={{"redHue",m.enabled?m.hue_tweak[0]:0},{"redSaturation",m.enabled?m.sat_tweak[0]:0},
                {"greenHue",m.enabled?m.hue_tweak[1]:0},{"greenSaturation",m.enabled?m.sat_tweak[1]:0},
                {"blueHue",m.enabled?m.hue_tweak[2]:0},{"blueSaturation",m.enabled?m.sat_tweak[2]:0}};
            if(m.captrawShadowTint)result["calibration"]["shadowTint"]=m.captrawShadowTint;
        }else if(group=="hsl"){
            Json values=Json::object();const std::array<double,8> positions{0,1./12,1./6,1./3,.5,2./3,.75,5./6};
            const std::vector<double> *curves[]={&p.hsl.hCurve,&p.hsl.sCurve,&p.hsl.lCurve};const char *names[]={"hue","saturation","luminance"};
            for(int channel=0;channel<3;++channel){
                values[names[channel]]=std::vector<int>(8,0);if(!p.hsl.enabled)continue;
                const auto &curve=*curves[channel];
                if(curve.size()!=33||curve[0]!=double(art::utils::FCT_MinMaxCPoints))throw std::runtime_error("原生 HSL 曲线无法无损投影为八色控件，已停止载入");
                for(int i=0;i<8;++i){
                    const int offset=1+i*4;const double value=(curve[offset+1]-.5)*200.;
                    if(!std::isfinite(value)||std::abs(curve[offset]-positions[i])>1e-5||std::abs(value-std::round(value))>1e-5||curve[offset+2]!=0||curve[offset+3]!=0)throw std::runtime_error("原生 HSL 曲线无法无损投影为八色控件，已停止载入");
                    values[names[channel]][i]=int(std::round(value));
                }
            }
            result["hsl"]=values;
        }else throw std::runtime_error("Unknown adjustment projection group");
    }
    return result;
}
Json inputProfileSettings(const pp::ColorManagementParams &p) {
    const std::string mode=p.inputProfile=="(cameraICC)"?"auto":p.inputProfile=="(camera)"||p.inputProfile.empty()?"matrix":p.inputProfile=="(embedded)"?"embedded":"inherited";
    Json state={{"mode",mode},{"toneCurve",p.toneCurve},{"lookTable",p.applyLookTable},{"hueSatMap",p.applyHueSatMap},
        {"baselineExposure",p.applyBaselineExposureOffset},{"illuminant",p.dcpIlluminant}};
    if(mode=="inherited")state["reference"]=std::string(p.inputProfile);
    if(!p.captrawEnhanced.empty())state["look"]=Json::parse(p.captrawEnhanced);
    return state;
}
void applyInputProfile(pp::ColorManagementParams &p,const Json &c) {
    const auto mode=c.at("mode").get<std::string>();
    if(mode=="auto")p.inputProfile="(cameraICC)";
    else if(mode=="matrix")p.inputProfile="(camera)";
    else if(mode=="embedded")p.inputProfile="(embedded)";
    else if(mode=="inherited"){
        p.inputProfile=c.at("reference").get<std::string>();
        if(inputProfileSettings(p).at("mode")!="inherited")throw std::runtime_error("Invalid inherited input profile");
    }else throw std::runtime_error("Invalid input profile mode");
    p.toneCurve=c.value("toneCurve",p.toneCurve);p.applyLookTable=c.value("lookTable",p.applyLookTable);
    p.applyHueSatMap=c.value("hueSatMap",p.applyHueSatMap);p.applyBaselineExposureOffset=c.value("baselineExposure",p.applyBaselineExposureOffset);
    if(c.contains("illuminant")&&(!c.at("illuminant").is_number_integer()||c.at("illuminant")<0||c.at("illuminant")>2))throw std::runtime_error("Invalid DCP illuminant");
    p.dcpIlluminant=c.value("illuminant",p.dcpIlluminant);
    p.captrawEnhanced.clear();
    if(c.contains("look")&&!c.at("look").is_null()){
        enhanced::Profile::parse(c.at("look"));
        p.captrawEnhanced=c.at("look").dump();
    }
}
void validateInputProfile(const pp::ColorManagementParams &p) {
    if(!p.captrawEnhanced.empty()){
        const auto look=Json::parse(p.captrawEnhanced);enhanced::Profile::parse(look);
        const auto base=look.at("profile").at("baseProfile").get<std::string>();
        if(!base.empty()){
            if(inputProfileSettings(p).at("mode")!="inherited"||p.inputProfile=="(none)")throw std::runtime_error("Look 缺少基础 DCP“"+base+"”，未应用。");
            const std::string path=p.inputProfile.substr(0,5)=="file:"?p.inputProfile.substr(5):p.inputProfile;
            const auto info=inspectInputProfile(path);
            if(info.at("kind")!="dcp"||info.at("name")!=base)throw std::runtime_error("Look 的基础配置必须为匹配的 DCP“"+base+"”。");
        }
    }
    if(inputProfileSettings(p).at("mode")!="inherited"||p.inputProfile=="(none)")return;
    const auto filename=p.inputProfile.substr(0,5)=="file:"?p.inputProfile.substr(5):p.inputProfile;
    if((p.inputProfile.substr(0,5)=="file:"||filename.find('/')!=Glib::ustring::npos)&&!Glib::file_test(filename,Glib::FILE_TEST_IS_REGULAR))throw std::runtime_error("配方引用的输入配置文件不可用，请恢复相关文件后重试。");
    // Content-addressed imports and document copies must never hit a stale path cache.
    const std::string name=Glib::path_get_basename(filename);const auto dot=name.find_last_of('.');
    if(dot==64&&std::all_of(name.begin(),name.begin()+64,[](char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');})){
        std::ifstream input(filename.c_str(),std::ios::binary);if(!input)throw std::runtime_error("配置文件资产不可读取。");
        std::unique_ptr<GChecksum,decltype(&g_checksum_free)> checksum(g_checksum_new(G_CHECKSUM_SHA256),g_checksum_free);
        char buffer[65536];size_t count=0;
        while(input){input.read(buffer,sizeof(buffer));const auto n=input.gcount();count+=n;if(count>64*1024*1024)throw std::runtime_error("配置文件资产超过大小限制。");g_checksum_update(checksum.get(),reinterpret_cast<const guchar *>(buffer),n);}
        if(input.bad()||name.substr(0,64)!=g_checksum_get_string(checksum.get()))throw std::runtime_error("配置文件资产内容校验失败，请恢复原始资产后重试。");
    }
    auto *store=art::engine::DCPStore::getInstance();
    if(store->isValidDCPFileName(filename)&&store->getProfile(filename))return;
    if(art::engine::ICCStore::getInstance()->getProfile(p.inputProfile))return;
    throw std::runtime_error("配方引用的输入配置文件不可用，请恢复相关文件后重试。");
}
void validateExternalMasks(const pp::ProcParams &p) {
    std::function<void(const pp::Mask &)> check=[&](const pp::Mask &mask){
        if(!mask.enabled)return;
        if(mask.externalMask.enabled){
            std::shared_ptr<art::engine::array2D<float>> pixels;
            if(!art::engine::ExternalMaskManager::getInstance()->load_mask(mask.externalMask.filename,pixels,true,nullptr,&mask.externalMask))
                throw std::runtime_error("配方引用的蒙版文件缺失或损坏，请恢复文件后重试："+std::string(mask.externalMask.filename));
        }
        if(!mask.captrawBrushProgram.empty()){
            auto program=Json::parse(mask.captrawBrushProgram);std::vector<std::string> paths;
            art::engine::brushProgramAssets(program,Json::object(),true,paths);
        }
        for(const auto &child:mask.components)check(child);
    };
    const auto tool=[&](const auto &params){if(params.enabled)for(const auto &mask:params.masks)check(mask);};
    tool(p.colorcorrection);tool(p.smoothing);tool(p.textureBoost);tool(p.localContrast);
}
Json externalMaskAssets(pp::ProcParams &p,const Json &replacements,bool validate) {
    if(!replacements.is_object())throw std::runtime_error("Invalid mask asset replacements");
    Json paths=Json::array();
    std::function<void(pp::Mask &)> visit=[&](pp::Mask &mask){
        auto &name=mask.externalMask.filename;
        if(!name.empty()){
            const std::string original=name;
            if(replacements.contains(original)){
                const auto target=replacements.at(original).get<std::string>();
                if(target.empty())throw std::runtime_error("Empty mask asset replacement");
                name=target;
            }
            const std::string path=name;
            if(std::find(paths.begin(),paths.end(),path)==paths.end()){
                if(validate){
                    std::shared_ptr<art::engine::array2D<float>> pixels;
                    if(!art::engine::ExternalMaskManager::getInstance()->load_mask(name,pixels,true,nullptr,&mask.externalMask))
                        throw std::runtime_error("无法读取需要保存的蒙版资产（含停用蒙版）："+path);
                }
                paths.push_back(path);
            }
        }
        if(!mask.captrawBrushProgram.empty()){
            auto program=Json::parse(mask.captrawBrushProgram);std::vector<std::string> assets;
            art::engine::brushProgramAssets(program,replacements,validate,assets);mask.captrawBrushProgram=program.dump();
            for(const auto &path:assets)if(std::find(paths.begin(),paths.end(),path)==paths.end())paths.push_back(path);
        }
        for(auto &child:mask.components)visit(child);
    };
    // Disabled regions still belong to the document and must survive a reopen.
    for(auto &m:p.colorcorrection.masks)visit(m);
    for(auto &m:p.textureBoost.masks)visit(m);
    for(auto &m:p.smoothing.masks)visit(m);
    for(auto &m:p.localContrast.masks)visit(m);
    return paths;
}
static pp::ExternalMask rasterSettings(const Json &r,int rotation) {
    pp::ExternalMask mask;mask.enabled=true;mask.captrawRaster=true;mask.captrawRotation=rotation;
    const std::string path=r.at("path"),hash=r.at("sha256");
    if(path.empty()||hash.size()!=64||hash.find_first_not_of("0123456789abcdef")!=std::string::npos)throw std::runtime_error("Invalid raster mask identity");
    for(const char *key:{"width","height"})if(!r.at(key).is_number_integer()||r.at(key)<1||r.at(key)>65000)throw std::runtime_error("Invalid raster mask dimensions");
    mask.filename=path;mask.captrawSha256=hash;mask.captrawWidth=r.at("width");mask.captrawHeight=r.at("height");
    if(int64_t(mask.captrawWidth)*mask.captrawHeight>64000000)throw std::runtime_error("Raster mask exceeds 64 MP");
    return mask;
}
Json rasterMaskAssets(Json &a,const Json &replacements,bool validate) {
    if(!replacements.is_object())throw std::runtime_error("Invalid mask asset replacements");
    Json paths=Json::array();
    std::function<void(Json &,int)> visit=[&](Json &m,int depth){
        if(depth>8)throw std::runtime_error("Mask group nesting limit exceeded");
        if(m.contains("raster")){
            auto &r=m.at("raster");auto mask=rasterSettings(r,0);
            const std::string path=mask.filename;
            if(replacements.contains(path)){r["path"]=replacements.at(path);mask=rasterSettings(r,0);}
            if(validate){std::shared_ptr<art::engine::array2D<float>> pixels;
                if(!art::engine::ExternalMaskManager::getInstance()->load_mask(mask.filename,pixels,true,nullptr,&mask))throw std::runtime_error("栅格蒙版资产缺失、已改变或尺寸不符："+std::string(mask.filename));}
            if(std::find(paths.begin(),paths.end(),std::string(mask.filename))==paths.end())paths.push_back(std::string(mask.filename));
        }else if(m.value("type",std::string())=="raster"&&!m.contains("components"))throw std::runtime_error("Missing raster mask asset");
        if(m.contains("brush")){
            std::vector<std::string> assets;art::engine::brushProgramAssets(m.at("brush"),replacements,validate,assets);
            for(const auto &path:assets)if(std::find(paths.begin(),paths.end(),path)==paths.end())paths.push_back(path);
        }
        if(m.contains("components")){if(!m["components"].is_array()||m["components"].size()>32)throw std::runtime_error("Invalid mask components");for(auto &child:m["components"])visit(child,depth+1);}
    };
    if(!a.at("masks").is_array())throw std::runtime_error("Invalid masks");
    for(auto &mask:a["masks"])visit(mask,0);
    return paths;
}
static std::array<double,8> blackWhiteHues(const Glib::ustring &space) {
    auto *store=art::engine::ICCStore::getInstance();const auto srgb=store->workingSpaceMatrix("sRGB"),ws=store->workingSpaceMatrix(space),inv=store->workingSpaceInverseMatrix(space);
    const std::array<double,8> hues{0,1./12,1./6,1./3,.5,2./3,.75,5./6};std::array<double,8> out;
    for(int i=0;i<8;++i){
        float r,g,b;art::engine::Color::hsv2rgb01(hues[i],1,1,r,g,b);double rgb[]={r,g,b},xyz[3]={},converted[3]={};
        for(auto &v:rgb)v=art::engine::Color::igamma_srgb(float(v*65535.))/65535.;
        for(int row=0;row<3;++row)for(int col=0;col<3;++col)xyz[row]+=srgb[row][col]*rgb[col];
        for(int row=0;row<3;++row)for(int col=0;col<3;++col)converted[row]+=inv[row][col]*xyz[col];
        float y,u,v,h,s;art::engine::Color::rgb2yuv(converted[0],converted[1],converted[2],y,u,v,ws);art::engine::Color::yuv2hsl(u,v,h,s);
        out[i]=h/(2.*3.141592653589793);if(out[i]<0)out[i]+=1;
    }return out;
}
Json blackWhiteSettings(const pp::ProcParams &params) {
    const auto &p=params.blackwhite;std::vector<int> mixer(8,0);const auto positions=blackWhiteHues(params.icm.workingProfile);
    if(p.luminanceCurve.size()>1){art::engine::FlatCurve curve(p.luminanceCurve,true);for(int i=0;i<8;++i)mixer[i]=std::clamp(int(std::lround((curve.getVal(positions[i])-.5)*200.)),-100,100);}
    return {{"enabled",p.enabled},{"mixer",mixer},{"base",{{"preset",std::string(p.setting)},{"filter",std::string(p.filter)},
        {"weights",{p.mixerRed,p.mixerGreen,p.mixerBlue}},{"gamma",{p.gammaRed,p.gammaGreen,p.gammaBlue}},
        {"tint",{{"amount",p.colorCast.getBottom()},{"hue",p.colorCast.getTop()}}}}}};
}
// Owned detail regions can be rebuilt without discarding inherited ART modules.
static constexpr const char *detailPrefix="@CaptRAW-details-v1:";
template<class Module> static void removeDetailRegions(Module &module) {
    for(int i=int(module.masks.size())-1;i>=0;--i){
        const std::string name=module.masks[i].name;
        if(name.rfind(detailPrefix,0)!=0)continue;
        module.enabled=name.substr(std::char_traits<char>::length(detailPrefix),1)=="1";
        module.regions.erase(module.regions.begin()+i);module.masks.erase(module.masks.begin()+i);
    }
}
template<class Module,class Region> static void addDetailRegion(Module &module,const Region &region,const pp::Mask &mask,const std::string &id) {
    pp::Mask owned=mask;bool baseEnabled=module.enabled;
    for(const auto &m:module.masks){const std::string name=m.name;if(name.rfind(detailPrefix,0)==0){baseEnabled=name.substr(std::char_traits<char>::length(detailPrefix),1)=="1";break;}}
    // A dormant non-neutral inherited module must not activate as a side effect.
    if(!baseEnabled)for(size_t i=0;i<module.regions.size();++i){const std::string name=module.masks[i].name;if(name.rfind(detailPrefix,0)!=0&&module.regions[i]!=Region())throw std::runtime_error("配方包含停用的独立 ART 局部处理参数，无法安全合并新的细节调整。原配方未修改。");}
    owned.name=std::string(detailPrefix)+(baseEnabled?"1:":"0:")+id;
    module.regions.push_back(region);module.masks.push_back(owned);module.enabled=true;
}
// Relative local WB operates on linear working RGB, not on raw sensor samples.
// LittleCMS supplies Bradford adaptation; ART supplies the illuminant model.
static std::vector<double> localWhiteBalance(double temperature,double tint,const Glib::ustring &space) {
    if(temperature==0 && tint==0)return {};
    namespace ae=art::engine;
    const auto white=[](double t,double g){
        ae::ColorTemp c(t,g,1,"Custom");double rgb[3];c.getMultipliers(rgb[0],rgb[1],rgb[2]);
        double xyz[3]={};for(int r=0;r<3;++r)for(int k=0;k<3;++k)xyz[r]+=ae::xyz_sRGBd65[r][k]*rgb[k];
        return cmsCIEXYZ{xyz[0]/xyz[1],1,xyz[2]/xyz[1]};
    };
    const auto neutral=white(6504,1),source=white(6504*std::exp2(temperature/100.),std::exp(-tint/200.));
    auto *store=ae::ICCStore::getInstance();const auto ws=store->workingSpaceMatrix(space),inv=store->workingSpaceInverseMatrix(space);
    std::vector<double> matrix(9);
    for(int col=0;col<3;++col){
        cmsCIEXYZ input{ws[0][col],ws[1][col],ws[2][col]},d65,balanced,output;
        if(!cmsAdaptToIlluminant(&d65,cmsD50_XYZ(),&neutral,&input)||
           !cmsAdaptToIlluminant(&balanced,&source,&neutral,&d65)||
           !cmsAdaptToIlluminant(&output,&neutral,cmsD50_XYZ(),&balanced))throw std::runtime_error("Local white balance adaptation failed");
        const double xyz[]={output.X,output.Y,output.Z};
        for(int row=0;row<3;++row)for(int k=0;k<3;++k)matrix[row*3+col]+=inv[row][k]*xyz[k];
    }
    return matrix;
}
void applyAdjustments(pp::ProcParams &p, const Json &a, int width, int height, std::vector<std::string> *maskIds) {
    if(a.contains("sourceFrame"))art::engine::attachSourceFrame(p,a.at("sourceFrame"));
    if(a.contains("hdrHeadroom"))num(a,"hdrHeadroom",3,1,4);
    if(a.contains("hdrEnabled")){
        if(!a.at("hdrEnabled").is_boolean())throw std::runtime_error("Invalid HDR edit mode");
        p.toneCurve.captrawHDREditMode=a.at("hdrEnabled").get<bool>();
        p.toneCurve.whitePoint=p.toneCurve.captrawHDREditMode?std::exp2(num(a,"hdrHeadroom",3,1,4)):1.;
    }else if(p.toneCurve.captrawHDREditMode){
        p.toneCurve.captrawHDREditMode=false;p.toneCurve.whitePoint=1.;
    }
    if(a.contains("colorGrading")){
        const auto &g=a.at("colorGrading");if(!g.is_object())throw std::runtime_error("Invalid color grading settings");
        std::vector<double> values;
        for(const char *region:{"shadows","midtones","highlights","global"}){
            const auto &wheel=g.at(region);if(!wheel.is_object())throw std::runtime_error("Invalid color grading wheel");
            values.push_back(num(wheel,"hue",0,0,360));values.push_back(num(wheel,"saturation",0,0,100));values.push_back(num(wheel,"luminance",0,-100,100));
        }
        values.push_back(num(g,"blending",50,0,100));values.push_back(num(g,"balance",0,-100,100));
        bool initial=true;for(int i=0;i<14;++i)initial&=values[i]==(i==12?50:0);if(initial)values.clear();
        p.captrawGrading=std::move(values);
    }
    if(maskIds)maskIds->clear();
    if(a.contains("blackWhite")){
        const auto &bw=a.at("blackWhite");if(!bw.is_object()||!bw.at("enabled").is_boolean()||!bw.at("mixer").is_array()||bw.at("mixer").size()!=8)throw std::runtime_error("Invalid black and white settings");
        pp::BlackWhiteParams value;value.enabled=bw.at("enabled");
        if(bw.contains("base")){
            const auto &base=bw.at("base");value.setting=base.at("preset").get<std::string>();value.filter=base.at("filter").get<std::string>();
            if(base.at("weights").size()!=3||base.at("gamma").size()!=3)throw std::runtime_error("Invalid black and white conversion");
            int *weights[]={&value.mixerRed,&value.mixerGreen,&value.mixerBlue},*gamma[]={&value.gammaRed,&value.gammaGreen,&value.gammaBlue};
            for(int i=0;i<3;++i){*weights[i]=int(num({{"v",base.at("weights")[i]}},"v",33,-100,200));*gamma[i]=int(num({{"v",base.at("gamma")[i]}},"v",0,-100,100));}
            value.colorCast.setValues(int(num(base.at("tint"),"amount",0,0,100)),int(num(base.at("tint"),"hue",0,0,360)));
        }
        const auto positions=blackWhiteHues(p.icm.workingProfile);bool changed=false;std::vector<std::pair<double,double>> nodes;
        std::vector<double> curve{double(art::utils::FCT_MinMaxCPoints)};
        for(int i=0;i<8;++i){if(!bw.at("mixer")[i].is_number_integer())throw std::runtime_error("Black and white mixer requires integer values");const double v=num({{"v",bw.at("mixer")[i]}},"v",0,-100,100);changed|=v!=0;nodes.push_back({positions[i],.5+v/200.});}
        std::sort(nodes.begin(),nodes.end());for(const auto &node:nodes)curve.insert(curve.end(),{node.first,node.second,0,0});
        if(changed)value.luminanceCurve=curve;
        p.blackwhite=value;
    }
    if(a.contains("colorProfile"))applyInputProfile(p.icm,a.at("colorProfile"));
    p.exposure.enabled=true;
    p.exposure.expcomp=num(a,"exposure",0,-5,5);
    p.exposure.hrmode=pp::ExposureParams::HR_COLORSOFT;
    p.wb.enabled=true; p.wb.method=pp::WBParams::CUSTOM_TEMP;
    // Validate CRS coordinates here; core.cc resolves them with this image's profile.
    num(a,"temperature",6500,1500,50000);num(a,"tint",0,-150,150);
    p.wb.temperature=6500;p.wb.green=1;p.wb.equal=1;
    p.wb.captrawRelativeMatrix.clear();
    if(a.contains("wbMultipliers")&&!a["wbMultipliers"].is_null()){
        const auto &m=a["wbMultipliers"];if(!m.is_array()||m.size()!=3)throw std::runtime_error("Invalid white balance multipliers");
        for(int i=0;i<3;++i){const double v=m[i].get<double>();if(!std::isfinite(v)||v<=0||v>100)throw std::runtime_error("Invalid white balance multiplier");p.wb.mult[i]=v;}
        p.wb.method=pp::WBParams::CUSTOM_MULT;
    }
    const bool relative=a.contains("incrementalTemperature")||a.contains("incrementalTint")||a.contains("relativeWBModel");
    if(relative){
        if(a.value("relativeWBModel",std::string("art-ctl-v1"))!="art-ctl-v1")throw std::runtime_error("Unsupported relative white balance model");
        const double t=num(a,"incrementalTemperature",0,-100,100),g=num(a,"incrementalTint",0,-100,100);
        if(std::round(t)!=t||std::round(g)!=g)throw std::runtime_error("Relative white balance requires integer offsets");
        if(a.contains("wbMultipliers")&&!a.at("wbMultipliers").is_null())throw std::runtime_error("Relative white balance cannot contain camera coefficients");
        p.wb.enabled=false;p.wb.method=pp::WBParams::CUSTOM_TEMP;p.wb.mult={1,1,1};
        if(t!=0||g!=0){const auto matrix=relativeWhiteBalanceMatrix(t,g,p.icm.workingProfile);p.wb.captrawRelativeMatrix.assign(matrix.begin(),matrix.end());}
    }
    p.toneCurve.captrawParametric=a.contains("parametricCurve")?parametricCurve(a.at("parametricCurve")):std::vector<double>{double(art::utils::DCT_Linear)};
    p.toneCurve.enabled=true; p.toneCurve.contrast=int(num(a,"contrast",0,-100,100));
    p.toneCurve.curveMode=pp::ToneCurveParams::TcMode::STD;
    p.toneCurve.captrawCurveRefineModel.clear();p.toneCurve.captrawCurveRefineAmount=0.;
    if(a.contains("curveRefineModel")||a.contains("curveRefineSaturation")){
        if(a.value("curveRefineModel",std::string())!="weighted-std-v1"||!a.contains("curveRefineSaturation"))throw std::runtime_error("Invalid curve refinement model or amount");
        const double amount=num(a,"curveRefineSaturation",0,0,100);
        if(std::round(amount)!=amount)throw std::runtime_error("Curve refinement amount requires an integer");
        p.toneCurve.captrawCurveRefineModel="weighted-std-v1";p.toneCurve.captrawCurveRefineAmount=amount;
    }
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
    if(a.contains("sharpenDetail"))p.sharpening.contrast=num(a,"sharpenDetail",25,0,100)*.8;
    if(a.contains("sharpenEdgeMask")){
        const double mask=num(a,"sharpenEdgeMask",0,0,100);
        p.sharpening.edgesonly=mask>0;p.sharpening.edges_radius=1.9;
        p.sharpening.edges_tolerance=int(std::lround(10.+9990.*std::sqrt(mask/100.)));
    }
    p.denoise.enabled=num(a,"luminanceNoise",0,0,100)>0||num(a,"colorNoise",0,0,100)>0;
    p.denoise.luminance=num(a,"luminanceNoise",0,0,100);p.denoise.chrominance=num(a,"colorNoise",0,0,100);
    p.denoise.chrominanceMethod=pp::DenoiseParams::ChrominanceMethod::MANUAL;
    if(a.contains("luminanceNoiseDetail"))p.denoise.luminanceDetail=num(a,"luminanceNoiseDetail",50,0,100);
    if(a.contains("luminanceNoiseContrast"))p.denoise.luminanceDetailThreshold=int(num(a,"luminanceNoiseContrast",0,0,100));
    if(a.contains("colorNoiseDetail")||a.contains("colorNoiseSmoothness")){
        const double detail=num(a,"colorNoiseDetail",50,0,100),smoothness=num(a,"colorNoiseSmoothness",50,0,100);
        p.denoise.guidedChromaRadius=std::clamp(int(std::lround((100.-detail+smoothness)*.1)),0,20);
        p.denoise.smoothingEnabled=p.denoise.guidedChromaRadius>0;
    }
    const double dehaze=num(a,"dehaze",0,-100,100);p.dehaze.enabled=dehaze!=0;
    p.dehaze.strength={double(art::utils::FCT_MinMaxCPoints),0,.5+dehaze/200,0,0,1,.5+dehaze/200,0,0};
    const double vignette=num(a,"vignette",0,-100,100);p.pcvignette.enabled=vignette!=0;p.pcvignette.strength=-vignette/100;
    if(!a.contains("postCropVignetteStyle")&&a.contains("postCropVignetteFeather"))p.pcvignette.feather=int(num(a,"postCropVignetteFeather",50,0,100));
    if(!a.contains("postCropVignetteStyle")&&a.contains("postCropVignetteRoundness"))p.pcvignette.roundness=int(num(a,"postCropVignetteRoundness",0,-100,100));
    p.grain.enabled=num(a,"grain",0,0,100)>0;p.grain.strength=int(num(a,"grain",0,0,100));
    // Explicit model selection: absent fields keep the legacy ART algorithms.
    p.captrawEffects.clear();
    const bool modernGrain=a.contains("grainModel"),modernVignette=a.contains("postCropVignetteStyle");
    if((a.contains("grainSize")||a.contains("grainRoughness"))&&!modernGrain)
        throw std::runtime_error("Grain size/roughness requires explicit procedural-v1 model");
    if((a.contains("postCropVignetteMidpoint")||a.contains("postCropVignetteHighlights"))&&!modernVignette)
        throw std::runtime_error("Vignette midpoint/highlights requires explicit style selection");
    if(modernGrain||modernVignette){
        if(modernGrain&&a.at("grainModel")!="procedural-v1")throw std::runtime_error("Unsupported grain model");
        const std::string style=a.value("postCropVignetteStyle",std::string("highlight-priority"));
        const int mode=style=="highlight-priority"?1:style=="color-priority"?2:style=="paint-overlay"?3:0;
        if(!mode)throw std::runtime_error("Invalid post-crop vignette style");
        p.captrawEffects={modernGrain?1.:0.,num(a,"grain",0,0,100),num(a,"grainSize",25,0,100),num(a,"grainRoughness",50,0,100),
            modernVignette?double(mode):0.,vignette,num(a,"postCropVignetteMidpoint",50,0,100),
            num(a,"postCropVignetteRoundness",0,-100,100),num(a,"postCropVignetteFeather",50,0,100),num(a,"postCropVignetteHighlights",0,0,100)};
        if(modernGrain)p.grain.enabled=false;
        if(modernVignette)p.pcvignette.enabled=false;
    }
    const std::string glowStyle=a.value("glowStyle",std::string("diffusion"));
    const int glowMode=glowStyle=="diffusion"?0:glowStyle=="bloom"?1:glowStyle=="halation"?2:-1;
    if(glowMode<0)throw std::runtime_error("Invalid glow style");
    p.captrawGlow={num(a,"glow",0,0,100),double(glowMode),num(a,"glowRange",50,0,100),num(a,"glowSpread",50,0,100),num(a,"glowWarmth",0,-100,100)};
    p.lensProf.lcMode=a.value("lensCorrections",false)?pp::LensProfParams::LcMode::LENSFUNAUTOMATCH:pp::LensProfParams::LcMode::NONE;
    p.lensProf.useDist=true;p.lensProf.useCA=true;p.lensProf.useVign=true;
    p.lensProf.lfCameraMake="";p.lensProf.lfCameraModel="";p.lensProf.lfLens="";
    if(a.contains("lensProfile")){
        const auto &l=a.at("lensProfile");const std::string mode=l.at("mode");
        if(mode!="auto"&&mode!="manual")throw std::runtime_error("Invalid lens profile mode");
        p.lensProf.useDist=l.at("distortion").get<bool>();p.lensProf.useVign=l.at("vignette").get<bool>();p.lensProf.useCA=l.at("ca").get<bool>();
        const std::string make=l.at("cameraMake"),model=l.at("cameraModel"),lens=l.at("lens");
        if(mode=="manual"){
            const auto *db=art::engine::LFDatabase::getInstance();
            const auto camera=db->findCamera(make,model);
            const auto found=db->findLens(art::engine::LFCamera(),lens);
            if((!make.empty()||!model.empty())&&(!camera||camera.getMake()!=make||camera.getModel()!=model))throw std::runtime_error("镜头配置中的相机不在随包数据库中，请重新选择。");
            if(!lens.empty()&&(!found||found.getLens()!=lens))throw std::runtime_error("镜头配置不在随包数据库中，请重新选择。");
            p.lensProf.lfCameraMake=make;p.lensProf.lfCameraModel=model;p.lensProf.lfLens=lens;
            if(a.value("lensCorrections",false))p.lensProf.lcMode=pp::LensProfParams::LcMode::LENSFUNMANUAL;
        }
    }
    if(a.contains("lensManualDistortion")){
        const double amount=num(a,"lensManualDistortion",0,-100,100);
        p.distortion.enabled=amount!=0;p.distortion.amount=amount/200.;p.distortion.autocompute=false;
    }
    if(a.contains("lensVignette")){
        const int amount=int(num(a,"lensVignette",0,-100,100));
        p.vignetting.enabled=amount!=0;p.vignetting.amount=amount;
    }
    if(a.contains("defringe")){
        const auto &d=a.at("defringe");if(!d.is_object())throw std::runtime_error("Invalid defringe settings");
        const double purpleAmount=num(d,"purpleAmount",0,0,100),purpleLow=num(d,"purpleHueLo",30,0,100),purpleHigh=num(d,"purpleHueHi",70,0,100);
        const double greenAmount=num(d,"greenAmount",0,0,100),greenLow=num(d,"greenHueLo",40,0,100),greenHigh=num(d,"greenHueHi",60,0,100);
        if(purpleLow>=purpleHigh||greenLow>=greenHigh)throw std::runtime_error("Invalid defringe hue range");
        std::vector<double> curve{double(art::utils::FCT_MinMaxCPoints)};
        for(int i=0;i<=100;++i){
            const double x=i/100.,purpleCenter=(purpleLow+purpleHigh)/200.,greenCenter=(greenLow+greenHigh)/200.;
            double value=.5;
            if(purpleAmount>0&&x>=purpleLow/100.&&x<=purpleHigh/100.){
                const double half=(purpleHigh-purpleLow)/200.,factor=1.-std::abs(x-purpleCenter)/half;
                value=std::min(value,.5-purpleAmount/200.*factor);
            }
            if(greenAmount>0&&x>=greenLow/100.&&x<=greenHigh/100.){
                const double half=(greenHigh-greenLow)/200.,factor=1.-std::abs(x-greenCenter)/half;
                value=std::min(value,.5-greenAmount/200.*factor);
            }
            curve.insert(curve.end(),{x,value,0,0});
        }
        p.defringe.enabled=purpleAmount>0||greenAmount>0;p.defringe.radius=2;p.defringe.threshold=13;p.defringe.huecurve=std::move(curve);
    }
    p.hsl.enabled=a.contains("hsl");
    if(p.hsl.enabled){const std::array<double,8> positions{0,1./12,1./6,1./3,.5,2./3,.75,5./6};
        const auto hsl=[&](const char *name){const auto &values=a.at("hsl").at(name);if(values.size()!=8)throw std::runtime_error("Invalid HSL bands");std::vector<double> out{double(art::utils::FCT_MinMaxCPoints)};
            for(int i=0;i<8;i++){const double v=values[i];if(!std::isfinite(v)||v< -100||v>100)throw std::runtime_error("Invalid HSL value");out.insert(out.end(),{positions[i],.5+v/200,0,0});}return out;};
        p.hsl.hCurve=hsl("hue");p.hsl.sCurve=hsl("saturation");p.hsl.lCurve=hsl("luminance");}
    if(a.contains("calibration")){
        const auto &c=a.at("calibration");if(!c.is_object())throw std::runtime_error("Invalid calibration settings");
        const auto value=[&](const char *key){const double number=num(c,key,0,-100,100);const int v=int(number);if(v!=number)throw std::runtime_error("Calibration values must be integers");return v;};
        p.chmixer.captrawShadowTint=value("shadowTint");
        p.chmixer.mode=pp::ChannelMixerParams::PRIMARIES_CHROMA;
        p.chmixer.hue_tweak[0]=value("redHue");p.chmixer.sat_tweak[0]=value("redSaturation");
        p.chmixer.hue_tweak[1]=value("greenHue");p.chmixer.sat_tweak[1]=value("greenSaturation");
        p.chmixer.hue_tweak[2]=value("blueHue");p.chmixer.sat_tweak[2]=value("blueSaturation");
        p.chmixer.enabled=p.chmixer.hue_tweak[0]!=0||p.chmixer.hue_tweak[1]!=0||p.chmixer.hue_tweak[2]!=0||
            p.chmixer.sat_tweak[0]!=0||p.chmixer.sat_tweak[1]!=0||p.chmixer.sat_tweak[2]!=0;
    }
    int rotation=a.value("rotation",0);
    if(rotation!=0 && rotation!=90 && rotation!=180 && rotation!=270)throw std::runtime_error("Invalid rotation");
    const bool flipCoordinates=a.contains("flipHorizontal")||a.contains("flipVertical");
    if((flipCoordinates||p.coarse.rotate!=rotation)&&!p.rotate.captrawSourceBasisSet){
        p.rotate.captrawSourceBasisSet=true;
        p.rotate.captrawSourceBasisHorizontal=p.coarse.rotate%180?p.coarse.vflip:p.coarse.hflip;
        p.rotate.captrawSourceBasisVertical=p.coarse.rotate%180?p.coarse.hflip:p.coarse.vflip;
    }
    p.coarse.rotate=rotation;
    if(a.contains("flipHorizontal"))p.coarse.hflip=a.at("flipHorizontal").get<bool>();
    if(a.contains("flipVertical"))p.coarse.vflip=a.at("flipVertical").get<bool>();
    if(a.contains("fineRotation")){
        const double angle=num(a,"fineRotation",0,-45,45);
        if(angle!=(p.rotate.enabled?p.rotate.degree:0)){p.rotate.degree=angle;p.rotate.enabled=angle!=0;}
    }
    if(a.contains("perspective")){
        const auto &v=a.at("perspective");auto &target=p.perspective;
        target.enabled=v.at("enabled").get<bool>();
        target.horizontal=num(v,"horizontal",target.horizontal,-200,200);
        target.vertical=num(v,"vertical",target.vertical,-200,200);
        target.angle=num(v,"angle",target.angle,-20,20);
        target.shear=num(v,"shear",target.shear,-50,50);
        target.flength=num(v,"focalLength",target.flength,0,1200);
        target.cropfactor=num(v,"cropFactor",target.cropfactor,.1,10);
        target.captrawManual=v.contains("manualModel");
        target.captrawSignedFraming=target.captrawManual&&v.at("manualModel")=="signed-framing-v1";
        if(target.captrawManual&&!target.captrawSignedFraming&&v.at("manualModel")!="art-perspective-v1")throw std::runtime_error("Unsupported manual perspective model");
        target.aspect=num(v,"aspect",target.captrawSignedFraming?0:target.aspect,target.captrawSignedFraming?-100:.5,target.captrawSignedFraming?100:2);
        if(!target.captrawManual)for(const char *key:{"scale","offsetX","offsetY","constrainCrop"})
            if(v.contains(key))throw std::runtime_error("Manual perspective parameters require a model");
        target.captrawScale=num(v,"scale",1,target.captrawSignedFraming?.5:.1,target.captrawSignedFraming?1.5:4);
        target.captrawOffsetX=num(v,"offsetX",0,target.captrawSignedFraming?-100:-.72,target.captrawSignedFraming?100:.72);target.captrawOffsetY=num(v,"offsetY",0,target.captrawSignedFraming?-100:-.72,target.captrawSignedFraming?100:.72);
        target.captrawConstrain=v.value("constrainCrop",false);
    }
    if(a.contains("perspectiveGuides")){
        const auto &guides=a.at("perspectiveGuides");
        if(!guides.is_array()||guides.size()>4)throw std::runtime_error("Invalid perspective guides");
        for(const auto &guide:guides){
            const std::string axis=guide.at("axis");
            if(axis!="horizontal"&&axis!="vertical")throw std::runtime_error("Invalid perspective guide axis");
            for(const char *end:{"start","end"})for(const char *key:{"x","y"}){
                const auto &v=guide.at(end).at(key);
                if(!v.is_number()||!std::isfinite(v.get<double>()))throw std::runtime_error("Invalid perspective guide point");
            }
        }
    }
    const auto rotate=[&](double x,double y)->std::pair<double,double>{switch(rotation){case 90:return {1-y,x};case 180:return {1-x,1-y};case 270:return {y,1-x};default:return {x,y};}};
    if(rotation==90 || rotation==270)std::swap(width,height);
    if(a.contains("spots"))applyRepairs(p,a.at("spots"),width,height,rotation);
    // Repair recipes keep unflipped source anchors; ART applies spots after
    // getImage() has already mirrored the coarse source canvas.
    const auto sourceBasis=art::engine::geometrySourceBasis(p);
    for(auto &entry:p.spot.entries){
        const auto mirror=[&](double &x,double &y){if(p.coarse.hflip!=sourceBasis.first)x=width-1-x;if(p.coarse.vflip!=sourceBasis.second)y=height-1-y;};
        double sx=entry.sourcePos.x,sy=entry.sourcePos.y,tx=entry.targetPos.x,ty=entry.targetPos.y;
        mirror(sx,sy);mirror(tx,ty);entry.sourcePos.set(sx,sy);entry.targetPos.set(tx,ty);
        for(size_t i=0;i<entry.repairPath.size();i+=2)mirror(entry.repairPath[i],entry.repairPath[i+1]);
    }
    if(a.contains("cropAspect")&&!a.at("cropAspect").is_null())num(a,"cropAspect",1,1e-6,1e6);
    p.crop.enabled=!a.at("crop").is_null();
    if(p.crop.enabled) {
        const auto &c=a.at("crop");
        double x=num(c,"x",0,0,1),y=num(c,"y",0,0,1);
        double w=num(c,"width",1,0.001,1),h=num(c,"height",1,0.001,1);
        if(x+w>1.00001 || y+h>1.00001)throw std::runtime_error("Crop extends outside image");
        const auto orient=[&](double x,double y){auto q=rotate(x,y);if(p.coarse.hflip!=sourceBasis.first)q.first=1-q.first;if(p.coarse.vflip!=sourceBasis.second)q.second=1-q.second;return q;};
        const auto first=orient(x,y),second=orient(x+w,y+h);
        p.crop.x=std::round(std::min(first.first,second.first)*width);p.crop.y=std::round(std::min(first.second,second.second)*height);
        p.crop.w=std::max(1,int(std::round(std::abs(second.first-first.first)*width)));p.crop.h=std::max(1,int(std::round(std::abs(second.second-first.second)*height)));
    }
    removeDetailRegions(p.textureBoost);removeDetailRegions(p.smoothing);
    // Whole-image detail precedes owned local regions; inherited ART settings stay intact.
    const double texture=num(a,"texture",0,-100,100),clarity=num(a,"clarity",0,-100,100);
    if(texture!=0){pp::TextureBoostParams::Region r;r.strength=texture/50.;addDetailRegion(p.textureBoost,r,pp::Mask(),"global:texture");}
    if(clarity!=0){pp::TextureBoostParams::Region r;r.strength=clarity/50.;r.detailThreshold=4.;addDetailRegion(p.textureBoost,r,pp::Mask(),"global:clarity");}
    p.colorcorrection.regions.clear();p.colorcorrection.masks.clear();p.colorcorrection.showMask=-1;
    std::function<pp::Mask(const Json &,int)> makeMask;
    makeMask=[&](const Json &m,int depth)->pp::Mask{
        pp::Mask mask; mask.enabled=m.value("enabled",true);mask.inverted=m.value("inverted",false);
        mask.name=m.value("name",std::string("Mask"));
        if(depth>8)throw std::runtime_error("Mask group nesting limit exceeded");
        if(m.contains("linearGradientModel")&&(m.at("linearGradientModel")!="full-zero-v1"||m.value("type",std::string())!="linear"||m.contains("components")||m.value("feather",0.)!=0.))
            throw std::runtime_error("Invalid Full/Zero gradient model");
        if(m.contains("components")){
            if(!m["components"].is_array()||m["components"].size()>32)throw std::runtime_error("Invalid mask components");
            for(const auto &child:m["components"]){
                if(!child.value("enabled",true)||!child.value("initialized",true)||(child.value("type",std::string())=="brush"&&child.at("points").empty()&&(!child.contains("brush")||child.at("brush").at("strokes").empty())))continue;
                auto component=makeMask(child,depth+1);if(!component.enabled)continue;
                const auto operation=child.value("operation",std::string("add"));
                if(operation!="add"&&operation!="subtract"&&operation!="intersect")throw std::runtime_error("Invalid mask operation");
                mask.componentModes.push_back(operation=="subtract"?1:operation=="intersect"?2:0);
                mask.components.push_back(component);
            }
            mask.enabled=!mask.components.empty();return mask;
        }
        if(m.contains("referenceAngle")){
            mask.captrawReferenceAngle=num(m,"referenceAngle",0,-45,45);
            mask.captrawReferenceAngleSet=true;
        }
        if(m.contains("geometryReference"))mask.captrawGeometryReference=maskGeometryReferenceData(m.at("geometryReference"));
        mask.captrawMirrorCoordinates=flipCoordinates||p.rotate.captrawSourceBasisSet;
        const double feather=num(m,"feather",30,0,100);
        std::string type=m.value("type",std::string("brush"));
        if(type=="raster") {
            mask.externalMask=rasterSettings(m.at("raster"),rotation);
            mask.externalMask.feather=feather;
        } else if(type=="color") {
            const auto &samples=m.at("colorSamples");
            if(!samples.is_array()||samples.size()>5)throw std::runtime_error("Color range supports up to five samples");
            const double refine=num(m,"colorRefine",50,0,100);
            for(const auto &sample:samples){
                for(const char *key:{"l","c","h"})if(!sample.at(key).is_number())throw std::runtime_error("Invalid color sample");
                if(!sample.contains("point"))throw std::runtime_error("Missing color sample position");
                for(const char *key:{"point","end"})if(sample.contains(key)){
                    const auto &point=sample.at(key);
                    if(!point.at("x").is_number()||!point.at("y").is_number())throw std::runtime_error("Invalid color sample position");
                    num(point,"x",0,0,1);num(point,"y",0,0,1);
                }
                // UI anchor only: colors remain fixed when geometry changes.
                if(sample.contains("sourcePoint")){
                    const auto &point=sample.at("sourcePoint");
                    if(!point.is_object()||!point.contains("x")||!point.contains("y")||!point.at("x").is_number()||!point.at("y").is_number())
                        throw std::runtime_error("Invalid color sample source position");
                    num(point,"x",0,-1e7,1e7);num(point,"y",0,-1e7,1e7);
                }
                pp::Mask part;part.parametricMask.enabled=true;part.parametricMask.blur=-10;
                auto &d=part.deltaEMask;d.enabled=true;
                d.L=num(sample,"l",0,-1000,1000)/100.;d.C=num(sample,"c",0,0,1000)/100.;d.H=num(sample,"h",0,0,360);
                d.range=.25+refine*.195;d.decay=50;d.weight_L=50;d.weight_C=75;d.weight_H=100;
                mask.components.push_back(part);mask.componentModes.push_back(0);
            }
            mask.enabled=!samples.empty();
        } else if(type=="luminance") {
            const auto &range=m.at("luminanceRange");
            if(!range.is_array()||range.size()!=4)throw std::runtime_error("Invalid luminance range");
            std::array<double,4> v;
            for(int i=0;i<4;++i)v[i]=num({{"value",range[i]}},"value",0,0,100)/100.;
            if(v[0]>v[1]||v[1]>=v[2]||v[2]>v[3])throw std::runtime_error("Luminance range must have ordered falloffs and distinct limits");
            auto &pm=mask.parametricMask;pm.enabled=true;pm.blur=-10;pm.lightnessDetail=0;
            pm.lightness={double(art::utils::FCT_MinMaxCPoints)};
            const auto point=[&](double x,double y){
                if(pm.lightness.size()>1&&pm.lightness[pm.lightness.size()-4]==x)return;
                pm.lightness.insert(pm.lightness.end(),{x,y,.35,.35});
            };
            point(0,v[1]==0?1:0);
            // FlatCurve requires distinct X coordinates. Equal markers form a near-step
            // across at most 0.0001 L*, retaining black/white endpoints without wrapping.
            if(v[1]>0){point(v[0]==v[1]?std::max(0.,v[1]-1e-6):v[0],0);point(v[1],1);}
            point(v[2],1);
            if(v[2]<1)point(v[2]==v[3]?std::min(1.,v[2]+1e-6):v[3],0);
            point(1,v[2]==1?1:0);
        } else if(type=="brush") {
            if(m.contains("brush")){
                art::engine::validateBrushProgram(m.at("brush"));
                mask.captrawBrushProgram=m.at("brush").dump();mask.captrawBrushRotation=rotation;
            }
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
                double authorWidth=width,authorHeight=height;
                if(m.contains("geometryReference")&&m.at("geometryReference").at("version")>=2){
                    const auto reference=art::engine::geometryReferenceParams(mask.captrawGeometryReference);
                    const auto frame=art::engine::checkedSourceFrame(Json::parse(reference.commonTrans.captrawSourceFrame));
                    authorWidth=frame.at(rotation%180?"height":"width");authorHeight=frame.at(rotation%180?"width":"height");
                }
                auto shape=std::make_unique<pp::AreaMask::Gradient>();
                shape->x=(sx+ex-1)*100;shape->y=(sy+ey-1)*100;
                shape->angle=std::atan2((ex-sx)*authorWidth,(ey-sy)*authorHeight)*180.0/3.141592653589793;
                shape->strengthStart=100;shape->strengthEnd=0;
                if(m.contains("linearGradientModel")){
                    mask.areaMask.feather=0;
                    shape->captrawFullZero={sx,sy,ex,ey};
                    shape->feather=std::hypot((ex-sx)*authorWidth,(ey-sy)*authorHeight)/std::hypot(authorWidth,authorHeight)*100.0;
                }else{
                shape->feather=std::max(.01,std::hypot((ex-sx)*authorWidth,(ey-sy)*authorHeight)/std::hypot(authorWidth,authorHeight)*100.0*(.5+feather/100.0));
                }
                mask.areaMask.shapes.push_back(std::move(shape));
            } else throw std::runtime_error("Unknown mask type");
        }
        return mask;
    };
    const auto hasRange=[](const auto &self,const pp::Mask &mask)->bool{
        if(mask.parametricMask.enabled||mask.deltaEMask.enabled)return true;
        for(const auto &child:mask.components)if(self(self,child))return true;
        return false;
    };
    for(const auto &m:a.at("masks")){
        if(!m.value("enabled",true)||!m.value("initialized",true)||(m.value("type",std::string())=="brush"&&!m.contains("components")&&m.at("points").empty()&&(!m.contains("brush")||m.at("brush").at("strokes").empty())))continue;
        auto mask=makeMask(m,0);if(!mask.enabled)continue;
        const bool rangeMask=hasRange(hasRange,mask);
        if(rangeMask)mask.name="@CaptRAW-range:"+std::to_string(p.colorcorrection.regions.size());
        pp::ColorCorrectionParams::Region region;
        region.mode=pp::ColorCorrectionParams::Mode::RGB;
        if(m.contains("whiteBalance")){
            const auto &wb=m.at("whiteBalance");if(!wb.is_object())throw std::runtime_error("Invalid local white balance");
            region.whiteBalanceMatrix=localWhiteBalance(num(wb,"temperature",0,-100,100),num(wb,"tint",0,-100,100),p.icm.workingProfile);
        }
        if(m.contains("tone")){
            const auto &t=m.at("tone");if(!t.is_object())throw std::runtime_error("Invalid local tone settings");
            region.toneBands={int(num(t,"blacks",0,-100,100)),int(num(t,"shadows",0,-100,100)),0,int(num(t,"highlights",0,-100,100)),int(num(t,"whites",0,-100,100))};
            if(std::all_of(region.toneBands.begin(),region.toneBands.end(),[](int v){return v==0;}))region.toneBands.clear();
        }
        const double gain=std::exp2(num(m,"brightness",0,-4,4));
        const double contrast=std::exp2(num(m,"contrast",0,-100,100)/100.0);
        for(int i=0;i<3;++i){region.slope[i]=gain;region.power[i]=1.0/contrast;region.pivot[i]=0.18;}
        region.outSaturation=num(m,"saturation",0,-100,100);
        const double localGlow=m.contains("details")?num(m.at("details"),"glow",0,-100,100):0;
        if(localGlow!=0){
            if(!rangeMask)mask.name="@CaptRAW-glow:"+std::to_string(p.colorcorrection.regions.size());
            p.captrawGlow.push_back(double(p.colorcorrection.regions.size()));p.captrawGlow.push_back(localGlow);
        }
        p.colorcorrection.regions.push_back(region);p.colorcorrection.masks.push_back(mask);
        if(maskIds)maskIds->push_back(m.value("id",std::string()));
        if(m.contains("details")){
            const auto &d=m.at("details");if(!d.is_object())throw std::runtime_error("Invalid local detail settings");
            const auto id=m.at("id").get<std::string>();
            const double hue=num(d,"hue",0,-180,180),texture=num(d,"texture",0,-100,100),clarity=num(d,"clarity",0,-100,100),noise=num(d,"noise",0,0,100);
            const double noiseDetail=num(d,"noiseDetail",50,0,100);
            if(hue!=0){pp::ColorCorrectionParams::Region color;color.mode=pp::ColorCorrectionParams::Mode::YUV;color.hueshift=hue;p.colorcorrection.regions.push_back(color);p.colorcorrection.masks.push_back(mask);if(maskIds)maskIds->push_back(id);}
            // Later modules must reuse the pre-adjustment range, not select again
            // from pixels already changed by color correction or other mask groups.
            pp::Mask detailMask=mask;
            if(rangeMask){detailMask=pp::Mask();detailMask.linkedMask.enabled=true;detailMask.linkedMask.toolname="colorcorrection";detailMask.linkedMask.name=mask.name;}
            if(texture!=0){pp::TextureBoostParams::Region r;r.strength=texture/50.;addDetailRegion(p.textureBoost,r,detailMask,id+":texture");}
            if(clarity!=0){pp::TextureBoostParams::Region r;r.strength=clarity/50.;r.detailThreshold=4.;addDetailRegion(p.textureBoost,r,detailMask,id+":clarity");}
            if(noise!=0){pp::SmoothingParams::Region r;r.mode=pp::SmoothingParams::Region::Mode::NLMEANS;r.channel=pp::SmoothingParams::Region::Channel::LUMINANCE;r.nlstrength=int(noise);r.nldetail=int(noiseDetail);addDetailRegion(p.smoothing,r,detailMask,id+":noise");}
        }
    }
    if(p.captrawGlow[0]==0&&p.captrawGlow.size()==5)p.captrawGlow.clear();
    p.colorcorrection.enabled=!p.colorcorrection.regions.empty();
    if(p.toneCurve.captrawHDREditMode){
        if(!p.toneCurve.hasWhitePoint())throw std::runtime_error("当前旧式或第二色调曲线不能应用 HDR 白点，请关闭 HDR 或复位对应曲线。");
        for(const auto *channel:{&p.rgbCurves.rcurve,&p.rgbCurves.gcurve,&p.rgbCurves.bcurve}){
            if(!channel->empty()&&!art::engine::DiagonalCurve(*channel).isIdentity())throw std::runtime_error("RGB 单通道曲线尚未支持 HDR，请关闭 HDR 后复位单通道曲线再重试。");
        }
        if(p.blackwhite.enabled&&(p.blackwhite.gammaRed||p.blackwhite.gammaGreen||p.blackwhite.gammaBlue||p.blackwhite.colorCast.getBottom()))throw std::runtime_error("当前黑白 gamma 或染色尚未支持 HDR，请关闭 HDR 或复位黑白配置。");
    }
    p.icm.outputProfile="RTv4_sRGB";p.icm.outputIntent=art::engine::RI_RELATIVE;p.icm.outputBPC=true;
    art::engine::validateManualPerspective(p.perspective);
    validateInputProfile(p.icm);
    validateExternalMasks(p);
}
std::string profileText(const pp::ProcParams &p) {
    pp::KeyFile k;if(p.save(nullptr,k)!=0)throw std::runtime_error("Cannot serialize ART profile");return k.to_data();
}
void loadProfile(pp::ProcParams &p,const std::string &text) {
    if(text.empty())return;
    pp::KeyFile k;
    if(!k.load_from_data(text) || p.load(nullptr,k)!=0)throw std::runtime_error("Invalid ART profile");
    if(p.rotate.captrawMaskCoordinates){
        const double current=p.rotate.enabled?p.rotate.degree:0,reference=p.rotate.captrawMaskReferenceDegree;
        if(!std::isfinite(current)||!std::isfinite(reference)||std::abs(current)>45||std::abs(reference)>45)
            throw std::runtime_error("Invalid mask reference rotation");
    }
}
}
