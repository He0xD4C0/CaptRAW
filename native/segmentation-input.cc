#include "segmentation-input.h"
#include <png.h>
#include <array>
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
}
