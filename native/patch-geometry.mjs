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
}
