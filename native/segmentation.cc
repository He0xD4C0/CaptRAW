#include "segmentation.h"
#include "segmentation-input.h"
#include <CommonCrypto/CommonDigest.h>
#include <png.h>
#include <filesystem>
#include <fstream>
#include <array>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>
#include <stdexcept>
namespace fs=std::filesystem;
namespace captraw {
using Json=nlohmann::json;
using Clock=std::chrono::steady_clock;
static double elapsed(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
static std::vector<uint8_t> readBytes(const fs::path &path,size_t maximum){
    const auto size=fs::file_size(path);if(!size||size>maximum)throw std::runtime_error("Invalid segmentation file size: "+path.string());
    std::ifstream input(path,std::ios::binary);std::vector<uint8_t> bytes(size);
    input.read(reinterpret_cast<char *>(bytes.data()),size);
    if(input.gcount()!=std::streamsize(size)||input.peek()!=EOF)throw std::runtime_error("Segmentation file changed while reading: "+path.string());
    return bytes;
}
static std::string sha256(const std::vector<uint8_t> &bytes){
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256(bytes.data(),CC_LONG(bytes.size()),digest);
    const char *hex="0123456789abcdef";std::string result;result.reserve(64);
    for(unsigned char byte:digest){result+=hex[byte>>4];result+=hex[byte&15];}return result;
}
struct SkySample {
    int x,y;
    double luma=0,chroma=0,blue=0,detail=0;
};
static SkySample measureSkySample(const SegmentationRgb &rgb,int x,int y){
    const int radius=std::clamp(std::min(rgb.width,rgb.height)/256,1,6),area=radius*2+1;
    double sum[3]{},sumSquared=0;size_t count=0;
    for(int dy=-radius;dy<=radius;++dy)for(int dx=-radius;dx<=radius;++dx){
        const int sx=std::clamp(x+dx,0,rgb.width-1),sy=std::clamp(y+dy,0,rgb.height-1);
        const auto offset=(size_t(sy)*rgb.width+sx)*3;
        for(int channel=0;channel<3;++channel)sum[channel]+=rgb.pixels[offset+channel];
        const double luma=(.2126*rgb.pixels[offset]+.7152*rgb.pixels[offset+1]+.0722*rgb.pixels[offset+2])/255.;
        sumSquared+=luma*luma;++count;
    }
    const std::array<double,3> mean{sum[0]/count/255.,sum[1]/count/255.,sum[2]/count/255.};
    const double luma=.2126*mean[0]+.7152*mean[1]+.0722*mean[2];
    const double variance=std::max(0.,sumSquared/count-luma*luma);
    return {x,y,luma,std::max({mean[0],mean[1],mean[2]})-std::min({mean[0],mean[1],mean[2]}),
            mean[2]-.5*(mean[0]+mean[1]),std::sqrt(variance)};
}
static bool skyLike(const SkySample &sample){
    const bool blueSky=sample.blue>.018&&sample.luma>.06;
    const bool brightSky=sample.luma>.55&&sample.chroma<.16;
    const bool overcast=sample.luma>.28&&sample.chroma<.08;
    return sample.detail<.018&&(blueSky||brightSky||overcast);
}
static std::vector<std::pair<int,int>> automaticSkySeeds(const SegmentationRgb &rgb){
    constexpr int columns=48,rows=12;
    std::vector<SkySample> samples;size_t candidates=0,topSamples=0;
    for(int row=0;row<rows;++row)for(int column=0;column<columns;++column){
        const int x=std::min(rgb.width-1,std::max(0,int((column+.5)*rgb.width/columns)));
        const int y=std::min(rgb.height-1,std::max(0,int((.03+.24*(row+.5)/rows)*rgb.height)));
        const auto sample=measureSkySample(rgb,x,y);samples.push_back(sample);++topSamples;
        if(skyLike(sample))++candidates;
    }
    if(candidates<9||candidates*5<topSamples)return {};
    std::vector<std::pair<int,int>> seeds;
    for(int quarter=0;quarter<4;++quarter){
        double bestScore=-std::numeric_limits<double>::infinity();SkySample best{};
        for(const auto &sample:samples){
            const double xfraction=double(sample.x)/rgb.width,yfraction=double(sample.y)/rgb.height;
            if(xfraction<quarter*.25||xfraction>=(quarter+1)*.25||!skyLike(sample))continue;
            const double score=sample.luma+1.8*std::max(0.,sample.blue)+.35*(1.-sample.chroma)
                -4.*sample.detail+.35*(.27-yfraction);
            if(score>bestScore){bestScore=score;best=sample;}
        }
        if(bestScore>-std::numeric_limits<double>::infinity()){
            const auto duplicate=std::find_if(seeds.begin(),seeds.end(),[&](const auto &seed){
                return seed.first==best.x&&seed.second==best.y;
            });
            if(duplicate==seeds.end())seeds.emplace_back(best.x,best.y);
        }
    }
    return seeds.size()>=3?seeds:std::vector<std::pair<int,int>>{};
}
struct Segmentation::Impl {
    Ort::Env env{ORT_LOGGING_LEVEL_WARNING,"captraw-segment"};Ort::SessionOptions options;
    std::unique_ptr<Ort::Session> preprocessor,encoder,decoder,personParts,subject;
    std::vector<Ort::Value> features;std::string imageHash;int width=0,height=0;
    std::vector<float> subjectProbability;std::string subjectImageHash;int subjectWidth=0,subjectHeight=0;
    Json manifest,personPartsManifest,subjectManifest;fs::path cache;uint64_t sequence=0;std::function<void(const Json &)> events;
    Impl(const std::string &models,const std::string &directory,std::function<void(const Json &)> sink):cache(directory),events(std::move(sink)){
        env.DisableTelemetryEvents();options.SetIntraOpNumThreads(8);options.SetInterOpNumThreads(1);options.DisableMemPattern();
        const auto bytes=readBytes(fs::path(models)/"manifest.json",16384);manifest=Json::parse(bytes);
        if(manifest.at("schemaVersion")!=1||!manifest.at("modelId").is_string()||manifest.at("modelId").get<std::string>().size()>128)throw std::runtime_error("Unsupported segmentation manifest");
        const auto load=[&](const char *name){
            const auto bytes=readBytes(fs::path(models)/name,256*1024*1024);const auto &expected=manifest.at("files").at(name);
            if(expected.at("bytes")!=bytes.size()||expected.at("sha256")!=sha256(bytes))throw std::runtime_error(std::string("Segmentation model checksum mismatch: ")+name);
            // Parse the same bytes that were checked, not a second read of a mutable file.
            return std::make_unique<Ort::Session>(env,bytes.data(),bytes.size(),options);
        };
        preprocessor=load("preprocess.onnx");encoder=load("encoder.onnx");decoder=load("decoder.onnx");
        const fs::path personModels=fs::path(models).parent_path()/"person-parts",personManifestPath=personModels/"manifest.json",personModelPath=personModels/"model.onnx";
        personPartsManifest=Json::parse(readBytes(personManifestPath,16384));
        if(personPartsManifest.at("schemaVersion")!=1||!personPartsManifest.at("modelId").is_string())throw std::runtime_error("Unsupported person-parts manifest");
        const auto personBytes=readBytes(personModelPath,256*1024*1024);
        const auto &personExpected=personPartsManifest.at("files").at("model.onnx");
        if(personExpected.at("bytes")!=personBytes.size()||personExpected.at("sha256")!=sha256(personBytes))throw std::runtime_error("Person-parts model checksum mismatch");
        personParts=std::make_unique<Ort::Session>(env,personBytes.data(),personBytes.size(),options);
        const fs::path subjectModels=fs::path(models).parent_path()/"subject",subjectManifestPath=subjectModels/"manifest.json",subjectModelPath=subjectModels/"model.onnx";
        subjectManifest=Json::parse(readBytes(subjectManifestPath,16384));
        if(subjectManifest.at("schemaVersion")!=1||!subjectManifest.at("modelId").is_string())throw std::runtime_error("Unsupported subject manifest");
        const auto subjectBytes=readBytes(subjectModelPath,512*1024*1024);
        const auto &subjectExpected=subjectManifest.at("files").at("model.onnx");
        if(subjectExpected.at("bytes")!=subjectBytes.size()||subjectExpected.at("sha256")!=sha256(subjectBytes))throw std::runtime_error("Subject model checksum mismatch");
        subject=std::make_unique<Ort::Session>(env,subjectBytes.data(),subjectBytes.size(),options);fs::create_directories(cache);
    }
    Json predict(const Json &p){
        const auto start=Clock::now();
        if(!p.at("revision").is_number_integer()||p.at("revision")<1||p.at("revision")>9007199254740991LL)throw std::runtime_error("Invalid segmentation revision");
        const auto session=p.at("sessionId").get<std::string>();if(session.empty()||session.size()>128)throw std::runtime_error("Invalid segmentation session");
        for(const char *name:{"width","height"})if(!p.at(name).is_number_integer()||p.at(name)<1||p.at(name)>65000)throw std::runtime_error("Invalid segmentation dimensions");
        const int w=p.at("width"),h=p.at("height");if(int64_t(w)*h>64000000)throw std::runtime_error("Segmentation preview exceeds 64 MP");
        int rotation=0;
        if(p.contains("outputRotation")){
            const auto &value=p.at("outputRotation");if(!value.is_number())throw std::runtime_error("Invalid segmentation output rotation");
            const double angle=value.get<double>();
            if(!std::isfinite(angle)||(angle!=0&&angle!=90&&angle!=180&&angle!=270))throw std::runtime_error("Invalid segmentation output rotation");
            rotation=int(angle);
        }
        const int maskWidth=rotation==90||rotation==270?h:w,maskHeight=rotation==90||rotation==270?w:h;
        const auto &points=p.at("points"),&labels=p.at("labels");
        if(!points.is_array()||!labels.is_array()||labels.empty()||labels.size()>64||points.size()!=labels.size())throw std::runtime_error("Invalid segmentation prompts");
        std::vector<float> coords;std::vector<int32_t> kinds;
        for(size_t i=0;i<points.size();++i){
            const auto &point=points[i];if(!point.is_array()||point.size()!=2||!point[0].is_number()||!point[1].is_number())throw std::runtime_error("Invalid segmentation point");
            const float x=point[0],y=point[1];if(!std::isfinite(x)||!std::isfinite(y)||x<0||x>w||y<0||y>h)throw std::runtime_error("Segmentation point is outside image");
            if(!labels[i].is_number_integer()||labels[i]< -1||labels[i]>3)throw std::runtime_error("Invalid segmentation label");
            const int kind=labels[i];if(kind>=2&&(i>1||kind!=int(i)+2))throw std::runtime_error("Box corners must be the first two prompts");
            coords.push_back(x*1024/w);coords.push_back(y*1024/h);kinds.push_back(kind);
        }
        if(kinds[0]==2&&(kinds.size()<2||kinds[1]!=3||coords[0]>=coords[2]||coords[1]>=coords[3]))throw std::runtime_error("Invalid segmentation box");
        if(kinds.size()>1&&kinds[1]==3&&kinds[0]!=2)throw std::runtime_error("Missing first box corner");
        const auto expected=p.at("imageSha256").get<std::string>();
        const auto bytes=readBytes(p.at("path").get<std::string>(),256*1024*1024);const auto actual=sha256(bytes);
        if(expected!=actual)throw std::runtime_error("Segmentation input checksum mismatch; request a fresh preview");
        bool reused=actual==imageHash&&!features.empty();double inputMs=0,encodeMs=0;
        const auto stage=[&](const char *name){events({{"event","segment-stage"},{"stage",name},{"sessionId",session},{"revision",p.at("revision")}});};
        if(reused){if(width!=w||height!=h)throw std::runtime_error("Prompt dimensions do not match cached preview");}
        else{
            auto t=Clock::now();stage("prepare");auto rgb=readSegmentationPng(bytes);
            if(rgb.width!=w||rgb.height!=h)throw std::runtime_error("Prompt dimensions do not match preview");
            auto input=prepareSegmentationInput(*preprocessor,rgb);inputMs=elapsed(t);
            const char *inputNames[]={"image"},*outputs[]={"image_features_0","image_features_1","image_embeddings"};
            stage("encode");t=Clock::now();auto next=encoder->Run(Ort::RunOptions{nullptr},inputNames,&input,1,outputs,3);encodeMs=elapsed(t);
            const std::array<std::vector<int64_t>,3> shapes{{{1,32,256,256},{1,64,128,128},{1,256,64,64}}};
            for(size_t i=0;i<next.size();++i){const auto info=next[i].GetTensorTypeAndShapeInfo();if(info.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT||info.GetShape()!=shapes[i])throw std::runtime_error("Unexpected segmentation feature shape");}
            features=std::move(next);imageHash=actual;width=w;height=h;
        }
        auto memory=Ort::MemoryInfo::CreateCpu(OrtArenaAllocator,OrtMemTypeDefault);
        std::vector<Ort::Value> inputs;for(auto &feature:features){const auto info=feature.GetTensorTypeAndShapeInfo();const auto shape=info.GetShape();inputs.push_back(Ort::Value::CreateTensor<float>(memory,feature.GetTensorMutableData<float>(),info.GetElementCount(),shape.data(),shape.size()));}
        const std::array<int64_t,3> pointShape{1,int64_t(kinds.size()),2};const std::array<int64_t,2> kindShape{1,int64_t(kinds.size())};const std::array<int64_t,4> maskShape{1,1,256,256};int64_t one=1,two=2;
        std::vector<float> prior(256*256,0);float hasPrior=0;std::array<int32_t,2> original{h,w};
        inputs.push_back(Ort::Value::CreateTensor<float>(memory,coords.data(),coords.size(),pointShape.data(),3));
        inputs.push_back(Ort::Value::CreateTensor<int32_t>(memory,kinds.data(),kinds.size(),kindShape.data(),2));
        inputs.push_back(Ort::Value::CreateTensor<float>(memory,prior.data(),prior.size(),maskShape.data(),4));
        inputs.push_back(Ort::Value::CreateTensor<float>(memory,&hasPrior,1,&one,1));
        inputs.push_back(Ort::Value::CreateTensor<int32_t>(memory,original.data(),2,&two,1));
        const char *names[]={"image_features_0","image_features_1","image_embeddings","point_coords","point_labels","input_masks","has_input_masks","original_image_size"},*outputs[]={"masks","iou_predictions"};
        stage("decode");auto t=Clock::now();auto values=decoder->Run(Ort::RunOptions{nullptr},names,inputs.data(),inputs.size(),outputs,2);const double decodeMs=elapsed(t);
        const auto mi=values[0].GetTensorTypeAndShapeInfo(),si=values[1].GetTensorTypeAndShapeInfo();
        if(mi.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_BOOL||mi.GetShape()!=std::vector<int64_t>{1,3,h,w}||si.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT||si.GetShape()!=std::vector<int64_t>{1,3})throw std::runtime_error("Unexpected segmentation result");
        const auto *scores=values[1].GetTensorData<float>();int selected=0;for(int i=0;i<3;++i){if(!std::isfinite(scores[i]))throw std::runtime_error("Invalid segmentation score");if(scores[i]>scores[selected])selected=i;}
        const auto *masks=values[0].GetTensorData<bool>();Json candidates=Json::array();std::vector<fs::path> cleanup;
        stage("write");t=Clock::now();const auto job=++sequence;
        try{
            for(int i=0;i<3;++i){
                std::vector<uint8_t> coverage(size_t(w)*h);size_t count=0;
                for(size_t j=0;j<coverage.size();++j){
                    const bool value=masks[size_t(i)*coverage.size()+j];size_t target=j;
                    // Undo the input's clockwise coarse rotation without resampling coverage.
                    if(rotation==90)target=(w-1-j%w)*h+j/w;
                    else if(rotation==180)target=coverage.size()-1-j;
                    else if(rotation==270)target=(j%w)*h+h-1-j/w;
                    coverage[target]=value?255:0;count+=value;
                }
                const auto file=cache/("mask-"+std::to_string(job)+"-"+std::to_string(i)+".png"),temporary=fs::path(file.string()+".tmp");cleanup.push_back(temporary);cleanup.push_back(file);
                png_image png{};png.version=PNG_IMAGE_VERSION;png.width=maskWidth;png.height=maskHeight;png.format=PNG_FORMAT_GRAY;png.flags=PNG_IMAGE_FLAG_FAST;
                const bool written=png_image_write_to_file(&png,temporary.c_str(),0,coverage.data(),0,nullptr);png_image_free(&png);
                if(!written)throw std::runtime_error("Cannot write segmentation mask");fs::rename(temporary,file);
                candidates.push_back({{"index",i},{"score",scores[i]},{"pixels",count},{"file",file.string()},{"sha256",sha256(readBytes(file,128*1024*1024))}});
            }
        }catch(...){for(const auto &file:cleanup){std::error_code ignored;fs::remove(file,ignored);}throw;}
        return {{"sessionId",session},{"revision",p.at("revision")},{"imageSha256",actual},{"modelId",manifest.at("modelId")},{"width",w},{"height",h},{"maskWidth",maskWidth},{"maskHeight",maskHeight},{"selected",selected},{"candidates",candidates},{"cached",reused},{"inputMs",inputMs},{"encodeMs",encodeMs},{"decodeMs",decodeMs},{"writeMs",elapsed(t)},{"elapsedMs",elapsed(start)}};
    }
    Json parts(const Json &p){
        const auto start=Clock::now();
        if(!p.at("revision").is_number_integer()||p.at("revision")<1||p.at("revision")>9007199254740991LL)throw std::runtime_error("Invalid person-parts revision");
        const auto session=p.at("sessionId").get<std::string>();if(session.empty()||session.size()>128)throw std::runtime_error("Invalid person-parts session");
        for(const char *name:{"width","height"})if(!p.at(name).is_number_integer()||p.at(name)<1||p.at(name)>65000)throw std::runtime_error("Invalid person-parts dimensions");
        const int w=p.at("width"),h=p.at("height");if(int64_t(w)*h>64000000)throw std::runtime_error("Person-parts preview exceeds 64 MP");
        int rotation=0;
        if(p.contains("outputRotation")){
            const auto angle=p.at("outputRotation").get<double>();if(!std::isfinite(angle)||(angle!=0&&angle!=90&&angle!=180&&angle!=270))throw std::runtime_error("Invalid person-parts output rotation");
            rotation=int(angle);
        }
        const int maskWidth=rotation==90||rotation==270?h:w,maskHeight=rotation==90||rotation==270?w:h;
        const auto expected=p.at("imageSha256").get<std::string>();
        const auto bytes=readBytes(p.at("path").get<std::string>(),256*1024*1024);const auto actual=sha256(bytes);
        if(expected!=actual)throw std::runtime_error("Person-parts input checksum mismatch; request a fresh preview");
        const auto stage=[&](const char *name){events({{"event","segment-stage"},{"stage",name},{"sessionId",session},{"revision",p.at("revision")}});};
        auto t=Clock::now();stage("prepare");auto rgb=readSegmentationPng(bytes);if(rgb.width!=w||rgb.height!=h)throw std::runtime_error("Person-parts dimensions do not match preview");
        auto input=preparePersonPartsInput(rgb);const double inputMs=elapsed(t);
        Ort::AllocatorWithDefaultOptions allocator;auto inputName=personParts->GetInputNameAllocated(0,allocator),outputName=personParts->GetOutputNameAllocated(0,allocator);
        const char *inputNames[]={inputName.get()},*outputNames[]={outputName.get()};
        stage("decode");t=Clock::now();auto output=personParts->Run(Ort::RunOptions{nullptr},inputNames,&input,1,outputNames,1);const double decodeMs=elapsed(t);
        const auto info=output[0].GetTensorTypeAndShapeInfo();
        if(info.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT||info.GetShape()!=std::vector<int64_t>{1,256,256,6})throw std::runtime_error("Unexpected person-parts result");
        const auto *logits=output[0].GetTensorData<float>();std::vector<uint8_t> labels(256*256);
        for(size_t pixel=0;pixel<labels.size();++pixel){int best=0;for(int channel=0;channel<6;++channel){const float value=logits[pixel*6+channel];if(!std::isfinite(value))throw std::runtime_error("Invalid person-parts logit");if(value>logits[pixel*6+best])best=channel;}labels[pixel]=uint8_t(best);}
        static constexpr const char *names[]={"background","hair","bodySkin","faceSkin","clothes","accessories"};Json result=Json::array();std::vector<fs::path> cleanup;
        stage("write");t=Clock::now();const auto job=++sequence;
        try{
            for(int classIndex=1;classIndex<6;++classIndex){
                std::vector<uint8_t> coverage(size_t(maskWidth)*maskHeight);size_t count=0;
                for(int iy=0;iy<h;++iy)for(int ix=0;ix<w;++ix){
                    const int mx=std::min(255,int((int64_t(ix)*2+1)*256/(int64_t(w)*2))),my=std::min(255,int((int64_t(iy)*2+1)*256/(int64_t(h)*2)));
                    const bool selected=labels[size_t(my)*256+mx]==classIndex;size_t target=size_t(iy)*w+ix;
                    if(rotation==90)target=size_t(w-1-ix)*h+iy;
                    else if(rotation==180)target=size_t(w)*h-1-target;
                    else if(rotation==270)target=size_t(ix)*h+h-1-iy;
                    coverage[target]=selected?255:0;count+=selected;
                }
                const auto file=cache/("part-"+std::to_string(job)+"-"+std::to_string(classIndex)+".png"),temporary=fs::path(file.string()+".tmp");cleanup.push_back(temporary);cleanup.push_back(file);
                png_image png{};png.version=PNG_IMAGE_VERSION;png.width=maskWidth;png.height=maskHeight;png.format=PNG_FORMAT_GRAY;png.flags=PNG_IMAGE_FLAG_FAST;
                const bool written=png_image_write_to_file(&png,temporary.c_str(),0,coverage.data(),0,nullptr);png_image_free(&png);
                if(!written)throw std::runtime_error("Cannot write person-parts mask");fs::rename(temporary,file);
                result.push_back({{"part",names[classIndex]},{"classIndex",classIndex},{"pixels",count},{"file",file.string()},{"sha256",sha256(readBytes(file,128*1024*1024))}});
            }
        }catch(...){for(const auto &file:cleanup){std::error_code ignored;fs::remove(file,ignored);}throw;}
        return {{"sessionId",session},{"revision",p.at("revision")},{"imageSha256",actual},{"modelId",personPartsManifest.at("modelId")},{"width",w},{"height",h},{"maskWidth",maskWidth},{"maskHeight",maskHeight},{"parts",result},{"inputMs",inputMs},{"decodeMs",decodeMs},{"writeMs",elapsed(t)},{"elapsedMs",elapsed(start)}};
    }
    Json semanticMasks(const Json &p){
        const auto start=Clock::now();
        if(!p.at("revision").is_number_integer()||p.at("revision")<1||p.at("revision")>9007199254740991LL)throw std::runtime_error("Invalid semantic-mask revision");
        const auto session=p.at("sessionId").get<std::string>();if(session.empty()||session.size()>128)throw std::runtime_error("Invalid semantic-mask session");
        for(const char *name:{"width","height"})if(!p.at(name).is_number_integer()||p.at(name)<1||p.at(name)>65000)throw std::runtime_error("Invalid semantic-mask dimensions");
        const int w=p.at("width"),h=p.at("height");if(int64_t(w)*h>64000000)throw std::runtime_error("Semantic-mask preview exceeds 64 MP");
        int rotation=0;
        if(p.contains("outputRotation")){
            const auto angle=p.at("outputRotation").get<double>();if(!std::isfinite(angle)||(angle!=0&&angle!=90&&angle!=180&&angle!=270))throw std::runtime_error("Invalid semantic-mask output rotation");
            rotation=int(angle);
        }
        const int maskWidth=rotation==90||rotation==270?h:w,maskHeight=rotation==90||rotation==270?w:h;
        const auto expected=p.at("imageSha256").get<std::string>();
        const auto bytes=readBytes(p.at("path").get<std::string>(),256*1024*1024);const auto actual=sha256(bytes);
        if(expected!=actual)throw std::runtime_error("Semantic-mask input checksum mismatch; request a fresh preview");
        const auto stage=[&](const char *name){events({{"event","segment-stage"},{"stage",name},{"sessionId",session},{"revision",p.at("revision")}});};
        bool reused=actual==subjectImageHash&&subjectProbability.size()==320*320&&subjectWidth==w&&subjectHeight==h;
        double inputMs=0,decodeMs=0;
        if(!reused){
            auto t=Clock::now();stage("prepare");auto rgb=readSegmentationPng(bytes);if(rgb.width!=w||rgb.height!=h)throw std::runtime_error("Semantic-mask dimensions do not match preview");
            auto input=prepareSubjectInput(rgb);inputMs=elapsed(t);
            Ort::AllocatorWithDefaultOptions allocator;auto inputName=subject->GetInputNameAllocated(0,allocator),outputName=subject->GetOutputNameAllocated(0,allocator);
            const char *inputNames[]={inputName.get()},*outputNames[]={outputName.get()};
            stage("decode");t=Clock::now();auto output=subject->Run(Ort::RunOptions{nullptr},inputNames,&input,1,outputNames,1);decodeMs=elapsed(t);
            const auto info=output[0].GetTensorTypeAndShapeInfo();
            if(info.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT||info.GetShape()!=std::vector<int64_t>{1,1,320,320})throw std::runtime_error("Unexpected subject result");
            const auto *probability=output[0].GetTensorData<float>();subjectProbability.assign(probability,probability+320*320);
            subjectImageHash=actual;subjectWidth=w;subjectHeight=h;
        }
        Json result=Json::array();std::vector<fs::path> cleanup;
        stage("write");const auto writeStart=Clock::now();const auto job=++sequence;
        try{
            for(int part=0;part<2;++part){
                std::vector<uint8_t> coverage(size_t(maskWidth)*maskHeight);size_t count=0;
                for(int iy=0;iy<h;++iy)for(int ix=0;ix<w;++ix){
                    const int mx=std::min(319,int((int64_t(ix)*2+1)*320/(int64_t(w)*2))),my=std::min(319,int((int64_t(iy)*2+1)*320/(int64_t(h)*2)));const float value=subjectProbability[size_t(my)*320+mx];
                    if(!std::isfinite(value)||value<0||value>1)throw std::runtime_error("Invalid subject probability");
                    const uint8_t subject=uint8_t(std::lround(value*255.f)),covered=part==0?subject:uint8_t(255-subject);size_t target=size_t(iy)*w+ix;
                    if(rotation==90)target=size_t(w-1-ix)*h+iy;
                    else if(rotation==180)target=size_t(w)*h-1-target;
                    else if(rotation==270)target=size_t(ix)*h+h-1-iy;
                    coverage[target]=covered;count+=covered>0;
                }
                const auto file=cache/("semantic-"+std::to_string(job)+"-"+std::to_string(part)+".png"),temporary=fs::path(file.string()+".tmp");cleanup.push_back(temporary);cleanup.push_back(file);
                png_image png{};png.version=PNG_IMAGE_VERSION;png.width=maskWidth;png.height=maskHeight;png.format=PNG_FORMAT_GRAY;png.flags=PNG_IMAGE_FLAG_FAST;
                const bool written=png_image_write_to_file(&png,temporary.c_str(),0,coverage.data(),0,nullptr);png_image_free(&png);
                if(!written)throw std::runtime_error("Cannot write semantic mask");fs::rename(temporary,file);
                result.push_back({{"part",part==0?"subject":"background"},{"classIndex",part},{"pixels",count},{"file",file.string()},{"sha256",sha256(readBytes(file,128*1024*1024))}});
            }
        }catch(...){for(const auto &file:cleanup){std::error_code ignored;fs::remove(file,ignored);}throw;}
        return {{"sessionId",session},{"revision",p.at("revision")},{"imageSha256",actual},{"modelId",subjectManifest.at("modelId")},{"width",w},{"height",h},{"maskWidth",maskWidth},{"maskHeight",maskHeight},{"parts",result},{"cached",reused},{"inputMs",inputMs},{"decodeMs",decodeMs},{"writeMs",elapsed(writeStart)},{"elapsedMs",elapsed(start)}};
    }
    Json sky(const Json &p){
        const auto start=Clock::now();
        if(!p.at("revision").is_number_integer()||p.at("revision")<1||p.at("revision")>9007199254740991LL)throw std::runtime_error("Invalid sky-mask revision");
        const auto session=p.at("sessionId").get<std::string>();if(session.empty()||session.size()>128)throw std::runtime_error("Invalid sky-mask session");
        for(const char *name:{"width","height"})if(!p.at(name).is_number_integer()||p.at(name)<1||p.at(name)>65000)throw std::runtime_error("Invalid sky-mask dimensions");
        const int w=p.at("width"),h=p.at("height");if(int64_t(w)*h>64000000)throw std::runtime_error("Sky-mask preview exceeds 64 MP");
        const auto expected=p.at("imageSha256").get<std::string>();
        const auto bytes=readBytes(p.at("path").get<std::string>(),256*1024*1024);const auto actual=sha256(bytes);
        if(expected!=actual)throw std::runtime_error("Sky-mask input checksum mismatch; request a fresh preview");
        const auto stage=[&](const char *name){events({{"event","segment-stage"},{"stage",name},{"sessionId",session},{"revision",p.at("revision")}});};
        auto t=Clock::now();stage("prepare");auto rgb=readSegmentationPng(bytes);if(rgb.width!=w||rgb.height!=h)throw std::runtime_error("Sky-mask dimensions do not match preview");
        const auto seeds=automaticSkySeeds(rgb);const double seedMs=elapsed(t);
        if(seeds.empty())throw std::runtime_error("未检测到可靠天空；请改用点选或框选。");
        Json prompt=p;prompt["points"]=Json::array();prompt["labels"]=Json::array();
        for(const auto &[x,y]:seeds){prompt["points"].push_back({x,y});prompt["labels"].push_back(1);}
        Json seg=predict(prompt),result;
        const int selected=seg.at("selected");const auto &candidates=seg.at("candidates");
        std::vector<fs::path> candidateFiles;
        if(candidates.is_array())for(const auto &item:candidates)candidateFiles.emplace_back(item.at("file").get<std::string>());
        const auto removeCandidates=[&](){for(const auto &path:candidateFiles){std::error_code ignored;fs::remove(path,ignored);}};
        if(!candidates.is_array()||selected<0||selected>=int(candidates.size())){removeCandidates();throw std::runtime_error("Sky-mask segmentation did not return a candidate");}
        const auto &candidate=candidates[selected];const auto pixels=candidate.at("pixels").get<uint64_t>();
        if(pixels<uint64_t(w)*h/1000){removeCandidates();throw std::runtime_error("自动天空范围过小；请改用点选或框选。");}
        const auto job=++sequence;
        const auto file=cache/("sky-"+std::to_string(job)+".png");
        const auto temporary=fs::path(file.string()+".tmp");
        stage("write");t=Clock::now();
        try{
            fs::copy_file(fs::path(candidate.at("file").get<std::string>()),temporary,fs::copy_options::overwrite_existing);
            fs::rename(temporary,file);
            const auto fileBytes=readBytes(file,128*1024*1024);
            removeCandidates();
            return {{"sessionId",session},{"revision",p.at("revision")},{"imageSha256",actual},{"modelId",manifest.at("modelId")},
                    {"width",w},{"height",h},{"maskWidth",seg.at("maskWidth")},{"maskHeight",seg.at("maskHeight")},
                    {"selected",selected},{"score",candidate.at("score")},{"pixels",pixels},{"file",file.string()},
                    {"sha256",sha256(fileBytes)},{"seedCount",seeds.size()},{"cached",seg.at("cached")},
                    {"seedMs",seedMs},{"inputMs",seg.at("inputMs")},{"encodeMs",seg.at("encodeMs")},
                    {"decodeMs",seg.at("decodeMs")},{"writeMs",elapsed(t)},{"elapsedMs",elapsed(start)}};
        }catch(...){
            removeCandidates();std::error_code ignored;fs::remove(temporary,ignored);fs::remove(file,ignored);
            throw;
        }
    }
};
Segmentation::Segmentation(const std::string &models,const std::string &cache,std::function<void(const Json &)> events):impl(std::make_unique<Impl>(models,cache,std::move(events))){}
Segmentation::~Segmentation()=default;
Segmentation::Json Segmentation::info()const{return {{"modelId",impl->manifest.at("modelId")},{"personPartsModelId",impl->personPartsManifest.at("modelId")},{"subjectModelId",impl->subjectManifest.at("modelId")},{"runtime",Ort::GetVersionString()},{"telemetryDisabled",true},{"cachedImages",impl->features.empty()?0:1}};}
Segmentation::Json Segmentation::predict(const Json &p){return impl->predict(p);}
Segmentation::Json Segmentation::parts(const Json &p){return impl->parts(p);}
Segmentation::Json Segmentation::semanticMasks(const Json &p){return impl->semanticMasks(p);}
Segmentation::Json Segmentation::sky(const Json &p){return impl->sky(p);}
void Segmentation::close(){impl->features.clear();impl->imageHash.clear();impl->width=impl->height=0;impl->subjectProbability.clear();impl->subjectImageHash.clear();impl->subjectWidth=impl->subjectHeight=0;}
}
