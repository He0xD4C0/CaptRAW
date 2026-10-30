// Adapted from RAWmakase enhanced.rs, look_settings.rs and color/curve.rs.
// Copyright (c) 2026 RAWmakase contributors. MIT: native/config/enhanced-profile.LICENSE.
#include "enhanced-profile.h"
#include <algorithm>
#include <cmath>
#include <cctype>
#include <map>
#include <set>
#include <stdexcept>
namespace captraw::enhanced {
namespace {
using Json=nlohmann::json;
void require(bool ok,const std::string &message){if(!ok)throw std::runtime_error(message);}
bool hex(const std::string &v){return v.size()==32&&std::all_of(v.begin(),v.end(),[](unsigned char c){return std::isxdigit(c);});}
std::string lower(std::string v){std::transform(v.begin(),v.end(),v.begin(),[](unsigned char c){return std::tolower(c);});return v;}
float number(const Json &p,const std::string &key,float fallback,float lo,float hi){
    if(!p.contains(key)||p.at(key)=="")return fallback;
    const std::string value=p.at(key).get<std::string>();size_t used=0;float out;
    try{out=std::stof(value,&used);}catch(...){throw std::runtime_error("Look 数值无效："+key);}
    require(used==value.size()&&std::isfinite(out)&&out>=lo&&out<=hi,"Look 数值超出范围："+key);return out;
}
bool boolean(const Json &p,const std::string &key,bool fallback){if(!p.contains(key))return fallback;const auto v=lower(p.at(key).get<std::string>());if(v.empty())return fallback;require(v=="true"||v=="false","Look 布尔值无效："+key);return v=="true";}
float encode(float v){return v<=0.0031308f?12.92f*v:1.055f*std::pow(std::max(0.f,v),1.f/2.4f)-.055f;}
float decode(float v){return v<=.04045f?v/12.92f:std::pow((v+.055f)/1.055f,2.4f);}
const std::array<std::string,8> bands{"Red","Orange","Yellow","Green","Aqua","Blue","Purple","Magenta"};
const std::set<std::string> metadata{"Version","ProcessVersion","CameraProfile","LookTable","RGBTable","RGBTableAmount","RequiresRGBTables","ConvertToGrayscale"};
std::map<std::string,std::array<float,3>> ranges(){
    std::map<std::string,std::array<float,3>> out;
    for(auto key:{"Highlights2012","Shadows2012","Whites2012","Blacks2012","Clarity2012","Contrast2012","Saturation","ParametricShadows","ParametricDarks","ParametricLights","ParametricHighlights","SplitToningBalance","PostCropVignetteAmount","PostCropVignetteRoundness"})out[key]={0,-100,100};
    out["Exposure2012"]={0,-5,5};
    for(auto key:{"SplitToningShadowHue","SplitToningHighlightHue"})out[key]={0,0,360};
    for(auto key:{"SplitToningShadowSaturation","SplitToningHighlightSaturation","PostCropVignetteHighlightContrast"})out[key]={0,0,100};
    for(auto key:{"PostCropVignetteMidpoint","PostCropVignetteFeather"})out[key]={50,0,100};
    out["PostCropVignetteStyle"]={1,0,3};
    out["ParametricShadowSplit"]={25,1,97};out["ParametricMidtoneSplit"]={50,2,98};out["ParametricHighlightSplit"]={75,3,99};
    for(const auto &band:bands)for(const auto &control:{"Hue","Saturation","Luminance"})out[std::string(control)+"Adjustment"+band]={0,-100,100};
    return out;
}
}
Profile Profile::parse(const Json &settings){
    require(settings.is_object()&&settings.contains("profile"),"Look 设置无效。");Profile out;out.definition=settings.at("profile");const auto &d=out.definition;
    require(d.is_object()&&d.at("schemaVersion")==1,"Look 资产版本无效。");
    for(const auto &key:{"uuid","name","group","copyright","baseProfile","cameraModelRestriction","xmpPacket"})require(d.contains(key)&&d.at(key).is_string(),"Look 文本字段无效。");
    require(hex(d.at("uuid").get<std::string>())&&!d.at("name").get<std::string>().empty(),"Look 名称或 UUID 无效。");
    for(const auto &key:{"supportsAmount","supportsSceneReferred","supportsOutputReferred","supportsColor","supportsMonochrome","supportsHighDynamicRange","supportsNormalDynamicRange"})require(d.contains(key)&&d.at(key).is_boolean(),"Look 支持标志无效。");
    require(settings.at("amount").is_number(),"Look 强度无效。");out.amount=settings.at("amount").get<float>();require(std::isfinite(out.amount)&&out.amount>=0&&out.amount<=2,"Look 强度必须在 0–200% 之间。");if(!d.at("supportsAmount").get<bool>())require(out.amount==1,"此 Look 不支持强度调整。");
    out.parameters=d.at("parameters");require(out.parameters.is_object(),"Look 参数无效。");const auto numeric=ranges();
    for(const auto &entry:out.parameters.items()){
        require(entry.value().is_string(),"Look 参数必须为标准文本。");const auto it=numeric.find(entry.key());
        if(it!=numeric.end()){const auto &r=it->second;number(out.parameters,entry.key(),r[0],r[1],r[2]);}
        else require(metadata.count(entry.key()),"不支持的必要 Look 参数："+entry.key());
    }
    require(!boolean(out.parameters,"RequiresRGBTables",false),"Look 需要原片自己的 RGB 表，当前未提供，未应用。");boolean(out.parameters,"ConvertToGrayscale",false);
    const float s0=number(out.parameters,"ParametricShadowSplit",25,1,97),s1=number(out.parameters,"ParametricMidtoneSplit",50,2,98),s2=number(out.parameters,"ParametricHighlightSplit",75,3,99);require(s0<s1&&s1<s2,"Look 参数曲线分界无效。");
    const auto tables=d.at("tables");require(tables.is_array()&&tables.size()<=2,"Look 表资产无效。");std::map<std::string,std::shared_ptr<Table>> decoded;
    for(const auto &table:tables){const auto id=lower(table.at("fingerprint").get<std::string>());require(hex(id)&&!decoded.count(id),"Look 表标识无效或重复。");auto payload=std::make_shared<Table>(Table::decode(table.at("data").get<std::string>()));require(payload->wireMD5==id,"Look 表 payload 指纹与声明不符，未应用。");decoded[id]=std::move(payload);}
    const auto table=[&](const char *key,uint32_t type){std::shared_ptr<Table> result;if(out.parameters.contains(key)&&!out.parameters.at(key).get<std::string>().empty()){const auto id=lower(out.parameters.at(key).get<std::string>());require(hex(id)&&decoded.count(id),std::string("Look 缺少表资产：")+key);result=decoded.at(id);require(result->type==type,std::string("Look 表类型不匹配：")+key);}return result;};
    out.hsv=table("LookTable",0);out.rgb=table("RGBTable",1);require(decoded.size()==size_t(bool(out.hsv))+size_t(bool(out.rgb)),"Look 包含未引用的表资产。");
    if(out.rgb)out.rgbStrength=out.rgb->rgbAmount(number(out.parameters,"RGBTableAmount",1,0,2),out.amount);
    out.rgbActive=out.rgb&&out.rgbStrength!=0&&!out.rgb->isIdentity();
    out.hsvActive=out.hsv&&std::clamp(out.amount,out.hsv->bounds[0],out.hsv->bounds[1])!=0&&!out.hsv->isIdentity();
    std::vector<std::array<double,2>> points;
    if(d.contains("curve")&&!d.at("curve").is_null()){
        require(d.at("curve").is_array()&&d.at("curve").size()>=2&&d.at("curve").size()<=32,"Look 曲线点数无效。");
        for(const auto &p:d.at("curve")){const double x=p.at("x"),y=p.at("y");require(std::isfinite(x)&&std::isfinite(y)&&x>=0&&x<=1&&y>=0&&y<=1&&(points.empty()||x-points.back()[0]>=.00049),"Look 曲线点无效。");points.push_back({x,y});}
    }else points={{0,0},{1,1}};
    // Upstream natural cubic spline, sampled at the same 4097 inputs.
    const size_t n=points.size();std::vector<double> second(n,0),upper(n,0);
    for(size_t i=1;i+1<n;++i){const double left=points[i][0]-points[i-1][0],right=points[i+1][0]-points[i][0],diagonal=2*(left+right)-left*upper[i-1],rhs=6*((points[i+1][1]-points[i][1])/right-(points[i][1]-points[i-1][1])/left);upper[i]=right/diagonal;second[i]=(rhs-left*second[i-1])/diagonal;}
    for(size_t i=n-1;i-->1;)second[i]-=upper[i]*second[i+1];
    for(size_t k=0;k<out.curve.size();++k){const double x=double(k)/4096;float y;
        if(x<=points.front()[0])y=points.front()[1];else if(x>=points.back()[0])y=points.back()[1];else{size_t i=0;while(i+2<n&&points[i+1][0]<=x)++i;const double h=points[i+1][0]-points[i][0],a=(points[i+1][0]-x)/h,b=(x-points[i][0])/h;y=std::clamp(a*points[i][1]+b*points[i+1][1]+((a*a*a-a)*second[i]+(b*b*b-b)*second[i+1])*h*h/6,0.,1.);}out.curve[k]=y;
    }
    const auto original=out.curve;const auto eval=[&](float x){const float p=std::clamp(x,0.f,1.f)*4096;const size_t i=std::min(size_t(p),size_t(4095));return original[i]+(original[i+1]-original[i])*(p-i);};
    if(out.amount!=1)for(size_t i=0;i<out.curve.size();++i){const float y=original[i],x=float(i)/4096;out.curve[i]=out.amount>1?y+(eval(y)-y)*(out.amount-1):x+(y-x)*out.amount;}
    for(size_t i=0;i<out.curve.size();++i)out.curveEnabled|=out.curve[i]!=float(i)/4096;
    bool authored=out.hsv||out.rgb||(d.contains("curve")&&!d.at("curve").is_null())||!d.at("baseProfile").get<std::string>().empty()||out.parameters.contains("ConvertToGrayscale");
    for(const auto &p:out.parameters.items())authored|=numeric.count(p.key())!=0;
    require(authored,"Look 没有表、曲线或支持的显影参数。");
    return out;
}
float Profile::evaluate(float x)const{const float p=std::clamp(x,0.f,1.f)*4096;const size_t i=std::min(size_t(p),size_t(4095));return curve[i]+(curve[i+1]-curve[i])*(p-i);}
Pixel Profile::applyHSV(Pixel p)const{if(!hasHSV())return p;for(float &v:p)v=std::clamp(v,0.f,1.f);return hsv->applyHSV(p,amount);}
Pixel Profile::applyCurve(Pixel p)const{
    if(!curveEnabled)return p;for(float &v:p)v=encode(std::clamp(v,0.f,1.f));const float lo=std::min({p[0],p[1],p[2]}),hi=std::max({p[0],p[1],p[2]}),a=evaluate(lo),b=evaluate(hi);for(float &v:p)v=decode(hi-lo>1e-8f?a+(b-a)*(v-lo)/(hi-lo):a);return p;
}
Pixel Profile::applyRGB(Pixel p)const{return hasRGB()?rgb->applyRGB(p,rgbStrength):p;}
bool Profile::isIdentity()const{return !hasHSV()&&!hasRGB()&&!hasCurve()&&controls().empty();}
Json Profile::controls()const{
    Json out=Json::object();const float factor=amount>1?1+(amount-1)*.5f:amount;const auto numeric=ranges();const auto get=[&](const std::string &key){const auto &r=numeric.at(key);return number(parameters,key,r[0],r[1],r[2]);};
    for(const auto &entry:std::map<std::string,std::string>{{"Exposure2012","exposure"},{"Saturation","saturation"},{"Highlights2012","highlights"},{"Shadows2012","shadows"},{"Whites2012","whites"},{"Blacks2012","blacks"},{"Contrast2012","contrast"},{"Clarity2012","clarity"}})if(parameters.contains(entry.first)&&get(entry.first)*factor!=0)out[entry.second]=get(entry.first)*factor;
    for(const auto &pair:std::map<std::string,std::string>{{"Hue","hue"},{"Saturation","saturation"},{"Luminance","luminance"}})for(size_t i=0;i<bands.size();++i){const auto key=pair.first+"Adjustment"+bands[i];if(parameters.contains(key)&&get(key)*factor!=0){if(!out.contains("hsl"))out["hsl"]={{"hue",std::vector<float>(8,0)},{"saturation",std::vector<float>(8,0)},{"luminance",std::vector<float>(8,0)}};out["hsl"][pair.second][i]=get(key)*factor;}}
    for(const auto &pair:std::map<std::string,std::string>{{"Shadows","shadows"},{"Darks","darks"},{"Lights","lights"},{"Highlights","highlights"}})if(parameters.contains("Parametric"+pair.first)&&get("Parametric"+pair.first)*factor!=0){out["parametricCurve"][pair.second]=get("Parametric"+pair.first)*factor;out["parametricCurve"]["splits"]={get("ParametricShadowSplit"),get("ParametricMidtoneSplit"),get("ParametricHighlightSplit")};}
    if(boolean(parameters,"ConvertToGrayscale",false))out["blackWhite"]={{"enabled",true}};
    if(factor!=0&&(get("SplitToningShadowSaturation")!=0||get("SplitToningHighlightSaturation")!=0))out["toning"]={{"shadowHue",get("SplitToningShadowHue")},{"shadowSaturation",std::min(100.f,get("SplitToningShadowSaturation")*factor)},{"highlightHue",get("SplitToningHighlightHue")},{"highlightSaturation",std::min(100.f,get("SplitToningHighlightSaturation")*factor)},{"balance",get("SplitToningBalance")}};
    if(factor!=0&&get("PostCropVignetteAmount")!=0)out["vignette"]={{"amount",get("PostCropVignetteAmount")*factor},{"midpoint",get("PostCropVignetteMidpoint")},{"feather",get("PostCropVignetteFeather")},{"roundness",get("PostCropVignetteRoundness")},{"highlights",get("PostCropVignetteHighlightContrast")},{"style",get("PostCropVignetteStyle")}};
    return out;
}
Json Profile::describe()const{Json result={{"name",definition.at("name")},{"kind","look"},{"enhanced",definition},{"controls",controls()}};if(hsv)result["hsv"]=hsv->describe();if(rgb)result["rgb"]=rgb->describe();return result;}
}
