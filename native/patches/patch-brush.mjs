import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function patchBrush(upstream){
 const patch=(file,marker,pairs)=>{
  const path=join(upstream,'src/engine',file);let source=readFileSync(path,'utf8');if(source.includes(marker))return;
  for(const [from,to] of pairs){if(!source.includes(from))throw new Error('Brush patch anchor missing: '+file+' '+from.slice(0,70));source=source.replace(from,to);}
  writeFileSync(path,source);
 };
 patch('procparams.h','std::string captrawBrushProgram;',[
  ['    std::string captrawGeometryReference;',`    std::string captrawBrushProgram;
    int captrawBrushRotation = 0;
    std::string captrawGeometryReference;`]
 ]);
 patch('procparams.h','bool captrawUnitCoverage = false;',[
  ['    bool captrawRaster = false;','    bool captrawUnitCoverage = false; // Runtime-only scalar asset decoding.\n    bool captrawRaster = false;']
 ]);
 patch('procparams.cc','// CaptRAW: ordered brush program, separate from legacy strokes.',[
  ['    return captrawGeometryReference == other.captrawGeometryReference &&',`    return captrawBrushProgram == other.captrawBrushProgram &&
           captrawBrushRotation == other.captrawBrushRotation &&
           captrawGeometryReference == other.captrawGeometryReference &&`],
  ['    captrawGeometryReference.clear();',`    // CaptRAW: ordered brush program, separate from legacy strokes.
    captrawBrushProgram.clear();captrawBrushRotation=0;
    if(keyfile.has_key(group_name,prefix + "CaptRAWBrushProgramV1" + suffix)){
        captrawBrushProgram=keyfile.get_string(group_name,prefix + "CaptRAWBrushProgramV1" + suffix);
        captrawBrushRotation=keyfile.get_integer(group_name,prefix + "CaptRAWBrushRotation" + suffix);
        if(captrawBrushProgram.size()>16777216 || captrawBrushRotation<0 || captrawBrushRotation>270 || captrawBrushRotation%90)
            throw std::runtime_error("Invalid brush program storage");
    }
    captrawGeometryReference.clear();`],
  ['    bool ret = count > 0 || captrawReferenceAngleSet || !captrawGeometryReference.empty();',
   '    bool ret = count > 0 || captrawReferenceAngleSet || !captrawGeometryReference.empty() || !captrawBrushProgram.empty();'],
  ['    if(!captrawGeometryReference.empty())',`    if(!captrawBrushProgram.empty()){
        putToKeyfile(group_name,prefix + "CaptRAWBrushProgramV1" + suffix,captrawBrushProgram,keyfile);
        putToKeyfile(group_name,prefix + "CaptRAWBrushRotation" + suffix,captrawBrushRotation,keyfile);
    }
    if(!captrawGeometryReference.empty())`]
 ]);
 patch('masks.cc','#include "brush.h"',[
  ['#include "masks.h"','#include "masks.h"\n#include "brush.h"'],
  ['        // CaptRAW: compose component coverage before group inversion and opacity.',`        if(masks[i].enabled && !masks[i].captrawBrushProgram.empty())
            applyBrushProgram(masks[i].captrawBrushProgram,masks[i].captrawBrushRotation,
                              !masks[i].drawnMask.strokes.empty(),offset_x,offset_y,full_width,full_height,scale,guide,
                              Lmask ? &(*Lmask)[i] : nullptr,abmask ? &(*abmask)[i] : nullptr,multithread,plistener,resolveGeometry);
        // CaptRAW: compose component coverage before group inversion and opacity.`]
 ]);
 patch('masks.cc','// CaptRAW: frozen gray16 coverage shares the raster cache.',[
  ['int64_t(m.captrawWidth)*m.captrawHeight > 64000000','int64_t(m.captrawWidth)*m.captrawHeight > 512000000'],
  ['    Glib::Checksum checksum(Glib::Checksum::CHECKSUM_SHA256);',`    // CaptRAW: frozen gray16 coverage shares the raster cache.
    if(metadata && metadata->captrawRaster){
        file.seekg(0,std::ios::end);const std::streamoff bytes=file.tellg();file.seekg(0,std::ios::beg);
        if(bytes<1 || bytes>256ll*1024*1024){
            if(plistener)plistener->externalMaskError("Raster asset exceeds 256 MiB: " + filename);
            return false;
        }
    }
    Glib::Checksum checksum(Glib::Checksum::CHECKSUM_SHA256);`],
  ['    const std::string key = Glib::filename_from_utf8(filename) + "\\n" + checksum.get_string();',
   '    const std::string key = std::string(metadata && metadata->captrawUnitCoverage ? "unit16:" : "") + Glib::filename_from_utf8(filename) + "\\n" + checksum.get_string();'],
  ['    if (!cache_.get(key, mask)) {\n        StdImageSource src;',`    if (!cache_.get(key, mask)) {
        if(metadata && metadata->captrawUnitCoverage){
            if(!loadBrushCoverage(filename,metadata->captrawWidth,metadata->captrawHeight,mask)){
                if(plistener)plistener->externalMaskError("Invalid frozen gray16 coverage: " + filename);
                return false;
            }
            cache_.set(key,mask);
        }else{
        StdImageSource src;`],
  ['        cache_.set(key, mask);\n    }\n\n    if(metadata && metadata->captrawRaster',
   '        cache_.set(key, mask);\n        }\n    }\n\n    if(metadata && metadata->captrawRaster']
 ]);
}
