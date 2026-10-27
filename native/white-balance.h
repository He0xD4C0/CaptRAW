#pragma once
#include "engine/imagesource.h"
#include "engine/procparams.h"
#include <array>
namespace captraw {
// CIE 1931 xy <-> Robertson temperature and Adobe's -3000-scaled uv tint.
std::array<double,2> whiteBalanceXY(double temperature,double tint);
std::array<double,2> whiteBalanceTemperatureTint(const std::array<double,2> &xy);
std::array<double,3> whiteBalanceMultipliers(art::engine::ImageSource *,const art::engine::procparams::ColorManagementParams &,double temperature,double tint);
std::array<double,2> whiteBalanceCoordinates(art::engine::ImageSource *,const art::engine::procparams::ColorManagementParams &,const std::array<double,3> &multipliers);
}
