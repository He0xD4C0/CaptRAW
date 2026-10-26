import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function patchMaskGroups(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const changed=edit(source);if(changed===source||!changed.includes(marker))throw new Error('ART mask patch anchor mismatch: '+file);writeFileSync(path,changed);};
 patch('procparams.h','std::vector<Mask> components;',s=>s.replace('class Mask {\npublic:','class Mask {\npublic:\n    std::vector<Mask> components;\n    std::vector<int> componentModes;').replace('const Glib::ustring &prefix, const Glib::ustring &suffix);\n    void save','const Glib::ustring &prefix, const Glib::ustring &suffix, int depth = 0);\n    void save'));
 patch('procparams.cc','CaptRAWComponentCount',s=>{
  s=s.replace('return enabled == other.enabled && inverted == other.inverted &&\n           parametricMask','return components == other.components && componentModes == other.componentModes &&\n           enabled == other.enabled && inverted == other.inverted &&\n           parametricMask');
  const start=s.indexOf('bool Mask::load('),end=s.indexOf('void Mask::save(',start);let load=s.slice(start,end);
  load=load.replace('const Glib::ustring &prefix, const Glib::ustring &suffix)','const Glib::ustring &prefix, const Glib::ustring &suffix, int depth)');
  load=load.replace('    bool ret = false;',String.raw`    if(depth > 8) throw std::runtime_error("Mask group nesting limit exceeded");
    int count = 0;
    assignFromKeyfile(keyfile, group_name, prefix + "CaptRAWComponentCount" + suffix, count);
    if(count < 0 || count > 32) throw std::runtime_error("Invalid mask component count");
    components.clear(); componentModes.clear();
    for(int i=0;i<count;++i){
        const auto childPrefix=prefix + Glib::ustring::compose("CaptRAWComponent%1_",i);
        Mask child; child.load(ppVersion,keyfile,basedir,group_name,childPrefix,suffix,depth+1);
        int mode=0;assignFromKeyfile(keyfile,group_name,childPrefix+"Operation"+suffix,mode);
        if(mode<0||mode>2)throw std::runtime_error("Invalid mask operation");
        components.push_back(child);componentModes.push_back(mode);
    }
    bool ret = count > 0;`);
  s=s.slice(0,start)+load+s.slice(end);
  const at=s.indexOf('void Mask::save('),begin=s.indexOf('{',at)+1;
  s=s.slice(0,begin)+String.raw`
    putToKeyfile(group_name,prefix+"CaptRAWComponentCount"+suffix,int(components.size()),keyfile);
    for(size_t i=0;i<components.size();++i){
        const auto childPrefix=prefix+Glib::ustring::compose("CaptRAWComponent%1_",i);
        components[i].save(keyfile,basedir,group_name,childPrefix,suffix);
        putToKeyfile(group_name,childPrefix+"Operation"+suffix,componentModes.at(i),keyfile);
    }
`+s.slice(begin);return s;
 });
 patch('masks.cc','// CaptRAW: compose component coverage before group inversion and opacity.',s=>s.replace('        apply_brush(i, false);',String.raw`        apply_brush(i, false);
        // CaptRAW: compose component coverage before group inversion and opacity.
        if(!masks[i].components.empty()){
            std::vector<array2D<float>> children(masks[i].components.size());
            generateMasks(rgb,toolname,mmgr,masks[i].components,offset_x,offset_y,
                          full_width,full_height,scale,multithread,-1,&children,nullptr,plistener);
            for(int y=0;y<H;++y)for(int x=0;x<W;++x){
                float coverage=0.f;
                for(size_t j=0;j<children.size();++j){
                    const float next=children[j][y][x];
                    switch(masks[i].componentModes.at(j)){
                        case 1:coverage*=1.f-next;break;
                        case 2:coverage*=next;break;
                        default:coverage=std::max(coverage,next);break;
                    }
                }
                if(Lmask)(*Lmask)[i][y][x]=coverage;
                if(abmask)(*abmask)[i][y][x]=coverage;
            }
        }`));
}

