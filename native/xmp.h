#pragma once
#include <string>
#define TXMP_STRING_TYPE std::string
#ifndef XMP_INCLUDE_XMPFILES
#define XMP_INCLUDE_XMPFILES 0
#endif
#include "XMP.hpp"
#include <nlohmann/json.hpp>
namespace captraw::xmp {
using Json=nlohmann::json;
constexpr const char *extension="https://captraw.org/ns/develop/1.0/";
void initialize();
SXMPMeta parse(const std::string &packet);
Json properties(const SXMPMeta &meta);
void update(SXMPMeta &meta,const Json &changes);
std::string serialize(const SXMPMeta &meta);
}
