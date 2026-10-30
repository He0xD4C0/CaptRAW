#pragma once
#include "engine/masks.h"
#include <nlohmann/json.hpp>
namespace art { namespace engine {
// The ARP stores this private program; XMP uses the corresponding typed RDF tree.
void validateBrushProgram(const nlohmann::json &program,bool preparing=false);
void brushProgramAssets(nlohmann::json &program,const nlohmann::json &replacements,
                        bool validate,std::vector<std::string> &paths);
bool loadBrushCoverage(const Glib::ustring &,int width,int height,std::shared_ptr<array2D<float>> &);
void applyBrushProgram(const std::string &program,int rotation,bool legacyBase,
                       int x,int y,int width,int height,double scale,array2D<float> &guide,
                       array2D<float> *lightness,array2D<float> *chroma,bool multithread,
                       ProgressListener *,const MaskGeometryResolver &);
// Full-resolution authoring color is sampled once. Output is gray16, no alpha.
nlohmann::json prepareBrushCoverage(const nlohmann::json &stroke,Imagefloat &guide,
                                   int rotation,const std::string &output);
}} // namespace art::engine
