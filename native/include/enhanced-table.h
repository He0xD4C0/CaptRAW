#pragma once
// Adapted from RAWmakase, commit e0251f9da4b8b70678388f4ec357ba88f416ac32.
// Copyright (c) 2026 RAWmakase contributors. MIT: native/config/enhanced-profile.LICENSE.
// Source files and SHA-256: native/config/enhanced-profile-sources.json. No DNG SDK code.
#include <array>
#include <cstdint>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>
namespace captraw { namespace enhanced {
using Pixel=std::array<float,3>;
struct Table {
    uint32_t type=0,version=0,dimensions=0,divisions=0,primaries=0,gamma=0,gamut=0,flags=0;
    std::array<uint32_t,3> hsvDimensions{};
    std::array<float,2> bounds{1,1};
    std::vector<Pixel> samples;
    std::string wireMD5,sha256;
    static Table decode(const std::string &encoded);
    nlohmann::json describe() const;
    // HSV input/output: linear ProPhoto RGB, as the upstream Table::apply.
    Pixel applyHSV(Pixel rgb,float profileAmount) const;
    // RGB input/output: linear sRGB-primaries display RGB, as upstream RgbTable::apply.
    Pixel applyRGB(Pixel rgb,float amount) const;
    float rgbAmount(float tableAmount,float profileAmount) const;
    bool isIdentity() const;
};
}}
