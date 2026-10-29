#pragma once
#include "engine/coord2d.h"
#include "engine/procparams.h"
#include <memory>

namespace art { namespace engine {
class FramesMetaData;
// Pixel centers in the full, coarse-rotated image, before/after ART's geometric
// stages. Source retains the document's inherited source canvas; display
// includes current ART coarse flips. Crop offsets and normalized UI coordinates
// belong at the call site.
class GeometryMap {
public:
    GeometryMap(const procparams::ProcParams &, int width, int height,
                const FramesMetaData *, int rawRotation,
                int fullWidth = 0, int fullHeight = 0);
    ~GeometryMap();
    Coord2D toSource(Coord2D display, int channel = 1);
    // A failed inverse is explicit; never pin an unmappable point to an edge.
    bool toDisplay(Coord2D source, Coord2D &display, int channel = 1);
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
}} // namespace art::engine
