#pragma once
#include "core.h"
namespace captraw {
// Inspect DCP/ICC/ICM or a normalized, asset-complete .look file.
Json inspectInputProfile(const std::string &path);
}
