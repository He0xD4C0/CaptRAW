#include "segmentation.h"
#include "segmentation-input.h"
#include <CommonCrypto/CommonDigest.h>
#include <png.h>
#include <filesystem>
#include <fstream>
#include <array>
#include <chrono>
#include <cmath>
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
struct Segmentation::Impl {
    Ort::Env env{ORT_LOGGING_LEVEL_WARNING,"captraw-segment"};Ort::SessionOptions options;
    std::unique_ptr<Ort::Session> preprocessor,encoder,decoder;
    std::vector<Ort::Value> features;std::string imageHash;int width=0,height=0;
    Json manifest;fs::path cache;uint64_t sequence=0;std::function<void(const Json &)> events;
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
        preprocessor=load("preprocess.onnx");encoder=load("encoder.onnx");decoder=load("decoder.onnx");fs::create_directories(cache);
    }
    Json predict(const Json &p){
        const auto start=Clock::now();
        if(!p.at("revision").is_number_integer()||p.at("revision")<1||p.at("revision")>9007199254740991LL)throw std::runtime_error("Invalid segmentation revision");
        const auto session=p.at("sessionId").get<std::string>();if(session.empty()||session.size()>128)throw std::runtime_error("Invalid segmentation session");
        for(const char *name:{"width","height"})if(!p.at(name).is_number_integer()||p.at(name)<1||p.at(name)>65000)throw std::runtime_error("Invalid segmentation dimensions");
        const int w=p.at("width"),h=p.at("height");if(int64_t(w)*h>64000000)throw std::runtime_error("Segmentation preview exceeds 64 MP");
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
                for(size_t j=0;j<coverage.size();++j){const bool value=masks[size_t(i)*coverage.size()+j];coverage[j]=value?255:0;count+=value;}
                const auto file=cache/("mask-"+std::to_string(job)+"-"+std::to_string(i)+".png"),temporary=fs::path(file.string()+".tmp");cleanup.push_back(temporary);cleanup.push_back(file);
                png_image png{};png.version=PNG_IMAGE_VERSION;png.width=w;png.height=h;png.format=PNG_FORMAT_GRAY;png.flags=PNG_IMAGE_FLAG_FAST;
                const bool written=png_image_write_to_file(&png,temporary.c_str(),0,coverage.data(),0,nullptr);png_image_free(&png);
                if(!written)throw std::runtime_error("Cannot write segmentation mask");fs::rename(temporary,file);
                candidates.push_back({{"index",i},{"score",scores[i]},{"pixels",count},{"file",file.string()},{"sha256",sha256(readBytes(file,128*1024*1024))}});
            }
        }catch(...){for(const auto &file:cleanup){std::error_code ignored;fs::remove(file,ignored);}throw;}
        return {{"sessionId",session},{"revision",p.at("revision")},{"imageSha256",actual},{"modelId",manifest.at("modelId")},{"width",w},{"height",h},{"selected",selected},{"candidates",candidates},{"cached",reused},{"inputMs",inputMs},{"encodeMs",encodeMs},{"decodeMs",decodeMs},{"writeMs",elapsed(t)},{"elapsedMs",elapsed(start)}};
    }
};
Segmentation::Segmentation(const std::string &models,const std::string &cache,std::function<void(const Json &)> events):impl(std::make_unique<Impl>(models,cache,std::move(events))){}
Segmentation::~Segmentation()=default;
Segmentation::Json Segmentation::info()const{return {{"modelId",impl->manifest.at("modelId")},{"runtime",Ort::GetVersionString()},{"telemetryDisabled",true},{"cachedImages",impl->features.empty()?0:1}};}
Segmentation::Json Segmentation::predict(const Json &p){return impl->predict(p);}
void Segmentation::close(){impl->features.clear();impl->imageHash.clear();impl->width=impl->height=0;}
}
