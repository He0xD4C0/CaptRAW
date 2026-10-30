#include "input-profile.h"
#include "enhanced-profile.h"
#include "engine/dcp.h"
#include <lcms2.h>
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <vector>

namespace fs=std::filesystem;
namespace captraw {
Json inspectInputProfile(const std::string &path) {
    if(path.empty()||path.find('\0')!=std::string::npos)
        throw std::runtime_error("输入配置文件路径无效。");
    std::error_code error;
    const auto file=fs::absolute(fs::path(path),error).lexically_normal();
    if(error||!fs::is_regular_file(file,error)||error)
        throw std::runtime_error("输入配置文件不存在或不是普通文件。");
    const auto size=fs::file_size(file,error);
    if(error||size==0||size>64*1024*1024)
        throw std::runtime_error("输入配置文件为空、无法读取或超过 64 MB。");
    auto extension=file.extension().string();
    std::transform(extension.begin(),extension.end(),extension.begin(),[](unsigned char c){return std::tolower(c);});
    if(extension==".look"){
        std::ifstream stream(file);Json document;stream>>document;
        auto result=enhanced::Profile::parse({{"profile",document},{"amount",1}}).describe();
        result["id"]="inherited";result["reference"]="file:"+file.string();return result;
    }
    if(extension!=".dcp"&&extension!=".icc"&&extension!=".icm")
        throw std::runtime_error("请选择 DCP、ICC 或 ICM 输入配置文件。");
    Json result={{"id","inherited"},{"reference","file:"+file.string()},
        {"name",extension==".dcp"?"未命名 DCP":"未命名 ICC"},{"kind",extension==".dcp"?"dcp":"icc"}};
    if(extension==".dcp"){
        // Use a fresh instance: inspecting a replaced file must not hit ART's path cache.
        art::engine::DCPProfile profile(file.string(),true);
        if(!profile.isValid())throw std::runtime_error("DCP 输入配置文件无效或已损坏。");
        const auto &name=profile.getProfileName(),&camera=profile.getCameraModel();
        if(!g_utf8_validate(name.c_str(),name.size(),nullptr)||!g_utf8_validate(camera.c_str(),camera.size(),nullptr))
            throw std::runtime_error("DCP 输入配置文件文本编码无效。");
        if(!name.empty())result["name"]=name;
        if(!camera.empty())result["cameraModel"]=camera;
        if(profile.getEmbedPolicy()>=0)result["embedPolicy"]=profile.getEmbedPolicy();
        Json lights=Json::array();const auto l=profile.getIlluminants();
        if(l.temperature_1>0)lights.push_back({{"id",1},{"temperature",l.temperature_1}});
        if(l.will_interpolate&&l.temperature_2>0)lights.push_back({{"id",2},{"temperature",l.temperature_2}});
        result["dcp"]={{"toneCurve",profile.getHasToneCurve()},{"lookTable",profile.getHasLookTable()},
            {"hueSatMap",profile.getHasHueSatMap()},{"baselineExposure",profile.getHasBaselineExposureOffset()},
            {"illuminants",lights}};
        return result;
    }
    using Profile=std::unique_ptr<void,decltype(&cmsCloseProfile)>;
    Profile profile(cmsOpenProfileFromFile(file.string().c_str(),"r"),cmsCloseProfile);
    if(!profile)throw std::runtime_error("ICC 输入配置文件无效或已损坏。");
    const auto kind=cmsGetDeviceClass(profile.get());const auto pcs=cmsGetPCS(profile.get());
    if(cmsGetColorSpace(profile.get())!=cmsSigRgbData||
       (kind!=cmsSigInputClass&&kind!=cmsSigDisplayClass&&kind!=cmsSigColorSpaceClass)||
       (pcs!=cmsSigXYZData&&pcs!=cmsSigLabData))
        throw std::runtime_error("输入配置文件必须是 RGB 输入、显示或颜色空间类 ICC。");
    Profile xyz(cmsCreateXYZProfile(),cmsCloseProfile);
    std::unique_ptr<void,decltype(&cmsDeleteTransform)> transform(
        xyz?cmsCreateTransform(profile.get(),TYPE_RGB_FLT,xyz.get(),TYPE_XYZ_FLT,
            INTENT_RELATIVE_COLORIMETRIC,cmsFLAGS_NOOPTIMIZE|cmsFLAGS_NOCACHE):nullptr,cmsDeleteTransform);
    if(!transform)throw std::runtime_error("ICC 配置文件不支持有效的 RGB 输入转换。");
    // The wide API preserves localized descriptions with older Little CMS versions too.
    const auto bytes=cmsGetProfileInfo(profile.get(),cmsInfoDescription,"en","US",nullptr,0);
    if(bytes){
        std::vector<wchar_t> description((bytes+sizeof(wchar_t)-1)/sizeof(wchar_t)+1,0);
        if(cmsGetProfileInfo(profile.get(),cmsInfoDescription,"en","US",description.data(),bytes)){
            gchar *utf8;
            if constexpr(sizeof(wchar_t)==2)
                utf8=g_utf16_to_utf8(reinterpret_cast<const gunichar2 *>(description.data()),-1,nullptr,nullptr,nullptr);
            else
                utf8=g_ucs4_to_utf8(reinterpret_cast<const gunichar *>(description.data()),-1,nullptr,nullptr,nullptr);
            const std::unique_ptr<gchar,decltype(&g_free)> text(utf8,g_free);
            if(text&&*text)result["name"]=text.get();
        }
    }
    return result;
}
}
