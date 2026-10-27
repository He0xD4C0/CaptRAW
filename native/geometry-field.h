#pragma once
#include "geometry-map.h"
#include "engine/array2D.h"
#include <memory>
#include <stdexcept>

namespace art { namespace engine {
class MaskGeometryError: public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};
// Maps the current render canvas into the reference render canvas. Both maps
// share the same pre-transform source and processing dimensions. They must
// outlive this field. No RGB transform is applied to scalar mask coverage.
class GeometryField {
public:
    GeometryField(GeometryMap &current, GeometryMap &reference,
                  int width, int height, double tolerance = .02);
    ~GeometryField();
    bool map(Coord2D current, Coord2D &reference) const;
    // Offsets are pixel-center coordinates in the two processing canvases.
    // Source bounds extend half a pixel past the first/last center; outside
    // those bounds uses outside (0.5 for encoded signed brush coverage,
    // 1 for subtractive shape backgrounds). Values are never clamped.
    // Numerical inverse failure throws after workers finish; discard output.
    void warp(const array2D<float> &source, Coord2D sourceOrigin,
              array2D<float> &output, Coord2D outputOrigin, bool multithread,
              float outside = 0) const;
    bool isIdentity() const;
    size_t nodeCount() const;
    size_t exactCellCount() const;
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
// Per-processor cache. The caller serializes setSource/get with rendering;
// A returned field is borrowed until subsequent get calls can evict its entry.
// Finish a spatial leaf before resolving another; never retain it over recursion.
class MaskGeometryCache {
public:
    MaskGeometryCache();
    ~MaskGeometryCache();
    void setSource(const FramesMetaData *,int rawRotation,int width,int height,
                   int fullWidth,int fullHeight);
    const GeometryField *get(const procparams::ProcParams &);
    // Explicit leaf reference overrides the global opt-in/reference settings.
    const GeometryField *get(const procparams::ProcParams &, double referenceAngle);
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
}} // namespace art::engine
