#pragma once
#include "engine/coord2d.h"
#include "geometry-map.h"
#include <cstdint>
#include <optional>
#include <vector>

namespace captraw {
struct RepairSourceImage {
    const unsigned char *rgb;
    int width,height,fullWidth,fullHeight;
};
struct RepairSourceSearch {
    std::vector<art::engine::Coord2D> path;
    double radius,feather;
    uint64_t seed;
    std::optional<art::engine::Coord2D> exclude;
};
struct RepairSourceMatch {
    art::engine::Coord2D source,offset;
};
// Read-only search of native RGB8 pixels. No renderer, PNG or file dependencies.
RepairSourceMatch findRepairSource(const RepairSourceImage &,const RepairSourceSearch &,
                                  art::engine::GeometryMap &,int sourceWidth,int sourceHeight,int rotation);
}
