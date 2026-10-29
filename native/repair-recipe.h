#pragma once
#include "core.h"
#include "engine/procparams.h"
namespace captraw {
void applyRepairs(art::engine::procparams::ProcParams &,const Json &,int width,int height,int rotation);
}
