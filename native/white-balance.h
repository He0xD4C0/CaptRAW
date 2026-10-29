#pragma once
#include "engine/imagesource.h"
#include "engine/procparams.h"
#include <array>
namespace captraw {
// CIE 1931 xy: legacy Robertson at >=2000 K, ART Planck extension below.
// Tint retains the existing -3000-scaled uv convention.
std::array<double,2> whiteBalanceXY(double temperature,double tint);
std::array<double,2> whiteBalanceTemperatureTint(const std::array<double,2> &xy);
std::array<double,3> whiteBalanceMultipliers(art::engine::ImageSource *,const art::engine::procparams::ColorManagementParams &,double temperature,double tint);
std::array<double,2> whiteBalanceCoordinates(art::engine::ImageSource *,const art::engine::procparams::ColorManagementParams &,const std::array<double,3> &multipliers);
// ART-ctlscripts wbchmix v1: zero-centred rendered-image offsets in Rec2020.
std::array<double,9> relativeWhiteBalanceMatrix(double temperature,double tint,const Glib::ustring &workingSpace);
// Returns integer offsets and the remaining log-channel neutrality error.
std::array<double,3> solveRelativeWhiteBalance(const std::array<double,3> &mean);
}
