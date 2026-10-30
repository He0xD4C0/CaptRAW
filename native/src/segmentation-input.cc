#include "segmentation-input.h"
#include <png.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
namespace captraw {
static SegmentationRgb readPng(const std::string *path,const std::vector<uint8_t> *bytes) {
    struct Image {
        png_image value{};
        Image() { value.version=PNG_IMAGE_VERSION; }
        ~Image() { png_image_free(&value); }
    } holder;
    auto &image=holder.value;
    const bool opened=path?png_image_begin_read_from_file(&image,path->c_str()):png_image_begin_read_from_memory(&image,bytes->data(),bytes->size());
    if(!opened)throw std::runtime_error("Cannot read segmentation preview: "+std::string(image.message));
    if(!image.width||!image.height||image.width>65000||image.height>65000||uint64_t(image.width)*image.height>64000000)
        throw std::runtime_error("Segmentation preview exceeds 64 MP or 65000 pixels per edge");
    if(image.format!=PNG_FORMAT_RGB)throw std::runtime_error("Segmentation requires an opaque RGB8 PNG preview");
    SegmentationRgb rgb{int(image.width),int(image.height),std::vector<uint8_t>(PNG_IMAGE_SIZE(image))};
    if(!png_image_finish_read(&image,nullptr,rgb.pixels.data(),0,nullptr))throw std::runtime_error("Cannot decode segmentation preview: "+std::string(image.message));
    return rgb;
}
SegmentationRgb readSegmentationPng(const std::string &path){return readPng(&path,nullptr);}
SegmentationRgb readSegmentationPng(const std::vector<uint8_t> &bytes){return readPng(nullptr,&bytes);}
Ort::Value prepareSegmentationInput(Ort::Session &session,const SegmentationRgb &rgb) {
    if(rgb.width<1||rgb.height<1||rgb.width>65000||rgb.height>65000||uint64_t(rgb.width)*rgb.height>64000000||rgb.pixels.size()!=size_t(rgb.width)*rgb.height*3)
        throw std::runtime_error("Invalid segmentation RGB buffer");
    auto memory=Ort::MemoryInfo::CreateCpu(OrtArenaAllocator,OrtMemTypeDefault);
    const std::array<int64_t,4> shape{1,rgb.height,rgb.width,3};
    auto input=Ort::Value::CreateTensor<uint8_t>(memory,const_cast<uint8_t *>(rgb.pixels.data()),rgb.pixels.size(),shape.data(),shape.size());
    const char *inputs[]={"rgb"},*outputs[]={"image"};
    auto result=session.Run(Ort::RunOptions{nullptr},inputs,&input,1,outputs,1);
    const auto info=result[0].GetTensorTypeAndShapeInfo();
    if(info.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT||info.GetShape()!=std::vector<int64_t>{1,3,1024,1024})
        throw std::runtime_error("Unexpected segmentation preprocessing output");
    return std::move(result[0]);
}
Ort::Value preparePersonPartsInput(const SegmentationRgb &rgb) {
    if(rgb.width<1||rgb.height<1||rgb.width>65000||rgb.height>65000||uint64_t(rgb.width)*rgb.height>64000000||rgb.pixels.size()!=size_t(rgb.width)*rgb.height*3)
        throw std::runtime_error("Invalid person-parts RGB buffer");
    constexpr int size=256;std::vector<float> input(size_t(size)*size*3);
    const auto sample=[&](int x,int y,int channel){return rgb.pixels[(size_t(y)*rgb.width+x)*3+channel]/255.f;};
    for(int y=0;y<size;++y){
        const double sy=(y+.5)*rgb.height/size-.5;int y0=std::clamp(int(std::floor(sy)),0,rgb.height-1),y1=std::min(y0+1,rgb.height-1);const double fy=std::clamp(sy-y0,0.,1.);
        for(int x=0;x<size;++x){
            const double sx=(x+.5)*rgb.width/size-.5;int x0=std::clamp(int(std::floor(sx)),0,rgb.width-1),x1=std::min(x0+1,rgb.width-1);const double fx=std::clamp(sx-x0,0.,1.);
            for(int c=0;c<3;++c){
                const double top=sample(x0,y0,c)*(1-fx)+sample(x1,y0,c)*fx;
                const double bottom=sample(x0,y1,c)*(1-fx)+sample(x1,y1,c)*fx;
                input[(size_t(y)*size+x)*3+c]=float(top*(1-fy)+bottom*fy);
            }
        }
    }
    auto memory=Ort::MemoryInfo::CreateCpu(OrtArenaAllocator,OrtMemTypeDefault);const std::array<int64_t,4> shape{1,size,size,3};
    return Ort::Value::CreateTensor<float>(memory,input.data(),input.size(),shape.data(),shape.size());
}
Ort::Value prepareSubjectInput(const SegmentationRgb &rgb) {
    if(rgb.width<1||rgb.height<1||rgb.width>65000||rgb.height>65000||uint64_t(rgb.width)*rgb.height>64000000||rgb.pixels.size()!=size_t(rgb.width)*rgb.height*3)
        throw std::runtime_error("Invalid subject RGB buffer");
    constexpr int size=320;std::vector<float> input(size_t(3)*size*size);
    const auto sample=[&](int x,int y,int channel){return rgb.pixels[(size_t(y)*rgb.width+x)*3+channel]/255.f;};
    for(int y=0;y<size;++y){
        const double sy=(y+.5)*rgb.height/size-.5;int y0=std::clamp(int(std::floor(sy)),0,rgb.height-1),y1=std::min(y0+1,rgb.height-1);const double fy=std::clamp(sy-y0,0.,1.);
        for(int x=0;x<size;++x){
            const double sx=(x+.5)*rgb.width/size-.5;int x0=std::clamp(int(std::floor(sx)),0,rgb.width-1),x1=std::min(x0+1,rgb.width-1);const double fx=std::clamp(sx-x0,0.,1.);
            for(int c=0;c<3;++c){
                const double top=sample(x0,y0,c)*(1-fx)+sample(x1,y0,c)*fx;
                const double bottom=sample(x0,y1,c)*(1-fx)+sample(x1,y1,c)*fx;
                input[(size_t(c)*size+y)*size+x]=float(top*(1-fy)+bottom*fy);
            }
        }
    }
    auto memory=Ort::MemoryInfo::CreateCpu(OrtArenaAllocator,OrtMemTypeDefault);const std::array<int64_t,4> shape{1,3,size,size};
    return Ort::Value::CreateTensor<float>(memory,input.data(),input.size(),shape.data(),shape.size());
}
}
