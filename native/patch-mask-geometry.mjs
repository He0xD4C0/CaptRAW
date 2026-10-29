import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function patchMaskGeometry(upstream){
 const patch=(file,marker,edit)=>{
  const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');
  if(source.includes(marker))return;
  const changed=edit(source);
  if(changed===source||!changed.includes(marker))throw new Error('ART mask geometry anchor mismatch: '+file);
  writeFileSync(path,changed);
 };
 const replace=(s,from,to)=>{if(!s.includes(from))throw new Error('Missing mask geometry anchor: '+from.slice(0,100));return s.replace(from,to);};
 patch('masks.h','class GeometryField;',s=>{
  s=replace(s,'class LinkedMaskManager {','class GeometryField;\n\nclass LinkedMaskManager {');
  const start=s.indexOf('    bool apply_mask(const Glib::ustring &filename,'),end=s.indexOf('    static void init();',start);
  if(start<0||end<0)throw new Error('External mask declaration missing');
  const method=replace(s.slice(start,end),'const procparams::ExternalMask *metadata = nullptr);','const procparams::ExternalMask *metadata = nullptr, const GeometryField *geometry = nullptr);');
  s=s.slice(0,start)+method+s.slice(end);
  return replace(s,'std::vector<array2D<float>> *abmask, ProgressListener *pl);','std::vector<array2D<float>> *abmask, ProgressListener *pl,\n                   const GeometryField *geometry = nullptr);');
 });
 patch('masks.cc','// CaptRAW: remap spatial coverage before current-guide filtering (v1).',s=>{
  if(s.includes('// CaptRAW: remap spatial coverage before current-guide filtering.'))
   throw new Error('Stale generated mask geometry patch: recreate build/upstream/ART from the pinned source archive');
  const areaStart=s.indexOf('bool generate_area_mask('),areaEnd=s.indexOf('bool generate_drawn_mask(',areaStart);
  if(areaStart<0||areaEnd<0)throw new Error('Area mask definition missing');
  let area=s.slice(areaStart,areaEnd);
  area=replace(area,'ProgressListener *plistener)','ProgressListener *plistener, const GeometryField *geometry)');
  area=replace(area,'    Coord origin(ox, oy);',`    // CaptRAW: remap spatial coverage before current-guide filtering (v1).
    const int raster_w=geometry ? width : guide.width(), raster_h=geometry ? height : guide.height();
    Coord origin(geometry ? 0 : ox, geometry ? 0 : oy);`);
  area=replace(area,'x < global_mask.width() && y >= 0 &&\n                y < global_mask.height()','x < raster_w && y >= 0 &&\n                y < raster_h');
  area=replace(area,'        if (!shape_mask.width()) {','        if (!shape_mask.width() || shape_mask.width()!=raster_w || shape_mask.height()!=raster_h) {');
  area=replace(area,'shape_mask(global_mask.width(), global_mask.height());','shape_mask(raster_w, raster_h);');
  area=replace(area,'polyFill(shape_mask, global_mask.width(),\n                                   global_mask.height(), v, color)','polyFill(shape_mask, raster_w,\n                                   raster_h, v, color)');
  area=replace(area,'            int w = global_mask.width();\n            int h = global_mask.height();','            int w = raster_w;\n            int h = raster_h;');
  area=replace(area,"        // feather the shape's mask",`        if (geometry) {
            array2D<float> mapped(guide.width(),guide.height());
            geometry->warp(shape_mask,{0,0},mapped,{double(ox),double(oy)},multithread,
                           area_->mode==AreaMask::Shape::SUBTRACT ? fgcolor : bgcolor);
            shape_mask(mapped.width(),mapped.height(),static_cast<float *>(mapped));
        }

        // feather the shape's mask`);
  s=s.slice(0,areaStart)+area+s.slice(areaEnd);
  const drawnStart=s.indexOf('bool generate_drawn_mask('),drawnEnd=s.indexOf('template <class T>\nvoid rgb2lab',drawnStart);
  if(drawnStart<0||drawnEnd<0)throw new Error('Drawn mask definition missing');
  let drawn=s.slice(drawnStart,drawnEnd);
  drawn=replace(drawn,'array2D<float> &mask)','array2D<float> &mask, const GeometryField *geometry)');
  drawn=replace(drawn,'    const int mask_w = guide.width();\n    const int mask_h = guide.height();','    int mask_w = geometry ? width : guide.width();\n    int mask_h = geometry ? height : guide.height();');
  drawn=replace(drawn,'StrokeEval se(ox, oy, width, height, mask_w, mask_h);','StrokeEval se(geometry ? 0 : ox, geometry ? 0 : oy, width, height, mask_w, mask_h);');
  drawn=replace(drawn,'    DUMP("/tmp/after-scale.tif");',`    if (geometry) {
        array2D<float> mapped(guide.width(),guide.height());
        geometry->warp(mask,{0,0},mapped,{double(ox),double(oy)},multithread,needscale ? .5f : 0.f);
        mask(mapped.width(),mapped.height(),static_cast<float *>(mapped));mask_w=guide.width();mask_h=guide.height();
    }
    DUMP("/tmp/after-scale.tif");`);
  s=s.slice(0,drawnStart)+drawn+s.slice(drawnEnd);
  const externalStart=s.indexOf('bool ExternalMaskManager::apply_mask('),externalEnd=s.indexOf('bool generateMasks(',externalStart);
  if(externalStart<0||externalEnd<0)throw new Error('External mask definition missing');
  let external=s.slice(externalStart,externalEnd);
  external=replace(external,'const procparams::ExternalMask *metadata)','const procparams::ExternalMask *metadata, const GeometryField *geometry)');
  external=replace(external,'    (*out)(oW, oH);','    (*out)(oW, oH);\n    int mappingFailed=0;');
  external=replace(external,'#pragma omp parallel for if (multithread)','#pragma omp parallel for if (multithread) reduction(|:mappingFailed)');
  external=replace(external,'            float source_y = sy;',`            float source_y = sy;
            Coord2D reference(x+offset_x,y+offset_y);
            if(geometry){
                if(!geometry->map(reference,reference)){mappingFailed=1;(*out)[y][x]=0;continue;}
                if(reference.x<-.5 || reference.y<-.5 || reference.x>=dW-.5 || reference.y>=dH-.5){
                    (*out)[y][x]=inverted ? 1.f : 0.f;continue;
                }
                sx=std::max(0.f,std::min(float(W-1),float(reference.x*col_scale)));
                source_y=std::max(0.f,std::min(float(H-1),float(reference.y*row_scale)));
            }`);
  external=replace(external,'const double u = (x + offset_x + 0.5) / dW, v = (y + offset_y + 0.5) / dH;','const double u = (reference.x + 0.5) / dW, v = (reference.y + 0.5) / dH;');
  external=replace(external,'    if (feather > 0) {','    if(mappingFailed)throw MaskGeometryError("Mask geometry inverse failed; coverage was not rendered");\n\n    if (feather > 0) {');
  s=s.slice(0,externalStart)+external+s.slice(externalEnd);
  const generateStart=s.indexOf('bool generateMasks(');
  let generate=s.slice(generateStart);
  generate=replace(generate,'ProgressListener *plistener)','ProgressListener *plistener, const GeometryField *geometry)');
  generate=replace(generate,'    int n = masks.size();','    if(geometry && geometry->isIdentity())geometry=nullptr;\n    int n = masks.size();');
  generate=replace(generate,'                                amask)) {','                                amask, geometry)) {');
  generate=replace(generate,'                               amask, plistener)) {','                               amask, plistener, geometry)) {');
  generate=replace(generate,'guide, &amask, multithread, plistener, &em)) {','guide, &amask, multithread, plistener, &em, geometry)) {');
  generate=replace(generate,'full_width,full_height,scale,multithread,-1,&children,nullptr,plistener);','full_width,full_height,scale,multithread,-1,&children,nullptr,plistener,geometry);');
  return '#include "geometry-field.h"\n#include <stdexcept>\n'+s.slice(0,generateStart)+generate;
 });
}

