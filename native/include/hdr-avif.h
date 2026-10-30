#pragma once
#include "core.h"
namespace art { namespace engine { class Imagefloat; } }
namespace captraw {
// Input is full-resolution linear Rec.2020 with relative white = 65535.
Json saveHDRAVIF(art::engine::Imagefloat &,const std::string &output,const Json &rating);
}
