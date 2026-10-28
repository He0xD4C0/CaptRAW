#pragma once
#include "core.h"
#include "engine/procparams.h"
namespace captraw {
std::vector<double> parametricCurve(const Json &);
Json defaults();
Json referencedMasks(const Json &,const art::engine::procparams::ProcParams &);
Json inputProfileSettings(const art::engine::procparams::ColorManagementParams &);
Json blackWhiteSettings(const art::engine::procparams::ProcParams &);
Json perspectiveSettings(const art::engine::procparams::ProcParams &);
Json colorGradingSettings(const art::engine::procparams::ProcParams &);
Json adjustmentBase(const art::engine::procparams::ProcParams &,const Json &groups);
void applyInputProfile(art::engine::procparams::ColorManagementParams &,const Json &);
void validateInputProfile(const art::engine::procparams::ColorManagementParams &);
void validateExternalMasks(const art::engine::procparams::ProcParams &);
Json externalMaskAssets(art::engine::procparams::ProcParams &,const Json &replacements,bool validate);
Json rasterMaskAssets(Json &adjustments,const Json &replacements,bool validate);
void applyAdjustments(art::engine::procparams::ProcParams &, const Json &, int width, int height, std::vector<std::string> *maskIds = nullptr);
std::string profileText(const art::engine::procparams::ProcParams &);
void loadProfile(art::engine::procparams::ProcParams &, const std::string &);
}
