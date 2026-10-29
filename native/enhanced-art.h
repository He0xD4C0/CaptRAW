#pragma once
#include <memory>
#include "engine/procparams.h"
namespace captraw { namespace enhanced {
// Rendering-only parameter copy; stored user controls and history remain unchanged.
std::unique_ptr<art::engine::procparams::ProcParams> processingParams(const art::engine::procparams::ProcParams &);
}}
