#include "core.h"
#include "recipe.h"
#include "engine/rtengine.h"
#include "engine/image8.h"
#include "engine/imagesource.h"
#include "engine/refreshmap.h"
#include "engine/settings.h"
#include "engine/curves.h"
#include "engine/imagedata.h"
#include "engine/dcp.h"
#include "engine/iccstore.h"
#include <fstream>
#include "gui/options.h"
#include <giomm.h>
#include <filesystem>
#include <chrono>
#include <mutex>
#include <cmath>
#include <algorithm>
#include <cctype>
#include <png.h>
namespace fs=std::filesystem;
namespace ae=art::engine;
namespace pp=art::engine::procparams;
namespace captraw {
static bool isRaw(const std::string &path) {
    auto ext=fs::path(path).extension().string();
    std::transform(ext.begin(),ext.end(),ext.begin(),[](unsigned char c){return std::tolower(c);});
    return ext!=".tif"&&ext!=".tiff"&&ext!=".png"&&ext!=".jpg"&&ext!=".jpeg";
}
static void writePreview(ae::IImage8 *image,const std::string &file) {
    FILE *fp=fopen(file.c_str(),"wb");if(!fp)throw std::runtime_error("Cannot create preview");
    auto png=png_create_write_struct(PNG_LIBPNG_VER_STRING,nullptr,nullptr,nullptr);
    auto info=png_create_info_struct(png);
    if(setjmp(png_jmpbuf(png))){png_destroy_write_struct(&png,&info);fclose(fp);throw std::runtime_error("Cannot encode preview");}
    png_init_io(png,fp);png_set_compression_level(png,0);
    png_set_IHDR(png,info,image->getWidth(),image->getHeight(),8,PNG_COLOR_TYPE_RGB,PNG_INTERLACE_NONE,PNG_COMPRESSION_TYPE_DEFAULT,PNG_FILTER_TYPE_DEFAULT);
    png_set_sRGB(png,info,PNG_sRGB_INTENT_RELATIVE);png_write_info(png,info);
    for(int y=0;y<image->getHeight();++y)png_write_row(png,const_cast<png_bytep>(image->getData()+y*image->getWidth()*3));
    png_write_end(png,info);png_destroy_write_struct(&png,&info);fclose(fp);
}
struct Engine::Impl: ae::PreviewImageListener,ae::DetailedCropListener,ae::ProgressListener,ae::MaskPreviewListener {
    EventSink sink; std::string cache,path,id; ae::InitialImage *initial=nullptr;
    ae::StagedImageProcessor *processor=nullptr;ae::DetailedCrop *detail=nullptr;ae::IImage8 *preview=nullptr;
    pp::ProcParams params,baseline;Json adjustments;long revision=0;int baseWidth=0,baseHeight=0;
    std::vector<std::string> maskIds;std::string selectedMask;Json fitMask,detailMask;
    int dx=0,dy=0,dw=1024,dh=1024; std::string kind="fit";
    Json presetDB=Json::array(),presets=Json::array(),profileOptions=Json::array();bool previewAvailable=false;
    bool initialized=false,showingBefore=false;unsigned long frameSequence=0;
    std::chrono::steady_clock::time_point started;std::mutex eventMutex;
    Impl(const std::string &resources,const std::string &c,EventSink s):sink(s),cache(c) {
        fs::create_directories(cache);Gio::init();
        auto &o=art::gui::options;
        o.ART_base_dir=resources;o.user_config_dir=cache+"/settings";o.cacheBaseDir=cache+"/art-cache";
        fs::create_directories(std::string(o.user_config_dir));fs::create_directories(std::string(o.cacheBaseDir));
        o.rtSettings.verbose=0;o.rtSettings.gpu_enabled=false;o.rtSettings.thread_pool_size=8;
        o.rtSettings.iccDirectory=resources+"/iccprofiles/output";
        o.rtSettings.lensfunDbDirectory=resources+"/lensfun";
        o.rtSettings.monitorProfile="RTv4_sRGB";o.rtSettings.autoMonitorProfile=false;
        o.rtSettings.os_monitor_profile=ae::Settings::StdMonitorProfile::SRGB;
        ae::Settings::color_mgmt_mode=ae::Settings::ColorManagementMode::APPLICATION;
        o.rtSettings.metadata_xmp_sync=ae::Settings::MetadataXmpSync::NONE;
        o.defProfRaw=art::gui::Options::DEFPROFILE_INTERNAL;o.defProfImg=o.defProfRaw;
        o.useBundledProfiles=false;
        ae::init(&o.rtSettings,resources,o.user_config_dir,false);
        std::ifstream wbFile(resources+"/wbpresets.json");if(wbFile)presetDB=Json::parse(wbFile,nullptr,true,true);
    }
    ~Impl(){close();ae::cleanup();}
    void emit(const Json &j){std::lock_guard<std::mutex> lock(eventMutex);sink(j);}
    void close(){
        if(processor){processor->stopProcessing();if(detail){detail->setListener(nullptr);detail=nullptr;}
            processor->setMaskPreviewListener(nullptr);processor->setPreviewImageListener(nullptr);ae::StagedImageProcessor::destroy(processor);processor=nullptr;preview=nullptr;}
        if(initial){initial->decreaseRef();initial=nullptr;}
    }
    void maskReady(int region,const ae::array2D<float> &coverage,int x,int y,double scale,bool detailRegion)override{
        if(selectedMask.empty()||region>=int(maskIds.size())||maskIds[region]!=selectedMask||coverage.width()<=0||coverage.height()<=0)return;
        const int sx=detailRegion?std::clamp(int(dx/scale)-x,0,coverage.width()):0,sy=detailRegion?std::clamp(int(dy/scale)-y,0,coverage.height()):0;
        const int w=detailRegion?std::min(int(dw/scale),coverage.width()-sx):coverage.width(),h=detailRegion?std::min(int(dh/scale),coverage.height()-sy):coverage.height();
        if(w<=0||h<=0)return;
        const auto file=cache+"/"+id+"-mask-"+std::to_string(++frameSequence)+".png";
        FILE *fp=fopen(file.c_str(),"wb");if(!fp)throw std::runtime_error("Cannot create mask preview");
        auto png=png_create_write_struct(PNG_LIBPNG_VER_STRING,nullptr,nullptr,nullptr);auto info=png_create_info_struct(png);
        if(setjmp(png_jmpbuf(png))){png_destroy_write_struct(&png,&info);fclose(fp);throw std::runtime_error("Cannot encode mask preview");}
        png_init_io(png,fp);png_set_compression_level(png,0);
        png_set_IHDR(png,info,w,h,8,PNG_COLOR_TYPE_RGBA,PNG_INTERLACE_NONE,PNG_COMPRESSION_TYPE_DEFAULT,PNG_FILTER_TYPE_DEFAULT);
        png_set_sRGB(png,info,PNG_sRGB_INTENT_RELATIVE);png_write_info(png,info);
        std::vector<unsigned char> row(w*4);
        for(int iy=0;iy<h;++iy){for(int ix=0;ix<w;++ix){row[ix*4]=235;row[ix*4+1]=70;row[ix*4+2]=55;row[ix*4+3]=std::lround(std::clamp(coverage[iy+sy][ix+sx],0.f,1.f)*255.f);}png_write_row(png,row.data());}
        png_write_end(png,info);png_destroy_write_struct(&png,&info);fclose(fp);
        Json plane={{"id",selectedMask},{"file",file},{"x",(x+sx)*scale},{"y",(y+sy)*scale},{"width",w*scale},{"height",h*scale}};
        if(!detailRegion){plane["x"]=0;plane["y"]=0;plane["width"]=processor->getFullWidth();plane["height"]=processor->getFullHeight();}
        (detailRegion?detailMask:fitMask)=plane;
    }
    void setImage(ae::IImage8 *image,double,const pp::CropParams &)override{preview=image;}
    void delImage(ae::IImage8 *image)override{if(preview==image)preview=nullptr;delete image;}
    void publish(ae::IImage8 *image,const std::string &type,int x=0,int y=0){
        if(!image)return;
        std::string name=id+"-"+std::to_string(revision)+"-"+type+"-"+std::to_string(++frameSequence)+".png";
        std::string file=cache+"/"+name;
        std::array<std::array<unsigned,256>,3> histogram{};
        {art::utils::MyMutex::MyLock lock(image->getMutex());
            writePreview(image,file);const auto *data=image->getData();
            for(int i=0;i<image->getWidth()*image->getHeight();i++)for(int c=0;c<3;c++)++histogram[c][data[i*3+c]];}
        const auto elapsed=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-started).count();
        Json mask=type=="detail"?detailMask:fitMask;
        if(type=="before"||selectedMask.empty()||!mask.is_object()||mask.value("id",std::string())!=selectedMask)mask=nullptr;
        emit({{"event","preview"},{"frame",{{"sessionId",id},{"revision",revision},{"file",file},
            {"width",image->getWidth()},{"height",image->getHeight()},
            {"fullWidth",processor->getFullWidth()},{"fullHeight",processor->getFullHeight()},
            {"kind",type},{"x",x},{"y",y},{"mask",mask},{"histogram",histogram},{"elapsedMs",elapsed}}}});
    }
    void imageReady(const pp::CropParams &)override{previewAvailable=true;publish(preview,kind);}
    void setDetailedCrop(ae::IImage8 *image,ae::IImage8 *,const pp::ColorManagementParams &,
                        const pp::CropParams &,int x,int y,int,int,int)override{publish(image,"detail",x,y);}
    void getWindow(int &x,int &y,int &w,int &h,int &skip)override{x=dx;y=dy;w=dw;h=dh;skip=1;}
    void setProgress(double p)override{emit({{"event","progress"},{"progress",p}});}
    void setProgressStr(const Glib::ustring &)override{}
    void setProgressState(bool)override{}
    void error(const Glib::ustring &m)override{emit({{"event","error"},{"message",std::string(m)}});}
    Json inputProfiles(){
        auto *source=initial->getImageSource();const auto camera=initial->getMetaData()->getCamera();
        const auto describeDCP=[](ae::DCPProfile *p){
            Json lights=Json::array();const auto l=p->getIlluminants();
            if(l.temperature_1>0)lights.push_back({{"id",1},{"temperature",l.temperature_1}});
            if(l.will_interpolate&&l.temperature_2>0)lights.push_back({{"id",2},{"temperature",l.temperature_2}});
            return Json{{"toneCurve",p->getHasToneCurve()},{"lookTable",p->getHasLookTable()},{"hueSatMap",p->getHasHueSatMap()},
                {"baselineExposure",p->getHasBaselineExposureOffset()},{"illuminants",lights}};
        };
        Json choices=Json::array();
        if(isRaw(path)){
            auto *dcp=ae::DCPStore::getInstance()->getCameraProfile(camera);
            const auto icc=dcp?nullptr:ae::ICCStore::getInstance()->getCameraProfile(camera);
            Json automatic={{"id","auto"},{"kind",dcp?"dcp":icc?"icc":"matrix"},{"name",dcp?"相机 DCP · "+camera:icc?"相机 ICC · "+camera:"自动 · 相机矩阵"}};
            if(dcp)automatic["dcp"]=describeDCP(dcp);
            choices.push_back(automatic);choices.push_back({{"id","matrix"},{"kind","matrix"},{"name","相机矩阵"}});
        }else choices.push_back({{"id","auto"},{"kind",source->getEmbeddedProfile()?"icc":"srgb"},{"name",source->getEmbeddedProfile()?"嵌入 ICC":"sRGB（无嵌入配置文件）"}});
        if(source->getEmbeddedProfile())choices.push_back({{"id","embedded"},{"kind","icc"},{"name","嵌入 ICC"}});
        else if(isRaw(path)&&Glib::ustring(fs::path(path).extension().string()).lowercase()==".dng"){
            auto *embedded=ae::DCPStore::getInstance()->getProfile(path);
            if(embedded)choices.push_back({{"id","embedded"},{"kind","dcp"},{"name","嵌入 DNG 配置文件"},{"dcp",describeDCP(embedded)}});
        }
        return choices;
    }
    Json open(const Json &a){
        close();previewAvailable=false;presets=Json::array();initialized=false;showingBefore=false;selectedMask.clear();fitMask=nullptr;detailMask=nullptr;maskIds.clear();path=a.at("path");id=a.at("sessionId");int err=0;
        started=std::chrono::steady_clock::now();
        initial=ae::InitialImage::load(path,isRaw(path),&err,this);
        if(!initial)throw std::runtime_error("无法解码照片：文件损坏，或当前核心不支持此格式/压缩模式。请重试其他照片（错误码 "+std::to_string(err)+"）。");
        initial->getImageSource()->getFullSize(baseWidth,baseHeight);
        // StagedImageProcessor takes ownership of one ImageSource reference.
        initial->increaseRef();
        processor=ae::StagedImageProcessor::create(initial);
        processor->setPreviewImageListener(this);processor->setMaskPreviewListener(this);processor->setProgressListener(this);
        processor->setMonitorProfile("RTv4_sRGB",ae::RI_RELATIVE);
        processor->setPreviewScale(std::max(1,int(std::ceil(std::max(baseWidth,baseHeight)/2048.0))));
        ae::ColorTemp wb;processor->getCamWB(wb);
        adjustments=defaults(wb.getTemp()>0?wb.getTemp():6500,wb.getGreen()>0?wb.getGreen():1);
        const int baselineVersion=a.value("baselineVersion",3);if(baselineVersion!=2&&baselineVersion!=3)throw std::runtime_error("Unsupported baseline version");
        if(baselineVersion==3&&wb.getTemp()>0){auto exact=wbResult(wb,"camera");for(auto it=exact.begin();it!=exact.end();++it)adjustments[it.key()]=it.value();}
        else adjustments["wbMode"]="custom";
        params.setDefaults();applyAdjustments(params,adjustments,baseWidth,baseHeight);baseline=params;
        adjustments["colorProfile"]=inputProfileSettings(params.icm);
        const auto *md=initial->getMetaData();
        if(const auto *frames=dynamic_cast<const ae::FramesData *>(md)){
            for(const auto &camera:presetDB)if(camera.at("make_model")==frames->getInternalMakeModel()){presets=camera.at("presets");break;}
        }
        Json options=Json::array();for(size_t i=0;i<presets.size();++i)options.push_back({{"id",std::to_string(i)},{"name",presets[i].at("name")}});
        profileOptions=inputProfiles();
        Json result={{"inputProfiles",profileOptions},{"baselineVersion",baselineVersion},{"whiteBalancePresets",options},{"id",id},{"path",path},{"name",fs::path(path).filename().string()},
            {"width",baseWidth},{"height",baseHeight},{"camera",md->getCamera()},{"lens",md->getLens()},
            {"iso",md->getISOSpeed()},{"aperture",md->getFNumber()},{"shutter",md->getShutterSpeed()},{"focalLength",md->getFocalLen()},{"adjustments",adjustments},{"artProfile",profileText(params)}};
        return result;
    }
    Json update(const Json &a,bool before=false){
        if(!processor)throw std::runtime_error("No image is open");
        processor->stopProcessing();revision=a.at("revision");kind=before?"before":"fit";
        const Json previous=adjustments;
        if(!before){
            pp::ProcParams candidate=params;const Json next=a.at("adjustments");
            if(next.contains("colorProfile")){
                const auto mode=next.at("colorProfile").at("mode").get<std::string>();
                if(mode!="inherited"&&std::none_of(profileOptions.begin(),profileOptions.end(),[&](const Json &p){return p.at("id")==mode;}))throw std::runtime_error("当前照片没有所选输入配置文件。请选择相机配置或矩阵。");
            }
            loadProfile(candidate,a.value("artProfile",std::string()));
            std::vector<std::string> nextMaskIds;applyAdjustments(candidate,next,baseWidth,baseHeight,&nextMaskIds);
            maskIds=std::move(nextMaskIds);
            params=candidate;adjustments=next;
        }
        const auto previousMask=selectedMask;selectedMask=before?std::string():a.value("maskId",std::string());
        if(selectedMask!=previousMask||previous["masks"]!=adjustments["masks"]||previous["rotation"]!=adjustments["rotation"]){fitMask=nullptr;detailMask=nullptr;}
        started=std::chrono::steady_clock::now();
        auto *target=processor->beginUpdateParams();*target=before?baseline:params;
        int flags=ae::FIRST;
        if(initialized && !before && !showingBefore){
            flags=ae::M_MONITOR;
            if(previous["temperature"]!=adjustments["temperature"] || previous["tint"]!=adjustments["tint"])flags|=ae::WHITEBALANCE;
            if(previous["exposure"]!=adjustments["exposure"])flags|=ae::HDR;
            if(previous["contrast"]!=adjustments["contrast"] || previous["curve"]!=adjustments["curve"] || previous["saturation"]!=adjustments["saturation"] || previous["vibrance"]!=adjustments["vibrance"])flags|=ae::RGBCURVE;
            if(previous["masks"]!=adjustments["masks"] || previous["rotation"]!=adjustments["rotation"] || previous["crop"]!=adjustments["crop"])flags|=ae::ALLNORAW;
            for(const auto *key:{"highlights","shadows","whites","blacks","sharpening","sharpenRadius","luminanceNoise","colorNoise","dehaze","vignette","grain","lensCorrections","redCurve","greenCurve","blueCurve","hsl","wbMultipliers","colorProfile"})if(previous.value(key,Json())!=adjustments.value(key,Json()))flags|=ae::ALLNORAW;
        }
        if(selectedMask!=previousMask)flags|=ae::ALLNORAW;
        showingBefore=before;initialized=true;
        processor->endUpdateParams(flags);
        return {{"artProfile",profileText(params)}};
    }
    Json wbResult(const ae::ColorTemp &wb,const std::string &mode,const Json &exactCamera=Json()){
        double r,g,b;wb.getMultipliers(r,g,b);initial->getImageSource()->wbMul2Camera(r,g,b);
        Json mult=exactCamera.is_array()?exactCamera:Json::array({r,g,b});
        const double rawTint=std::log(wb.getGreen())*100.,rawTemp=wb.getTemp();
        const double temp=std::clamp(rawTemp,1500.,60000.),tint=std::clamp(rawTint,-100.,100.);
        const ae::ColorTemp projected(temp,std::exp(tint/100.),1,"");double pr,pg,pb;projected.getMultipliers(pr,pg,pb);initial->getImageSource()->wbMul2Camera(pr,pg,pb);
        const double normal=mult[1].get<double>();bool approximate=wb.clipped()||temp!=rawTemp||tint!=rawTint;
        for(int i=0;i<3;++i){const double v=mult[i].get<double>();if(!std::isfinite(v)||v<=0||v>100)throw std::runtime_error("White balance estimate is outside the supported range");}
        const double pm[3]={pr/pg,1.,pb/pg};for(int i=0;i<3;++i)approximate|=std::abs(pm[i]-mult[i].get<double>()/normal)>.01;
        return {{"temperature",int(temp)},{"tint",tint},{"wbMode",mode},{"wbMultipliers",mult},{"wbApproximate",approximate}};
    }
    Json whiteBalance(const Json &a){
        if(!processor||!previewAvailable)throw std::runtime_error("请等待照片预览完成后再设置白平衡。");
        processor->stopProcessing();const auto mode=a.at("mode").get<std::string>();ae::ColorTemp wb;
        if(mode=="camera")processor->getCamWB(wb);
        else if(mode=="auto"){if(!processor->getAutoWB(wb,1))throw std::runtime_error("无法计算自动白平衡。");}
        else if(mode=="preset"){
            const auto index=a.at("preset").get<std::string>();size_t i=0;while(i<presets.size()&&std::to_string(i)!=index)++i;
            if(i==presets.size())throw std::runtime_error("此相机没有该白平衡预设。");
            const auto &m=presets[i].at("multipliers");double r=m[0],g=m[1],b=m[2];initial->getImageSource()->wbCamera2Mul(r,g,b);wb=ae::ColorTemp(r,g,b);
            return wbResult(wb,"preset:"+index,m);
        }else if(mode=="sample"){
            double x=a.at("x").get<double>(),y=a.at("y").get<double>();const int size=a.value("size",11);
            if(!std::isfinite(x)||!std::isfinite(y)||x<0||x>1||y<0||y>1||size<3||size>51||size%2!=1)throw std::runtime_error("Invalid white balance sample");
            const double ox=x;switch(params.coarse.rotate){case 90:x=1-y;y=ox;break;case 180:x=1-x;y=1-y;break;case 270:x=y;y=1-ox;break;}
            processor->getSpotWB(std::lround(x*(processor->getFullWidth()-1)),std::lround(y*(processor->getFullHeight()-1)),(size-1)/2,wb);
        }else throw std::runtime_error("Unknown white balance method");
        if(!(wb.getTemp()>0&&wb.getGreen()>0))throw std::runtime_error("此位置或照片无法估计白平衡。");
        return wbResult(wb,mode);
    }
    int maskBorder(const Json &m)const{
        if(!m.value("enabled",true))return 0;
        if(m.contains("components")){int padding=0;for(const auto &child:m["components"])padding=std::max(padding,maskBorder(child));return padding;}
        const auto type=m.value("type",std::string());const double feather=m.value("feather",0.0)/100.;
        if(type=="radial"){
            const auto &s=m.at("start"),&e=m.at("end");
            const double radius=std::min(std::abs(e.at("x").get<double>()-s.at("x").get<double>())*baseWidth,std::abs(e.at("y").get<double>()-s.at("y").get<double>())*baseHeight)*.5;
            // Both shape and area feather run guided filters with a 2r support.
            return std::ceil(4.*radius*feather+32.);
        }
        if(type=="brush"){
            double radius=0;for(const auto &point:m.at("points"))radius=std::max(radius,point.value("radius",.2));
            const double side=std::min(baseWidth,baseHeight);
            return std::ceil(4.*side*.1*radius*.2*feather+2.*side*.1*feather+32.);
        }
        return 32;
    }
    Json viewport(const Json &a){
        if(!processor)throw std::runtime_error("No image is open");
        processor->stopProcessing();revision=a.at("revision");
        dx=std::clamp(a.value("x",0),0,processor->getFullWidth()-1);dy=std::clamp(a.value("y",0),0,processor->getFullHeight()-1);
        dw=std::clamp(a.value("width",1024),1,std::min(2048,processor->getFullWidth()-dx));dh=std::clamp(a.value("height",1024),1,std::min(2048,processor->getFullHeight()-dy));
        if(!detail){detail=processor->createCrop(nullptr,true);detail->setListener(this);}
        int border=32;for(const auto &mask:adjustments["masks"])border=std::max(border,maskBorder(mask));
        detail->setBorder(border);detail->setWindow(dx,dy,dw,dh,1);started=std::chrono::steady_clock::now();detail->fullUpdate();
        return Json::object();
    }
    Json exportImage(const Json &a){
        pp::ProcParams p;p.setDefaults();loadProfile(p,a.at("artProfile"));int err=0;
        const auto input=a.at("path").get<std::string>();
        auto *job=ae::ProcessingJob::create(input,isRaw(input),p);
        auto *image=ae::processImage(job,err,this);
        if(!image)throw std::runtime_error("Export processing failed ("+std::to_string(err)+")");
        const std::string output=a.at("output"),format=a.at("format");
        err=format=="tiff"?image->saveAsTIFF(output,16,false,false):image->saveAsJPEG(output,95,3);
        delete image;
        if(err)throw std::runtime_error("Cannot write export ("+std::to_string(err)+")");
        return {{"path",output}};
    }
};
Engine::Engine(const std::string &r,const std::string &c,EventSink sink):impl(std::make_unique<Impl>(r,c,sink)){}
Engine::~Engine()=default;
Json Engine::call(const std::string &method,const Json &p){
    if(method=="validate"){
        pp::ProcParams params;params.setDefaults();loadProfile(params,p.at("artProfile"));applyAdjustments(params,p.at("adjustments"),1000,1000);return {{"colorProfile",inputProfileSettings(params.icm)}};
    }
    if(method=="curve"){
        auto a=defaults(6500,1);a["curve"]=p.at("points");pp::ProcParams params;params.setDefaults();applyAdjustments(params,a,1000,1000);
        ae::DiagonalCurve curve(params.toneCurve.curve);std::vector<double> samples;for(int i=0;i<=512;i++)samples.push_back(curve.getVal(i/512.0));return {{"samples",samples}};
    }
    if(method=="open")return impl->open(p);
    if(method=="update")return impl->update(p);
    if(method=="before")return impl->update(p,true);
    if(method=="whiteBalance")return impl->whiteBalance(p);
    if(method=="viewport")return impl->viewport(p);
    if(method=="export")return impl->exportImage(p);
    if(method=="close"){impl->close();return Json::object();}
    if(method=="save")return {{"artProfile",profileText(impl->params)}};
    if(method=="cancel"){if(impl->processor)impl->processor->stopProcessing();return Json::object();}
    throw std::runtime_error("Unknown operation: "+method);
}
}
