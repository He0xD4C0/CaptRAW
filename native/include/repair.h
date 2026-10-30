#pragma once
#include "engine/imagefloat.h"
#include "engine/array2D.h"
#include <vector>

namespace art { namespace engine {
using RepairRelax = void (*)(Imagefloat *, const array2D<int32_t> &);
// One translated source patch and one connected path domain. No per-dab edits.
void repairStroke(Imagefloat *source, Imagefloat *target, int sx, int sy,
                  int tx, int ty, int width, int height,
                  const std::vector<double> &path, double radius,
                  double outerRadius, double opacity, int detail, RepairRelax relax);
}}
