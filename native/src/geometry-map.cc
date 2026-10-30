#include "geometry-map.h"
#include "geometry-reference.h"
#include "engine/improcfun.h"
#include "engine/perspectivecorrection.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace art { namespace engine {
struct GeometryMap::Impl {
    procparams::ProcParams params;
    ImProcFunctions ipf;
    std::unique_ptr<const LensCorrection> lens;
    PerspectiveCorrection perspective;
    int width, height;
    double scale, perspectiveScale;
    bool lensCA;
    Impl(const procparams::ProcParams &p, int w, int h,
         const FramesMetaData *metadata, int rawRotation, int fullWidth, int fullHeight)
        : params(p), ipf(&params, false), width(w), height(h) {
        if (w < 2 || h < 2) throw std::runtime_error("Invalid geometry dimensions");
        ipf.setScale(1);
        lens = ipf.getLensCorrection(w, h, metadata, rawRotation);
        scale = params.perspective.captrawFill(params.commonTrans.autofill) ? ipf.getTransformAutoFill(w, h, lens.get()) : 1;
        // Keep ART's actual autofill above, which also sees retained disabled
        // CA values. Only the subsequent pixel sampling ignores disabled CA.
        if (!params.cacorrection.enabled) {
            params.cacorrection.red = params.cacorrection.blue = 0;
        }
        if (!fullWidth && !fullHeight) { fullWidth=w; fullHeight=h; }
        if (fullWidth<w || fullHeight<h) throw std::runtime_error("Invalid full geometry dimensions");
        perspectiveScale=double(fullWidth)/w;
        perspective.init(fullWidth, fullHeight, params.perspective, params.commonTrans.autofill, metadata);
        lensCA = lens && params.lensProf.useCA && lens->isCACorrectionAvailable();
    }
    Coord2D source(Coord2D point, int channel) {
        if (channel < 0 || channel > 2 || !std::isfinite(point.x) || !std::isfinite(point.y))
            throw std::runtime_error("Invalid geometry coordinate");
        // Inverse of transform(): perspective, lens CA, then the combined
        // lens distortion / autofill / fine rotation / manual distortion / CA.
        point.x*=perspectiveScale; point.y*=perspectiveScale;
        perspective(point.x, point.y);
        point.x/=perspectiveScale; point.y/=perspectiveScale;
        if (lensCA) lens->correctCA(point.x, point.y, 0, 0, channel);
        std::vector<Coord2D> red, green, blue;
        ipf.transCoord(width, height, {point}, red, green, blue, scale, lens.get(), false);
        auto result=channel == 0 ? red[0] : channel == 1 ? green[0] : blue[0];
        // Retain the document's original coarse source canvas (unflipped for
        // neutral documents), including inherited legacy anchor reflections.
        const auto basis=geometrySourceBasis(params);
        if(params.coarse.hflip!=basis.first)result.x=width-1-result.x;
        if(params.coarse.vflip!=basis.second)result.y=height-1-result.y;
        return result;
    }
};
GeometryMap::GeometryMap(const procparams::ProcParams &p, int w, int h,
                         const FramesMetaData *metadata, int rawRotation, int fullWidth, int fullHeight)
    : impl(new Impl(p, w, h, metadata, rawRotation, fullWidth, fullHeight)) {}
GeometryMap::~GeometryMap() = default;
Coord2D GeometryMap::toSource(Coord2D point, int channel) { return impl->source(point, channel); }
bool GeometryMap::toDisplay(Coord2D target, Coord2D &display, int channel) {
    if (!std::isfinite(target.x) || !std::isfinite(target.y) || channel < 0 || channel > 2)
        throw std::runtime_error("Invalid geometry coordinate");
    Coord2D point = target;
    const auto distance = [&](Coord2D p) { return std::hypot(p.x-target.x, p.y-target.y); };
    for (int iteration=0; iteration<24; ++iteration) {
        const auto value=toSource(point, channel);
        const double error=distance(value);
        if (!std::isfinite(error)) return false;
        if (error<.002) { display=point; return true; }
        // Lensfun uses float maps; a one-pixel central difference avoids a
        // numerically zero derivative on large full-resolution coordinates.
        const auto xp=toSource({point.x+1,point.y},channel), xm=toSource({point.x-1,point.y},channel);
        const auto yp=toSource({point.x,point.y+1},channel), ym=toSource({point.x,point.y-1},channel);
        const double a=(xp.x-xm.x)/2, b=(yp.x-ym.x)/2, c=(xp.y-xm.y)/2, d=(yp.y-ym.y)/2;
        const double determinant=a*d-b*c;
        if (!std::isfinite(determinant) || std::abs(determinant)<1e-10) return false;
        const double ex=value.x-target.x, ey=value.y-target.y;
        const double dx=(d*ex-b*ey)/determinant, dy=(a*ey-c*ex)/determinant;
        bool advanced=false;
        for (double step=1; step>=1./128; step/=2) {
            Coord2D next(point.x-step*dx,point.y-step*dy);
            if (std::abs(next.x)>=1e7 || std::abs(next.y)>=1e7) continue;
            if (distance(toSource(next,channel))<error) { point=next; advanced=true; break; }
        }
        if (!advanced) return false;
    }
    return false;
}
}} // namespace art::engine
