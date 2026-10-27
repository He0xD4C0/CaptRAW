#pragma once
#include "core.h"
#include "engine/procparams.h"
namespace captraw {
std::vector<double> parametricCurve(const Json &);
Json defaults(double temperature, double green);
Json inputProfileSettings(const art::engine::procparams::ColorManagementParams &);
Json blackWhiteSettings(const art::engine::procparams::ProcParams &);
Json colorGradingSettings(const art::engine::procparams::ProcParams &);
Json spotSettings(const art::engine::procparams::ProcParams &,int width,int height);
void validateInputProfile(const art::engine::procparams::ColorManagementParams &);
void validateExternalMasks(const art::engine::procparams::ProcParams &);
Json externalMaskAssets(art::engine::procparams::ProcParams &,const Json &replacements,bool validate);
Json rasterMaskAssets(Json &adjustments,const Json &replacements,bool validate);
void applyAdjustments(art::engine::procparams::ProcParams &, const Json &, int width, int height, std::vector<std::string> *maskIds = nullptr);
std::string profileText(const art::engine::procparams::ProcParams &);
void loadProfile(art::engine::procparams::ProcParams &, const std::string &);
}
