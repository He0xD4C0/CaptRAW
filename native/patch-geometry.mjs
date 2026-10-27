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
