#pragma once
#include "geometry-map.h"
#include <glibmm/keyfile.h>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>

namespace art { namespace engine {
// A legacy document's source anchors were authored on its inherited coarse
// canvas. Keep that canvas stable after explicit flips, without rewriting points.
inline std::pair<bool,bool> geometrySourceBasis(const procparams::ProcParams &p) {
    if(!p.rotate.captrawSourceBasisSet)return {p.coarse.hflip,p.coarse.vflip};
    if(p.coarse.rotate%180)return {p.rotate.captrawSourceBasisVertical,p.rotate.captrawSourceBasisHorizontal};
    return {p.rotate.captrawSourceBasisHorizontal,p.rotate.captrawSourceBasisVertical};
}
// Versioned backend-owned transform snapshot. No masks or image adjustments.
inline bool geometryReferenceGroup(const Glib::ustring &name) {
    for(const char *group:{"Version","Coarse Transformation","Common Properties for Transformations",
                          "Rotation","Distortion","LensProfile","Perspective","CACorrection"})
        if(name==group)return true;
    return false;
}
inline procparams::ProcParams maskGeometryParams(const procparams::ProcParams &p) {
    procparams::ProcParams result;
    result.rotate=p.rotate;result.rotate.captrawMaskCoordinates=false;result.rotate.captrawMaskReferenceDegree=0;
    result.commonTrans=p.commonTrans;result.coarse=p.coarse;result.distortion=p.distortion;
    result.cacorrection=p.cacorrection;result.perspective=p.perspective;result.lensProf=p.lensProf;
    result.perspective.control_lines.clear();
    return result;
}
inline std::string geometryReference(const procparams::ProcParams &p, bool includeFrame = false) {
    procparams::KeyFile stored;
    if(maskGeometryParams(p).save(nullptr,stored))throw std::runtime_error("Cannot save mask geometry reference");
    Glib::KeyFile key;key.load_from_data(stored.to_data());
    if(includeFrame&&!p.commonTrans.captrawSourceFrame.empty())
        key.set_string("Common Properties for Transformations","CaptRAWSourceFrameV1",p.commonTrans.captrawSourceFrame);
    else if(key.has_key("Common Properties for Transformations","CaptRAWSourceFrameV1"))
        key.remove_key("Common Properties for Transformations","CaptRAWSourceFrameV1");
    for(const auto &group:key.get_groups())if(!geometryReferenceGroup(group))key.remove_group(group);
    return key.to_data();
}
inline procparams::ProcParams geometryReferenceParams(const std::string &data) {
    if(data.empty()||data.size()>65536)throw std::runtime_error("Invalid mask geometry reference");
    Glib::KeyFile checked;checked.load_from_data(data);
    for(const auto &group:checked.get_groups())if(!geometryReferenceGroup(group))
        throw std::runtime_error("Unexpected mask geometry reference group");
    for(const char *group:{"Version","Coarse Transformation","Common Properties for Transformations","Rotation","Distortion","LensProfile","Perspective","CACorrection"})
        if(!checked.has_group(group))throw std::runtime_error("Incomplete mask geometry reference");
    procparams::KeyFile key;key.load_from_data(data);procparams::ProcParams result;
    if(result.load(nullptr,key))throw std::runtime_error("Cannot load mask geometry reference");
    const auto &v=result.perspective;
    for(double value:{result.rotate.degree,result.distortion.amount,result.cacorrection.red,result.cacorrection.blue,
                      v.horizontal,v.vertical,v.angle,v.shear,v.flength,v.cropfactor,v.aspect,
                      v.captrawScale,v.captrawOffsetX,v.captrawOffsetY})
        if(!std::isfinite(value))throw std::runtime_error("Nonfinite mask geometry reference");
    if(v.captrawManual&&(v.captrawScale<(v.captrawSignedFraming?.5:.1)||v.captrawScale>(v.captrawSignedFraming?1.5:4)||std::abs(v.captrawOffsetX)>(v.captrawSignedFraming?100:.5)||std::abs(v.captrawOffsetY)>(v.captrawSignedFraming?100:.5)||v.aspect<(v.captrawSignedFraming?-100:.5)||v.aspect>(v.captrawSignedFraming?100:2)))
        throw std::runtime_error("Invalid manual mask geometry reference");
    if(std::abs(result.rotate.degree)>45||result.coarse.rotate<0||result.coarse.rotate>270||result.coarse.rotate%90)
        throw std::runtime_error("Invalid mask geometry reference rotation");
    return maskGeometryParams(result);
}
// Both UI masks and recipe.rotate use full-canvas normalized coordinates.
// Convert the reference's coarse canvas to/from the current coarse canvas.
inline Coord2D maskCanvasRotation(Coord2D p,int width,int height,int degrees) {
    switch((degrees%360+360)%360){
    case 90:return {height-p.y,p.x};
    case 180:return {width-p.x,height-p.y};
    case 270:return {p.y,width-p.x};
    default:return p;
    }
}
inline Coord2D maskSourceRotation(Coord2D p,int width,int height,int degrees) {
    // Image content uses pixel centers; recipe mask points use canvas edges.
    return maskCanvasRotation(p,width-1,height-1,degrees);
}
inline Coord2D geometrySourceFlip(Coord2D p,int width,int height,bool horizontal,bool vertical) {
    if(horizontal)p.x=width-1-p.x;
    if(vertical)p.y=height-1-p.y;
    return p;
}
}} // namespace art::engine
