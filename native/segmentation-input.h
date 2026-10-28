#pragma once
#include <onnxruntime_cxx_api.h>
#include <string>
#include <vector>
namespace captraw {
// The caller provides an already oriented sRGB RGB8 preview from the engine.
// This boundary deliberately performs no additional profile/EXIF conversion.
struct SegmentationRgb { int width, height; std::vector<uint8_t> pixels; };
SegmentationRgb readSegmentationPng(const std::string &path);
SegmentationRgb readSegmentationPng(const std::vector<uint8_t> &bytes);
Ort::Value prepareSegmentationInput(Ort::Session &, const SegmentationRgb &);
Ort::Value preparePersonPartsInput(const SegmentationRgb &);
Ort::Value prepareSubjectInput(const SegmentationRgb &);
}