export function patchMaskGeometryPipeline(upstream){
 const patch=(file,marker,edits)=>{
  const path=join(upstream,'src/engine',file);let source=readFileSync(path,'utf8');
  if(source.includes(marker))return;
  for(const [before,after] of edits){
   if(!source.includes(before)||source.indexOf(before)!==source.lastIndexOf(before))throw new Error('ART mask pipeline anchor mismatch: '+file+' / '+before.slice(0,80));
   source=source.replace(before,()=>after);
  }
  if(!source.includes(marker))throw new Error('ART mask pipeline marker missing: '+file);
  writeFileSync(path,source);
 };
 patch('procparams.h','bool captrawMaskCoordinates',[
  ['struct RotateParams {\n    bool enabled;\n    double degree;',`struct RotateParams {
    bool enabled;
    double degree;
    bool captrawMaskCoordinates = false;
    double captrawMaskReferenceDegree = 0;`]
 ]);
 patch('procparams.cc','"CaptRAWMaskCoordinates"',[
  ['    return enabled == other.enabled && degree == other.degree;',`    return enabled == other.enabled && degree == other.degree &&
        captrawMaskCoordinates == other.captrawMaskCoordinates &&
        captrawMaskReferenceDegree == other.captrawMaskReferenceDegree;`],
  ['            saveToKeyfile("Rotation", "Degree", rotate.degree, keyFile);',`            saveToKeyfile("Rotation", "Degree", rotate.degree, keyFile);
            saveToKeyfile("Rotation", "CaptRAWMaskCoordinates", rotate.captrawMaskCoordinates, keyFile);
            saveToKeyfile("Rotation", "CaptRAWMaskReferenceDegree", rotate.captrawMaskReferenceDegree, keyFile);`],
  ['            assignFromKeyfile(keyFile, "Rotation", "Degree", rotate.degree);',`            assignFromKeyfile(keyFile, "Rotation", "Degree", rotate.degree);
            assignFromKeyfile(keyFile, "Rotation", "CaptRAWMaskCoordinates", rotate.captrawMaskCoordinates);
            assignFromKeyfile(keyFile, "Rotation", "CaptRAWMaskReferenceDegree", rotate.captrawMaskReferenceDegree);`]
 ]);
 patch('improcfun.h','setMaskGeometrySource(',[
  ['class CLUTApplication;','class CLUTApplication;\nclass MaskGeometryCache;'],
  ['    void setViewport(int ox, int oy, int fw, int fh);',`    void setViewport(int ox, int oy, int fw, int fh);
    void setMaskGeometrySource(const FramesMetaData *, int rawRotation, int width, int height,
                               int fullWidth, int fullHeight);
    const GeometryField *maskGeometry();`],
  ['    LinkedMaskManager linked_mask_mgr_;','    std::unique_ptr<MaskGeometryCache> maskGeometryCache_;\n    LinkedMaskManager linked_mask_mgr_;']
 ]);
 patch('improcfun.cc','#include "geometry-field.h"',[
  ['#include "improcfun.h"','#include "improcfun.h"\n#include "geometry-field.h"']
 ]);
 for(const file of ['ipcolorcorrection.cc','iptextureboost.cc','ipsmoothing.cc','iplocalcontrast.cc']){
  if(readFileSync(join(upstream,'src/engine',file),'utf8').includes('maskGeometry(mask)'))continue;
  patch(file,'plistener, maskGeometry()))',[
   ['maskErrorListener ? maskErrorListener : plistener)) {','maskErrorListener ? maskErrorListener : plistener, maskGeometry())) {']
  ]);
 }
 // Supply the actual transform dimensions, not scale * rounded preview size.
 // This must also run when transform() is skipped (current angle can be zero
 // while masks were authored at a nonzero reference angle).
 patch('improccoordinator.cc','ipf.setMaskGeometrySource(',[
  ['        ipf.setScale(scale);',`        ipf.setScale(scale);
        ipf.setMaskGeometrySource(imgsrc->getMetaData(), imgsrc->getRotateDegree(), pW, pH, fw, fh);`]
 ]);
 patch('dcrop.cc','parent->ipf.setMaskGeometrySource(',[
  ['    parent->ipf.setViewport(offset_x, offset_y, full_width, full_height);',`    parent->ipf.setViewport(offset_x, offset_y, full_width, full_height);
    parent->ipf.setMaskGeometrySource(parent->imgsrc->getMetaData(), parent->imgsrc->getRotateDegree(),
        skips(parent->fw, skip), skips(parent->fh, skip), parent->getFullWidth(), parent->getFullHeight());`]
 ]);
 patch('dcrop.cc','// CaptRAW: preserve the complete intermediate transform canvas.',[
  ['    leftBorder = skips(rqx1 - bx1, skip);',`    // CaptRAW: preserve the complete intermediate transform canvas.
    // A source bounding box is not an intermediate output bounding box. Lens
    // CA/perspective sample the first transform again; ART's 15% estimate can
    // cut valid pixels even when requesting the entire output image.
    const auto &perspective=parent->params.perspective;
    if ((perspective.enabled && (perspective.horizontal || perspective.vertical || perspective.angle || perspective.shear)) ||
        (parent->params.lensProf.needed() &&
         (parent->params.lensProf.useDist || parent->params.lensProf.useCA))) {
        orx=ory=0;orw=parent->fw;orh=parent->fh;
    }

    leftBorder = skips(rqx1 - bx1, skip);`]
 ]);
 patch('simpleprocess.cc','ipf.setMaskGeometrySource(',[
  ['        sanitize("denoise");',`        sanitize("denoise");
        ipf.setMaskGeometrySource(imgsrc->getMetaData(), imgsrc->getRotateDegree(), fw, fh, fw, fh);`]
 ]);
 patch('rtthumbnail.cc','ipf.setMaskGeometrySource(',[
  ['    ipf.setScale((origFW * tscale) / rwidth);',`    ipf.setScale((origFW * tscale) / rwidth);
    ipf.setMaskGeometrySource(metadata, 0, fw, fh, origFW * tscale + 0.5, origFH * tscale + 0.5);`]
 ]);
 patch('procparams.cc','// CaptRAW: missing reference fields mean the original canvas.',[
  ['            assignFromKeyfile(keyFile, "Rotation", "CaptRAWMaskCoordinates", rotate.captrawMaskCoordinates);',`            // CaptRAW: missing reference fields mean the original canvas.
            rotate.captrawMaskCoordinates=false;rotate.captrawMaskReferenceDegree=0;
            assignFromKeyfile(keyFile, "Rotation", "CaptRAWMaskCoordinates", rotate.captrawMaskCoordinates);`]
 ]);
 patch('rtengine.h','virtual void maskGeometryError(',[
  ['    virtual void externalMaskError(const Glib::ustring &descr) { error(descr); }',`    virtual void externalMaskError(const Glib::ustring &descr) { error(descr); }
    virtual void maskGeometryError(const Glib::ustring &descr) { error(descr); }`]
 ]);
 patch('masks.cc','// CaptRAW: a detail region outside a mask is not an empty whole-image mask.',[
  ['    if (is_empty && plistener) {',`    // CaptRAW: a detail region outside a mask is not an empty whole-image mask.
    if (is_empty && plistener && ox==0 && oy==0 &&
        guide.width()==width && guide.height()==height) {`]
 ]);
 patch('improcfun.cc','catch (const MaskGeometryError &error)',[
  ['    switch (stage) {','    try {\n    switch (stage) {'],
  ['    return stop;\n}\n\nint ImProcFunctions::setDeltaEData',`    } catch (const MaskGeometryError &error) {
        auto *listener=maskErrorListener ? maskErrorListener : plistener;
        if(!listener)throw;
        listener->maskGeometryError(error.what());
        return true;
    }
    return stop;
}

int ImProcFunctions::setDeltaEData`]
 ]);
 patch('procparams.cc','"CaptRAWDrawnMaskStrokes"',[
  ['    if (ppVersion < 1019) {\n        std::vector<float>\n            v; // important:',`    if (keyfile.has_key(group_name,prefix + "CaptRAWDrawnMaskStrokes" + suffix)) {
        // The upstream packed stroke list rounds coordinates/radii to half
        // precision. Prefer exact doubles for preview/export consistency.
        const auto stored=keyfile.get_double_list(group_name,prefix + "CaptRAWDrawnMaskStrokes" + suffix);
        const std::vector<double> values(stored.begin(),stored.end());
        for(double value:values)if(!std::isfinite(value))throw ConversionError();
        for(size_t pos=0;pos<values.size();) {
            if(values.size()-pos<4)throw ConversionError();
            const double count=values[pos];
            if(count<1 || count>2048 || count!=std::floor(count) || values.size()-pos<4+2*size_t(count))throw ConversionError();
            pos+=4+2*size_t(count);
        }
        drawnMask.strokes_from_list(values);ret=true;
    } else if (ppVersion < 1019) {
        std::vector<float>
            v; // important:`],
  ['    drawnMask.strokes_to_list(v);\n    putToKeyfile(group_name, prefix + "DrawnMaskStrokes" + suffix, pack_list(v),',`    drawnMask.strokes_to_list(v);
    putToKeyfile(group_name, prefix + "CaptRAWDrawnMaskStrokes" + suffix, v, keyfile);
    putToKeyfile(group_name, prefix + "DrawnMaskStrokes" + suffix, pack_list(v),`]
 ]);
 // Incremental leaf-reference patches also upgrade already generated 0.43 sources.
 patch('procparams.h','bool captrawReferenceAngleSet',[
  ['class Mask {\npublic:',`class Mask {
public:
    bool captrawReferenceAngleSet = false;
    double captrawReferenceAngle = 0;`]
 ]);
 patch('procparams.cc','// CaptRAW: independent spatial leaf reference angles.',[
  ['    return components == other.components && componentModes == other.componentModes &&',`    return captrawReferenceAngleSet == other.captrawReferenceAngleSet &&
           captrawReferenceAngle == other.captrawReferenceAngle &&
           components == other.components && componentModes == other.componentModes &&`],
  ['    if(depth > 8) throw std::runtime_error("Mask group nesting limit exceeded");',`    // CaptRAW: independent spatial leaf reference angles.
    captrawReferenceAngleSet=keyfile.has_key(group_name,prefix + "CaptRAWReferenceAngle" + suffix);
    captrawReferenceAngle=0;
    if(captrawReferenceAngleSet){
        captrawReferenceAngle=keyfile.get_double(group_name,prefix + "CaptRAWReferenceAngle" + suffix);
        if(!std::isfinite(captrawReferenceAngle) || std::abs(captrawReferenceAngle)>45)
            throw std::runtime_error("Invalid mask leaf reference rotation");
    }
    if(depth > 8) throw std::runtime_error("Mask group nesting limit exceeded");`],
  ['    bool ret = count > 0;','    bool ret = count > 0 || captrawReferenceAngleSet;'],
  ['    putToKeyfile(group_name,prefix+"CaptRAWComponentCount"+suffix,int(components.size()),keyfile);',`    if(captrawReferenceAngleSet)
        putToKeyfile(group_name,prefix + "CaptRAWReferenceAngle" + suffix,captrawReferenceAngle,keyfile);
    putToKeyfile(group_name,prefix+"CaptRAWComponentCount"+suffix,int(components.size()),keyfile);`]
 ]);
 patch('masks.h','using MaskGeometryResolver =',[
  ['#include <unordered_map>','#include <functional>\n#include <unordered_map>'],
  ['class GeometryField;',`class GeometryField;
using MaskGeometryResolver = std::function<const GeometryField *(const procparams::Mask &)>;`],
  ['                   const GeometryField *geometry = nullptr);',`                   const GeometryField *geometry = nullptr,
                   const MaskGeometryResolver &resolveGeometry = MaskGeometryResolver());`]
 ]);
 patch('masks.cc','// CaptRAW: resolve a leaf only until its spatial operations finish.',[
  ['                   std::vector<array2D<float>> *abmask,\n                   ProgressListener *plistener, const GeometryField *geometry)',`                   std::vector<array2D<float>> *abmask,
                   ProgressListener *plistener, const GeometryField *geometry,
                   const MaskGeometryResolver &resolveGeometry)`],
  ['    if(geometry && geometry->isIdentity())geometry=nullptr;',
   '    if(resolveGeometry || (geometry && geometry->isIdentity()))geometry=nullptr;'],
  ['    const auto apply_brush = [&](int i, bool add_bounded) -> void {',
   '    const auto apply_brush = [&](int i, bool add_bounded, const GeometryField *leafGeometry) -> void {'],
  ['                                amask, geometry)) {','                                amask, leafGeometry)) {'],
  ['        apply_brush(i, true);',`        {
        // CaptRAW: resolve a leaf only until its spatial operations finish.
        // Cache entries may be evicted by the next leaf or recursive group.
        const auto &spatial=masks[i];
        const GeometryField *leafGeometry=geometry;
        if(resolveGeometry){
            leafGeometry=spatial.enabled && spatial.components.empty() &&
                (spatial.drawnMask.enabled || spatial.areaMask.enabled || spatial.externalMask.enabled)
                ? resolveGeometry(spatial) : nullptr;
        }
        if(leafGeometry && leafGeometry->isIdentity())leafGeometry=nullptr;
        apply_brush(i, true, leafGeometry);`],
  ['                               amask, plistener, geometry)) {','                               amask, plistener, leafGeometry)) {'],
  ['guide, &amask, multithread, plistener, &em, geometry)) {','guide, &amask, multithread, plistener, &em, leafGeometry)) {'],
  ['        apply_brush(i, false);','        apply_brush(i, false, leafGeometry);\n        }'],
  ['full_width,full_height,scale,multithread,-1,&children,nullptr,plistener,geometry);',
   'full_width,full_height,scale,multithread,-1,&children,nullptr,plistener,geometry,resolveGeometry);']
 ]);
 patch('improcfun.h','maskGeometry(const procparams::Mask &mask)',[
  ['    const GeometryField *maskGeometry();',`    const GeometryField *maskGeometry();
    const GeometryField *maskGeometry(const procparams::Mask &mask);`]
 ]);
 for(const file of ['ipcolorcorrection.cc','iptextureboost.cc','ipsmoothing.cc','iplocalcontrast.cc'])
  patch(file,'maskGeometry(mask)',[
   ['maskErrorListener ? maskErrorListener : plistener, maskGeometry())) {',`maskErrorListener ? maskErrorListener : plistener, nullptr,
                [this](const procparams::Mask &mask) { return maskGeometry(mask); })) {`]
  ]);
 // Full authoring geometry is independent of the legacy angle-only reference.
 patch('procparams.h','std::string captrawGeometryReference;',[
  ['    bool captrawReferenceAngleSet = false;','    std::string captrawGeometryReference;\n    bool captrawReferenceAngleSet = false;']
 ]);
 patch('procparams.cc','// CaptRAW: full authoring geometry reference (v1).',[
  ['    return captrawReferenceAngleSet == other.captrawReferenceAngleSet &&',
   '    return captrawGeometryReference == other.captrawGeometryReference &&\n           captrawReferenceAngleSet == other.captrawReferenceAngleSet &&'],
  ['    captrawReferenceAngleSet=keyfile.has_key(group_name,prefix + "CaptRAWReferenceAngle" + suffix);',`    // CaptRAW: full authoring geometry reference (v1).
    captrawGeometryReference.clear();
    if(keyfile.has_key(group_name,prefix + "CaptRAWGeometryReferenceV1" + suffix))
        captrawGeometryReference=keyfile.get_string(group_name,prefix + "CaptRAWGeometryReferenceV1" + suffix);
    captrawReferenceAngleSet=keyfile.has_key(group_name,prefix + "CaptRAWReferenceAngle" + suffix);`],
  ['    bool ret = count > 0 || captrawReferenceAngleSet;',
   '    bool ret = count > 0 || captrawReferenceAngleSet || !captrawGeometryReference.empty();'],
  ['    if(captrawReferenceAngleSet)\n        putToKeyfile(group_name,prefix + "CaptRAWReferenceAngle" + suffix,captrawReferenceAngle,keyfile);',`    if(!captrawGeometryReference.empty())
        putToKeyfile(group_name,prefix + "CaptRAWGeometryReferenceV1" + suffix,captrawGeometryReference,keyfile);
    if(captrawReferenceAngleSet)
        putToKeyfile(group_name,prefix + "CaptRAWReferenceAngle" + suffix,captrawReferenceAngle,keyfile);`]
 ]);

 // Explicit new flip controls opt legacy leaves into unflipped mask coverage.
 // Missing fields keep inherited ARP coverage exactly as authored.
 patch('procparams.h','bool captrawMirrorCoordinates = false;',[
  ['    bool captrawReferenceAngleSet = false;','    bool captrawMirrorCoordinates = false;\n    bool captrawReferenceAngleSet = false;']
 ]);
 patch('procparams.cc','// CaptRAW: explicit mirrored legacy coordinates.',[
  ['           captrawReferenceAngleSet == other.captrawReferenceAngleSet &&',
   '           captrawMirrorCoordinates == other.captrawMirrorCoordinates &&\n           captrawReferenceAngleSet == other.captrawReferenceAngleSet &&'],
  ['    captrawReferenceAngleSet=keyfile.has_key(group_name,prefix + "CaptRAWReferenceAngle" + suffix);',`    // CaptRAW: explicit mirrored legacy coordinates.
    captrawMirrorCoordinates=false;
    if(keyfile.has_key(group_name,prefix + "CaptRAWMirrorCoordinates" + suffix))
        captrawMirrorCoordinates=keyfile.get_boolean(group_name,prefix + "CaptRAWMirrorCoordinates" + suffix);
    captrawReferenceAngleSet=keyfile.has_key(group_name,prefix + "CaptRAWReferenceAngle" + suffix);`],
  ['    if(captrawReferenceAngleSet)\n        putToKeyfile(group_name,prefix + "CaptRAWReferenceAngle" + suffix,captrawReferenceAngle,keyfile);',`    if(captrawMirrorCoordinates)
        putToKeyfile(group_name,prefix + "CaptRAWMirrorCoordinates" + suffix,true,keyfile);
    if(captrawReferenceAngleSet)
        putToKeyfile(group_name,prefix + "CaptRAWReferenceAngle" + suffix,captrawReferenceAngle,keyfile);`]
 ]);

 // The anchor canvas is native-only metadata; absent legacy fields retain their canvas.
 patch('procparams.h','bool captrawSourceBasisSet = false;',[
  ['    double captrawMaskReferenceDegree = 0;',`    double captrawMaskReferenceDegree = 0;
    bool captrawSourceBasisSet = false;
    bool captrawSourceBasisHorizontal = false, captrawSourceBasisVertical = false;`]
 ]);
 patch('procparams.cc','// CaptRAW: stable inherited source canvas.',[
  ['        captrawMaskReferenceDegree == other.captrawMaskReferenceDegree;',`        captrawMaskReferenceDegree == other.captrawMaskReferenceDegree &&
        captrawSourceBasisSet == other.captrawSourceBasisSet &&
        captrawSourceBasisHorizontal == other.captrawSourceBasisHorizontal &&
        captrawSourceBasisVertical == other.captrawSourceBasisVertical;`],
  ['            saveToKeyfile("Rotation", "CaptRAWMaskReferenceDegree", rotate.captrawMaskReferenceDegree, keyFile);',`            saveToKeyfile("Rotation", "CaptRAWMaskReferenceDegree", rotate.captrawMaskReferenceDegree, keyFile);
            if(rotate.captrawSourceBasisSet){
                saveToKeyfile("Rotation", "CaptRAWSourceBasis", true, keyFile);
                saveToKeyfile("Rotation", "CaptRAWSourceBasisHorizontal", rotate.captrawSourceBasisHorizontal, keyFile);
                saveToKeyfile("Rotation", "CaptRAWSourceBasisVertical", rotate.captrawSourceBasisVertical, keyFile);
            }`],
  ['            rotate.captrawMaskCoordinates=false;rotate.captrawMaskReferenceDegree=0;',`            // CaptRAW: stable inherited source canvas.
            rotate.captrawSourceBasisSet=false;rotate.captrawSourceBasisHorizontal=false;rotate.captrawSourceBasisVertical=false;
            rotate.captrawMaskCoordinates=false;rotate.captrawMaskReferenceDegree=0;`],
  ['            assignFromKeyfile(keyFile, "Rotation", "CaptRAWMaskReferenceDegree", rotate.captrawMaskReferenceDegree);',`            assignFromKeyfile(keyFile, "Rotation", "CaptRAWMaskReferenceDegree", rotate.captrawMaskReferenceDegree);
            assignFromKeyfile(keyFile, "Rotation", "CaptRAWSourceBasis", rotate.captrawSourceBasisSet);
            assignFromKeyfile(keyFile, "Rotation", "CaptRAWSourceBasisHorizontal", rotate.captrawSourceBasisHorizontal);
            assignFromKeyfile(keyFile, "Rotation", "CaptRAWSourceBasisVertical", rotate.captrawSourceBasisVertical);`]
 ]);

}
