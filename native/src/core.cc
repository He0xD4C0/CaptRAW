#include "core.h"
#include "recipe.h"
#include "brush.h"
#include "white-balance.h"
#include "input-profile.h"
#include "geometry-map.h"
#include "geometry-reference.h"
#include "source-frame.h"
#include "repair-source.h"
#include "float-preview.h"
#include "tat-sample.h"
#include "hdr-avif.h"
#include "output-metadata.h"
#include "engine/perspectivecorrection.h"
#include "engine/rtengine.h"
#include "engine/image8.h"
#include "engine/imagefloat.h"
#include "engine/masks.h"
#include "engine/imagesource.h"
#include "engine/refreshmap.h"
#include "engine/settings.h"
#include "engine/curves.h"
#include "engine/imagedata.h"
#include "engine/metadata.h"
#include "engine/dcp.h"
#include "engine/iccstore.h"
#include <fstream>
#include "gui/options.h"
#include "engine/rtlensfun.h"
#include "engine/improcfun.h"
#include <giomm.h>
#include <glibmm/checksum.h>
#include <filesystem>
#include <chrono>
#include <mutex>
#include <atomic>
#include <condition_variable>
#include <cmath>
#include <algorithm>
#include <tuple>
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
static void resolveWhiteBalance(pp::ProcParams &params,ae::ImageSource *source,const Json &adjustments){
    if(adjustments.contains("incrementalTemperature")||adjustments.contains("incrementalTint")||adjustments.contains("relativeWBModel")){
        if(source->isRAW())throw std::runtime_error("相对白平衡仅适用于已渲染图像，不能将偏移作为 RAW 色温。");
        return;
    }
    if(params.wb.method!=pp::WBParams::CUSTOM_TEMP)return;
    // recipe.cc validates CRS units; exact camera coefficients enter ART's existing path.
    const auto m=whiteBalanceMultipliers(source,params.icm,adjustments.value("temperature",6500.),adjustments.value("tint",0.));
    for(int i=0;i<3;++i)params.wb.mult[i]=m[i];
    params.wb.method=pp::WBParams::CUSTOM_MULT;
}
static bool isRaw(const std::string &path) {
    auto ext=fs::path(path).extension().string();
    std::transform(ext.begin(),ext.end(),ext.begin(),[](unsigned char c){return std::tolower(c);});
    return ext!=".tif"&&ext!=".tiff"&&ext!=".png"&&ext!=".jpg"&&ext!=".jpeg";
}
static const char *classifyInputKind(const ae::ImageSource &source){
    // Query the successfully decoded source, not the filename's loader hint.
    if(!source.isRAW())return "rendered";
    const auto sensor=source.getSensorType();
    if(sensor==ae::ST_BAYER||sensor==ae::ST_FUJI_XTRANS)return "mosaic-raw";
    // RawImageSource also handles non-CFA LinearRaw DNG and stacked/mono data.
    return "linear-raw";
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
struct Engine::Impl: ae::PreviewImageListener,ae::DetailedCropListener,ae::ProgressListener,ae::MaskPreviewListener,ae::HistogramListener,ae::FloatPreviewListener {
    EventSink sink; std::string cache,path,id,cacheId; ae::InitialImage *initial=nullptr;
    ae::StagedImageProcessor *processor=nullptr;ae::DetailedCrop *detail=nullptr;ae::IImage8 *preview=nullptr;
    pp::ProcParams params,baseline;Json adjustments;long revision=0;int baseWidth=0,baseHeight=0;
    Json documentFrame;
    Json geometryIdentity;
    std::unique_ptr<ae::GeometryMap> displayCoordinates,referenceCoordinates;
    double coordinateReferenceAngle=0;
    std::string coordinateReferenceKey;
    std::vector<std::string> maskIds;std::string selectedMask;Json fitMask,detailMask;
    std::unique_ptr<ae::Image8> fullDetailImage;std::unique_ptr<ae::array2D<float>> fullDetailCoverage;int coverageX=0,coverageY=0;double coverageScale=1;
    int dx=0,dy=0,dw=1024,dh=1024; std::string kind="fit";
    Json presetDB=Json::array(),presets=Json::array(),profileOptions=Json::array();bool previewAvailable=false;
    Json curveHistogram=nullptr;bool previewPending=false;
    std::unique_ptr<CurveSampler> curveSampler;
    std::atomic<bool> maskFailure{false};
    bool colorEnabled=false,samplingColor=false;std::unique_ptr<ae::Imagefloat> sampleColorCache;int colorX=0,colorY=0;
    bool linearEnabled=false,linearFailure=false;Json fitLinear,detailLinear;
    std::unique_ptr<LinearPixels> fullDetailLinear;
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
        if(processor)processor->stopProcessing();curveSampler.reset();
        displayCoordinates.reset();referenceCoordinates.reset();
        if(processor){processor->stopProcessing();if(detail){detail->setListener(nullptr);detail=nullptr;}
            processor->setHistogramListener(nullptr);processor->setFloatPreviewListener(nullptr);processor->setMaskPreviewListener(nullptr);processor->setPreviewImageListener(nullptr);ae::StagedImageProcessor::destroy(processor);processor=nullptr;preview=nullptr;}
        if(initial){initial->decreaseRef();initial=nullptr;}
        fullDetailImage.reset();fullDetailCoverage.reset();fullDetailLuminance.reset();sampleLuminanceCache.reset();sampleColorCache.reset();colorEnabled=false;luminanceEnabled=false;fitLuminance=nullptr;detailLuminance=nullptr;luminanceFingerprint.clear();
        fullDetailLinear.reset();linearEnabled=false;linearFailure=false;fitLinear=nullptr;detailLinear=nullptr;
    }
    bool wantsFloatPreview()const override{return linearEnabled&&!samplingColor&&!samplingLuminance;}
    void linearWindow(const LinearPixels &image,bool detailed,int sx=0,int sy=0,int width=0,int height=0){
        if(!width)width=image.width;if(!height)height=image.height;
        const auto file=cache+"/"+cacheId+"-linear-"+std::to_string(++frameSequence)+".rgba16f";
        try{writeLinearPixels(image,file,sx,sy,width,height);}
        catch(...){fs::remove(file);throw;}
        (detailed?detailLinear:fitLinear)={{"file",file},{"width",width},{"height",height},{"rowBytes",width*8},{"encoding","rgba16float-le"},{"colorSpace","rec709-linear"}};
        if(params.toneCurve.whitePoint>1.){
            const double headroom=std::log2(params.toneCurve.whitePoint);const auto histogram=linearHistogram(image,sx,sy,width,height,headroom);
            (detailed?detailLinear:fitLinear)["histogram"]={{"bins",histogram.bins},{"headroom",headroom},{"below",histogram.below},{"above",histogram.above}};
        }
    }
    void floatPreviewReady(ae::Imagefloat &image,int,int,int sx,int sy,int width,int height,bool detailed)override{
        try{
            auto pixels=linearPixels(image,params.icm,sx,sy,width,height);
            if(detailed&&fullDetailContext()){
                fullDetailLinear=std::make_unique<LinearPixels>(std::move(pixels));
                linearWindow(*fullDetailLinear,true,dx,dy,dw,dh);
            }else linearWindow(pixels,detailed);
        }catch(const std::exception &e){linearFailure=true;error(std::string("浮点预览失败，未发布图像：")+e.what());}
    }
    bool wantsColorSample()const override{return samplingColor;}
    bool wantsMask(int region)const override{return !selectedMask.empty()&&region>=0&&region<int(maskIds.size())&&maskIds[region]==selectedMask;}
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
        const auto file=cache+"/"+cacheId+"-luminance-"+std::to_string(++frameSequence)+".png";writePreview(&gray,file);
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
        const auto file=cache+"/"+cacheId+"-mask-"+std::to_string(++frameSequence)+".png";
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
        if(!image||maskFailure||linearFailure)return;
        std::string name=cacheId+"-"+std::to_string(revision)+"-"+type+"-"+std::to_string(++frameSequence)+".png";
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
            {"kind",type},{"x",x},{"y",y},{"mask",mask},{"linear",linearEnabled?(type=="detail"?detailLinear:fitLinear):Json(nullptr)},{"luminance",luminanceEnabled&&type!="before"?(type=="detail"?detailLuminance:fitLuminance):Json(nullptr)},{"histogram",histogram},{"curveHistogram",type=="detail"?Json(nullptr):curveHistogram},{"elapsedMs",elapsed}}}});
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
        if(!params.captrawGlow.empty())return true;
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
    void maskGeometryError(const Glib::ustring &message)override{
        maskFailure=true;
        error("蒙版坐标映射失败，已停止发布结果。请调整几何设置后重试。" + message);
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
        if(source->isRAW()){
            auto *dcp=ae::DCPStore::getInstance()->getCameraProfile(camera);
            const auto icc=dcp?nullptr:ae::ICCStore::getInstance()->getCameraProfile(camera);
            Json automatic={{"id","auto"},{"kind",dcp?"dcp":icc?"icc":"matrix"},{"name",dcp?"相机 DCP · "+camera:icc?"相机 ICC · "+camera:"自动 · 相机矩阵"}};
            if(dcp)automatic["dcp"]=describeDCP(dcp);
            choices.push_back(automatic);choices.push_back({{"id","matrix"},{"kind","matrix"},{"name","相机矩阵"}});
        }else choices.push_back({{"id","auto"},{"kind",source->getEmbeddedProfile()?"icc":"srgb"},{"name",source->getEmbeddedProfile()?"嵌入 ICC":"sRGB（无嵌入配置文件）"}});
        if(source->getEmbeddedProfile())choices.push_back({{"id","embedded"},{"kind","icc"},{"name","嵌入 ICC"}});
        else if(source->isRAW()&&Glib::ustring(fs::path(path).extension().string()).lowercase()==".dng"){
            auto *embedded=ae::DCPStore::getInstance()->getProfile(path);
            if(embedded)choices.push_back({{"id","embedded"},{"kind","dcp"},{"name","嵌入 DNG 配置文件"},{"dcp",describeDCP(embedded)}});
        }
        return choices;
    }
    Json open(const Json &a){
        if(a.contains("baselineVersion")&&a.at("baselineVersion")!=4)throw std::runtime_error("Unsupported baseline version");
        close();previewAvailable=false;previewPending=false;curveHistogram=nullptr;presets=Json::array();initialized=false;showingBefore=false;selectedMask.clear();fitMask=nullptr;detailMask=nullptr;maskIds.clear();path=a.at("path");id=a.at("sessionId");int err=0;
        // Session IDs are opaque RPC identifiers, never filesystem path components.
        cacheId=Glib::Checksum::compute_checksum(Glib::Checksum::CHECKSUM_SHA256,id);
        maskFailure=false;
        started=std::chrono::steady_clock::now();
        pp::ProcParams frameParams;frameParams.setDefaults();loadProfile(frameParams,a.value("artProfile",std::string()));
        Json requestedFrame=a.value("sourceFrame",Json());
        if(requestedFrame.is_null()&&!frameParams.commonTrans.captrawSourceFrame.empty())
            requestedFrame=ae::checkedSourceFrame(Json::parse(frameParams.commonTrans.captrawSourceFrame));
        const auto framePolicy=requestedFrame.is_null()?
            (a.value("artProfile",std::string()).empty()?a.value("sourceFramePolicy",std::string("legacy")):std::string("legacy")):
            ae::checkedSourceFrame(requestedFrame).at("policy").get<std::string>();
        if(framePolicy!="legacy"&&framePolicy!="active-area-v1")throw std::runtime_error("Invalid source frame policy");
        const bool decodeFrame=framePolicy=="active-area-v1"&&
            (requestedFrame.is_null()||requestedFrame.value("decoderModel",std::string())=="sensor-crop-v1");
        geometryIdentity=ae::sourceContentIdentity(path);
        initial=ae::InitialImage::load(path,isRaw(path),&err,this,decodeFrame);
        if(!initial)throw std::runtime_error("无法解码照片：文件损坏，或当前核心不支持此格式/压缩模式。请重试其他照片（错误码 "+std::to_string(err)+"）。");
        if(ae::sourceContentIdentity(path)!=geometryIdentity)throw std::runtime_error("Geometry source changed during decoding");
        initial->getImageSource()->getFullSize(baseWidth,baseHeight);
        auto *frameSource=initial->getImageSource();
        const int originalBorder=frameSource->getDecodedSourceFrame().border;
        if(framePolicy=="legacy")ae::applySourceFrame(frameSource,frameParams);
        documentFrame=ae::sourceFrame(frameSource,frameParams,framePolicy=="active-area-v1",
            framePolicy=="legacy"?baseWidth:0,framePolicy=="legacy"?baseHeight:0);
        if(!requestedFrame.is_null()){
            // The snapshot belongs to this decoded source, never to a target
            // selected for synchronization. Reject a mismatched frame early.
            for(const char *key:{"sensor","fullWidth","fullHeight","decoded","border","width","height","layoutWidth","layoutHeight"})
                if(requestedFrame.at(key)!=documentFrame.at(key))throw std::runtime_error("Source frame does not match the decoded photo");
        }
        if(framePolicy=="active-area-v1"){
            baseWidth=documentFrame.at("layoutWidth");baseHeight=documentFrame.at("layoutHeight");
        }else frameSource->setBorder(originalBorder);
        // StagedImageProcessor takes ownership of one ImageSource reference.
        initial->increaseRef();
        processor=ae::StagedImageProcessor::create(initial);
        processor->setPreviewImageListener(this);processor->setHistogramListener(this);processor->setMaskPreviewListener(this);processor->setFloatPreviewListener(this);processor->setProgressListener(this);
        processor->setMonitorProfile("RTv4_sRGB",ae::RI_RELATIVE);
        processor->setPreviewScale(std::max(1,int(std::ceil(std::max(baseWidth,baseHeight)/2048.0))));
        ae::ColorTemp wb;processor->getCamWB(wb);
        adjustments=defaults();params.setDefaults();
        if(framePolicy=="active-area-v1")adjustments["sourceFrame"]=documentFrame;
        ae::attachSourceFrame(params,framePolicy=="active-area-v1"?documentFrame:
            ae::sourceFrame(frameSource,params,false,baseWidth,baseHeight));
        // The caller knows whether a sidecar/recipe will be merged after open.
        // Missing policy deliberately retains legacy behavior for existing clients.
        const auto effectsDefaults=a.value("effectsDefaults",std::string("legacy"));
        if(effectsDefaults!="legacy"&&effectsDefaults!="current")throw std::runtime_error("Invalid effects defaults policy");
        if(effectsDefaults=="current"){
            adjustments["curveRefineModel"]="weighted-std-v1";
            adjustments["curveRefineSaturation"]=100;
            adjustments["grainModel"]="procedural-v1";adjustments["grainSize"]=25;adjustments["grainRoughness"]=50;
            adjustments["postCropVignetteStyle"]="highlight-priority";adjustments["postCropVignetteMidpoint"]=50;
            adjustments["postCropVignetteRoundness"]=0;adjustments["postCropVignetteFeather"]=50;adjustments["postCropVignetteHighlights"]=0;
        }
        int cx=0,cy=0,cw=0,ch=0;Json cameraCrop=nullptr;
        if(framePolicy=="active-area-v1"?frameSource->getDefaultCrop(cx,cy,cw,ch):frameSource->getCameraCrop(cx,cy,cw,ch))
            if(framePolicy=="legacy"||cx||cy||cw!=baseWidth||ch!=baseHeight)cameraCrop={{"x",double(cx)/baseWidth},{"y",double(cy)/baseHeight},{"width",double(cw)/baseWidth},{"height",double(ch)/baseHeight}};
        adjustments["crop"]=cameraCrop;
        if(wb.getTemp()>0){auto exact=wbResult(wb,"camera");for(auto it=exact.begin();it!=exact.end();++it)adjustments[it.key()]=it.value();}
        else adjustments["wbMode"]="custom";
        const auto wbDefaults=a.value("whiteBalanceDefaults",std::string("legacy"));
        if(wbDefaults!="legacy"&&wbDefaults!="current")throw std::runtime_error("Invalid white balance defaults policy");
        if(wbDefaults=="current"&&!initial->getImageSource()->isRAW()){
            adjustments["relativeWBModel"]="art-ctl-v1";adjustments["incrementalTemperature"]=0;adjustments["incrementalTint"]=0;
            adjustments["wbMode"]="camera";adjustments["wbMultipliers"]=nullptr;adjustments["wbApproximate"]=false;
        }
        applyAdjustments(params,adjustments,baseWidth,baseHeight);params.commonTrans.captrawSourceIdentity=geometryIdentity.dump();resolveWhiteBalance(params,initial->getImageSource(),adjustments);baseline=params;
        adjustments["colorProfile"]=inputProfileSettings(params.icm);
        adjustments["blackWhite"]=blackWhiteSettings(params);
        adjustments["colorGrading"]=colorGradingSettings(params);
        adjustments["lensManualDistortion"]=params.distortion.enabled?params.distortion.amount*200.:0;
        adjustments["lensVignette"]=params.vignetting.enabled?params.vignetting.amount:0;
        if(params.chmixer.enabled&&params.chmixer.mode==pp::ChannelMixerParams::PRIMARIES_CHROMA)adjustments["calibration"]={
            {"redHue",params.chmixer.hue_tweak[0]},{"redSaturation",params.chmixer.sat_tweak[0]},
            {"greenHue",params.chmixer.hue_tweak[1]},{"greenSaturation",params.chmixer.sat_tweak[1]},
            {"blueHue",params.chmixer.hue_tweak[2]},{"blueSaturation",params.chmixer.sat_tweak[2]}};
        adjustments["spots"]=Json::array();
        adjustments["fineRotation"]=params.rotate.enabled?params.rotate.degree:0;
        adjustments["perspective"]=perspectiveSettings(params);
        const auto *md=initial->getMetaData();
        if(const auto *frames=dynamic_cast<const ae::FramesData *>(md)){
            for(const auto &camera:presetDB)if(camera.at("make_model")==frames->getInternalMakeModel()){presets=camera.at("presets");break;}
        }
        Json options=Json::array();for(size_t i=0;i<presets.size();++i)options.push_back({{"id",std::to_string(i)},{"name",presets[i].at("name")}});
        profileOptions=inputProfiles();
        std::string profileCamera=md->getCamera();
        if(Glib::ustring(fs::path(path).extension().string()).lowercase()==".dng"){
            auto *dcp=ae::DCPStore::getInstance()->getProfile(path);
            if(dcp&&!dcp->getCameraModel().empty())profileCamera=dcp->getCameraModel();
        }
        Json result={{"sourceFrame",documentFrame},{"lensCatalog",lensCatalog()},{"lensStatus",lensStatus()},{"cameraCrop",cameraCrop},{"inputProfiles",profileOptions},{"baselineVersion",4},{"whiteBalancePresets",options},{"id",id},{"path",path},{"name",fs::path(path).filename().string()},
            {"width",baseWidth},{"height",baseHeight},{"inputKind",classifyInputKind(*initial->getImageSource())},{"camera",md->getCamera()},{"profileCamera",profileCamera},{"lens",md->getLens()},
            {"iso",md->getISOSpeed()},{"aperture",md->getFNumber()},{"shutter",md->getShutterSpeed()},{"focalLength",md->getFocalLen()},{"exposureCompensation",md->getExpComp()},{"adjustments",adjustments},{"effectiveGeometry",geometryProjection(params)},{"artProfile",profileText(params)}};
        // ART's metadata wrapper rejects images without EXIF before reading XMP.
        auto metadata=Exiv2::ImageFactory::open(path);metadata->readMetadata();const auto &xmp=metadata->xmpData();
        const auto entry=xmp.findKey(Exiv2::XmpKey("Xmp.xmp.Rating"));
        if(entry!=xmp.end()){
            std::istringstream value(entry->toString());value.imbue(std::locale::classic());double rating=0;
            if(value>>rating&&(value>>std::ws).eof()&&std::isfinite(rating)&&(rating==-1||(rating>=0&&rating<=5)))result["rating"]=rating;
        }else{const int rating=md->getRating();if(rating==-1||(rating>=1&&rating<=5))result["rating"]=rating;}
        const auto label=xmp.findKey(Exiv2::XmpKey("Xmp.xmp.Label"));
        if(label!=xmp.end())result["label"]=label->toString();
        return result;
    }
    Json update(const Json &a,bool before=false){
        if(!processor)throw std::runtime_error("No image is open");
        if(a.contains("linearPreview")&&!a.at("linearPreview").is_boolean())throw std::runtime_error("Invalid float preview request");
        processor->stopProcessing();curveSampler.reset();revision=a.at("revision");kind=before?"before":"fit";
        const Json previous=adjustments;
        const auto previousGrading=params.captrawGrading;
        const auto previousEffects=params.captrawEffects;
        const auto previousGlow=params.captrawGlow;
        bool profileChanged=false;
        if(!before){
            pp::ProcParams candidate=params;const Json next=a.at("adjustments");
            if(next.contains("colorProfile")){
                const auto mode=next.at("colorProfile").at("mode").get<std::string>();
                if(mode!="inherited"&&std::none_of(profileOptions.begin(),profileOptions.end(),[&](const Json &p){return p.at("id")==mode;}))throw std::runtime_error("当前照片没有所选输入配置文件。请选择相机配置或矩阵。");
            }
            const auto profile=a.value("artProfile",std::string());
            loadProfile(candidate,profile);
            if(documentFrame.at("policy")=="active-area-v1"){
                if(next.contains("sourceFrame")&&ae::checkedSourceFrame(next.at("sourceFrame"))!=documentFrame)
                    throw std::runtime_error("The document source frame is immutable");
                ae::attachSourceFrame(candidate,documentFrame);
            }else{
                if(next.contains("sourceFrame")&&next.at("sourceFrame").at("policy")!="legacy")
                    throw std::runtime_error("Cannot reinterpret a legacy document source frame");
                ae::applySourceFrame(initial->getImageSource(),candidate);
                ae::attachSourceFrame(candidate,ae::sourceFrame(initial->getImageSource(),candidate,false,baseWidth,baseHeight));
            }
            // History may restore absent new flip controls. With no ARP,
            // inherit the original canvas rather than the previous edit.
            // A nonempty ARP remains authoritative for inherited coarse flips.
            if(profile.empty()){
                if(!next.contains("perspective"))candidate.perspective=baseline.perspective;
                // An old history snapshot without calibration restores its native baseline.
                if(!next.contains("calibration"))candidate.chmixer.captrawShadowTint=baseline.chmixer.captrawShadowTint;
                if(!next.contains("flipHorizontal"))candidate.coarse.hflip=baseline.coarse.hflip;
                if(!next.contains("flipVertical"))candidate.coarse.vflip=baseline.coarse.vflip;
                if(!next.contains("flipHorizontal")&&!next.contains("flipVertical")){
                    candidate.rotate.captrawSourceBasisSet=baseline.rotate.captrawSourceBasisSet;
                    candidate.rotate.captrawSourceBasisHorizontal=baseline.rotate.captrawSourceBasisHorizontal;
                    candidate.rotate.captrawSourceBasisVertical=baseline.rotate.captrawSourceBasisVertical;
                }
            }
            profileChanged=candidate!=params;
            std::vector<std::string> nextMaskIds;applyAdjustments(candidate,next,baseWidth,baseHeight,&nextMaskIds);
            candidate.commonTrans.captrawSourceIdentity=geometryIdentity.dump();
            resolveWhiteBalance(candidate,initial->getImageSource(),next);
            maskIds=std::move(nextMaskIds);
            params=candidate;adjustments=next;
        }
        displayCoordinates.reset();referenceCoordinates.reset();
        pp::ProcParams samplingParams=params;samplingParams.colorcorrection=pp::ColorCorrectionParams();samplingParams.textureBoost=pp::TextureBoostParams();samplingParams.smoothing=pp::SmoothingParams();
        const auto fingerprint=profileText(samplingParams);const bool previousLuminance=luminanceEnabled;luminanceEnabled=!before&&a.value("luminance",false);colorEnabled=!before&&a.value("colorSampling",false);
        if(!colorEnabled||fingerprint!=luminanceFingerprint)sampleColorCache.reset();
        if(!luminanceEnabled||fingerprint!=luminanceFingerprint){sampleLuminanceCache.reset();fitLuminance=nullptr;detailLuminance=nullptr;}
        luminanceFingerprint=fingerprint;
        fullDetailImage.reset();fullDetailCoverage.reset();fullDetailLuminance.reset();
        fullDetailLinear.reset();linearEnabled=!before&&(params.toneCurve.captrawHDREditMode||a.value("linearPreview",false));linearFailure=false;fitLinear=nullptr;detailLinear=nullptr;
        const auto previousMask=selectedMask;selectedMask=before?std::string():a.value("maskId",std::string());
        if(selectedMask!=previousMask||previous["masks"]!=adjustments["masks"]||previous["rotation"]!=adjustments["rotation"]||previous.value("fineRotation",Json())!=adjustments.value("fineRotation",Json())||previous.value("perspective",Json())!=adjustments.value("perspective",Json())){fitMask=nullptr;detailMask=nullptr;}
        const bool flipsChanged=previous.value("flipHorizontal",Json())!=adjustments.value("flipHorizontal",Json())||previous.value("flipVertical",Json())!=adjustments.value("flipVertical",Json());
        if(flipsChanged){fitMask=nullptr;detailMask=nullptr;}
        started=std::chrono::steady_clock::now();
        auto *target=processor->beginUpdateParams();*target=before?baseline:params;
        int flags=ae::FIRST;
        if(initialized && !before && !showingBefore){
            flags=ae::M_MONITOR;
            // RAW scaling and highlight recovery depend on WB even at fit scale.
            // Invalidate those caches on WB edits so reopening preserves pixels.
            if(previous["temperature"]!=adjustments["temperature"] || previous["tint"]!=adjustments["tint"] || previous.value("wbMultipliers",Json())!=adjustments.value("wbMultipliers",Json())||previous.value("incrementalTemperature",Json())!=adjustments.value("incrementalTemperature",Json())||previous.value("incrementalTint",Json())!=adjustments.value("incrementalTint",Json())||previous.value("relativeWBModel",Json())!=adjustments.value("relativeWBModel",Json()))flags|=ae::WHITEBALANCE|ae::FIRST;
            if(previous["exposure"]!=adjustments["exposure"])flags|=ae::HDR;
            if(previous.value("hdrEnabled",Json())!=adjustments.value("hdrEnabled",Json())||previous.value("hdrHeadroom",Json())!=adjustments.value("hdrHeadroom",Json()))flags|=ae::ALLNORAW;
            if(previous["contrast"]!=adjustments["contrast"] || previous["curve"]!=adjustments["curve"] || previous["saturation"]!=adjustments["saturation"] || previous["vibrance"]!=adjustments["vibrance"] || previous.value("curveRefineModel",Json())!=adjustments.value("curveRefineModel",Json()) || previous.value("curveRefineSaturation",Json())!=adjustments.value("curveRefineSaturation",Json()))flags|=ae::RGBCURVE;
            if(previous["masks"]!=adjustments["masks"] || previous["rotation"]!=adjustments["rotation"]||previous.value("fineRotation",Json())!=adjustments.value("fineRotation",Json())||previous.value("perspective",Json())!=adjustments.value("perspective",Json()) || previous["crop"]!=adjustments["crop"])flags|=ae::ALLNORAW;
            if(previous.value("spots",Json())!=adjustments.value("spots",Json()))flags|=ae::SPOTADJUST;
            for(const auto *key:{"highlights","shadows","whites","blacks","sharpening","sharpenRadius","sharpenDetail","sharpenEdgeMask","luminanceNoise","luminanceNoiseDetail","luminanceNoiseContrast","colorNoise","colorNoiseDetail","colorNoiseSmoothness","dehaze","texture","clarity","vignette","postCropVignetteFeather","postCropVignetteRoundness","grain","lensCorrections","lensManualDistortion","defringe","redCurve","greenCurve","blueCurve","hsl","calibration","parametricCurve","wbMultipliers","colorProfile","blackWhite","colorGrading"})if(previous.value(key,Json())!=adjustments.value(key,Json()))flags|=ae::ALLNORAW;
        }
        // Lens vignetting is applied to RAW data before demosaicing, not in ALLNORAW.
        if(previous.value("lensCorrections",Json())!=adjustments.value("lensCorrections",Json())||previous.value("lensProfile",Json())!=adjustments.value("lensProfile",Json())||previous.value("lensVignette",Json())!=adjustments.value("lensVignette",Json()))flags|=ae::FIRST;
        if(selectedMask!=previousMask||luminanceEnabled!=previousLuminance)flags|=ae::ALLNORAW;
        if(previousGrading!=params.captrawGrading)flags|=ae::ALLNORAW;
        if(previousEffects!=params.captrawEffects||previousGlow!=params.captrawGlow)flags|=ae::ALLNORAW;
        if(flipsChanged)flags|=ae::FIRST;
        if(profileChanged||maskFailure)flags|=ae::FIRST;
        showingBefore=before;initialized=true;
        const auto optics=lensStatus();maskFailure=false;
        processor->endUpdateParams(flags);
        return {{"artProfile",profileText(params)},{"lensStatus",optics},
            {"geometry",geometryProjection(params)}};
    }
    static Json geometryProjection(const pp::ProcParams &p){
        const auto basis=ae::geometrySourceBasis(p);
        return {{"rotation",p.coarse.rotate},{"angle",p.rotate.enabled?p.rotate.degree:0},
            {"effectiveFill",p.perspective.captrawFill(p.commonTrans.autofill)},
            {"perspective",perspectiveSettings(p)},
            {"flipHorizontal",p.coarse.hflip},{"flipVertical",p.coarse.vflip},
            {"sourceFlipHorizontal",basis.first},{"sourceFlipVertical",basis.second}};
    }
    Json coordinates(const Json &request){
        if(!processor||!initial)throw std::runtime_error("No image is open");
        if(request.at("sessionId")!=id||!request.at("revision").is_number_integer()||request.at("revision")!=revision)
            throw std::runtime_error("Stale coordinate request");
        const auto from=request.at("from").get<std::string>(),to=request.at("to").get<std::string>();
        const auto validSpace=[](const std::string &space){return space=="display"||space=="reference"||space=="source";};
        if(!validSpace(from)||!validSpace(to))throw std::runtime_error("Invalid coordinate space");
        const auto &points=request.at("points");
        if(!points.is_array()||points.empty()||points.size()>4096)throw std::runtime_error("Expected 1-4096 coordinate points");
        for(const auto &point:points)for(const char *key:{"x","y"})
            if(!point.is_object()||!point.contains(key)||!point.at(key).is_number()||
               !std::isfinite(point.at(key).get<double>())||std::abs(point.at(key).get<double>())>1e7)
                throw std::runtime_error("Invalid coordinate point");
        const auto &geometry=showingBefore?baseline:params;
        const double angle=geometry.rotate.enabled?geometry.rotate.degree:0;
        const double reference=request.contains("referenceAngle")?request.at("referenceAngle").get<double>():
            geometry.rotate.captrawMaskCoordinates?geometry.rotate.captrawMaskReferenceDegree:angle;
        if(!std::isfinite(reference)||std::abs(reference)>45)throw std::runtime_error("Invalid reference angle");
        // New leaves snapshot all authoring transforms; explicit legacy angles
        // keep the old appearance when an existing leaf is edited.
        Json snapshot=request.value("geometryReference",Json());
        if(snapshot=="current")snapshot=maskGeometryReference(geometry);
        const std::string referenceKey=snapshot.is_null()?std::string():maskGeometryReferenceData(snapshot);
        auto referenceGeometry=referenceKey.empty()?geometry:ae::geometryReferenceParams(referenceKey);
        if(referenceGeometry.commonTrans.captrawSourceFrame.empty())referenceGeometry.commonTrans.captrawSourceFrame=geometry.commonTrans.captrawSourceFrame;
        if(referenceKey.empty()){referenceGeometry.rotate.degree=reference;referenceGeometry.rotate.enabled=reference!=0;}
        const int referenceRotation=referenceGeometry.coarse.rotate-geometry.coarse.rotate;
        const bool mirrorReference=referenceKey.empty()&&(geometry.rotate.captrawSourceBasisSet||adjustments.contains("flipHorizontal")||adjustments.contains("flipVertical"));
        if(mirrorReference){const auto basis=ae::geometrySourceBasis(geometry);referenceGeometry.coarse.hflip=basis.first;referenceGeometry.coarse.vflip=basis.second;}
        const int width=processor->getFullWidth(),height=processor->getFullHeight();
        int referenceWidth=referenceRotation%180?height:width,referenceHeight=referenceRotation%180?width:height;
        if(!geometry.commonTrans.captrawSourceFrame.empty()&&!referenceGeometry.commonTrans.captrawSourceFrame.empty()){
            const auto currentFrame=ae::checkedSourceFrame(Json::parse(geometry.commonTrans.captrawSourceFrame));
            const auto refFrame=ae::checkedSourceFrame(Json::parse(referenceGeometry.commonTrans.captrawSourceFrame));
            const char *x=referenceGeometry.coarse.rotate%180?"height":"width",*y=referenceGeometry.coarse.rotate%180?"width":"height";
            referenceWidth=std::max(2,int(std::lround(referenceWidth*refFrame.at(x).get<double>()/currentFrame.at(x).get<double>())));
            referenceHeight=std::max(2,int(std::lround(referenceHeight*refFrame.at(y).get<double>()/currentFrame.at(y).get<double>())));
        }
        const int authorWidth=referenceRotation%180?referenceHeight:referenceWidth,authorHeight=referenceRotation%180?referenceWidth:referenceHeight;
        const auto map=[&](const std::string &space)->ae::GeometryMap *{
            if(space=="source")return nullptr;
            if(space=="reference"&&(!referenceKey.empty()||reference!=angle||mirrorReference)){
                if(!referenceCoordinates||coordinateReferenceAngle!=reference||coordinateReferenceKey!=referenceKey){
                    referenceCoordinates=std::make_unique<ae::GeometryMap>(referenceGeometry,referenceWidth,referenceHeight,initial->getMetaData(),initial->getImageSource()->getRotateDegree());
                    coordinateReferenceAngle=reference;
                    coordinateReferenceKey=referenceKey;
                }
                return referenceCoordinates.get();
            }
            if(!displayCoordinates)displayCoordinates=std::make_unique<ae::GeometryMap>(geometry,width,height,initial->getMetaData(),initial->getImageSource()->getRotateDegree());
            return displayCoordinates.get();
        };
        auto *input=from==to?nullptr:map(from),*output=from==to?nullptr:map(to);
        Json result=Json::array();
        for(const auto &point:points){
            ae::Coord2D value(point.at("x").get<double>(),point.at("y").get<double>());
            bool valid=true;
            if(input!=output){
                if(from=="reference")value=ae::maskCanvasRotation({value.x*authorWidth/width,value.y*authorHeight/height},authorWidth,authorHeight,referenceRotation);
                if(input)value=input->toSource(value);
                if(from=="reference")value=ae::sourceFramePoint(value,referenceWidth,referenceHeight,width,height,referenceGeometry,geometry);
                if(to=="reference")value=ae::sourceFramePoint(value,width,height,referenceWidth,referenceHeight,geometry,referenceGeometry);
                if(output){ae::Coord2D converted;valid=output->toDisplay(value,converted);if(valid)value=converted;}
                if(to=="reference"&&valid){value=ae::maskCanvasRotation(value,referenceWidth,referenceHeight,-referenceRotation);value.x*=double(width)/authorWidth;value.y*=double(height)/authorHeight;}
            }
            if(valid&&std::isfinite(value.x)&&std::isfinite(value.y))result.push_back({{"x",value.x},{"y",value.y}});
            else result.push_back(nullptr);
        }
        Json response={{"sessionId",id},{"revision",revision},{"width",width},{"height",height},{"referenceAngle",reference},{"points",result}};
        if(!snapshot.is_null())response["geometryReference"]=snapshot;
        return response;
    }
    Json repairSource(const Json &request){
        if(!processor||!initial||!initialized)throw std::runtime_error("请先完成照片预览，再自动选择修复来源。");
        if(!request.contains("sessionId")||request.at("sessionId")!=id||!request.contains("revision")||
           !request.at("revision").is_number_integer()||request.at("revision")!=revision)
            throw std::runtime_error("Stale repair source request");
        if(showingBefore)throw std::runtime_error("请退出原图对比后再选择修复来源。");
        const auto number=[&](const char *key,double low,double high){
            const auto &v=request.at(key);
            if(!v.is_number()||!std::isfinite(v.get<double>())||v.get<double>()<low||v.get<double>()>high)
                throw std::runtime_error(std::string("Invalid repair source ")+key);
            return v.get<double>();
        };
        const auto point=[](const Json &p){
            if(!p.is_object())throw std::runtime_error("Invalid repair source point");
            for(const char *axis:{"x","y"})if(!p.contains(axis)||!p.at(axis).is_number()||
               !std::isfinite(p.at(axis).get<double>())||p.at(axis).get<double>()<0||p.at(axis).get<double>()>1)
                throw std::runtime_error("Invalid repair source point");
            return ae::Coord2D(p.at("x").get<double>(),p.at("y").get<double>());
        };
        const auto &path=request.at("path");
        if(!path.is_array()||path.empty()||path.size()>32768)throw std::runtime_error("Expected 1-32768 repair source points");
        RepairSourceSearch search;
        for(const auto &p:path)search.path.push_back(point(p));
        search.radius=number("radius",2,200);search.feather=number("feather",0,100);
        if(!request.at("seed").is_number_integer())throw std::runtime_error("Invalid repair source seed");
        search.seed=uint64_t(number("seed",0,9007199254740991.));
        if(request.contains("exclude"))search.exclude=point(request.at("exclude"));
        // Join ART's updater before borrowing its preview pointer. This also
        // avoids reading/replacing IImage8 while ART reallocates the fit image.
        processor->stopProcessing();
        if(!previewAvailable||!preview||maskFailure||linearFailure)throw std::runtime_error("请等待当前照片显影完成后再选择修复来源。");
        pp::ProcParams rendered;processor->getParams(&rendered);
        // ART projects exact WB multipliers back to display coordinates, and
        // fills the automatic deconvolution radius during rendering. Compare
        // authored settings without mistaking these derived values for a stale frame.
        if(params.wb.method==pp::WBParams::CUSTOM_MULT&&rendered.wb.method==pp::WBParams::CUSTOM_MULT){
            rendered.wb.temperature=params.wb.temperature;rendered.wb.green=params.wb.green;
        }
        if(params.sharpening.deconvAutoRadius&&rendered.sharpening.deconvAutoRadius)
            rendered.sharpening.deconvradius=params.sharpening.deconvradius;
        if(rendered!=params)throw std::runtime_error("当前修复预览尚未就绪，请等待显影后重试。");
        const auto frozen=params;
        const int fullWidth=processor->getFullWidth(),fullHeight=processor->getFullHeight();
        int width=0,height=0;std::vector<unsigned char> rgb;
        {art::utils::MyMutex::MyLock lock(preview->getMutex());
            width=preview->getWidth();height=preview->getHeight();
            if(width<1||height<1)throw std::runtime_error("Empty repair source preview");
            const auto *pixels=preview->getData();rgb.assign(pixels,pixels+size_t(width)*height*3);
        }
        ae::GeometryMap geometry(frozen,fullWidth,fullHeight,initial->getMetaData(),initial->getImageSource()->getRotateDegree());
        int sourceWidth=baseWidth,sourceHeight=baseHeight;
        if(frozen.coarse.rotate%180)std::swap(sourceWidth,sourceHeight);
        const auto match=findRepairSource({rgb.data(),width,height,fullWidth,fullHeight},search,geometry,sourceWidth,sourceHeight,frozen.coarse.rotate);
        return {{"sessionId",id},{"revision",revision},
            {"source",{{"x",match.source.x},{"y",match.source.y}}},{"offset",{{"x",match.offset.x},{"y",match.offset.y}}}};
    }
    Json autoPerspective(const Json &request){
        if(!processor||!initial||!initialized)throw std::runtime_error("请先完成照片预览，再自动校正透视。");
        if(!request.contains("sessionId")||request.at("sessionId")!=id||!request.contains("revision")||
           !request.at("revision").is_number_integer()||request.at("revision")!=revision)
            throw std::runtime_error("照片或调整已变化，请重新自动校正。");
        if(showingBefore)throw std::runtime_error("请退出原图对比后再自动校正。");
        if(baseWidth<3||baseHeight<3)throw std::runtime_error("照片尺寸过小，无法检测直线。");
        const bool guided=request.contains("lines");
        std::string direction;
        std::vector<ae::ControlLine> lines;
        std::vector<ae::Coord2D> sourcePoints;
        if(guided){
            const auto &input=request.at("lines");
            if(!input.is_array()||input.size()<2||input.size()>4)
                throw std::runtime_error("请绘制两条同方向参考线、三条混合方向参考线，或水平垂直各两条参考线。");
            const int width=processor->getFullWidth(),height=processor->getFullHeight();
            auto neutral=params;
            neutral.perspective.enabled=false;
            neutral.perspective.horizontal=neutral.perspective.vertical=neutral.perspective.angle=neutral.perspective.shear=0;
            const auto *metadata=initial->getMetaData();
            const int rawRotation=initial->getImageSource()->getRotateDegree();
            ae::GeometryMap current(params,width,height,metadata,rawRotation),target(neutral,width,height,metadata,rawRotation);
            int horizontal=0,vertical=0;
            for(const auto &line:input){
                if(!line.is_object()||!line.contains("axis")||
                   (line.at("axis")!="horizontal"&&line.at("axis")!="vertical"))
                    throw std::runtime_error("参考线方向无效，请选择水平或垂直。");
                const auto point=[&](const char *key){
                    if(!line.contains(key)||!line.at(key).is_object())throw std::runtime_error("参考线端点无效，请在照片内重新画线。");
                    const auto &p=line.at(key);
                    for(const char *axis:{"x","y"})if(!p.contains(axis)||!p.at(axis).is_number()||!std::isfinite(p.at(axis).get<double>()))
                        throw std::runtime_error("参考线端点无效，请在照片内重新画线。");
                    ae::Coord2D value(p.at("x").get<double>(),p.at("y").get<double>());
                    if(value.x<0||value.y<0||value.x>width-1||value.y>height-1)
                        throw std::runtime_error("参考线端点超出当前照片，请在照片内重新画线。");
                    const auto source=current.toSource(value);
                    if(!std::isfinite(source.x)||!std::isfinite(source.y)||!target.toDisplay(source,value)||!std::isfinite(value.x)||!std::isfinite(value.y))
                        throw std::runtime_error("参考线无法映射到原图，请重新画线。");
                    sourcePoints.push_back(source);
                    return value;
                };
                auto start=point("start"),end=point("end");
                if(start.x>end.x||(start.x==end.x&&start.y>end.y))std::swap(start,end);
                ae::ControlLine value{float(start.x),float(start.y),float(end.x),float(end.y),
                    line.at("axis")=="horizontal"?ae::ControlLine::HORIZONTAL:ae::ControlLine::VERTICAL};
                const double dx=value.x2-value.x1,dy=value.y2-value.y1,length=std::hypot(dx,dy);
                if(!std::isfinite(length)||length<=1e-6)throw std::runtime_error("参考线太短，请画更长的参考线。");
                for(const auto &previous:lines)if(previous.type==value.type&&
                    std::abs(dx*(previous.y1-value.y1)-dy*(previous.x1-value.x1))/length<1e-4&&
                    std::abs(dx*(previous.y2-value.y1)-dy*(previous.x2-value.x1))/length<1e-4)
                    throw std::runtime_error("同方向参考线重合，请选择两条不同的直线。");
                lines.push_back(value);
                if(value.type==ae::ControlLine::HORIZONTAL)++horizontal;else ++vertical;
            }
            const bool three=lines.size()==3&&horizontal>0&&vertical>0;
            if(!three&&((horizontal!=0&&horizontal!=2)||(vertical!=0&&vertical!=2)))
                throw std::runtime_error("两条线须同方向，三条线须包含水平和垂直方向，四条线须每个方向各两条。");
            direction=horizontal?(vertical?"both":"horizontal"):"vertical";
        }else{
            if(!request.contains("direction")||!request.at("direction").is_string())throw std::runtime_error("无效的自动透视方向。");
            direction=request.at("direction").get<std::string>();
        }
        if(direction!="horizontal"&&direction!="vertical"&&direction!="both")throw std::runtime_error("无效的自动透视方向。");
        processor->stopProcessing();
        const auto axis=direction=="horizontal"?ae::PerspectiveCorrection::HORIZONTAL:direction=="vertical"?ae::PerspectiveCorrection::VERTICAL:ae::PerspectiveCorrection::BOTH;
        bool success=false;auto candidate=params;
        auto controlLines=lines;
        if(controlLines.size()==3)std::sort(controlLines.begin(),controlLines.end(),[](const auto &a,const auto &b){
            return std::tie(a.type,a.x1,a.y1,a.x2,a.y2)<std::tie(b.type,b.x1,b.y1,b.x2,b.y2);
        });
        // ART fits full coarse-rotated coordinates before perspective, retaining
        // rotate/lens transforms (perspectivecorrection.cc: autocompute/toAshiftLines).
        candidate.perspective=ae::PerspectiveCorrection::autocompute(initial->getImageSource(),axis,&params,initial->getMetaData(),guided?&controlLines:nullptr,&success);
        if(!success)throw std::runtime_error("未找到足够可靠的直线，照片设置未改变。请重新画参考线，或使用手动透视与画线拉直。");
        candidate.perspective.enabled=true;
        auto result=perspectiveSettings(candidate),checked=adjustments;checked["perspective"]=result;
        // Reject an out-of-range solution; clamping would no longer be the solved transform.
        try{applyAdjustments(candidate,checked,baseWidth,baseHeight);}
        catch(const std::exception &){throw std::runtime_error("透视求解结果超出支持范围，照片设置未改变。请重新选择参考线或手动调整。");}
        if(guided){
            // ART's bounded optimizer can report success at its parameter limits
            // while leaving the guides tilted. Never present that as a solved fit.
            ae::GeometryMap solved(candidate,processor->getFullWidth(),processor->getFullHeight(),initial->getMetaData(),initial->getImageSource()->getRotateDegree());
            for(size_t i=0;i<lines.size();++i){
                ae::Coord2D start,end;
                const char *failure="当前范围内无法可靠校正这些参考线，照片设置未改变。请重新画线或手动调整。";
                if(!solved.toDisplay(sourcePoints[2*i],start)||!solved.toDisplay(sourcePoints[2*i+1],end))throw std::runtime_error(failure);
                const double dx=std::abs(end.x-start.x),dy=std::abs(end.y-start.y);
                const double residual=lines[i].type==ae::ControlLine::HORIZONTAL?std::atan2(dy,dx):std::atan2(dx,dy);
                if(!std::isfinite(residual)||std::hypot(dx,dy)<=1e-6||residual>0.1*std::acos(-1.)/180.)throw std::runtime_error(failure);
            }
        }
        return result;
    }
    Json straighten(const Json &request){
        if(!processor||!initial)throw std::runtime_error("请先打开照片，再画线拉直。");
        if(!request.contains("sessionId")||request.at("sessionId")!=id||!request.contains("revision")||
           !request.at("revision").is_number_integer()||request.at("revision")!=revision)
            throw std::runtime_error("照片或调整已变化，请在当前照片上重新画线。");
        if(showingBefore)throw std::runtime_error("请退出原图对比后再画线拉直。");
        const int width=processor->getFullWidth(),height=processor->getFullHeight();
        const auto point=[&](const char *key){
            if(!request.contains(key)||!request.at(key).is_object())throw std::runtime_error("拉直端点无效，请在照片内重新画线。");
            const auto &p=request.at(key);
            for(const char *axis:{"x","y"})if(!p.contains(axis)||!p.at(axis).is_number()||!std::isfinite(p.at(axis).get<double>()))
                throw std::runtime_error("拉直端点无效，请在照片内重新画线。");
            ae::Coord2D q(p.at("x").get<double>(),p.at("y").get<double>());
            if(q.x<-.5||q.y<-.5||q.x>width-.5||q.y>height-.5)throw std::runtime_error("拉直端点超出照片，请在照片内重新画线。");
            return q;
        };
        auto start=point("start"),end=point("end");
        if(std::hypot(end.x-start.x,end.y-start.y)<=1e-6)throw std::runtime_error("拉直线太短，请画一条更长的参考线。");
        const bool horizontal=std::abs(end.x-start.x)>=std::abs(end.y-start.y);
        // Canonical ordering makes both stroke directions follow identical arithmetic.
        if(start.x>end.x||(start.x==end.x&&start.y>end.y))std::swap(start,end);
        const auto *metadata=initial->getMetaData();
        const int rawRotation=initial->getImageSource()->getRotateDegree();
        ae::GeometryMap current(params,width,height,metadata,rawRotation);
        const auto first=current.toSource(start),second=current.toSource(end);
        const double sourceLength=std::hypot(second.x-first.x,second.y-first.y);
        if(!std::isfinite(sourceLength)||sourceLength<=1e-6)throw std::runtime_error("参考线无法映射到原图，请换一条更长的参考线。");
        const double previous=params.rotate.enabled?params.rotate.degree:0;
        const char *failure="当前镜头或透视设置下，所选方向在 ±45° 内无法可靠拉直。请换一条参考线，或先调整透视后重试。";
        // Each map inversion is itself bounded. Cap map construction as well, including
        // refinement and validation after rounding; never clamp a missing root.
        int evaluations=0;
        const auto evaluate=[&](double angle,double &value){
            if(++evaluations>192)throw std::runtime_error(failure);
            auto candidate=params;candidate.rotate.enabled=angle!=0;candidate.rotate.degree=angle;
            ae::GeometryMap map(candidate,width,height,metadata,rawRotation);
            ae::Coord2D a,b;
            if(!map.toDisplay(first,a)||!map.toDisplay(second,b))return false;
            const double dx=b.x-a.x,dy=b.y-a.y,length=std::hypot(dx,dy);
            if(!std::isfinite(length)||length<=1e-6)return false;
            value=(horizontal?dy:dx)/length;
            return std::isfinite(value);
        };
        struct Sample {double angle,value;bool valid;};
        std::vector<Sample> samples;
        for(int i=0;i<=36;++i){double angle=-45+i*2.5,value=0;bool valid=evaluate(angle,value);samples.push_back({angle,value,valid});}
        double value=0;bool valid=evaluate(previous,value);samples.push_back({previous,value,valid});
        std::sort(samples.begin(),samples.end(),[](const Sample &a,const Sample &b){return a.angle<b.angle;});
        std::vector<double> roots;
        for(const auto &s:samples)if(s.valid&&std::abs(s.value)<1e-7)roots.push_back(s.angle);
        for(size_t i=1;i<samples.size();++i){
            auto left=samples[i-1],right=samples[i];
            if(!left.valid||!right.valid||left.value*right.value>=0)continue;
            bool converged=true;
            for(int step=0;step<18&&right.angle-left.angle>1e-5;++step){
                const double middle=(left.angle+right.angle)/2;double residual=0;
                if(!evaluate(middle,residual)){converged=false;break;}
                if(std::abs(residual)<1e-7){left.angle=right.angle=middle;break;}
                if(left.value*residual<=0)right={middle,residual,true};else left={middle,residual,true};
            }
            if(converged)roots.push_back((left.angle+right.angle)/2);
        }
        std::sort(roots.begin(),roots.end(),[&](double a,double b){
            const double da=std::abs(a-previous),db=std::abs(b-previous);return da==db?a<b:da<db;
        });
        for(const double root:roots){
            const double angle=std::round(root*100)/100;double residual=0;
            if(angle< -45||angle>45||!evaluate(angle,residual))continue;
            const double degrees=std::asin(std::min(1.,std::abs(residual)))*180/std::acos(-1.);
            if(degrees<=.02)return {{"angle",angle==0?0:angle},{"axis",horizontal?"horizontal":"vertical"},{"previousAngle",previous},{"residualDegrees",degrees}};
        }
        throw std::runtime_error(failure);
    }
    Json wbResult(const ae::ColorTemp &wb,const std::string &mode,const Json &exactCamera=Json(),const pp::ColorManagementParams *profile=nullptr){
        Json mult=exactCamera;
        if(!mult.is_array()){double r,g,b;wb.getMultipliers(r,g,b);initial->getImageSource()->wbMul2Camera(r,g,b);mult=Json::array({r,g,b});}
        const auto coordinates=whiteBalanceCoordinates(initial->getImageSource(),profile?*profile:params.icm,{mult[0],mult[1],mult[2]});
        const double temp=std::clamp(coordinates[0],1500.,50000.),tint=std::clamp(coordinates[1],-150.,150.);
        const bool approximate=temp!=coordinates[0]||tint!=coordinates[1];
        return {{"temperature",int(std::round(temp))},{"tint",int(std::round(tint))},{"wbMode",mode},{"wbMultipliers",mult},{"wbApproximate",approximate}};
    }
    Json relativeWhiteBalance(const Json &a,const std::string &mode){
        Json result={{"temperature",adjustments.value("temperature",6500.)},{"tint",adjustments.value("tint",0.)},{"wbMode",mode},{"wbMultipliers",nullptr},{"wbApproximate",false},{"relativeWBModel","art-ctl-v1"},{"incrementalTemperature",0},{"incrementalTint",0}};
        if(mode=="camera")return result;
        if(mode!="auto"&&mode!="sample")throw std::runtime_error("已渲染图像不使用相机色温预设。");
        auto *source=initial->getImageSource();int width,height;source->getFullSize(width,height);
        int left=0,top=0,right=width-1,bottom=height-1,skip=std::max(1,int(std::ceil(std::max(width,height)/1024.)));
        std::vector<ae::Coord2D> samples;
        if(mode=="sample"){
            double x=a.at("x").get<double>(),y=a.at("y").get<double>();const int size=a.value("size",11);
            if(!std::isfinite(x)||!std::isfinite(y)||x<0||x>1||y<0||y>1||size<3||size>51||size%2!=1)throw std::runtime_error("Invalid relative WB sample");
            const double ox=x;switch(params.coarse.rotate){case 90:x=1-y;y=ox;break;case 180:x=1-x;y=1-y;break;case 270:x=y;y=1-ox;break;}
            const int dw=processor->getFullWidth(),dh=processor->getFullHeight();
            ae::GeometryMap geometry(params,dw,dh,initial->getMetaData(),source->getRotateDegree());const auto basis=ae::geometrySourceBasis(params);
            left=width;top=height;right=bottom=-1;skip=1;
            for(int yy=-size/2;yy<=size/2;++yy)for(int xx=-size/2;xx<=size/2;++xx){
                auto q=geometry.toSource({x*(dw-1)+xx,y*(dh-1)+yy});q=ae::geometrySourceFlip(q,dw,dh,basis.first,basis.second);q=ae::maskSourceRotation(q,dw,dh,-params.coarse.rotate);
                if(!std::isfinite(q.x)||!std::isfinite(q.y)||q.x<0||q.y<0||q.x>width-1||q.y>height-1)continue;
                samples.push_back(q);left=std::min(left,int(std::floor(q.x)));top=std::min(top,int(std::floor(q.y)));right=std::max(right,int(std::ceil(q.x)));bottom=std::max(bottom,int(std::ceil(q.y)));
            }
            if(samples.empty())throw std::runtime_error("白平衡取样位于图像透明边界之外。");
        }
        ae::PreviewProps region(left,top,right-left+1,bottom-top+1,skip);int w,h;source->getSize(region,w,h);
        ae::Imagefloat pixels(w,h);source->getImage(ae::ColorTemp(),TR_NONE,&pixels,region,params.exposure,params.raw);
        auto icm=params.icm;icm.workingProfile="Rec2020";source->convertColorSpace(&pixels,icm,ae::ColorTemp());
        std::array<double,3> mean{};
        if(mode=="auto")pixels.getAutoWBMultipliers(mean[0],mean[1],mean[2]);
        else{
            for(const auto &q:samples){
                const double x=q.x-left,y=q.y-top;const int x0=int(std::floor(x)),y0=int(std::floor(y)),x1=std::min(x0+1,w-1),y1=std::min(y0+1,h-1);const double fx=x-x0,fy=y-y0;
                for(int c=0;c<3;++c){const auto at=[&](int yy,int xx){return c==0?pixels.r(yy,xx):c==1?pixels.g(yy,xx):pixels.b(yy,xx);};mean[c]+=(1-fy)*((1-fx)*at(y0,x0)+fx*at(y0,x1))+fy*((1-fx)*at(y1,x0)+fx*at(y1,x1));}
            }
            for(double &v:mean)v/=samples.size();
        }
        const auto solved=solveRelativeWhiteBalance(mean);result["incrementalTemperature"]=int(solved[0]);result["incrementalTint"]=int(solved[1]);result["wbApproximate"]=solved[2]>1e-5;
        return result;
    }
    Json whiteBalance(const Json &a){
        if(!processor||!previewAvailable)throw std::runtime_error("请等待照片预览完成后再设置白平衡。");
        processor->stopProcessing();const auto mode=a.at("mode").get<std::string>();ae::ColorTemp wb;
        if(!initial->getImageSource()->isRAW()&&mode!="profile")return relativeWhiteBalance(a,mode);
        if(mode=="profile"){
            if(!adjustments.contains("wbMultipliers")||adjustments.at("wbMultipliers").is_null())throw std::runtime_error("当前白平衡没有固定系数，请重新选择配置文件。");
            auto next=adjustments;next["colorProfile"]=a.at("colorProfile");auto candidate=params;
            applyAdjustments(candidate,next,baseWidth,baseHeight);validateInputProfile(candidate.icm);
            auto result=wbResult(wb,adjustments.value("wbMode",std::string("custom")),adjustments.at("wbMultipliers"),&candidate.icm);
            result["colorProfile"]=inputProfileSettings(candidate.icm);return result;
        }
        else if(mode=="camera")processor->getCamWB(wb);
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
        dw=std::clamp(a.value("width",1024),1,processor->getFullWidth()-dx);dh=std::clamp(a.value("height",1024),1,processor->getFullHeight()-dy);
        started=std::chrono::steady_clock::now();
        if(fullDetailContext()&&fullDetailImage){
            if(linearEnabled&&fullDetailLinear)linearWindow(*fullDetailLinear,true,dx,dy,dw,dh);
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
    Json prepareBrush(const Json &a){
        if(!processor||a.at("sessionId")!=id||a.at("revision")!=revision||showingBefore)
            throw std::runtime_error("Stale brush preparation");
        const auto &stroke=a.at("stroke");
        ae::validateBrushProgram({{"version",1},{"strokes",Json::array({stroke})}},true);
        // A dedicated worker enables color sampling and removes owned local masks.
        // Capture full-resolution pre-colorcorrection pixels once, before selection.
        sampleLuminance({{"revision",revision},{"start",stroke.at("points").at(0)}},true);
        if(colorX!=0||colorY!=0||sampleColorCache->getWidth()!=processor->getFullWidth()||sampleColorCache->getHeight()!=processor->getFullHeight())
            throw std::runtime_error("Incomplete brush authoring guide");
        if(maskGeometryReferenceData(stroke.at("geometryReference"))!=maskGeometryReferenceData(maskGeometryReference(params)))
            throw std::runtime_error("Brush authoring geometry changed");
        return ae::prepareBrushCoverage(stroke,*sampleColorCache,params.coarse.rotate,a.at("output"));
    }
    Json sampleCurve(const Json &a){
        if(!processor||showingBefore||a.at("sessionId")!=id||a.at("revision")!=revision)throw std::runtime_error("照片已更新，请重新取样。");
        processor->stopProcessing();
        if(!curveSampler)curveSampler=std::make_unique<CurveSampler>(processor,params);
        curveSampler->prepare(a.at("channel"));
        if(!processor->getHighQualComputed()){
            unsigned long generation;{std::lock_guard<std::mutex> lock(previewMutex);generation=previewGeneration;}
            processor->startProcessing(ae::M_HIGHQUAL);
            bool ready;{std::unique_lock<std::mutex> lock(previewMutex);ready=previewCondition.wait_for(lock,std::chrono::seconds(90),[&]{return previewGeneration>generation;});}
            processor->stopProcessing();
            if(!ready)throw std::runtime_error("曲线高质量取样准备超时，请重试。");
            processor->setHighQualComputed();
        }
        auto result=curveSampler->sample(a.at("point"));result["revision"]=revision;result["sessionId"]=id;return result;
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
        if(a.contains("rating")&&(!a.at("rating").is_number()||!std::isfinite(a.at("rating").get<double>())||!(a.at("rating")==-1||(a.at("rating")>=0&&a.at("rating")<=5))))throw std::runtime_error("Invalid output rating");
        pp::ProcParams p;p.setDefaults();loadProfile(p,a.at("artProfile"));ae::validateManualPerspective(p.perspective);validateInputProfile(p.icm);validateExternalMasks(p);int err=0;
        if(processor)processor->stopProcessing();maskFailure=false;
        const std::string output=a.at("output"),format=a.at("format");
        if(format!="tiff"&&format!="jpeg"&&format!="avif")throw std::runtime_error("Unsupported export format");
        if(format!="avif"&&p.toneCurve.whitePoint>1.)throw std::runtime_error("JPEG 与整数 TIFF 仅支持 SDR。请选择 HDR AVIF，或先保存 XMP 再关闭 HDR 导出；尚未生成输出文件。");
        if(format=="avif"){
            if(a.value("colorSpace",std::string("rec2020"))!="rec2020")throw std::runtime_error("HDR AVIF requires Rec.2020 / PQ");
            p.icm.outputProfile="RTv4_Linear_Rec2020";p.icm.outputIntent=ae::RI_RELATIVE;p.icm.outputBPC=false;
            if(!ae::ICCStore::getInstance()->getProfile(p.icm.outputProfile))throw std::runtime_error("Linear Rec.2020 ICC profile is missing");
        }else if(a.contains("colorSpace")){
            const std::string space=a.at("colorSpace");
            const std::pair<const char*,const char*> profiles[]={{"srgb","RTv4_sRGB"},{"adobe-rgb","RTv4_Medium"},{"prophoto-rgb","RTv4_Large"},{"display-p3","RTv4_DisplayP3"},{"rec2020","RTv4_Rec2020"}};
            const auto found=std::find_if(std::begin(profiles),std::end(profiles),[&](const auto &v){return space==v.first;});
            if(found==std::end(profiles))throw std::runtime_error("Unsupported export color space");
            if(!ae::ICCStore::getInstance()->getProfile(found->second))throw std::runtime_error("Export ICC profile is missing");
            p.icm.outputProfile=found->second;p.icm.outputIntent=ae::RI_RELATIVE;p.icm.outputBPC=true;
        }
        const auto input=a.at("path").get<std::string>();
        std::error_code aliasError;
        if(fs::equivalent(input,output,aliasError))
            throw std::runtime_error("禁止将导出写入原始照片或其文件别名。");
        const auto exportIdentity=ae::sourceContentIdentity(input);
        p.commonTrans.captrawSourceIdentity=exportIdentity.dump();
        int jpegQuality=95,resolution=0;bool tiffUncompressed=false;
        const auto release=[](ae::InitialImage *im){if(im)im->decreaseRef();};
        std::unique_ptr<ae::InitialImage,decltype(release)> loaded(nullptr,release);
        if(a.contains("options")){
            const auto &o=a.at("options"),&s=o.at("size"),&sharp=o.at("sharpen");
            const auto integer=[](const Json &v,int low,int high){return v.is_number_integer()&&v>=low&&v<=high;};
            if(o.contains("resolution")){
                if(!integer(o.at("resolution"),1,999))throw std::runtime_error("Invalid output resolution");
                resolution=o.at("resolution");
            }
            if(o.contains("jpegQuality")){
                if(!integer(o.at("jpegQuality"),0,12))throw std::runtime_error("Invalid JPEG quality");
                jpegQuality=std::max(1,int(std::round(o.at("jpegQuality").get<double>()*100./12.)));
            }
            if(o.contains("tiffCompression")){
                const auto compression=o.at("tiffCompression").get<std::string>();
                if(compression!="zip"&&compression!="none")throw std::runtime_error("Invalid TIFF compression");
                tiffUncompressed=compression=="none";
            }
            const auto mode=s.at("mode").get<std::string>();
            if((mode!="original"&&mode!="long-edge"&&mode!="short-edge"&&mode!="bounds")||!integer(s.at("width"),1,65000)||!integer(s.at("height"),1,65000)||!s.at("dontEnlarge").is_boolean())throw std::runtime_error("Invalid output size");
            if(!sharp.at("enabled").is_boolean()||!integer(sharp.at("amount"),0,300)||!sharp.at("radius").is_number())throw std::runtime_error("Invalid output sharpening");
            const double radius=sharp.at("radius");
            if(!std::isfinite(radius)||radius<.1||radius>3)throw std::runtime_error("Invalid output sharpening radius");
            loaded.reset(ae::InitialImage::load(input,isRaw(input),&err,nullptr,ae::sourceFrameDecode(p)));
            if(err||!loaded)throw std::runtime_error("Cannot decode export source ("+std::to_string(err)+")");
            auto *source=loaded->getImageSource();
            // Match ART's full-quality stage_init dimensions, including sensor border and coarse rotation.
            ae::applySourceFrame(source,p);
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
        std::unique_ptr<ae::IImagefloat> image(ae::processImage(job,err,this));
        if(!image)throw std::runtime_error("Export processing failed ("+std::to_string(err)+")");
        if(maskFailure)throw std::runtime_error("蒙版处理失败，未写入导出文件。请检查设置或资产后重试。");
        if(ae::sourceContentIdentity(input)!=exportIdentity)throw std::runtime_error("Geometry source changed during export");
        const int width=image->getWidth(),height=image->getHeight();
        if(format=="tiff"){
            auto *io=dynamic_cast<ae::ImageIO *>(image.get());
            if(!io)throw std::runtime_error("TIFF encoder options unavailable");
            io->setOutputResolution(resolution);
        }
        Json hdr=nullptr;
        if(format=="avif"){
            auto *floating=dynamic_cast<ae::Imagefloat *>(image.get());if(!floating)throw std::runtime_error("HDR AVIF requires ART floating output");
            setProgress(.85);hdr=saveHDRAVIF(*floating,output,a.value("rating",Json()));setProgress(.98);
        }else err=format=="tiff"?image->saveAsTIFF(output,16,false,tiffUncompressed):image->saveAsJPEG(output,jpegQuality,3);
        image.reset();
        if(err)throw std::runtime_error("Cannot write export ("+std::to_string(err)+")");
        if(format!="avif"&&(a.contains("rating")||resolution)){
            auto metadata=Exiv2::ImageFactory::open(output);metadata->readMetadata();
            if(a.contains("rating"))metadata->xmpData()["Xmp.xmp.Rating"]=a.at("rating").dump();
            if(resolution){
                auto &exif=metadata->exifData();
                exif["Exif.Image.XResolution"]=Exiv2::URational(resolution,1);
                exif["Exif.Image.YResolution"]=Exiv2::URational(resolution,1);
                exif["Exif.Image.ResolutionUnit"]=uint16_t(2);
                auto &xmp=metadata->xmpData();
                xmp["Xmp.tiff.XResolution"]=std::to_string(resolution)+"/1";
                xmp["Xmp.tiff.YResolution"]=std::to_string(resolution)+"/1";
                xmp["Xmp.tiff.ResolutionUnit"]="2";
            }
            // A stale EXIF integer must not override the current standard XMP value.
            if(a.contains("rating"))for(const auto *key:{"Exif.Image.Rating","Exif.Image.RatingPercent"}){
                auto &exif=metadata->exifData();const auto found=exif.findKey(Exiv2::ExifKey(key));if(found!=exif.end())exif.erase(found);
            }
            metadata->writeMetadata();
        }
        Json result={{"path",output},{"outputProfile",format=="avif"?"Rec.2020/PQ":std::string(p.icm.outputProfile)},{"width",width},{"height",height}};
        if(!hdr.is_null())result["hdr"]=hdr;return result;
    }
};
Engine::Engine(const std::string &r,const std::string &c,EventSink sink):impl(std::make_unique<Impl>(r,c,sink)){}
Engine::~Engine()=default;
Json Engine::call(const std::string &method,const Json &p){
    if(method=="metadataPacket")return metadataPacket(p);
    if(method=="outputMetadata")return outputMetadata(p);
    if(method=="inspectInputProfile")return inspectInputProfile(p.at("path"));
    if(method=="inputProfileAsset"){
        pp::ProcParams params;params.setDefaults();loadProfile(params,p.at("artProfile"));
        auto adjustments=p.value("adjustments",Json::object());
        if(adjustments.contains("colorProfile"))applyInputProfile(params.icm,adjustments.at("colorProfile"));
        auto settings=inputProfileSettings(params.icm);std::string path;
        if(settings.at("mode")=="inherited"&&params.icm.inputProfile!="(none)"){
            path=params.icm.inputProfile;if(path.rfind("file:",0)==0)path=path.substr(5);
            if(p.contains("replacement")){
                path=p.at("replacement").get<std::string>();
                params.icm.inputProfile=path.rfind("captraw-profile:",0)==0?path:"file:"+path;
                settings=inputProfileSettings(params.icm);
                adjustments["colorProfile"]=settings;
            }
        }else if(p.contains("replacement"))throw std::runtime_error("配置文件资产没有对应引用。");
        return {{"path",path},{"artProfile",profileText(params)},{"adjustments",adjustments}};
    }
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
        if(params.wb.method==pp::WBParams::CUSTOM_TEMP||params.commonTrans.captrawSourceFrameSaved){
            int error=0;auto *image=ae::InitialImage::load(p.at("path").get<std::string>(),isRaw(p.at("path")),&error,nullptr,ae::sourceFrameDecode(params));
            if(!image||error){if(image)image->decreaseRef();throw std::runtime_error("无法读取原片以转换白平衡。");}
            try{
                ae::applySourceFrame(image->getImageSource(),params);
                if(params.wb.method==pp::WBParams::CUSTOM_TEMP)resolveWhiteBalance(params,image->getImageSource(),p.at("adjustments"));
            }catch(...){image->decreaseRef();throw;}
            image->decreaseRef();
        }
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
        pp::ProcParams params;params.setDefaults();loadProfile(params,p.at("artProfile"));
        auto a=p.at("adjustments");
        if(a.contains("sourceFrame"))ae::attachSourceFrame(params,a.at("sourceFrame"));
        else if(p.contains("sourceFrame"))ae::attachSourceFrame(params,p.at("sourceFrame"));
        Json bindingIdentity;
        if(p.value("bindSourceFrame",false)&&p.contains("sourcePath")){
            bindingIdentity=ae::sourceContentIdentity(p.at("sourcePath"));
            if(p.contains("sourceIdentity")&&ae::checkedContentIdentity(p.at("sourceIdentity"))!=bindingIdentity)
                throw std::runtime_error("Geometry binding source identity changed");
            params.commonTrans.captrawSourceIdentity=bindingIdentity.dump();
        }
        a["masks"]=referencedMasks(a,params,p.value("bindSourceFrame",false));
        applyAdjustments(params,a,1000,1000);
        if(!bindingIdentity.is_null()&&ae::sourceContentIdentity(p.at("sourcePath"))!=bindingIdentity)
            throw std::runtime_error("Geometry binding source changed during validation");
        return {{"colorProfile",inputProfileSettings(params.icm)},{"blackWhite",blackWhiteSettings(params)},{"colorGrading",colorGradingSettings(params)},{"fineRotation",params.rotate.enabled?params.rotate.degree:0},{"perspective",perspectiveSettings(params)},{"masks",a["masks"]},{"geometry",Impl::geometryProjection(params)}};
    }
    if(method=="adjustmentBase"){
        pp::ProcParams params;params.setDefaults();loadProfile(params,p.at("artProfile"));
        return adjustmentBase(params,p.at("groups"));
    }
    if(method=="parametricCurve"){
        ae::DiagonalCurve curve(parametricCurve(p));std::vector<double> samples;
        for(int i=0;i<=512;++i)samples.push_back(curve.getVal(i/512.));
        return {{"samples",samples}};
    }
    if(method=="curve"){
        auto a=defaults();a["curve"]=p.at("points");pp::ProcParams params;params.setDefaults();applyAdjustments(params,a,1000,1000);
        ae::DiagonalCurve curve(params.toneCurve.curve);std::vector<double> samples;for(int i=0;i<=512;i++)samples.push_back(curve.getVal(i/512.0));return {{"samples",samples}};
    }
    if(method=="open"){try{return impl->open(p);}catch(...){impl->close();throw;}}
    if(method=="update")return impl->update(p);
    if(method=="before")return impl->update(p,true);
    if(method=="whiteBalance")return impl->whiteBalance(p);
    if(method=="coordinates")return impl->coordinates(p);
    if(method=="repairSource")return impl->repairSource(p);
    if(method=="straighten")return impl->straighten(p);
    if(method=="autoPerspective")return impl->autoPerspective(p);
    if(method=="sampleLuminance")return impl->sampleLuminance(p);
    if(method=="sampleColor")return impl->sampleLuminance(p,true);
    if(method=="sampleCurve")return impl->sampleCurve(p);
    if(method=="prepareBrush")return impl->prepareBrush(p);
    if(method=="viewport")return impl->viewport(p);
    if(method=="export")return impl->exportImage(p);
    if(method=="close"){impl->close();return Json::object();}
    if(method=="save"){validateExternalMasks(impl->params);return {{"artProfile",profileText(impl->params)}};}
    if(method=="cancel"){if(impl->processor)impl->processor->stopProcessing();return Json::object();}
    throw std::runtime_error("Unknown operation: "+method);
}
}
