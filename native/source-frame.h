#pragma once
#include "engine/imagesource.h"
#include <nlohmann/json.hpp>
#include <array>

namespace art { namespace engine {
// This is decoder geometry, not a crop adjustment. All dimensions precede
// coarse rotation; fullWidth/fullHeight already include the file orientation.
nlohmann::json sourceFrame(ImageSource *, const procparams::ProcParams &, bool active,
                           int layoutWidth = 0, int layoutHeight = 0);
nlohmann::json checkedSourceFrame(const nlohmann::json &);
bool activeSourceFrame(const procparams::ProcParams &);
bool sourceFrameDecode(const procparams::ProcParams &);
// Stable content identity; filesystem versions remain session-local in Node.
nlohmann::json sourceContentIdentity(const std::string &);
nlohmann::json checkedContentIdentity(const nlohmann::json &);
nlohmann::json checkedRenderBinding(const nlohmann::json &);
bool hasRenderBinding(const procparams::ProcParams &);
procparams::ProcParams bindGeometryReference(const procparams::ProcParams &reference,
                                            const procparams::ProcParams &holder);
void applySourceFrame(ImageSource *, const procparams::ProcParams &);
void attachSourceFrame(procparams::ProcParams &, const nlohmann::json &);
class SourceFrameTransform {
public:
    SourceFrameTransform(int,int,int,int,const procparams::ProcParams &,const procparams::ProcParams &);
    Coord2D map(Coord2D) const;
private:
    int w,h,rw,rh,rotation,referenceRotation;
    bool legacy,ph,pv,rhflip,rvflip;
    double sx=1,sy=1,ox=0,oy=0;
};
// Map pixel centers between two coarse canvases via the decoded active frame.
// An empty descriptor denotes the historical shared-canvas mapping.
Coord2D sourceFramePoint(Coord2D, int width, int height,
                        int referenceWidth, int referenceHeight,
                        const procparams::ProcParams &, const procparams::ProcParams &);
}}
