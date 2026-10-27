import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function patchRasterMasks(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const next=edit(source);if(next===source||!next.includes(marker))throw new Error('Raster mask patch anchor mismatch: '+file);writeFileSync(path,next);};
 patch('procparams.h','bool captrawRaster = false;',s=>s.replace('class ExternalMask {\npublic:',`class ExternalMask {
public:
    bool captrawRaster = false;
    int captrawRotation = 0, captrawWidth = 0, captrawHeight = 0;
    Glib::ustring captrawSha256;`));
 patch('procparams.cc','// CaptRAW: canonical raster metadata.',s=>{
  s=s.replace('filename == other.filename && feather == other.feather;',`filename == other.filename && feather == other.feather &&
           captrawRaster == other.captrawRaster && captrawRotation == other.captrawRotation &&
           captrawWidth == other.captrawWidth && captrawHeight == other.captrawHeight && captrawSha256 == other.captrawSha256;`);
  const anchor='    ret |= assignFromKeyfile(keyfile, group_name,\n                             prefix + "ExternalMaskEnabled" + suffix,';
  s=s.replace(anchor,`    // CaptRAW: canonical raster metadata. Missing fields restore legacy sampling.
    externalMask.captrawRaster = false;
    externalMask.captrawRotation = externalMask.captrawWidth = externalMask.captrawHeight = 0;
    externalMask.captrawSha256.clear();
    ret |= assignFromKeyfile(keyfile, group_name, prefix + "CaptRAWRaster" + suffix, externalMask.captrawRaster);
    ret |= assignFromKeyfile(keyfile, group_name, prefix + "CaptRAWRasterRotation" + suffix, externalMask.captrawRotation);
    ret |= assignFromKeyfile(keyfile, group_name, prefix + "CaptRAWRasterWidth" + suffix, externalMask.captrawWidth);
    ret |= assignFromKeyfile(keyfile, group_name, prefix + "CaptRAWRasterHeight" + suffix, externalMask.captrawHeight);
    ret |= assignFromKeyfile(keyfile, group_name, prefix + "CaptRAWRasterSHA256" + suffix, externalMask.captrawSha256);
`+anchor);
  const at=s.indexOf('void Mask::save('),begin=s.indexOf('{',at)+1;
  s=s.slice(0,begin)+`
    if(externalMask.captrawRaster){
        putToKeyfile(group_name, prefix + "CaptRAWRaster" + suffix, true, keyfile);
        putToKeyfile(group_name, prefix + "CaptRAWRasterRotation" + suffix, externalMask.captrawRotation, keyfile);
        putToKeyfile(group_name, prefix + "CaptRAWRasterWidth" + suffix, externalMask.captrawWidth, keyfile);
        putToKeyfile(group_name, prefix + "CaptRAWRasterHeight" + suffix, externalMask.captrawHeight, keyfile);
        putToKeyfile(group_name, prefix + "CaptRAWRasterSHA256" + suffix, externalMask.captrawSha256, keyfile);
    }
`+s.slice(begin);return s;
 });
 patch('masks.h','// CaptRAW: optional raster coordinates and integrity.',s=>s.replace('    bool load_mask(', '    // CaptRAW: optional raster coordinates and integrity.\n    bool load_mask(').replace('                   ProgressListener *plistener);','                   ProgressListener *plistener, const procparams::ExternalMask *metadata = nullptr);').replace('                    ProgressListener *plistener);','                    ProgressListener *plistener, const procparams::ExternalMask *metadata = nullptr);'));
 patch('masks.cc','// CaptRAW: verify raster identity before cache lookup.',s=>{
  s=s.replace('std::shared_ptr<array2D<float>> &mask, bool multithread, ProgressListener *plistener)','std::shared_ptr<array2D<float>> &mask, bool multithread, ProgressListener *plistener, const procparams::ExternalMask *metadata)');
  s=s.replace('    const std::string key = Glib::filename_from_utf8(filename) + "\\n" + checksum.get_string();',`    // CaptRAW: verify raster identity before cache lookup.
    if(metadata && metadata->captrawRaster){
        const auto &m = *metadata;
        if(m.captrawWidth < 1 || m.captrawHeight < 1 || m.captrawWidth > 65000 || m.captrawHeight > 65000 ||
           int64_t(m.captrawWidth)*m.captrawHeight > 64000000 ||
           (m.captrawRotation != 0 && m.captrawRotation != 90 && m.captrawRotation != 180 && m.captrawRotation != 270) ||
           m.captrawSha256.size() != 64 || checksum.get_string() != m.captrawSha256){
            if(plistener)plistener->externalMaskError("Raster mask identity mismatch: " + filename);
            return false;
        }
    }
    const std::string key = Glib::filename_from_utf8(filename) + "\\n" + checksum.get_string();`);
  const start=s.indexOf('bool ExternalMaskManager::load_mask('),end=s.indexOf('bool ExternalMaskManager::apply_mask(',start);
  let loader=s.slice(start,end);loader=loader.replace('    return true;\n}',`    if(metadata && metadata->captrawRaster && (mask->width() != metadata->captrawWidth || mask->height() != metadata->captrawHeight)){
        if(plistener)plistener->externalMaskError("Raster mask dimensions mismatch: " + filename);
        return false;
    }
    return true;
}`);s=s.slice(0,start)+loader+s.slice(end);
  s=s.replace('bool multithread, ProgressListener *plistener)\n{\n    std::shared_ptr<array2D<float>> mask;', 'bool multithread, ProgressListener *plistener, const procparams::ExternalMask *metadata)\n{\n    std::shared_ptr<array2D<float>> mask;');
  s=s.replace('if (!load_mask(filename, mask, multithread, plistener)) return false;', 'if (!load_mask(filename, mask, multithread, plistener, metadata)) return false;');
  const a=s.indexOf('bool ExternalMaskManager::apply_mask('),b=s.indexOf('//-----------------------------------------------------------------------------',a);let apply=s.slice(a,b);
  apply=apply.replace('    if (plistener) {','    if (plistener && (!metadata || !metadata->captrawRaster)) {');
  apply=apply.replace('std::min(full_width, full_height) * scale * 0.01', 'std::min(full_width, full_height) * (metadata && metadata->captrawRaster ? 1.0 : scale) * 0.01');
  apply=apply.replace('guidedFilter(guide, *out, *out, radius, epsilon, multithread);', 'guidedFilter(guide, *out, *out, radius, epsilon, multithread, metadata && metadata->captrawRaster ? 1 : 0);');
  apply=apply.replace('            float val = getBilinearValue(a, sx, sy);',`            float source_y = sy;
            if(metadata && metadata->captrawRaster){
                // Pixel centers, inverse quarter turn, then edge-replicated bilinear sampling.
                const double u = (x + offset_x + 0.5) / dW, v = (y + offset_y + 0.5) / dH;
                double px = u, py = v;
                switch(metadata->captrawRotation){
                    case 90:px=v;py=1-u;break;
                    case 180:px=1-u;py=1-v;break;
                    case 270:px=1-v;py=u;break;
                }
                sx = std::max(0.f, std::min(float(W-1), float(px*W-0.5)));
                source_y = std::max(0.f, std::min(float(H-1), float(py*H-0.5)));
            }
            float val = getBilinearValue(a, sx, source_y);`);
  s=s.slice(0,a)+apply+s.slice(b);
  s=s.replace('guide, &amask, multithread, plistener)) {','guide, &amask, multithread, plistener, &em)) {');return s;
 });
}
