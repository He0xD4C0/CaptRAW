import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function patchFloatPreview(upstream){
 const patch=(name,marker,before,after)=>{
  const path=join(upstream,'src/engine',name),source=readFileSync(path,'utf8');
  if(source.includes(marker))return;
  if(!source.includes(before))throw new Error('ART float preview anchor mismatch: '+name);
  writeFileSync(path,source.replace(before,after));
 };
 patch('rtengine.h','class FloatPreviewListener {','class PreviewImageListener {',`// Borrowed working-space pixels: callbacks must finish reading before returning.
class FloatPreviewListener {
public:
    virtual ~FloatPreviewListener() = default;
    virtual bool wantsFloatPreview() const = 0;
    virtual void floatPreviewReady(Imagefloat &, int x, int y, int sx, int sy,
                                   int width, int height, bool detail) = 0;
};

class PreviewImageListener {`);
 patch('rtengine.h','virtual void setFloatPreviewListener','    virtual void setMaskPreviewListener(MaskPreviewListener *l) = 0;','    virtual void setMaskPreviewListener(MaskPreviewListener *l) = 0;\n    virtual void setFloatPreviewListener(FloatPreviewListener *l) = 0;');
 patch('improccoordinator.h','FloatPreviewListener *floatPreviewListener','    Imagefloat *orig_prev;','    FloatPreviewListener *floatPreviewListener = nullptr;\n    Imagefloat *orig_prev;');
 patch('improccoordinator.h','void setFloatPreviewListener','    void setMaskPreviewListener(MaskPreviewListener *l) override { ipf.maskPreviewListener = l; }','    void setMaskPreviewListener(MaskPreviewListener *l) override { ipf.maskPreviewListener = l; }\n    void setFloatPreviewListener(FloatPreviewListener *l) override { floatPreviewListener = l; }');
 patch('improccoordinator.cc','floatPreviewListener->floatPreviewReady','                ipf.rgb2monitor(bufs_[2], previmg);',`                ipf.rgb2monitor(bufs_[2], previmg);
                if (floatPreviewListener && floatPreviewListener->wantsFloatPreview())
                    floatPreviewListener->floatPreviewReady(*bufs_[2], 0, 0, 0, 0, pW, pH, false);`);
 patch('dcrop.cc','parent->floatPreviewListener->floatPreviewReady','        cropImageListener->setDetailedCrop(final, finaltrue, params.icm,',`        if (parent->floatPreviewListener && parent->floatPreviewListener->wantsFloatPreview())
            parent->floatPreviewListener->floatPreviewReady(*bufs_[2], rqcropx, rqcropy,
                leftBorder, upperBorder, finalW, finalH, true);
        cropImageListener->setDetailedCrop(final, finaltrue, params.icm,`);
}
