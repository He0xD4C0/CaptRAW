import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function patchGeometryMapping(upstream){
 const patch=(file,marker,edit)=>{
  const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');
  if(source.includes(marker))return;
  const changed=edit(source);
  if(changed===source||!changed.includes(marker))throw new Error('ART geometry patch anchor mismatch: '+file);
  writeFileSync(path,changed);
 };
 // Keep ART's existing return value, but expose failure instead of silently
 // treating unchanged parameters as a successful automatic correction.
 patch('perspectivecorrection.h','bool *success = nullptr',s=>s.replace('const std::vector<ControlLine> *control_lines = nullptr);','const std::vector<ControlLine> *control_lines = nullptr, bool *success = nullptr);'));
 patch('perspectivecorrection.cc','if (success) *success = res;',s=>s.replace('const std::vector<ControlLine> *control_lines)\n{','const std::vector<ControlLine> *control_lines, bool *success)\n{').replace('    if (res) {\n        retval.horizontal', '    if (success) *success = res;\n    if (res) {\n        retval.horizontal'));
 // Only three explicitly supplied mixed guides fit rotation and both shifts
 // with fixed zero shear. Automatic detection retains its original thresholds.
 patch('perspectivecorrection.cc','const bool three_guides = dir == BOTH',s=>{
  const anchor='        res = do_fit(&module, &p, fitaxis);\n        g->lines = nullptr;';
  return s.replace(anchor,`        const bool three_guides = dir == BOTH && g->lines_count == 3 &&
            ((g->horizontal_count == 2 && g->vertical_count == 1) ||
             (g->horizontal_count == 1 && g->vertical_count == 2));
        if (three_guides) p.shear = 0.f;
        res = do_fit(&module, &p, three_guides ? ASHIFT_FIT_BOTH : fitaxis, three_guides);
        g->lines = nullptr;`);
 });
 patch('ashift_dt.c','// Three mixed guides constrain three parameters, never shear.',s=>{
  const start=s.indexOf('static dt_iop_ashift_nmsresult_t nmsfit('),end=s.indexOf('// RT: BEGIN COMMENT',start);
  if(start<0||end<0)throw new Error('ART guided perspective fit anchor missing');
  let method=s.slice(start,end);
  const edits=[
   ['dt_iop_ashift_fitaxis_t dir)\n{','dt_iop_ashift_fitaxis_t dir, bool three_guides = false)\n{'],
   ['    if (!g->lines)\n',`    // Three mixed guides constrain three parameters, never shear.
    if (three_guides && (dir != ASHIFT_FIT_BOTH || p->shear != 0.f ||
        g->lines_count != 3 ||
        !((g->horizontal_count == 2 && g->vertical_count == 1) ||
          (g->horizontal_count == 1 && g->vertical_count == 2))))
        return NMS_NOT_ENOUGH_LINES;
    if (!g->lines)
`],
   ['g->vertical_count >= MINIMUM_FITLINES','g->vertical_count >= (three_guides ? 1 : MINIMUM_FITLINES)'],
   ['g->horizontal_count >= MINIMUM_FITLINES','g->horizontal_count >= (three_guides ? 1 : MINIMUM_FITLINES)']
  ];
  for(const [before,after] of edits){
   if(!method.includes(before))throw new Error('ART guided perspective fit anchor mismatch');
   method=method.replace(before,after);
  }
  s=s.slice(0,start)+method+s.slice(end);
  const signature='static int do_fit(dt_iop_module_t *module, dt_iop_ashift_params_t *p,\n                  dt_iop_ashift_fitaxis_t dir)';
  if(!s.includes(signature)||!s.includes('res = nmsfit(module, p, dir);'))throw new Error('ART guided perspective dispatch anchor mismatch');
  return s.replace(signature,signature.replace('dir)','dir, bool three_guides = false)'))
   .replace('res = nmsfit(module, p, dir);','res = nmsfit(module, p, dir, three_guides);');
 });
 patch('ashift_dt.c','// Fill only from initialized interior pixels.',s=>{
  const start=s.indexOf('    // border fill in output buffer'),end=s.indexOf('// edge enhancement in both directions',start);
  if(start<0||end<0)throw new Error('ART automatic perspective border anchor missing');
  return s.slice(0,start)+`    // Fill only from initialized interior pixels. Reading another border
    // pixel races with its writer and can sample uninitialized corner memory.
    for (int j = 0; j < height; j++) {
        for (int i = 0; i < width; i++) {
            if (j >= khwidth && j < height-khwidth && i >= khwidth && i < width-khwidth) continue;
            const int y = std::max(khwidth, std::min(height-khwidth-1, j));
            const int x = std::max(khwidth, std::min(width-khwidth-1, i));
            out[j*width+i] = out[y*width+x];
        }
    }
}

`+s.slice(end);
 });
 patch('improcfun.h','bool clipCoordinates = true',s=>{
  const start=s.indexOf('    bool transCoord(int W, int H, const std::vector<Coord2D> &src,');
  const end=s.indexOf('    double getTransformAutoFill',start);
  if(start<0||end<0)throw new Error('ART point geometry declaration missing');
  return s.slice(0,start)+s.slice(start,end).replace('const LensCorrection *pLCPMap = nullptr);','const LensCorrection *pLCPMap = nullptr, bool clipCoordinates = true);')+s.slice(end);
 });
 patch('iptransform.cc','if (!clipCoordinates) return clipped;',s=>{
  const start=s.indexOf('bool ImProcFunctions::transCoord(int W, int H, const std::vector<Coord2D> &src,');
  const end=s.indexOf('// Transform all corners',start);
  if(start<0||end<0)throw new Error('ART point geometry implementation missing');
  let method=s.slice(start,end).replace('const LensCorrection *pLCPMap)','const LensCorrection *pLCPMap, bool clipCoordinates)');
  method=method.replace('    // Clip all points and track if they were any corrections','    if (!clipCoordinates) return clipped;\n\n    // Clip all points and track if they were any corrections');
  return s.slice(0,start)+method+s.slice(end);
 });
 patch('improccoordinator.cc','// CaptRAW: sample all geometric stages in render order.',s=>{
  let start=s.indexOf('        // CaptRAW: invert the same lens stages used by the rendered preview.');
  if(start<0)start=s.indexOf('        ipf.transCoord(fw, fh, points, red, green, blue);');
  const end=s.indexOf('        int tr = getCoarseBitMask(params.coarse);',start);
  if(start<0||end<0)throw new Error('ART WB geometry call site missing');
  s=s.slice(0,start)+`        // CaptRAW: sample all geometric stages in render order.
        GeometryMap geometry(params, fw, fh, imgsrc->getMetaData(), imgsrc->getRotateDegree());
        std::vector<Coord2D> *channels[] = {&red, &green, &blue};
        for (const auto &point : points) for (int c=0; c<3; ++c) {
            auto source = geometry.toSource(point, c);
            source.x = std::max(0., std::min(double(fw-1), source.x));
            source.y = std::max(0., std::min(double(fh-1), source.y));
            channels[c]->push_back(source);
        }

`+s.slice(end);
  return '#include "geometry-map.h"\n'+s;
 });
 // Optional manual geometry: absent fields retain ART's original pixel path.
 patch('procparams.h','bool captrawManual = false;',s=>s.replace('    double aspect;\n    std::vector<int> control_lines;',`    double aspect;
    bool captrawManual = false;
    double captrawScale = 1, captrawOffsetX = 0, captrawOffsetY = 0;
    bool captrawConstrain = false;
    bool captrawFill(bool inherited) const { return enabled && captrawManual ? captrawConstrain : inherited; }
    std::vector<int> control_lines;`));
 patch('procparams.cc','// Versioned manual perspective geometry.',s=>{
  const edits=[
   ['           control_lines == other.control_lines;',`           control_lines == other.control_lines && captrawManual == other.captrawManual &&
           captrawScale == other.captrawScale && captrawOffsetX == other.captrawOffsetX &&
           captrawOffsetY == other.captrawOffsetY && captrawConstrain == other.captrawConstrain;`],
   ['            saveToKeyfile("Perspective", "Aspect", perspective.aspect, keyFile);',`            saveToKeyfile("Perspective", "Aspect", perspective.aspect, keyFile);
            // Versioned manual perspective geometry.
            if (perspective.captrawManual) {
                saveToKeyfile("Perspective", "CaptRAWManualV1", true, keyFile);
                saveToKeyfile("Perspective", "CaptRAWScale", perspective.captrawScale, keyFile);
                saveToKeyfile("Perspective", "CaptRAWOffsetX", perspective.captrawOffsetX, keyFile);
                saveToKeyfile("Perspective", "CaptRAWOffsetY", perspective.captrawOffsetY, keyFile);
                saveToKeyfile("Perspective", "CaptRAWConstrainCrop", perspective.captrawConstrain, keyFile);
            }`],
   ['        if (keyFile.has_group("Perspective") && RELEVANT_(perspective)) {',`        if (keyFile.has_group("Perspective") && RELEVANT_(perspective)) {
            perspective.captrawManual = false;
            perspective.captrawScale = 1; perspective.captrawOffsetX = perspective.captrawOffsetY = 0;
            perspective.captrawConstrain = false;
            assignFromKeyfile(keyFile, "Perspective", "CaptRAWManualV1", perspective.captrawManual);
            if (perspective.captrawManual) {
                assignFromKeyfile(keyFile, "Perspective", "CaptRAWScale", perspective.captrawScale);
                assignFromKeyfile(keyFile, "Perspective", "CaptRAWOffsetX", perspective.captrawOffsetX);
                assignFromKeyfile(keyFile, "Perspective", "CaptRAWOffsetY", perspective.captrawOffsetY);
                assignFromKeyfile(keyFile, "Perspective", "CaptRAWConstrainCrop", perspective.captrawConstrain);
            }`]
  ];
  for(const [before,after] of edits){if(!s.includes(before))throw new Error('ART manual perspective parameter anchor missing');s=s.replace(before,after);}return s;
 });
 patch('perspectivecorrection.h','double manualScale_ = 1,',s=>s.replace('    float ihomograph_[3][3];',`    float ihomograph_[3][3];
    bool manual_ = false;
    double manualScale_ = 1, manualOffsetX_ = 0, manualOffsetY_ = 0;`));
 patch('perspectivecorrection.cc','// Apply manual framing after ART perspective correction.',s=>{
  const anchor='        calc_scale(width, height, pp, fill);';
  if(!s.includes(anchor))throw new Error('ART manual perspective initialization anchor missing');
  s=s.replace('    if (params.enabled) {\n        auto pp = import_meta(params, metadata);',`    manual_ = params.enabled && params.captrawManual;
    if (params.enabled) {
        fill = params.captrawFill(fill);
        auto pp = import_meta(params, metadata);`);
  s=s.replace(anchor,anchor+`
        if (manual_) {
            // Apply manual framing after ART perspective correction. When
            // constrained, ART fills the lens/rotation/projective stages first.
            // Intersect the affine image rectangle with the output canvas,
            // then fit the original aspect inside it. No coverage resampling
            // or separate mask transform is introduced.
            const double zoom = params.captrawScale;
            double k = 1, mx = .5, my = .5;
            if (params.captrawConstrain) {
                const double left = std::max(0., .5*(1-zoom)+params.captrawOffsetX);
                const double right = std::min(1., .5*(1+zoom)+params.captrawOffsetX);
                const double top = std::max(0., .5*(1-zoom)+params.captrawOffsetY);
                const double bottom = std::min(1., .5*(1+zoom)+params.captrawOffsetY);
                k = std::min(right-left, bottom-top);
                mx = .5*(left+right); my = .5*(top+bottom);
            }
            manualScale_ = k/zoom;
            manualOffsetX_ = ((mx-.5*k-.5-params.captrawOffsetX)/zoom+.5)*width;
            manualOffsetY_ = ((my-.5*k-.5-params.captrawOffsetY)/zoom+.5)*height;
        }`);
  return s.replace('    correct(x, y, scale_, offx_, offy_);',`    if (manual_) {
        x = x*manualScale_+manualOffsetX_;
        y = y*manualScale_+manualOffsetY_;
    }
    correct(x, y, scale_, offx_, offy_);`);
 });
 patch('iptransform.cc','// Versioned aspect and affine controls also need the perspective sampler.',s=>{
  s=s.replaceAll('params->commonTrans.autofill','params->perspective.captrawFill(params->commonTrans.autofill)');
  const anchor='            params->perspective.angle || params->perspective.shear);';
  if(!s.includes(anchor))throw new Error('ART manual perspective sampler gate missing');
  return s.replace(anchor,`            params->perspective.angle || params->perspective.shear ||
            // Versioned aspect and affine controls also need the perspective sampler.
            (params->perspective.captrawManual && (params->perspective.aspect != 1 ||
             params->perspective.captrawScale != 1 || params->perspective.captrawOffsetX != 0 ||
             params->perspective.captrawOffsetY != 0)));`);
 });
 patch('dcrop.cc','// Include versioned manual framing in the complete-canvas rule.',s=>{
  const anchor='perspective.angle || perspective.shear)) ||';
  if(s.includes(anchor)){
   return s.replace(anchor,`perspective.angle || perspective.shear || perspective.captrawManual)) ||
        // Include versioned manual framing in the complete-canvas rule.`);
  }
  const insert='    leftBorder = skips(rqx1 - bx1, skip);';
  if(!s.includes(insert))throw new Error('ART manual perspective detail canvas anchor missing');
  return s.replace(insert,`    // Include versioned manual framing in the complete-canvas rule.
    const auto &perspective=parent->params.perspective;
    if ((perspective.enabled && (perspective.horizontal || perspective.vertical || perspective.angle || perspective.shear || perspective.captrawManual)) ||
        (parent->params.lensProf.needed() &&
         (parent->params.lensProf.useDist || parent->params.lensProf.useCA))) {
        orx=ory=0;orw=parent->fw;orh=parent->fh;
    }

`+insert);
 });
 // Signed framing is stored in its public units and lowered only at the
 // existing ART sampler. Legacy aspect/scale/offset arithmetic stays intact.
 patch('procparams.h','bool captrawSignedFraming = false;',s=>s.replace('    bool captrawManual = false;',`    bool captrawManual = false;
    bool captrawSignedFraming = false;
    PerspectiveParams captrawNativeFraming() const;`));
 patch('procparams.cc','PerspectiveParams PerspectiveParams::captrawNativeFraming() const',s=>{
  const before='bool PerspectiveParams::operator==(const PerspectiveParams &other) const';
  if(!s.includes(before))throw new Error('Signed framing parameter method anchor missing');
  s=s.replace(before,`PerspectiveParams PerspectiveParams::captrawNativeFraming() const
{
    PerspectiveParams p(*this);
    if (!captrawManual || !captrawSignedFraming) return p;
    p.captrawSignedFraming = false;
    const double ratio = 1 + std::abs(aspect) / 500.;
    p.aspect = aspect >= 0 ? 1 / ratio : ratio;
    p.captrawScale *= std::sqrt(ratio);
    p.captrawOffsetX *= .0072;
    p.captrawOffsetY *= -.0072;
    return p;
}

`+before);
  const edits=[
   ['captrawConstrain == other.captrawConstrain;', 'captrawConstrain == other.captrawConstrain && captrawSignedFraming == other.captrawSignedFraming;'],
   ['                saveToKeyfile("Perspective", "CaptRAWManualV1", true, keyFile);','                saveToKeyfile("Perspective", "CaptRAWManualV1", true, keyFile);\n                if (perspective.captrawSignedFraming) saveToKeyfile("Perspective", "CaptRAWSignedFramingV1", true, keyFile);'],
   ['            perspective.captrawManual = false;', '            perspective.captrawSignedFraming = false;\n            perspective.captrawManual = false;'],
   ['            if (perspective.captrawManual) {\n                assignFromKeyfile', '            if (perspective.captrawManual) {\n                assignFromKeyfile(keyFile, "Perspective", "CaptRAWSignedFramingV1", perspective.captrawSignedFraming);\n                assignFromKeyfile']
  ];
  for(const [a,b] of edits){if(!s.includes(a))throw new Error('Signed framing persistence anchor missing');s=s.replace(a,b);}return s;
 });
 patch('perspectivecorrection.cc','const auto nativeFraming = stored.captrawNativeFraming();',s=>{
  const start=s.indexOf('void PerspectiveCorrection::init('),end=s.indexOf('inline void PerspectiveCorrection::correct',start);
  if(start<0||end<0)throw new Error('Signed framing sampler anchor missing');
  let part=s.slice(start,end).replace('const procparams::PerspectiveParams &params,','const procparams::PerspectiveParams &stored,');
  part=part.replace('{\n    manual_',`{\n    const auto nativeFraming = stored.captrawNativeFraming();
    const auto &params = stored.captrawSignedFraming ? nativeFraming : stored;
    manual_`);
  s=s.slice(0,start)+part+s.slice(end);
  const a='    procparams::PerspectiveParams ret(pp);';
  if(!s.includes(a))throw new Error('Signed framing metadata import anchor missing');
  s=s.replace(a,'    procparams::PerspectiveParams ret(pp.captrawNativeFraming());');
  const crop=s.indexOf('void PerspectiveCorrection::autocrop('),anchor='    get_view_size(width, height, params, cw, ch);';
  if(crop<0||!s.slice(crop).includes(anchor))throw new Error('Signed framing crop lowering anchor missing');
  return s.slice(0,crop)+s.slice(crop).replace(anchor,'    get_view_size(width, height, params.captrawSignedFraming ? pp : params, cw, ch);');
 });
 patch('iptransform.cc','params->perspective.captrawSignedFraming ? 0 : 1',s=>{
  const a='params->perspective.aspect != 1 ||';if(!s.includes(a))throw new Error('Signed framing neutral sampler gate missing');
  return s.replace(a,'params->perspective.aspect != (params->perspective.captrawSignedFraming ? 0 : 1) ||');
 });
}