export function patchMaskPreview(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const changed=edit(source);if(changed===source||!changed.includes(marker))throw new Error('ART preview patch anchor mismatch: '+file);writeFileSync(path,changed);};
 patch('rtengine.h','class MaskPreviewListener',s=>s.replace('class PreviewImageListener {',`class MaskPreviewListener {
public:
    virtual ~MaskPreviewListener() = default;
    virtual void maskReady(int region, const array2D<float> &coverage, int x, int y,
                           double scale, bool detail) = 0;
};

class PreviewImageListener {`).replace('virtual void setPreviewImageListener(PreviewImageListener *l) = 0;', 'virtual void setPreviewImageListener(PreviewImageListener *l) = 0;\n    virtual void setMaskPreviewListener(MaskPreviewListener *l) = 0;'));
 patch('rtengine.h','virtual void setBorder(int pixels)',s=>s.replace('    virtual void setWindow(int cx, int cy, int cw, int ch, int skip) {}','    virtual void setWindow(int cx, int cy, int cw, int ch, int skip) {}\n    virtual void setBorder(int pixels) {}'));
 patch('dcrop.h','CaptRAW: adjustable processing halo',s=>s.replace('    const int\n        borderRequested;', '    int\n        borderRequested; // CaptRAW: adjustable processing halo'));
 patch('dcrop.h','void setBorder(int pixels)',s=>s.replace('    void setWindow(int cropX, int cropY, int cropW, int cropH,','    void setBorder(int pixels) override { borderRequested = pixels < 32 ? 32 : pixels; }\n    void setWindow(int cropX, int cropY, int cropW, int cropH,'));
 patch('improcfun.h','MaskPreviewListener *maskPreviewListener',s=>s.replace('class ImProcFunctions {\npublic:', 'class ImProcFunctions {\npublic:\n    MaskPreviewListener *maskPreviewListener = nullptr;'));
 patch('improccoordinator.h','void setMaskPreviewListener',s=>s.replace('    void setPreviewImageListener(PreviewImageListener *il) override', '    void setMaskPreviewListener(MaskPreviewListener *l) override { ipf.maskPreviewListener = l; }\n    void setPreviewImageListener(PreviewImageListener *il) override'));
 patch('ipcolorcorrection.cc','// CaptRAW: publish the exact coverage used below.',s=>s.replace('    float abca[n];',`    // CaptRAW: publish the exact coverage used below.
    if (maskPreviewListener && cur_pipeline != Pipeline::OUTPUT) {
        for (int i = 0; i < n; ++i) {
            maskPreviewListener->maskReady(i, Lmask[i], offset_x, offset_y, scale,
                                          cur_pipeline == Pipeline::PREVIEW);
        }
    }

    float abca[n];`));
}

export function patchQualityFixes(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const changed=edit(source);if(changed===source||!changed.includes(marker))throw new Error('ART quality patch anchor mismatch: '+file);writeFileSync(path,changed);};
 patch('xtrans_demosaic.cc','CaptRAW: keep homogeneity reads inside initialized tile bounds.',s=>{
  const extension=`                if (height - top < ts + 4) {
                    mrow = height - top + 2;
                }

                if (width - left < ts + 4) {
                    mcol = width - left + 2;
                }

`;
  if(!s.includes(extension)||!s.includes('xtransborder_interpolate(passes > 1 ? 8 : 11, red, green, blue);'))throw new Error('X-Trans edge anchors changed');
  return s.replace(extension,'                // CaptRAW: keep homogeneity reads inside initialized tile bounds.\n\n').replace('xtransborder_interpolate(passes > 1 ? 8 : 11, red, green, blue);','// The valid tile result ends 11 pixels before the sensor edge.\n    xtransborder_interpolate(11, red, green, blue);');
 });
 patch('procparams.cc','CaptRAW: preserve double precision WB coefficients.',s=>s.replace('            std::vector<float> m;\n            if (assignFromKeyfile(keyFile, "White Balance", "Multipliers", m)', '            std::vector<double> m; // CaptRAW: preserve double precision WB coefficients.\n            if (assignFromKeyfile(keyFile, "White Balance", "Multipliers", m)'));
}
