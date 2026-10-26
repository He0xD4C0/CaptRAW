#pragma once
#include "core.h"
#include "engine/procparams.h"
namespace captraw {
Json defaults(double temperature, double green);
Json inputProfileSettings(const art::engine::procparams::ColorManagementParams &);
void applyAdjustments(art::engine::procparams::ProcParams &, const Json &, int width, int height, std::vector<std::string> *maskIds = nullptr);
std::string profileText(const art::engine::procparams::ProcParams &);
void loadProfile(art::engine::procparams::ProcParams &, const std::string &);
}
