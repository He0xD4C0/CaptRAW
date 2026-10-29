#pragma once
#include <cstdint>
#include <array>
#include <string>
#include <vector>
namespace art { namespace engine { class Imagefloat; namespace procparams { struct ColorManagementParams; } } }
namespace captraw {
struct LinearPixels {
    int width, height;
    std::vector<uint16_t> rgba;
};
LinearPixels linearPixels(art::engine::Imagefloat &,const art::engine::procparams::ColorManagementParams &,int x,int y,int width,int height);
void writeLinearPixels(const LinearPixels &,const std::string &file,int x,int y,int width,int height);
struct HDRHistogram {
    std::array<std::array<uint32_t,512>,3> bins{};
    std::array<uint32_t,3> below{},above{};
};
HDRHistogram linearHistogram(const LinearPixels &,int x,int y,int width,int height,double headroom);
}
