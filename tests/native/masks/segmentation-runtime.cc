// Headless deployment proof using the public ONNX Runtime C++ API.
// Accepts engine RGB8 PNG previews or prepared tensors; not desktop integration.
#include "../../../native/include/segmentation-input.h"
#include <onnxruntime_cxx_api.h>
#include <nlohmann/json.hpp>
#include <fstream>
#include <filesystem>
#include <vector>
#include <array>
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <cmath>
#include <png.h>
#include <memory>
namespace fs=std::filesystem;
using Json=nlohmann::json;
using Clock=std::chrono::steady_clock;
static double ms(Clock::time_point start){return std::chrono::duration<double,std::milli>(Clock::now()-start).count();}
int main(int argc,char **argv){try{
 if(argc!=5)throw std::runtime_error("usage: segmentation-runtime model-dir input.png|input.f32 prompts.json output-prefix; or --preprocess input.png preprocess.onnx output.f32");
 const bool preprocessOnly=std::string(argv[1])=="--preprocess",pngInput=fs::path(argv[2]).extension()==".png";
 const auto decodeStart=Clock::now();std::vector<float> pixels;captraw::SegmentationRgb rgb{};
 if(pngInput)rgb=captraw::readSegmentationPng(argv[2]);
 else{
  if(preprocessOnly||fs::path(argv[2]).extension()!=".f32")throw std::runtime_error("Expected an RGB8 PNG or prepared .f32 tensor");
  std::ifstream file(argv[2],std::ios::binary);pixels.resize(3*1024*1024);
  file.read(reinterpret_cast<char*>(pixels.data()),pixels.size()*sizeof(float));if(file.gcount()!=long(pixels.size()*sizeof(float))||file.peek()!=EOF)throw std::runtime_error("Expected normalized CHW float32 1024x1024 tensor");
  for(float p:pixels)if(!std::isfinite(p))throw std::runtime_error("Non-finite image tensor");
 }
 const double inputDecodeMs=ms(decodeStart);
 Ort::Env env(ORT_LOGGING_LEVEL_WARNING,"captraw-probe");env.DisableTelemetryEvents();
 Ort::SessionOptions options;options.SetIntraOpNumThreads(8);options.SetInterOpNumThreads(1);options.DisableMemPattern();
 auto memory=Ort::MemoryInfo::CreateCpu(OrtArenaAllocator,OrtMemTypeDefault);Ort::Value input{nullptr};double preprocessMs=0;std::unique_ptr<Ort::Session> preprocessor;
 if(pngInput){
  const auto t=Clock::now();const fs::path path=preprocessOnly?fs::path(argv[3]):fs::path(argv[1]).parent_path()/"preprocess.onnx";
  preprocessor=std::make_unique<Ort::Session>(env,path.c_str(),options);input=captraw::prepareSegmentationInput(*preprocessor,rgb);preprocessMs=ms(t);
 }else{std::array<int64_t,4> shape{1,3,1024,1024};input=Ort::Value::CreateTensor<float>(memory,pixels.data(),pixels.size(),shape.data(),shape.size());}
 if(preprocessOnly){
  std::ofstream output(argv[4],std::ios::binary);output.write(reinterpret_cast<const char *>(input.GetTensorData<float>()),3*1024*1024*sizeof(float));if(!output)throw std::runtime_error("Cannot write input tensor");
  std::cout<<Json({{"width",rgb.width},{"height",rgb.height},{"inputDecodeMs",inputDecodeMs},{"preprocessMs",preprocessMs}}).dump()<<'\n';return 0;
 }
 Json prompt;std::ifstream(argv[3])>>prompt;
 for(const char *key:{"width","height"})if(!prompt.at(key).is_number_integer()||prompt.at(key)<1||prompt.at(key)>65000)throw std::runtime_error("Invalid prompt dimensions");
 int h=prompt.at("height"),w=prompt.at("width");if(h<1||w<1||h>65000||w>65000||int64_t(h)*w>512000000)throw std::runtime_error("Invalid output size");
 if(pngInput&&(w!=rgb.width||h!=rgb.height))throw std::runtime_error("Prompt dimensions do not match the input preview");
 std::vector<float> coords;std::vector<int32_t> labels;
 if(!prompt.at("points").is_array()||!prompt.at("labels").is_array()||prompt.at("labels").empty()||prompt.at("labels").size()>64||prompt.at("points").size()!=prompt.at("labels").size())throw std::runtime_error("Invalid prompts");
 for(const auto &point:prompt.at("points")){
  if(!point.is_array()||point.size()!=2)throw std::runtime_error("Invalid point");
  const float x=point.at(0),y=point.at(1);if(!std::isfinite(x)||!std::isfinite(y)||x<0||x>w||y<0||y>h)throw std::runtime_error("Point lies outside image bounds");
  coords.push_back(x*1024/w);coords.push_back(y*1024/h);
 }
 for(const auto &label:prompt.at("labels")){if(!label.is_number_integer()||label< -1||label>3)throw std::runtime_error("Invalid point label");labels.push_back(label.get<int32_t>());}
 if(labels.empty()||labels.size()>64||coords.size()!=labels.size()*2)throw std::runtime_error("Invalid prompts");
 const auto started=Clock::now();
 Ort::Session encoder(env,(fs::path(argv[1])/"encoder.onnx").c_str(),options),decoder(env,(fs::path(argv[1])/"decoder.onnx").c_str(),options);
 const double initMs=ms(started);
 const char *inputNames[]={"image"},*featuresNames[]={"image_features_0","image_features_1","image_embeddings"};
 auto t=Clock::now();auto features=encoder.Run(Ort::RunOptions{nullptr},inputNames,&input,1,featuresNames,3);const double encodeMs=ms(t);
 std::array<int64_t,3> pointsShape{1,int64_t(labels.size()),2};std::array<int64_t,2> labelsShape{1,int64_t(labels.size())};std::array<int64_t,4> maskShape{1,1,256,256};int64_t one=1,two=2;
 std::vector<float> prior(256*256,0);float hasPrior=0;std::array<int32_t,2> original{h,w};
 std::vector<Ort::Value> inputs;for(auto &v:features)inputs.push_back(std::move(v));
 inputs.push_back(Ort::Value::CreateTensor<float>(memory,coords.data(),coords.size(),pointsShape.data(),3));
 inputs.push_back(Ort::Value::CreateTensor<int32_t>(memory,labels.data(),labels.size(),labelsShape.data(),2));
 inputs.push_back(Ort::Value::CreateTensor<float>(memory,prior.data(),prior.size(),maskShape.data(),4));
 inputs.push_back(Ort::Value::CreateTensor<float>(memory,&hasPrior,1,&one,1));
 inputs.push_back(Ort::Value::CreateTensor<int32_t>(memory,original.data(),2,&two,1));
 const char *names[]={"image_features_0","image_features_1","image_embeddings","point_coords","point_labels","input_masks","has_input_masks","original_image_size"};
 const char *outputs[]={"masks","iou_predictions","low_res_masks"};
 t=Clock::now();auto result=decoder.Run(Ort::RunOptions{nullptr},names,inputs.data(),inputs.size(),outputs,3);const double decodeMs=ms(t);
 const auto maskInfo=result[0].GetTensorTypeAndShapeInfo(),scoreInfo=result[1].GetTensorTypeAndShapeInfo();
 if(maskInfo.GetShape()!=std::vector<int64_t>{1,3,h,w}||maskInfo.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_BOOL||scoreInfo.GetShape()!=std::vector<int64_t>{1,3}||scoreInfo.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT)throw std::runtime_error("Unexpected mask or score shape");
 auto *scores=result[1].GetTensorData<float>();int selected=0;for(int i=1;i<3;++i)if(scores[i]>scores[selected])selected=i;
 for(int i=0;i<3;++i)if(!std::isfinite(scores[i]))throw std::runtime_error("Non-finite segmentation score");
 const auto *mask=result[0].GetTensorData<bool>()+size_t(selected)*w*h;std::vector<uint8_t> bytes(size_t(w)*h);size_t count=0;
 for(size_t i=0;i<bytes.size();++i){bytes[i]=mask[i]?255:0;count+=mask[i];}
 std::ofstream raw(std::string(argv[4])+".mask",std::ios::binary);raw.write(reinterpret_cast<char*>(bytes.data()),bytes.size());if(!raw)throw std::runtime_error("Cannot write mask");
 png_image output{};output.version=PNG_IMAGE_VERSION;output.width=w;output.height=h;output.format=PNG_FORMAT_GRAY;
 if(!png_image_write_to_file(&output,(std::string(argv[4])+".png").c_str(),0,bytes.data(),0,nullptr))throw std::runtime_error("Cannot write mask PNG");
 Json report={{"runtime",Ort::GetVersionString()},{"inputType",pngInput?"png":"f32"},{"width",w},{"height",h},{"selected",selected},{"selectedPixels",count},{"scores",{scores[0],scores[1],scores[2]}},{"inputDecodeMs",inputDecodeMs},{"preprocessMs",preprocessMs},{"initMs",initMs},{"encodeMs",encodeMs},{"decodeMs",decodeMs},{"headless",true},{"telemetryDisabled",true}};
 std::ofstream(std::string(argv[4])+".json")<<report.dump(2)<<'\n';std::cout<<report.dump()<<'\n';return 0;
 }catch(const std::exception &e){std::cerr<<e.what()<<'\n';return 1;}}
