#pragma once
#include "core.h"
namespace captraw {
// Inspect a local DCP/ICC/ICM file; throws std::runtime_error on invalid input.
Json inspectInputProfile(const std::string &path);
}
