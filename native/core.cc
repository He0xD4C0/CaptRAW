#include "core.h"
#include "recipe.h"
#include "engine/rtengine.h"
#include "engine/image8.h"
#include "engine/imagefloat.h"
#include "engine/masks.h"
#include "engine/imagesource.h"
#include "engine/refreshmap.h"
#include "engine/settings.h"
#include "engine/curves.h"
#include "engine/imagedata.h"
#include "engine/dcp.h"
#include "engine/iccstore.h"
#include <fstream>
#include "gui/options.h"
#include "engine/rtlensfun.h"
#include "engine/improcfun.h"
#include <giomm.h>
#include <filesystem>
#include <chrono>
#include <mutex>
#include <atomic>
#include <condition_variable>
#include <cmath>
#include <algorithm>
#include <cctype>
#include <cstring>
#include <memory>
#include <cstdio>
#include <cerrno>
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
struct Engine::Impl: ae::PreviewImageListener,ae::DetailedCropListener,ae::ProgressListener,ae::MaskPreviewListener,ae::HistogramListener {
    EventSink sink; std::string cache,path,id; ae::InitialImage *initial=nullptr;
    ae::StagedImageProcessor *processor=nullptr;ae::DetailedCrop *detail=nullptr;ae::IImage8 *preview=nullptr;
    pp::ProcParams params,baseline;Json adjustments;long revision=0;int baseWidth=0,baseHeight=0;
    std::vector<std::string> maskIds;std::string selectedMask;Json fitMask,detailMask;
    std::unique_ptr<ae::Image8> fullDetailImage;std::unique_ptr<ae::array2D<float>> fullDetailCoverage;int coverageX=0,coverageY=0;double coverageScale=1;
    int dx=0,dy=0,dw=1024,dh=1024; std::string kind="fit";
    Json presetDB=Json::array(),presets=Json::array(),profileOptions=Json::array();bool previewAvailable=false;
    Json curveHistogram=nullptr;bool previewPending=false;
    std::atomic<bool> maskFailure{false};
    bool colorEnabled=false,samplingColor=false;std::unique_ptr<ae::Imagefloat> sampleColorCache;int colorX=0,colorY=0;
    bool luminanceEnabled=false,samplingLuminance=false;Json fitLuminance,detailLuminance;
    std::unique_ptr<ae::PlanarWhateverData<float>> fullDetailLuminance,sampleLuminanceCache;
    int luminanceX=0,luminanceY=0,sampleX=0,sampleY=0;double luminanceScale=1;
    std::string luminanceFingerprint;std::mutex previewMutex;std::condition_variable previewCondition;unsigned long previewGeneration=0;
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
        // Metadata uses the bundled Exiv2 path, never an optional PATH helper.
        o.rtSettings.exiftool_path.clear();
        o.defProfRaw=art::gui::Options::DEFPROFILE_INTERNAL;o.defProfImg=o.defProfRaw;
        o.useBundledProfiles=false;
        ae::init(&o.rtSettings,resources,o.user_config_dir,false);
        std::ifstream wbFile(resources+"/wbpresets.json");if(wbFile)presetDB=Json::parse(wbFile,nullptr,true,true);
    }
    ~Impl(){close();ae::cleanup();}
    void emit(const Json &j){std::lock_guard<std::mutex> lock(eventMutex);sink(j);}
    void close(){
        if(processor){processor->stopProcessing();if(detail){detail->setListener(nullptr);detail=nullptr;}
            processor->setHistogramListener(nullptr);processor->setMaskPreviewListener(nullptr);processor->setPreviewImageListener(nullptr);ae::StagedImageProcessor::destroy(processor);processor=nullptr;preview=nullptr;}
        if(initial){initial->decreaseRef();initial=nullptr;}
        fullDetailImage.reset();fullDetailCoverage.reset();fullDetailLuminance.reset();sampleLuminanceCache.reset();sampleColorCache.reset();colorEnabled=false;luminanceEnabled=false;fitLuminance=nullptr;detailLuminance=nullptr;luminanceFingerprint.clear();
    }
    bool wantsColorSample()const override{return samplingColor;}
    void colorSampleReady(const ae::Imagefloat &image,int x,int y,double scale,bool detailRegion)override{
        if(samplingColor&&detailRegion&&scale==1){sampleColorCache=std::make_unique<ae::Imagefloat>(image.getWidth(),image.getHeight());image.copyTo(sampleColorCache.get());colorX=x;colorY=y;}
    }
    bool wantsLuminance()const override{return luminanceEnabled;}
    bool luminanceSampleOnly()const override{return samplingLuminance;}
    void luminanceReady(const ae::PlanarWhateverData<float> &values,int x,int y,double scale,bool detailRegion)override{
        if(!luminanceEnabled)return;
        if(samplingLuminance){
            if(detailRegion){sampleLuminanceCache=std::make_unique<ae::PlanarWhateverData<float>>();values.copyData(sampleLuminanceCache.get());sampleX=x;sampleY=y;}
            return;
        }
        if(detailRegion&&fullDetailContext()&&(&values!=fullDetailLuminance.get())){
            fullDetailLuminance=std::make_unique<ae::PlanarWhateverData<float>>();values.copyData(fullDetailLuminance.get());luminanceX=x;luminanceY=y;luminanceScale=scale;
        }
        const int sx=detailRegion?std::clamp(int(dx/scale)-x,0,values.getWidth()):0,sy=detailRegion?std::clamp(int(dy/scale)-y,0,values.getHeight()):0;
        const int w=detailRegion?std::min(int(dw/scale),values.getWidth()-sx):values.getWidth(),h=detailRegion?std::min(int(dh/scale),values.getHeight()-sy):values.getHeight();
        if(w<=0||h<=0)return;
        ae::Image8 gray(w,h);auto *data=const_cast<unsigned char *>(gray.getData());
        for(int row=0;row<h;++row)for(int col=0;col<w;++col){const auto v=std::lround(std::clamp(values.v(row+sy,col+sx),0.f,1.f)*255.f);for(int c=0;c<3;++c)data[(row*w+col)*3+c]=v;}
        const auto file=cache+"/"+id+"-luminance-"+std::to_string(++frameSequence)+".png";writePreview(&gray,file);
        Json plane={{"file",file},{"x",(x+sx)*scale},{"y",(y+sy)*scale},{"width",w*scale},{"height",h*scale}};
        if(!detailRegion){plane["x"]=0;plane["y"]=0;plane["width"]=processor->getFullWidth();plane["height"]=processor->getFullHeight();}
        (detailRegion?detailLuminance:fitLuminance)=plane;
    }
    void maskReady(int region,const ae::array2D<float> &coverage,int x,int y,double scale,bool detailRegion)override{
        if(samplingLuminance||selectedMask.empty()||region<0||region>=int(maskIds.size())||maskIds[region]!=selectedMask||coverage.width()<=0||coverage.height()<=0)return;
        if(detailRegion&&fullDetailContext()&&(&coverage!=fullDetailCoverage.get())){
            fullDetailCoverage=std::make_unique<ae::array2D<float>>(coverage.width(),coverage.height());coverageX=x;coverageY=y;coverageScale=scale;
            for(int row=0;row<coverage.height();++row)std::memcpy((*fullDetailCoverage)[row],coverage[row],coverage.width()*sizeof(float));
        }
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
        if(!image||maskFailure)return;
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
            {"kind",type},{"x",x},{"y",y},{"mask",mask},{"luminance",luminanceEnabled&&type!="before"?(type=="detail"?detailLuminance:fitLuminance):Json(nullptr)},{"histogram",histogram},{"curveHistogram",type=="detail"?Json(nullptr):curveHistogram},{"elapsedMs",elapsed}}}});
    }
    void imageReady(const pp::CropParams &)override{previewAvailable=true;previewPending=true;{std::lock_guard<std::mutex> lock(previewMutex);++previewGeneration;}previewCondition.notify_all();}
    void setObservable(ae::HistogramObservable *)override{}
    bool updateHistogram()const override{return false;}
    bool updateHistogramRaw()const override{return false;}
    bool updateVectorscopeHC()const override{return false;}
    bool updateVectorscopeHS()const override{return false;}
    bool updateWaveform()const override{return false;}
    void histogramChanged(const ae::LUTu &,const ae::LUTu &,const ae::LUTu &,const ae::LUTu &,const ae::LUTu &tone,
        const ae::LUTu &,const ae::LUTu &,const ae::LUTu &,const ae::LUTu &,const ae::LUTu &,const ae::LUTu &,const ae::LUTu &,
        const ae::LUTu &,const ae::LUTu &,int,const ae::array2D<int> &,const ae::array2D<int> &,int,
        const ae::array2D<int> &,const ae::array2D<int> &,const ae::array2D<int> &,const ae::array2D<int> &)override{
        // ART notifies after imageReady. Publish matching pixels and input histogram together.
        curveHistogram=Json::array();for(int i=0;i<tone.getSize();++i)curveHistogram.push_back(tone[i]);
        if(previewPending){previewPending=false;publish(preview,kind);}
    }
    bool fullDetailContext()const{
        if(adjustments.value("texture",0.)!=0||adjustments.value("clarity",0.)!=0)return true;
        for(const auto &m:adjustments["masks"])if(m.value("enabled",true)&&m.contains("tone")){const auto &t=m.at("tone");for(const char *key:{"highlights","shadows","whites","blacks"})if(t.value(key,0.)!=0)return true;}
        for(const auto &m:adjustments["masks"])if(m.value("enabled",true)&&m.contains("details")){const auto &d=m.at("details");if(d.value("texture",0.)!=0||d.value("clarity",0.)!=0||d.value("noise",0.)!=0)return true;}
        return false;
    }
    void publishDetailWindow(ae::IImage8 *image,int x=0,int y=0){
        ae::Image8 region(dw,dh);const int stride=image->getWidth()*3;
        for(int row=0;row<dh;++row)std::memcpy(const_cast<unsigned char *>(region.getData())+row*dw*3,image->getData()+(dy-y+row)*stride+(dx-x)*3,dw*3);
        publish(&region,"detail",dx,dy);
    }
    void setDetailedCrop(ae::IImage8 *image,ae::IImage8 *,const pp::ColorManagementParams &,
                        const pp::CropParams &,int x,int y,int,int,int)override{
        if(fullDetailContext()){
            fullDetailImage=std::make_unique<ae::Image8>(image->getWidth(),image->getHeight());
            std::memcpy(const_cast<unsigned char *>(fullDetailImage->getData()),image->getData(),size_t(image->getWidth())*image->getHeight()*3);
            publishDetailWindow(image,x,y);
        }else publish(image,"detail",x,y);
    }
    void getWindow(int &x,int &y,int &w,int &h,int &skip)override{x=dx;y=dy;w=dw;h=dh;skip=1;if(fullDetailContext()){x=y=0;w=processor->getFullWidth();h=processor->getFullHeight();}}
    void setProgress(double p)override{emit({{"event","progress"},{"progress",p}});}
    void setProgressStr(const Glib::ustring &)override{}
    void setProgressState(bool)override{}
    void error(const Glib::ustring &m)override{emit({{"event","error"},{"message",std::string(m)}});}
    void externalMaskError(const Glib::ustring &)override{
        maskFailure=true;
        error("蒙版文件在处理期间不可用，已停止发布结果。请恢复文件后重试。");
    }
    Json lensCatalog(){
        const auto *db=ae::LFDatabase::getInstance();Json cameras=Json::array(),lenses=Json::array();
        for(const auto &c:db->getCameras())cameras.push_back({{"make",std::string(c.getMake())},{"model",std::string(c.getModel())}});
        for(const auto &l:db->getLenses())lenses.push_back({{"make",std::string(l.getMake())},{"name",std::string(l.getLens())}});
        return {{"cameras",cameras},{"lenses",lenses}};
    }
    Json lensStatus(){
        auto lp=params.lensProf;const bool manual=adjustments.contains("lensProfile")&&adjustments.at("lensProfile").at("mode")=="manual";
        lp.lcMode=manual?pp::LensProfParams::LcMode::LENSFUNMANUAL:pp::LensProfParams::LcMode::LENSFUNAUTOMATCH;
        const auto *md=initial->getMetaData();
        const auto *db=ae::LFDatabase::getInstance();
        const auto make=manual?std::string(lp.lfCameraMake):md->getMake(),model=manual?std::string(lp.lfCameraModel):md->getModel(),name=manual?std::string(lp.lfLens):md->getLens();
        const auto camera=make.empty()||model.empty()?ae::LFCamera():db->findCamera(make,model);
        const auto lens=name.empty()?ae::LFLens():db->findLens(manual?ae::LFCamera():camera,name);
        const bool missing=manual&&(lp.lfCameraMake.empty()||lp.lfCameraModel.empty()||lp.lfLens.empty());
        int flags=0;
        if(!missing&&camera&&lens&&md->getFocalLen()>0){
            const auto mod=db->findModifier(lp,md,baseWidth,baseHeight,params.coarse,initial->getImageSource()->getRotateDegree());
            if(mod)flags=mod->correctionFlags();
        }
        const std::string reason=missing?"请选择相机和镜头配置。":md->getFocalLen()<=0?"照片缺少有效焦距，无法应用镜头配置。":!camera?"未找到相机配置，请手动选择。":!lens?"未找到镜头配置，请手动选择。":!(flags&(LF_MODIFY_DISTORTION|LF_MODIFY_VIGNETTING|LF_MODIFY_TCA))?"该配置在当前拍摄参数下没有可用校正。":"";
        return {{"cameraMake",std::string(camera.getMake())},{"cameraModel",std::string(camera.getModel())},{"lens",lens?std::string(lens.getLens()):std::string()},
            {"distortion",bool(flags&LF_MODIFY_DISTORTION)},{"vignette",bool(flags&LF_MODIFY_VIGNETTING)},{"ca",bool(flags&LF_MODIFY_TCA)},{"reason",reason}};
    }
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
        close();previewAvailable=false;previewPending=false;curveHistogram=nullptr;presets=Json::array();initialized=false;showingBefore=false;selectedMask.clear();fitMask=nullptr;detailMask=nullptr;maskIds.clear();path=a.at("path");id=a.at("sessionId");int err=0;
        maskFailure=false;
        started=std::chrono::steady_clock::now();
        initial=ae::InitialImage::load(path,isRaw(path),&err,this);
        if(!initial)throw std::runtime_error("无法解码照片：文件损坏，或当前核心不支持此格式/压缩模式。请重试其他照片（错误码 "+std::to_string(err)+"）。");
        initial->getImageSource()->getFullSize(baseWidth,baseHeight);
        // StagedImageProcessor takes ownership of one ImageSource reference.
        initial->increaseRef();
        processor=ae::StagedImageProcessor::create(initial);
        processor->setPreviewImageListener(this);processor->setHistogramListener(this);processor->setMaskPreviewListener(this);processor->setProgressListener(this);
        processor->setMonitorProfile("RTv4_sRGB",ae::RI_RELATIVE);
        processor->setPreviewScale(std::max(1,int(std::ceil(std::max(baseWidth,baseHeight)/2048.0))));
        ae::ColorTemp wb;processor->getCamWB(wb);
        adjustments=defaults(wb.getTemp()>0?wb.getTemp():6500,wb.getGreen()>0?wb.getGreen():1);
        int cx=0,cy=0,cw=0,ch=0;Json cameraCrop=nullptr;
        if(initial->getImageSource()->getCameraCrop(cx,cy,cw,ch))cameraCrop={{"x",double(cx)/baseWidth},{"y",double(cy)/baseHeight},{"width",double(cw)/baseWidth},{"height",double(ch)/baseHeight}};
        const int baselineVersion=a.value("baselineVersion",4);if(baselineVersion!=2&&baselineVersion!=3&&baselineVersion!=4)throw std::runtime_error("Unsupported baseline version");
        if(baselineVersion>=4)adjustments["crop"]=cameraCrop;
        if(baselineVersion>=3&&wb.getTemp()>0){auto exact=wbResult(wb,"camera");for(auto it=exact.begin();it!=exact.end();++it)adjustments[it.key()]=it.value();}
        else adjustments["wbMode"]="custom";
        params.setDefaults();applyAdjustments(params,adjustments,baseWidth,baseHeight);baseline=params;
        adjustments["colorProfile"]=inputProfileSettings(params.icm);
        adjustments["blackWhite"]=blackWhiteSettings(params);
        adjustments["colorGrading"]=colorGradingSettings(params);
        adjustments["spots"]=Json::array();
        const auto *md=initial->getMetaData();
        if(const auto *frames=dynamic_cast<const ae::FramesData *>(md)){
            for(const auto &camera:presetDB)if(camera.at("make_model")==frames->getInternalMakeModel()){presets=camera.at("presets");break;}
        }
        Json options=Json::array();for(size_t i=0;i<presets.size();++i)options.push_back({{"id",std::to_string(i)},{"name",presets[i].at("name")}});
        profileOptions=inputProfiles();
        Json stored=Json::array();if(a.contains("artProfile")){pp::ProcParams document;document.setDefaults();loadProfile(document,a.at("artProfile"));stored=spotSettings(document,baseWidth,baseHeight);}
        Json result={{"lensCatalog",lensCatalog()},{"lensStatus",lensStatus()},{"cameraCrop",cameraCrop},{"recipeSpots",stored},{"inputProfiles",profileOptions},{"baselineVersion",baselineVersion},{"whiteBalancePresets",options},{"id",id},{"path",path},{"name",fs::path(path).filename().string()},
            {"width",baseWidth},{"height",baseHeight},{"camera",md->getCamera()},{"lens",md->getLens()},
            {"iso",md->getISOSpeed()},{"aperture",md->getFNumber()},{"shutter",md->getShutterSpeed()},{"focalLength",md->getFocalLen()},{"adjustments",adjustments},{"artProfile",profileText(params)}};
        return result;
    }
    Json update(const Json &a,bool before=false){
        if(!processor)throw std::runtime_error("No image is open");
        processor->stopProcessing();revision=a.at("revision");kind=before?"before":"fit";
        const Json previous=adjustments;
        const auto previousGrading=params.captrawGrading;
        bool profileChanged=false;
        if(!before){
            pp::ProcParams candidate=params;const Json next=a.at("adjustments");
            if(next.contains("colorProfile")){
                const auto mode=next.at("colorProfile").at("mode").get<std::string>();
                if(mode!="inherited"&&std::none_of(profileOptions.begin(),profileOptions.end(),[&](const Json &p){return p.at("id")==mode;}))throw std::runtime_error("当前照片没有所选输入配置文件。请选择相机配置或矩阵。");
            }
            loadProfile(candidate,a.value("artProfile",std::string()));
            profileChanged=candidate!=params;
            std::vector<std::string> nextMaskIds;applyAdjustments(candidate,next,baseWidth,baseHeight,&nextMaskIds);
            maskIds=std::move(nextMaskIds);
            params=candidate;adjustments=next;
        }
        pp::ProcParams samplingParams=params;samplingParams.colorcorrection=pp::ColorCorrectionParams();samplingParams.textureBoost=pp::TextureBoostParams();samplingParams.smoothing=pp::SmoothingParams();
        const auto fingerprint=profileText(samplingParams);const bool previousLuminance=luminanceEnabled;luminanceEnabled=!before&&a.value("luminance",false);colorEnabled=!before&&a.value("colorSampling",false);
        if(!colorEnabled||fingerprint!=luminanceFingerprint)sampleColorCache.reset();
        if(!luminanceEnabled||fingerprint!=luminanceFingerprint){sampleLuminanceCache.reset();fitLuminance=nullptr;detailLuminance=nullptr;}
        luminanceFingerprint=fingerprint;
        fullDetailImage.reset();fullDetailCoverage.reset();fullDetailLuminance.reset();
        const auto previousMask=selectedMask;selectedMask=before?std::string():a.value("maskId",std::string());
        if(selectedMask!=previousMask||previous["masks"]!=adjustments["masks"]||previous["rotation"]!=adjustments["rotation"]){fitMask=nullptr;detailMask=nullptr;}
        started=std::chrono::steady_clock::now();
        auto *target=processor->beginUpdateParams();*target=before?baseline:params;
        int flags=ae::FIRST;
        if(initialized && !before && !showingBefore){
            flags=ae::M_MONITOR;
            if(previous["temperature"]!=adjustments["temperature"] || previous["tint"]!=adjustments["tint"] || previous.value("wbMultipliers",Json())!=adjustments.value("wbMultipliers",Json()))flags|=ae::WHITEBALANCE;
            if(previous["exposure"]!=adjustments["exposure"])flags|=ae::HDR;
            if(previous["contrast"]!=adjustments["contrast"] || previous["curve"]!=adjustments["curve"] || previous["saturation"]!=adjustments["saturation"] || previous["vibrance"]!=adjustments["vibrance"])flags|=ae::RGBCURVE;
            if(previous["masks"]!=adjustments["masks"] || previous["rotation"]!=adjustments["rotation"] || previous["crop"]!=adjustments["crop"])flags|=ae::ALLNORAW;
            if(previous.value("spots",Json())!=adjustments.value("spots",Json()))flags|=ae::SPOTADJUST;
            for(const auto *key:{"highlights","shadows","whites","blacks","sharpening","sharpenRadius","luminanceNoise","colorNoise","dehaze","texture","clarity","vignette","grain","lensCorrections","redCurve","greenCurve","blueCurve","hsl","parametricCurve","wbMultipliers","colorProfile","blackWhite","colorGrading"})if(previous.value(key,Json())!=adjustments.value(key,Json()))flags|=ae::ALLNORAW;
        }
        // Lens vignetting is applied to RAW data before demosaicing, not in ALLNORAW.
        if(previous.value("lensCorrections",Json())!=adjustments.value("lensCorrections",Json())||previous.value("lensProfile",Json())!=adjustments.value("lensProfile",Json()))flags|=ae::FIRST;
        if(selectedMask!=previousMask||luminanceEnabled!=previousLuminance)flags|=ae::ALLNORAW;
        if(previousGrading!=params.captrawGrading)flags|=ae::ALLNORAW;
        if(profileChanged||maskFailure)flags|=ae::FIRST;
        showingBefore=before;initialized=true;
        const auto optics=lensStatus();maskFailure=false;
        processor->endUpdateParams(flags);
        return {{"artProfile",profileText(params)},{"lensStatus",optics}};
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
        if(type=="raster")return std::ceil(2.*std::min(baseWidth,baseHeight)*.01*feather+32.);
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
        validateExternalMasks(showingBefore?baseline:params);
        if(maskFailure)throw std::runtime_error("蒙版处理失败，请恢复文件并重新调整照片后重试。");
        dx=std::clamp(a.value("x",0),0,processor->getFullWidth()-1);dy=std::clamp(a.value("y",0),0,processor->getFullHeight()-1);
        dw=std::clamp(a.value("width",1024),1,std::min(2048,processor->getFullWidth()-dx));dh=std::clamp(a.value("height",1024),1,std::min(2048,processor->getFullHeight()-dy));
        started=std::chrono::steady_clock::now();
        if(fullDetailContext()&&fullDetailImage){
            if(fullDetailCoverage){const auto it=std::find(maskIds.begin(),maskIds.end(),selectedMask);if(it!=maskIds.end())maskReady(int(it-maskIds.begin()),*fullDetailCoverage,coverageX,coverageY,coverageScale,true);}
            if(fullDetailLuminance)luminanceReady(*fullDetailLuminance,luminanceX,luminanceY,luminanceScale,true);
            publishDetailWindow(fullDetailImage.get());return Json::object();
        }
        if(!detail){detail=processor->createCrop(nullptr,true);detail->setListener(this);}
        int border=32;for(const auto &mask:adjustments["masks"])border=std::max(border,maskBorder(mask));
        detail->setBorder(border);int x,y,w,h,skip;getWindow(x,y,w,h,skip);detail->setWindow(x,y,w,h,skip);started=std::chrono::steady_clock::now();
        // A detail crop alone reuses navigator demosaicing. Follow ART's detail-window handshake.
        if(!processor->getHighQualComputed()){
            processor->startProcessing(ae::M_HIGHQUAL);processor->setHighQualComputed();
        }else detail->fullUpdate();
        return Json::object();
    }
    Json sampleLuminance(const Json &a,bool color=false){
        if(!processor||!(color?colorEnabled:luminanceEnabled)||showingBefore)throw std::runtime_error("请先启用范围取样。");
        processor->stopProcessing();
        if(a.at("revision").get<long>()!=revision)throw std::runtime_error("照片已更新，请重新取样。");
        const auto rotate=[&](const Json &point){
            double x=point.at("x").get<double>(),y=point.at("y").get<double>();
            if(!std::isfinite(x)||!std::isfinite(y)||x<0||x>1||y<0||y>1)throw std::runtime_error("Invalid luminance sample coordinates");
            const auto ox=x;switch(params.coarse.rotate){case 90:x=1-y;y=ox;break;case 180:x=1-x;y=1-y;break;case 270:x=y;y=1-ox;break;}
            return std::pair<double,double>(x,y);
        };
        const auto first=rotate(a.at("start")),last=a.contains("end")&&!a.at("end").is_null()?rotate(a.at("end")):first;
        const bool area=a.contains("end")&&!a.at("end").is_null();const int width=processor->getFullWidth(),height=processor->getFullHeight();
        const int left=params.crop.enabled?params.crop.x:0,top=params.crop.enabled?params.crop.y:0,right=params.crop.enabled?params.crop.x+params.crop.w-1:width-1,bottom=params.crop.enabled?params.crop.y+params.crop.h-1:height-1;
        const int x0=std::max(left,int(area?std::floor(std::min(first.first,last.first)*(width-1)):std::round(first.first*(width-1)))-(area?0:2)),y0=std::max(top,int(area?std::floor(std::min(first.second,last.second)*(height-1)):std::round(first.second*(height-1)))-(area?0:2));
        const int x1=std::min(right,int(area?std::ceil(std::max(first.first,last.first)*(width-1)):std::round(first.first*(width-1)))+(area?0:2)),y1=std::min(bottom,int(area?std::ceil(std::max(first.second,last.second)*(height-1)):std::round(first.second*(height-1)))+(area?0:2));
        if(x0>x1||y0>y1)throw std::runtime_error("取样区域在当前裁切范围之外。");
        const bool reused=color?bool(sampleColorCache):bool(sampleLuminanceCache);
        if(!reused){
            // ART's quality handshake requires a registered detail crop.
            std::unique_ptr<ae::DetailedCrop> sample(processor->createCrop(nullptr,true));sample->setWindow(0,0,width,height,1);
            if(!processor->getHighQualComputed()){
                unsigned long generation;{std::lock_guard<std::mutex> lock(previewMutex);generation=previewGeneration;}
                processor->startProcessing(ae::M_HIGHQUAL);
                bool ready;{std::unique_lock<std::mutex> lock(previewMutex);ready=previewCondition.wait_for(lock,std::chrono::seconds(30),[&]{return previewGeneration>generation;});}
                processor->stopProcessing();
                if(!ready)throw std::runtime_error("高质量预览尚未完成，请稍后重新取样。");
                processor->setHighQualComputed();
            }
            // Separate synchronous crop preserves the user's detail viewport. A full
            // image supplies context for all pre-mask spatial operations and is cached.
            samplingLuminance=!color;samplingColor=color;
            try{sample->fullUpdate();samplingLuminance=false;samplingColor=false;}catch(...){samplingLuminance=false;samplingColor=false;sampleLuminanceCache.reset();sampleColorCache.reset();throw;}
            if(color?!bool(sampleColorCache):!bool(sampleLuminanceCache))throw std::runtime_error("无法获取照片的取样数据。");
        }
        if(color){
            float l,c,h;
            if(!ae::getDeltaEColorRegion(sampleColorCache.get(),x0-colorX,y0-colorY,x1-colorX,y1-colorY,l,c,h))throw std::runtime_error("无法读取此区域的颜色，请重新取样。");
            return {{"l",l*100},{"c",c*100},{"h",h},{"pixels",(x1-x0+1)*(y1-y0+1)},{"revision",revision},{"reused",reused}};
        }
        const auto &plane=*sampleLuminanceCache;
        if(x0<sampleX||y0<sampleY||x1-sampleX>=plane.getWidth()||y1-sampleY>=plane.getHeight())throw std::runtime_error("亮度数据与照片尺寸不一致，请重新载入照片。");
        double low=1,high=0;for(int y=y0;y<=y1;++y)for(int x=x0;x<=x1;++x){const double v=plane.v(y-sampleY,x-sampleX);low=std::min(low,v);high=std::max(high,v);}
        return {{"minimum",low*100},{"maximum",high*100},{"pixels",(x1-x0+1)*(y1-y0+1)},{"x",x0},{"y",y0},{"width",x1-x0+1},{"height",y1-y0+1},{"revision",revision},{"reused",reused}};
    }
    Json exportImage(const Json &a){
        pp::ProcParams p;p.setDefaults();loadProfile(p,a.at("artProfile"));validateInputProfile(p.icm);validateExternalMasks(p);int err=0;
        if(processor)processor->stopProcessing();maskFailure=false;
        const std::string output=a.at("output"),format=a.at("format");
        if(format!="tiff"&&format!="jpeg")throw std::runtime_error("Unsupported export format");
        if(a.contains("colorSpace")){
            const std::string space=a.at("colorSpace");
            const std::pair<const char*,const char*> profiles[]={{"srgb","RTv4_sRGB"},{"adobe-rgb","RTv4_Medium"},{"prophoto-rgb","RTv4_Large"},{"display-p3","RTv4_DisplayP3"},{"rec2020","RTv4_Rec2020"}};
            const auto found=std::find_if(std::begin(profiles),std::end(profiles),[&](const auto &v){return space==v.first;});
            if(found==std::end(profiles))throw std::runtime_error("Unsupported export color space");
            if(!ae::ICCStore::getInstance()->getProfile(found->second))throw std::runtime_error("Export ICC profile is missing");
            p.icm.outputProfile=found->second;p.icm.outputIntent=ae::RI_RELATIVE;p.icm.outputBPC=true;
        }
        const auto input=a.at("path").get<std::string>();
        const auto release=[](ae::InitialImage *im){if(im)im->decreaseRef();};
        std::unique_ptr<ae::InitialImage,decltype(release)> loaded(nullptr,release);
        if(a.contains("options")){
            const auto &o=a.at("options"),&s=o.at("size"),&sharp=o.at("sharpen");
            const auto integer=[](const Json &v,int low,int high){return v.is_number_integer()&&v>=low&&v<=high;};
            const auto mode=s.at("mode").get<std::string>();
            if((mode!="original"&&mode!="long-edge"&&mode!="short-edge"&&mode!="bounds")||!integer(s.at("width"),1,65000)||!integer(s.at("height"),1,65000)||!s.at("dontEnlarge").is_boolean())throw std::runtime_error("Invalid output size");
            if(!sharp.at("enabled").is_boolean()||!integer(sharp.at("amount"),0,300)||!sharp.at("radius").is_number())throw std::runtime_error("Invalid output sharpening");
            const double radius=sharp.at("radius");
            if(!std::isfinite(radius)||radius<.1||radius>3)throw std::runtime_error("Invalid output sharpening radius");
            loaded.reset(ae::InitialImage::load(input,isRaw(input),&err));
            if(err||!loaded)throw std::runtime_error("Cannot decode export source ("+std::to_string(err)+")");
            auto *source=loaded->getImageSource();
            // Match ART's full-quality stage_init dimensions, including sensor border and coarse rotation.
            if(source->getSensorType()==ae::ST_BAYER)source->setBorder(p.raw.bayersensor.method==pp::RAWParams::BayerSensor::Method::PIXELSHIFT?std::max(p.raw.bayersensor.border,2):p.raw.bayersensor.border);
            else if(source->getSensorType()==ae::ST_FUJI_XTRANS)source->setBorder(p.raw.xtranssensor.border);
            int fw=0,fh=0;source->getFullSize(fw,fh,ae::getCoarseBitMask(p.coarse));
            if(!p.crop.hasGeometry())p.crop.setDefaultGeometry(fw,fh);
            if(p.crop.x>fw||p.crop.y>fh){p.crop.enabled=false;p.crop.x=p.crop.y=0;p.crop.w=fw;p.crop.h=fh;}
            else{
                p.crop.x=std::max(0,p.crop.x);p.crop.y=std::max(0,p.crop.y);
                if(p.crop.w<=0||p.crop.w>fw-p.crop.x)p.crop.w=fw-p.crop.x;
                if(p.crop.h<=0||p.crop.h>fh-p.crop.y)p.crop.h=fh-p.crop.y;
            }
            const int cw=p.crop.enabled?p.crop.w:fw,ch=p.crop.enabled?p.crop.h:fh;
            if(cw<1||ch<1)throw std::runtime_error("Empty export crop");
            p.resize=pp::ResizeParams();p.resize.enabled=mode!="original";p.resize.appliesTo="Cropped area";
            p.resize.width=s.at("width");p.resize.height=mode=="bounds"?s.at("height").get<int>():p.resize.width;
            p.resize.allowUpscaling=!s.at("dontEnlarge").get<bool>();p.resize.unit=pp::ResizeParams::PX;
            p.resize.dataspec=mode=="short-edge"?(cw<=ch?1:2):3;
            int ow=0,oh=0;ae::ImProcFunctions ipf(&p);const auto scale=ipf.resizeScale(&p,fw,fh,ow,oh);
            if(scale==1||(scale>1&&!p.resize.allowUpscaling)){ow=cw;oh=ch;}
            if(ow<1||oh<1||ow>65000||oh>65000||int64_t(ow)*oh>512000000)throw std::runtime_error("Output must be 1–65000 pixels per edge and at most 512 MP");
            pp::ProcParams defaults;defaults.setDefaults();p.prsharpening=defaults.prsharpening;
            p.prsharpening.enabled=sharp.at("enabled").get<bool>()&&sharp.at("amount").get<int>()>0;
            p.prsharpening.amount=sharp.at("amount");p.prsharpening.radius=radius;
        }
        auto *job=loaded?ae::ProcessingJob::create(loaded.get(),p,false):ae::ProcessingJob::create(input,isRaw(input),p);
        auto *image=ae::processImage(job,err,this);
        if(!image)throw std::runtime_error("Export processing failed ("+std::to_string(err)+")");
        if(maskFailure){delete image;throw std::runtime_error("蒙版文件在处理期间不可用，未写入导出文件。请恢复文件后重试。");}
        const int width=image->getWidth(),height=image->getHeight();
        err=format=="tiff"?image->saveAsTIFF(output,16,false,false):image->saveAsJPEG(output,95,3);
        delete image;
        if(err)throw std::runtime_error("Cannot write export ("+std::to_string(err)+")");
        return {{"path",output},{"outputProfile",std::string(p.icm.outputProfile)},{"width",width},{"height",height}};
    }
};
Engine::Engine(const std::string &r,const std::string &c,EventSink sink):impl(std::make_unique<Impl>(r,c,sink)){}
Engine::~Engine()=default;
Json Engine::call(const std::string &method,const Json &p){
    if(method=="maskAssets"){
        pp::ProcParams params;params.setDefaults();loadProfile(params,p.at("artProfile"));
        const auto replacements=p.value("replacements",Json::object());const bool validate=p.value("validate",false);
        auto paths=externalMaskAssets(params,replacements,validate);Json result;
        if(p.contains("adjustments")){
            auto a=p.at("adjustments");const auto extra=rasterMaskAssets(a,replacements,validate);
            for(const auto &path:extra)if(std::find(paths.begin(),paths.end(),path)==paths.end())paths.push_back(path);
            result["adjustments"]=a;
        }
        result["paths"]=paths;result["artProfile"]=profileText(params);return result;
    }
    if(method=="compose"){
        const int width=p.at("width"),height=p.at("height");
        if(width<1||height<1||width>200000||height>200000)throw std::runtime_error("Invalid image dimensions");
        pp::ProcParams params;params.setDefaults();loadProfile(params,p.at("artProfile"));
        applyAdjustments(params,p.at("adjustments"),width,height);validateInputProfile(params.icm);
        return {{"artProfile",profileText(params)}};
    }
    if(method=="publish"){
        const std::string source=p.at("temporary"),destination=p.at("destination");
#ifdef __APPLE__
        // Atomic, no-replace rename also works on volumes without hard links.
        if(renamex_np(source.c_str(),destination.c_str(),RENAME_EXCL)==0)return true;
        if(errno==EEXIST)return false;
        throw std::runtime_error(std::string("Cannot publish export: ")+std::strerror(errno));
#else
        std::error_code error;fs::create_hard_link(source,destination,error);
        if(error==std::errc::file_exists)return false;
        if(error)throw std::runtime_error("Cannot publish export: "+error.message());
        fs::remove(source);return true;
#endif
    }
    if(method=="validate"){
        pp::ProcParams params;params.setDefaults();loadProfile(params,p.at("artProfile"));applyAdjustments(params,p.at("adjustments"),1000,1000);return {{"colorProfile",inputProfileSettings(params.icm)},{"blackWhite",blackWhiteSettings(params)},{"colorGrading",colorGradingSettings(params)}};
    }
    if(method=="parametricCurve"){
        ae::DiagonalCurve curve(parametricCurve(p));std::vector<double> samples;
        for(int i=0;i<=512;++i)samples.push_back(curve.getVal(i/512.));
        return {{"samples",samples}};
    }
    if(method=="curve"){
        auto a=defaults(6500,1);a["curve"]=p.at("points");pp::ProcParams params;params.setDefaults();applyAdjustments(params,a,1000,1000);
        ae::DiagonalCurve curve(params.toneCurve.curve);std::vector<double> samples;for(int i=0;i<=512;i++)samples.push_back(curve.getVal(i/512.0));return {{"samples",samples}};
    }
    if(method=="open"){try{return impl->open(p);}catch(...){impl->close();throw;}}
    if(method=="update")return impl->update(p);
    if(method=="before")return impl->update(p,true);
    if(method=="whiteBalance")return impl->whiteBalance(p);
    if(method=="sampleLuminance")return impl->sampleLuminance(p);
    if(method=="sampleColor")return impl->sampleLuminance(p,true);
    if(method=="viewport")return impl->viewport(p);
    if(method=="export")return impl->exportImage(p);
    if(method=="close"){impl->close();return Json::object();}
    if(method=="save"){validateExternalMasks(impl->params);return {{"artProfile",profileText(impl->params)}};}
    if(method=="cancel"){if(impl->processor)impl->processor->stopProcessing();return Json::object();}
    throw std::runtime_error("Unknown operation: "+method);
}
}
