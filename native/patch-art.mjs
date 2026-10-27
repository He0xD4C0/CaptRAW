import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function patchInputProfileMetadata(upstream){
 const patch=(file,marker,edits)=>{
  const path=join(upstream,'src/engine',file);let source=readFileSync(path,'utf8');
  if(source.includes(marker))return;
  for(const [before,after] of edits){
   if(!source.includes(before)||source.indexOf(before)!==source.lastIndexOf(before))throw new Error('ART input profile patch anchor mismatch: '+file+' / '+before.slice(0,60));
   source=source.replace(before,()=>after);
  }
  writeFileSync(path,source);
 };
 patch('dcp.h','// CaptRAW: input profile metadata.',[
  ['#include <memory>','#include <memory>\n#include <string>'],
  ['    Illuminants getIlluminants() const;',`    // CaptRAW: input profile metadata.
    const std::string &getProfileName() const { return profile_name; }
    const std::string &getCameraModel() const { return camera_model; }
    int getEmbedPolicy() const { return embed_policy; }
    Illuminants getIlluminants() const;`],
  ['    Matrix color_matrix_1;',`    std::string profile_name;
    std::string camera_model;
    int embed_policy = -1;
    Matrix color_matrix_1;`]
 ]);
 patch('dcp.cc','// CaptRAW: validate external profile metadata.',[
  ['        fseek(f, 0, SEEK_SET);',`        if (fseek(f, 0, SEEK_END) != 0) return false;
        file_size_ = ftell(f);
        if (file_size_ < 8 || fseek(f, 0, SEEK_SET) != 0) return false;`],
  ['        get2(f, order_);\n        if (!offset) {\n            offset = get4(f, order_);\n        }',`        if (order_ != INTEL && order_ != MOTOROLA) return false;
        const auto magic = get2(f, order_);
        if (magic != 42 && magic != 0x4352) return false;
        offset = get4(f, order_);
        if (offset < 8 || offset > file_size_ - 2) return false;`],
  ['        int base = 0;\n        for (int i = 0; i < numtags; i++) {',`        if (12L * numtags > file_size_ - ftell(f)) return false;
        int base = 0;
        for (int i = 0; i < numtags; i++) {`],
  ['            if (parse_tag(t, f, base, order_)) {\n                tags_[t.id] = std::move(t);\n            }',`            if (!parse_tag(t, f, base, order_) || find(t.id)) return false;
            tags_[t.id] = std::move(t);`],
  ['        return true;\n    }\n\n    bool find(int id) const', '        return validateProfile();\n    }\n\n    bool find(int id) const'],
  ['            if (t.type == ASCII) {','            if (t.type == ASCII || t.type == BYTE) {'],
  ['                std::ostringstream buf;\n                unsigned char *value = &(t.value[0]);\n                buf << value;\n                return buf.str();',`                const auto end = std::find(t.value.begin(), t.value.begin() + t.count, 0);
                return std::string(t.value.begin(), end);`],
  ['        if (!t.count) {\n            t.count = 1;\n        }','        if (!t.count) return false;'],
  ['        if (valuesize > 4) {\n            fseek(f, get4(f, order) + base, SEEK_SET);\n        }',`        if (valuesize > 4) {
            const auto offset = get4(f, order);
            if (offset < 0 || offset > file_size_ - valuesize - base ||
                fseek(f, offset + base, SEEK_SET) != 0) return false;
        }
        if (valuesize > file_size_ - ftell(f) || loaded_bytes_ + valuesize > 64 * 1024 * 1024) return false;
        loaded_bytes_ += valuesize;`],
  ["        t.value[readSize] = '\\0';","        if (readSize != static_cast<size_t>(valuesize)) return false;\n        t.value[readSize] = '\\0';"],
  ['    std::unordered_map<int, Tag> tags_;',`    // CaptRAW: validate external profile metadata. Keep parsing in ART.
    bool validateProfile()
    {
        const auto matches = [&](int id, TagType type, unsigned count) {
            const auto it = tags_.find(id);
            return it != tags_.end() && it->second.type == type && it->second.count == count;
        };
        if (!matches(50721, SRATIONAL, 9)) return false;
        for (int id : {50721, 50722, 50964, 50965})
            if (find(id) && !matches(id, SRATIONAL, 9)) return false;
        for (int id : {50778, 50779})
            if (find(id) && !matches(id, SHORT, 1)) return false;
        for (int id : {50941, 51107, 51108})
            if (find(id) && !matches(id, LONG, 1)) return false;
        if (find(51109) && !matches(51109, SRATIONAL, 1)) return false;
        for (int id : {50708, 50936, 50942}) {
            const auto it = tags_.find(id);
            if (it != tags_.end() && it->second.type != ASCII && it->second.type != BYTE) return false;
        }
        if (find(50941) && (toInt(50941) < 0 || toInt(50941) > 3)) return false;
        for (int dims : {50937, 50981}) {
            const int data = dims == 50937 ? 50938 : 50982;
            if (!find(dims)) {
                if (find(data) || (dims == 50937 && find(50939))) return false;
                continue;
            }
            if (!matches(dims, LONG, 3)) return false;
            const int h = toInt(dims), s = toInt(dims, 4), v = toInt(dims, 8);
            const auto count = getCount(data);
            if (h < 1 || s < 2 || v < 1 || count % 3 ||
                h > 10000000 / s || h * s > 10000000 / v ||
                static_cast<unsigned>(h * s * v) != count / 3 || !matches(data, FLOAT, count)) return false;
            if (dims == 50937 && find(50939) && !matches(50939, FLOAT, count)) return false;
        }
        if (find(50940)) {
            const auto count = getCount(50940);
            if (count < 4 || count % 2 || !matches(50940, FLOAT, count)) return false;
            double previous = -1;
            for (unsigned i = 0; i < count; i += 2) {
                const double x = toDouble(50940, i * 4), y = toDouble(50940, (i + 1) * 4);
                if (!std::isfinite(x) || !std::isfinite(y) || x <= previous || x < 0 || x > 1 || y < 0 || y > 1) return false;
                previous = x;
            }
        }
        return true;
    }
    long file_size_ = 0;
    size_t loaded_bytes_ = 0;
    std::unordered_map<int, Tag> tags_;`],
  ['    light_source_1 = md.find(CALIBRATION_ILLUMINANT_1)',`    profile_name = md.toString(50936); // ProfileName (ASCII or UTF-8 BYTE)
    camera_model = md.toString(50708); // UniqueCameraModel; DNG standalone profile restriction
    embed_policy = md.find(50941) ? md.toInt(50941) : -1; // ProfileEmbedPolicy

    light_source_1 = md.find(CALIBRATION_ILLUMINANT_1)`]
 ]);
 // Keep stricter standalone checks out of ART's existing embedded-DNG path.
 patch('dcp.h','// CaptRAW: opt-in standalone validation.',[
  ['    explicit DCPProfile(const Glib::ustring &filename);',`    // CaptRAW: opt-in standalone validation.
    explicit DCPProfile(const Glib::ustring &filename, bool strict_validation = false);`]
 ]);
 patch('dcp.cc','// CaptRAW: opt-in standalone validation.',[
  ['DCPProfile::DCPProfile(const Glib::ustring &filename)','DCPProfile::DCPProfile(const Glib::ustring &filename, bool strict_validation)'],
  ['    DCPMetadata md(file);','    DCPMetadata md(file, strict_validation);'],
  ['    explicit DCPMetadata(FILE *file): order_(UNKNOWN), file_(file) {}',`    // CaptRAW: opt-in standalone validation.
    explicit DCPMetadata(FILE *file, bool strict): order_(UNKNOWN), file_(file), strict_(strict) {}`],
  ['        return validateProfile();','        return !strict_ || validateProfile();'],
  ['            if (!parse_tag(t, f, base, order_) || find(t.id)) return false;\n            tags_[t.id] = std::move(t);',`            if (parse_tag(t, f, base, order_)) {
                if (strict_ && find(t.id)) return false;
                tags_[t.id] = std::move(t);
            } else if (strict_) return false;`],
  ['        if (!t.count) return false;',`        if (!t.count) {
            if (strict_) return false;
            t.count = 1;
        }`],
  ['loaded_bytes_ + valuesize > 64 * 1024 * 1024','(strict_ && loaded_bytes_ + valuesize > 64 * 1024 * 1024)'],
  ['    FILE *file_;','    FILE *file_;\n    bool strict_;']
 ]);
}
export function patchWhiteBalanceAccess(upstream){
 const path=join(upstream,'src/engine/dcp.h'),s=readFileSync(path,'utf8');
 if(s.includes('// CaptRAW: DCP white-point conversion.'))return;
 const changed=s.replace('    Matrix findXyztoCamera(', 'public: // CaptRAW: DCP white-point conversion.\n    Matrix findXyztoCamera(').replace('    Matrix makeXyzCam(', 'private:\n    Matrix makeXyzCam(');
 if(changed===s||!changed.includes('private:\n    Matrix makeXyzCam('))throw new Error('DCP white balance access anchor mismatch');
 writeFileSync(path,changed);
}
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

export function patchExternalMaskErrors(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const changed=edit(source);if(changed===source||!changed.includes(marker))throw new Error('ART external mask patch anchor mismatch: '+file);writeFileSync(path,changed);};
 patch('rtengine.h','virtual void externalMaskError(',s=>s.replace('virtual void error(const Glib::ustring &descr) = 0;','virtual void error(const Glib::ustring &descr) = 0;\n    virtual void externalMaskError(const Glib::ustring &descr) { error(descr); }'));
 patch('masks.h','bool load_mask(',s=>s.replace('    static ExternalMaskManager *getInstance();',`    static ExternalMaskManager *getInstance();
    bool load_mask(const Glib::ustring &filename,
                   std::shared_ptr<array2D<float>> &mask, bool multithread,
                   ProgressListener *plistener);`));
 patch('masks.cc','bool ExternalMaskManager::load_mask(',s=>{
  const start=s.indexOf('    std::string key =',s.indexOf('bool ExternalMaskManager::apply_mask('));
  const end=s.indexOf('    const array2D<float> &a = *mask;',start);
  if(start<0||end<0)throw new Error('External mask loader anchor mismatch');
  const loader=s.slice(start,end).replace('    std::shared_ptr<array2D<float>> mask;\n','').replace('if (plistener && !filename.empty())','if (plistener)').replace('plistener->error(','plistener->externalMaskError(');
  s=s.slice(0,start)+`    std::shared_ptr<array2D<float>> mask;
    if (!load_mask(filename, mask, multithread, plistener)) return false;

`+s.slice(end);
  s=s.replace('bool ExternalMaskManager::apply_mask(',`// CaptRAW: preflight and rendering share the same decoded asset cache.
bool ExternalMaskManager::load_mask(const Glib::ustring &filename,
    std::shared_ptr<array2D<float>> &mask, bool multithread, ProgressListener *plistener)
{
${loader}    return true;
}

bool ExternalMaskManager::apply_mask(`);
  s=s.replace('if (em.enabled && ExternalMaskManager::getInstance()->apply_mask(', 'if (masks[i].enabled && em.enabled && ExternalMaskManager::getInstance()->apply_mask(');
  s=s.replace('if(!masks[i].components.empty()){','if(masks[i].enabled && !masks[i].components.empty()){');
  return s;
 });
 patch('masks.cc','// CaptRAW: external mask content cache.',s=>s.replace('#include "masks.h"','#include "masks.h"\n#include <fstream>').replace(`    std::string key =
        Glib::filename_from_utf8(filename) + "\\n" + getMD5(filename, true);`,`    // CaptRAW: external mask content cache. Size/mtime cannot detect every corrupt replacement.
    std::ifstream file(Glib::filename_from_utf8(filename), std::ios::binary);
    Glib::Checksum checksum(Glib::Checksum::CHECKSUM_SHA256);
    unsigned char bytes[65536];
    while (file.read(reinterpret_cast<char *>(bytes), sizeof(bytes)) || file.gcount())
        checksum.update(bytes, file.gcount());
    if (!file.eof() || file.bad()) {
        if (plistener) plistener->externalMaskError(filename);
        return false;
    }
    const std::string key = Glib::filename_from_utf8(filename) + "\\n" + checksum.get_string();`));
 patch('improcfun.h','void setMaskErrorListener(',s=>s.replace('    void setProgressListener(ProgressListener *pl, int num_previews);','    void setProgressListener(ProgressListener *pl, int num_previews);\n    void setMaskErrorListener(ProgressListener *pl) { maskErrorListener = pl; }').replace('    ProgressListener *plistener;','    ProgressListener *plistener;\n    ProgressListener *maskErrorListener = nullptr;'));
 patch('simpleprocess.cc','ipf.setMaskErrorListener(pl);',s=>s.replace('        ipf.setPipeline(ImProcFunctions::Pipeline::OUTPUT);','        ipf.setPipeline(ImProcFunctions::Pipeline::OUTPUT);\n        ipf.setMaskErrorListener(pl);'));
 for(const file of ['ipcolorcorrection.cc','ipsmoothing.cc','iptextureboost.cc','iplocalcontrast.cc'])
  patch(file,'maskErrorListener ? maskErrorListener : plistener',s=>s.replace('cur_pipeline == Pipeline::NAVIGATOR ? plistener : nullptr)) {','maskErrorListener ? maskErrorListener : plistener)) {'));
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
 patch('rtengine.h','virtual bool wantsLuminance()',s=>s.replace('    virtual ~MaskPreviewListener() = default;',`    virtual ~MaskPreviewListener() = default;
    virtual bool wantsLuminance() const { return false; }
    virtual void luminanceReady(const PlanarWhateverData<float> &, int, int, double, bool) {}`));
 patch('ipcolorcorrection.cc','// CaptRAW: read the same floating lightness used by range masks.',s=>s.replace('    if (!params->colorcorrection.enabled) {',`    // CaptRAW: read the same floating lightness used by range masks.
    if (maskPreviewListener && maskPreviewListener->wantsLuminance() && cur_pipeline != Pipeline::OUTPUT) {
        PlanarWhateverData<float> lightness(W, H);
        fillPipetteMasks(rgb, &lightness, MasksEditID::L, multiThread);
        maskPreviewListener->luminanceReady(lightness, offset_x, offset_y, scale,
                                          cur_pipeline == Pipeline::PREVIEW);
    }
    if (!params->colorcorrection.enabled) {`));
 patch('rtengine.h','virtual bool luminanceSampleOnly()',s=>s.replace('    virtual bool wantsLuminance() const { return false; }','    virtual bool wantsLuminance() const { return false; }\n    virtual bool luminanceSampleOnly() const { return false; }'));
 patch('ipcolorcorrection.cc','if (maskPreviewListener->luminanceSampleOnly())',s=>s.replace('maskPreviewListener->luminanceReady(lightness, offset_x, offset_y, scale,\n                                          cur_pipeline == Pipeline::PREVIEW);','maskPreviewListener->luminanceReady(lightness, offset_x, offset_y, scale,\n                                          cur_pipeline == Pipeline::PREVIEW);\n        if (maskPreviewListener->luminanceSampleOnly()) return true;'));
 patch('rtengine.h','class Imagefloat; // CaptRAW color sampling',s=>s.replace('class MaskPreviewListener {','class Imagefloat; // CaptRAW color sampling\nclass MaskPreviewListener {'));
 patch('rtengine.h','virtual bool wantsColorSample()',s=>s.replace('    virtual bool wantsLuminance() const { return false; }',`    virtual bool wantsColorSample() const { return false; }
    virtual void colorSampleReady(const Imagefloat &, int, int, double, bool) {}
    virtual bool wantsLuminance() const { return false; }`));
 patch('ipcolorcorrection.cc','maskPreviewListener->wantsColorSample()',s=>s.replace('    // CaptRAW: read the same floating lightness used by range masks.',`    if (maskPreviewListener && maskPreviewListener->wantsColorSample() && cur_pipeline != Pipeline::OUTPUT) {
        maskPreviewListener->colorSampleReady(*rgb, offset_x, offset_y, scale, cur_pipeline == Pipeline::PREVIEW);
        return true;
    }
    // CaptRAW: read the same floating lightness used by range masks.`));
 patch('masks.h','bool getDeltaEColorRegion(',s=>s.replace('bool getDeltaEColor(Imagefloat *rgb',`bool getDeltaEColorRegion(Imagefloat *rgb, int x0, int y0, int x1, int y1, float &L, float &C, float &H);
bool getDeltaEColor(Imagefloat *rgb`));
 patch('masks.cc','bool getDeltaEColorRegion(',s=>s.replace('bool getDeltaEColor(Imagefloat *rgb',`// CaptRAW: rectangular samples use ART's same Lab conversion and median color.
bool getDeltaEColorRegion(Imagefloat *rgb, int x0, int y0, int x1, int y1, float &L, float &C, float &H)
{
    if (x0 < 0 || y0 < 0 || x1 >= rgb->getWidth() || y1 >= rgb->getHeight() || x0 > x1 || y0 > y1) return false;
    std::vector<float> ls, as, bs;
    const size_t count = size_t(x1-x0+1)*(y1-y0+1); ls.reserve(count); as.reserve(count); bs.reserve(count);
    const auto ws = ICCStore::getInstance()->workingSpaceMatrix(rgb->colorSpace());
    const auto mode = rgb->mode();
    for (int y=y0; y<=y1; ++y) for (int x=x0; x<=x1; ++x) {
        float l,a,b; rgb2lab(mode,rgb->r(y,x),rgb->g(y,x),rgb->b(y,x),l,a,b,ws);
        if (!std::isfinite(l) || !std::isfinite(a) || !std::isfinite(b)) continue;
        ls.push_back(l); as.push_back(a); bs.push_back(b);
    }
    if (ls.empty()) return false;
    const auto median=[](std::vector<float> &v){auto mid=v.begin()+v.size()/2;std::nth_element(v.begin(),mid,v.end());return *mid;};
    L=median(ls)/32768.f;const float a=median(as)/42000.f,b=median(bs)/42000.f;
    C=sqrtf(a*a+b*b);H=xatan2f(b,a)*360.f/(2.f*RT_PI);if(H<0)H+=360.f;
    return true;
}

bool getDeltaEColor(Imagefloat *rgb`));
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
 patch('iptonecurve.cc','CaptRAW: count every pixel when histogram bins collide.',s=>s.replace('            hist[y >> compression]++;',`            // CaptRAW: count every pixel when histogram bins collide.
#ifdef _OPENMP
#pragma omp atomic update
#endif
            hist[y >> compression]++;`));
 patch('procparams.cc','CaptRAW: WB multipliers are numeric data, not a curve.',s=>{
  const tail='\n            if (assignFromKeyfile(keyFile, "White Balance", "Multipliers", m) &&\n                m.size() == 3) {';
  const replacement=`            // CaptRAW: WB multipliers are numeric data, not a curve.
            std::vector<double> m;
            if (keyFile.has_key("White Balance", "Multipliers"))
                m = keyFile.get_double_list("White Balance", "Multipliers");
            if (m.size() == 3) {`;
  return s.replace('            std::vector<float> m;'+tail,replacement).replace('            std::vector<double> m; // CaptRAW: preserve double precision WB coefficients.'+tail,replacement);
 });
 patch('procparams.cc','CaptRAW: preserve the second curve mode even for an identity curve.',s=>s.replace(`            if (!toneCurve.curve2.empty() &&
                toneCurve.curve2[0] != art::utils::DCT_Linear &&
                toneCurve.curveMode != toneCurve.curveMode2) {`,`            // CaptRAW: preserve the second curve mode even for an identity curve.
            if (toneCurve.curveMode != toneCurve.curveMode2) {`));
 patch('ipspot.cc','CaptRAW: ordered healing relaxation',s=>s.replace(`    for (int iter = 0; iter < MAX_ITER; ++iter) {
#ifdef _OPENMP
#pragma omp parallel for schedule(dynamic, 16)
#endif
`, `    // CaptRAW: ordered healing relaxation reads updated neighboring rows.
    // Parallel rows race on those values and change the rendered result.
    for (int iter = 0; iter < MAX_ITER; ++iter) {
`));

}

export function patchBlackWhiteMixer(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const changed=edit(source);if(changed===source||!changed.includes(marker))throw new Error('ART B&W patch anchor mismatch: '+file);writeFileSync(path,changed);};
 patch('procparams.h','std::vector<double> luminanceCurve;',s=>s.replace('struct BlackWhiteParams {\n    bool enabled;','struct BlackWhiteParams {\n    bool enabled;\n    std::vector<double> luminanceCurve;'));
 patch('procparams.cc','/* CaptRAW: independent pre-monochrome hue luminance. */',s=>s.replace('BlackWhiteParams::BlackWhiteParams()\n    : enabled(false),','BlackWhiteParams::BlackWhiteParams()\n    : enabled(false), luminanceCurve{art::utils::FCT_Linear}, /* CaptRAW: independent pre-monochrome hue luminance. */').replace('    return enabled == other.enabled && filter == other.filter &&','    return luminanceCurve == other.luminanceCurve &&\n           enabled == other.enabled && filter == other.filter &&').replace('        // Black & White\n        if (RELEVANT_(blackwhite)) {','        // Black & White\n        if (RELEVANT_(blackwhite)) {\n            if (blackwhite.luminanceCurve.size() > 1)\n                saveToKeyfile("Black & White", "CaptRAWLuminanceCurve", blackwhite.luminanceCurve, keyFile);').replace('        if (keyFile.has_group("Black & White") && RELEVANT_(blackwhite)) {','        if (keyFile.has_group("Black & White") && RELEVANT_(blackwhite)) {\n            blackwhite.luminanceCurve = {art::utils::FCT_Linear};\n            assignFromKeyfile(keyFile, "Black & White", "CaptRAWLuminanceCurve", blackwhite.luminanceCurve);'));
 patch('improcfun.h','void hslEqualizerWithParams(',s=>s.replace('    void hslEqualizer(Imagefloat *rgb);','    void hslEqualizer(Imagefloat *rgb);\n    void hslEqualizerWithParams(Imagefloat *rgb, const procparams::HSLEqualizerParams &hslParams, bool chromaWeighted = false);'));
 patch('iphsl.cc','void ImProcFunctions::hslEqualizerWithParams(',s=>s.replace('void ImProcFunctions::hslEqualizer(Imagefloat *img)\n{','void ImProcFunctions::hslEqualizer(Imagefloat *img)\n{\n    hslEqualizerWithParams(img, params->hsl);\n}\n\nvoid ImProcFunctions::hslEqualizerWithParams(Imagefloat *img, const HSLEqualizerParams &hslParams, bool chromaWeighted)\n{').replaceAll('params->hsl.', 'hslParams.').replace('float f = 1.f + tolin(mask[y][x], 10.f);', 'float f = 1.f + tolin(mask[y][x], 10.f);\n                if (chromaWeighted) {\n                    const float lum = img->g(y, x);\n                    const float weight = lum > 0.f ? std::min(1.f, img->b(y, x) / lum) : 0.f;\n                    f = 1.f + (f - 1.f) * weight;\n                }'));
 patch('ipbw.cc','// CaptRAW: reuse HSL before conversion without changing the color mixer.',s=>s.replace('void ImProcFunctions::blackAndWhite(Imagefloat *img)\n{\n    if (!params->blackwhite.enabled) {\n        return;\n    }','void ImProcFunctions::blackAndWhite(Imagefloat *img)\n{\n    if (!params->blackwhite.enabled) {\n        return;\n    }\n    // CaptRAW: reuse HSL before conversion without changing the color mixer.\n    if (params->blackwhite.luminanceCurve.size() > 1) {\n        HSLEqualizerParams mixer;\n        mixer.enabled = true;\n        mixer.lCurve = params->blackwhite.luminanceCurve;\n        hslEqualizerWithParams(img, mixer, true);\n    }'));
}

export function patchCameraCrop(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const changed=edit(source);if(changed===source||!changed.includes(marker))throw new Error('ART camera crop patch anchor mismatch: '+file);writeFileSync(path,changed);};
 patch('rawimage.h','bool getCameraCrop(',s=>s.replace('    bool use_internal_decoder_;','    std::array<int,4> camera_crop_{};\n    bool use_internal_decoder_;').replace('    int get_width() const { return width; }','    bool getCameraCrop(int &x, int &y, int &w, int &h) const;\n    int get_width() const { return width; }'));
 patch('rawimage.cc','bool RawImage::getCameraCrop(',s=>s.replace('int RawImage::loadRaw(',`bool RawImage::getCameraCrop(int &x, int &y, int &w, int &h) const
{
    // Nikon tag 0x0045 is in physical sensor coordinates, retained after recycle().
    if (camera_crop_[2] <= 0 || camera_crop_[3] <= 0) return false;
    x = camera_crop_[0] - left_margin; y = camera_crop_[1] - top_margin;
    w = camera_crop_[2]; h = camera_crop_[3];
    return x >= 0 && y >= 0 && x + w <= width && y + h <= height;
}

int RawImage::loadRaw(`).replace('    libraw_.reset(new LibRaw());', '    camera_crop_ = {};\n    libraw_.reset(new LibRaw());').replace('        int err = libraw_->open_buffer(ifp->data, ifp->size);', `        int err = libraw_->open_buffer(ifp->data, ifp->size);
        if (err == LIBRAW_SUCCESS && libraw_->imgdata.idata.maker_index == LIBRAW_CAMERAMAKER_Nikon) {
            const auto &crop = libraw_->imgdata.sizes.raw_inset_crops[0];
            if (crop.cwidth > 0 && crop.cheight > 0 && crop.cwidth != 65535 && crop.cheight != 65535)
                camera_crop_ = {int(crop.cleft), int(crop.ctop), int(crop.cwidth), int(crop.cheight)};
        }`));
 patch('imagesource.h','virtual bool getCameraCrop(',s=>s.replace('    virtual void setBorder(unsigned int border) {}','    virtual bool getCameraCrop(int &x, int &y, int &w, int &h) const { return false; }\n    virtual void setBorder(unsigned int border) {}'));
 patch('rawimagesource.h','bool getCameraCrop(',s=>s.replace('    void setBorder(unsigned int rawBorder) override', '    bool getCameraCrop(int &x, int &y, int &w, int &h) const override;\n    void setBorder(unsigned int rawBorder) override'));
 patch('rawimagesource.cc','bool RawImageSource::getCameraCrop(',s=>s.replace('void RawImageSource::getFullSize(',`bool RawImageSource::getCameraCrop(int &x, int &y, int &w, int &h) const
{
    if (!ri || ri->getSensorType() != ST_BAYER || !ri->getCameraCrop(x,y,w,h)) return false;
    // Keep the existing demosaic boundary; intersect only the camera's inset.
    const int W=ri->get_width()-2*border, H=ri->get_height()-2*border;
    const int right=std::min(x+w-border,W), bottom=std::min(y+h-border,H);
    x=std::max(0,x-border);y=std::max(0,y-border);w=right-x;h=bottom-y;
    if(w<=0 || h<=0) return false;
    const int ox=x,oy=y,ow=w,oh=h;
    switch(ri->get_rotateDegree()){
        case 90:x=H-oy-oh;y=ox;w=oh;h=ow;break;
        case 180:x=W-ox-ow;y=H-oy-oh;break;
        case 270:x=oy;y=W-ox-ow;w=oh;h=ow;break;
    }
    return true;
}

void RawImageSource::getFullSize(`));
}

export function patchLocalWhiteBalance(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const changed=edit(source);if(changed===source||!changed.includes(marker))throw new Error('ART local WB patch anchor mismatch: '+file);writeFileSync(path,changed);};
 patch('procparams.h','std::vector<double> whiteBalanceMatrix;',s=>s.replace('    enum class Mode { YUV, RGB, HSL, JZAZBZ, LUT };\n    struct Region {','    enum class Mode { YUV, RGB, HSL, JZAZBZ, LUT };\n    struct Region {\n        std::vector<double> whiteBalanceMatrix;'));
 patch('procparams.cc','CaptRAWWhiteBalanceMatrix_',s=>s.replace('    return a == other.a && b == other.b && abscale == other.abscale &&','    return whiteBalanceMatrix == other.whiteBalanceMatrix &&\n           a == other.a && b == other.b && abscale == other.abscale &&').replace('                auto &l = colorcorrection.regions[j];','                auto &l = colorcorrection.regions[j];\n                if (!l.whiteBalanceMatrix.empty())\n                    putToKeyfile("ColorCorrection", Glib::ustring("CaptRAWWhiteBalanceMatrix_") + n, l.whiteBalanceMatrix, keyFile);').replace('                ColorCorrectionParams::Region cur;\n                Mask curmask;',`                ColorCorrectionParams::Region cur;
                if (keyFile.has_key(ccgroup, prefix + "CaptRAWWhiteBalanceMatrix_" + std::to_string(i))) {
                    // CaptRAW: matrix data is not a curve.
                    cur.whiteBalanceMatrix = keyFile.get_double_list(ccgroup, prefix + "CaptRAWWhiteBalanceMatrix_" + std::to_string(i));
                    if (cur.whiteBalanceMatrix.size() != 9 || std::any_of(cur.whiteBalanceMatrix.begin(), cur.whiteBalanceMatrix.end(), [](double v){ return !std::isfinite(v) || std::abs(v) > 64; }))
                        throw std::runtime_error("Invalid local white balance matrix");
                }
                Mask curmask;`));
 patch('procparams.cc','// CaptRAW: matrix data is not a curve.',s=>s.replace('if (assignFromKeyfile(keyFile, ccgroup, prefix + "CaptRAWWhiteBalanceMatrix_" + std::to_string(i), cur.whiteBalanceMatrix)) {',`if (keyFile.has_key(ccgroup, prefix + "CaptRAWWhiteBalanceMatrix_" + std::to_string(i))) {
                    // CaptRAW: matrix data is not a curve.
                    cur.whiteBalanceMatrix = keyFile.get_double_list(ccgroup, prefix + "CaptRAWWhiteBalanceMatrix_" + std::to_string(i));`));
 patch('ipcolorcorrection.cc','// CaptRAW: working-space Bradford matrix, before local CDL and masking.',s=>{
  s=s.replace('    float rslope[n][3];','    bool haswb[n];\n    float wbmatrix[n][9];\n    float rslope[n][3];').replace('        auto &r = params->colorcorrection.regions[i];','        auto &r = params->colorcorrection.regions[i];\n        haswb[i] = r.whiteBalanceMatrix.size() == 9;\n        if (haswb[i]) for (int j=0;j<9;++j) wbmatrix[i][j] = float(r.whiteBalanceMatrix[j]);');
  const anchor='        const auto *compression = rcompression[region];';
  const scalar=`
        // CaptRAW: working-space Bradford matrix, before local CDL and masking.
        if (haswb[region]) {
            const auto *m = wbmatrix[region];
            float R,G,B;
            Color::yuv2rgb(Y,u,v,R,G,B,ws);
            const float r=m[0]*R+m[1]*G+m[2]*B, g=m[3]*R+m[4]*G+m[5]*B, b=m[6]*R+m[7]*G+m[8]*B;
            Color::rgb2yuv(r,g,b,Y,u,v,ws);
        }
`;
  const vector=`
        if (haswb[region]) {
            const auto *m = wbmatrix[region];
            vfloat R,G,B;
            Color::yuv2rgb(Y,u,v,R,G,B,vws);
            const vfloat r=F2V(m[0])*R+F2V(m[1])*G+F2V(m[2])*B, g=F2V(m[3])*R+F2V(m[4])*G+F2V(m[5])*B, b=F2V(m[6])*R+F2V(m[7])*G+F2V(m[8])*B;
            Color::rgb2yuv(r,g,b,Y,u,v,vws);
        }
`;
  const split=s.split(anchor);if(split.length!==3)throw new Error('Local WB scalar/SIMD anchors changed');return split[0]+anchor+scalar+split[1]+anchor+vector+split[2];
 });
}

export function patchLocalTone(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const changed=edit(source);if(changed===source||!changed.includes(marker))throw new Error('ART local tone patch anchor mismatch: '+file);writeFileSync(path,changed);};
 patch('procparams.h','std::vector<int> toneBands;',s=>s.replace('        std::vector<double> whiteBalanceMatrix;','        std::vector<double> whiteBalanceMatrix;\n        std::vector<int> toneBands;'));
 patch('procparams.cc','CaptRAWToneBands_',s=>s.replace('    return whiteBalanceMatrix == other.whiteBalanceMatrix &&','    return toneBands == other.toneBands && whiteBalanceMatrix == other.whiteBalanceMatrix &&').replace('                if (!l.whiteBalanceMatrix.empty())','                if (!l.toneBands.empty())\n                    putToKeyfile("ColorCorrection", Glib::ustring("CaptRAWToneBands_") + n, l.toneBands, keyFile);\n                if (!l.whiteBalanceMatrix.empty())').replace('                ColorCorrectionParams::Region cur;','                ColorCorrectionParams::Region cur;\n                if (keyFile.has_key(ccgroup, prefix + "CaptRAWToneBands_" + std::to_string(i))) {\n                    const auto savedBands = keyFile.get_integer_list(ccgroup, prefix + "CaptRAWToneBands_" + std::to_string(i));\n                    cur.toneBands.assign(savedBands.begin(), savedBands.end());\n                    if (cur.toneBands.size() != 5 || std::any_of(cur.toneBands.begin(), cur.toneBands.end(), [](int v){ return v < -100 || v > 100; }))\n                        throw std::runtime_error("Invalid local tone bands");\n                }'));
 patch('improcfun.h','void localToneEqualizer(',s=>s.replace('    bool toneEqualizer(Imagefloat *rgb);','    bool toneEqualizer(Imagefloat *rgb);\n    void localToneEqualizer(Imagefloat *yuv, const std::vector<int> &bands, array2D<float> &correction);'));
 patch('iptoneequalizer.cc','void ImProcFunctions::localToneEqualizer(',s=>{
  s=s.replace('             cmsHPROFILE monitor_prof)','             cmsHPROFILE monitor_prof, array2D<float> *correction = nullptr)');
  s=s.replace('            Y[y][x] = LIM(Color::rgbLuminance(R[y][x], G[y][x], B[y][x], ws),','            Y[y][x] = LIM(correction ? G[y][x] / 65535.f : Color::rgbLuminance(R[y][x], G[y][x], B[y][x], ws),');
  s=s.replace('            STVF(R[y][x], LVF(R[y][x]) * corr);','            if (correction) { STVFU((*correction)[y][x], corr); continue; }\n            STVF(R[y][x], LVF(R[y][x]) * corr);');
  s=s.replace('            R[y][x] *= corr;','            if (correction) { (*correction)[y][x] = corr; continue; }\n            R[y][x] *= corr;');
  return s.replace('bool ImProcFunctions::toneEqualizer(Imagefloat *rgb)',`// CaptRAW: reuse the identical tone-equalizer calculation on linear YUV luminance.
void ImProcFunctions::localToneEqualizer(Imagefloat *yuv, const std::vector<int> &bands, array2D<float> &correction)
{
    ToneEqualizerParams p;
    std::copy(bands.begin(), bands.end(), p.bands.begin());
    const int W = yuv->getWidth(), H = yuv->getHeight();
    correction(W, H);
    array2D<float> R(W, H, yuv->r.ptrs, ARRAY2D_BYREFERENCE);
    array2D<float> G(W, H, yuv->g.ptrs, ARRAY2D_BYREFERENCE);
    array2D<float> B(W, H, yuv->b.ptrs, ARRAY2D_BYREFERENCE);
    tone_eq(R, G, B, p, params->icm.workingProfile, scale, multiThread, false, monitor, &correction);
}

bool ImProcFunctions::toneEqualizer(Imagefloat *rgb)`);
 });
 patch('ipcolorcorrection.cc','// CaptRAW: tonal neighborhoods must see all preceding regions.',s=>{
  const start=s.lastIndexOf('    rgb->setMode(Imagefloat::Mode::YUV, multiThread);'),end=s.lastIndexOf('    return false;');
  if(start<0||end<start)throw new Error('Color correction processing anchor changed');
  let loop=s.slice(start,end);
  loop=loop.replace('    rgb->setMode(Imagefloat::Mode::YUV, multiThread);',`    rgb->setMode(Imagefloat::Mode::YUV, multiThread);
    // CaptRAW: tonal neighborhoods must see all preceding regions.
    bool sequential = false;
    for (int i=0;i<n;++i) if (params->colorcorrection.masks[i].enabled && !params->colorcorrection.regions[i].toneBands.empty()) sequential = true;
    for (int pass=0;pass<(sequential?n:1);++pass) {
        array2D<float> toneGain;
        const bool applyTone = sequential && params->colorcorrection.masks[pass].enabled && !params->colorcorrection.regions[pass].toneBands.empty();
        if (applyTone) localToneEqualizer(rgb, params->colorcorrection.regions[pass].toneBands, toneGain);`);
  loop=loop.replace('            for (int i = 0; i < n; ++i) {','            for (int i = sequential ? pass : 0; i < (sequential ? pass+1 : n); ++i) {');
  loop=loop.replace('                            CDL_v(i, Y_newv, u_newv, v_newv);','                            if (applyTone) { const vfloat gain = LVFU(toneGain[y][x]); Y_newv *= gain; u_newv *= gain; v_newv *= gain; }\n                            CDL_v(i, Y_newv, u_newv, v_newv);');
  loop=loop.replace('                            CDL(i, Y_new, u_new, v_new);','                            if (applyTone) { const float gain = toneGain[y][x]; Y_new *= gain; u_new *= gain; v_new *= gain; }\n                            CDL(i, Y_new, u_new, v_new);');
  // The product only puts tonal bands on RGB regions. Native LUT regions must also receive the gain before their transform.
  loop=loop.replace('                    lut[i]->apply(thread_id, W, rbuf.data, gbuf.data,','                    if (applyTone) for (int x=0;x<W;++x) { const float gain=toneGain[y][x]; rbuf.data[x]*=gain; gbuf.data[x]*=gain; bbuf.data[x]*=gain; }\n                    lut[i]->apply(thread_id, W, rbuf.data, gbuf.data,');
  return s.slice(0,start)+loop+'    }\n\n'+s.slice(end);
 });
}

export function patchParametricCurve(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const changed=edit(source);if(changed===source||!changed.includes(marker))throw new Error('ART parametric curve patch anchor mismatch: '+file);writeFileSync(path,changed);};
 patch('procparams.h','std::vector<double> captrawParametric;',s=>s.replace('    std::vector<double> curve2;','    std::vector<double> curve2;\n    std::vector<double> captrawParametric;'));
 patch('procparams.cc','// CaptRAW: independent parametric curve serialization.',s=>s.replace('      curveMode(ToneCurveParams::TcMode::NEUTRAL),','      captrawParametric{art::utils::DCT_Linear},\n      curveMode(ToneCurveParams::TcMode::NEUTRAL),').replace('           (histmatching || (curve2 == other.curve2)) &&','           (histmatching || (curve2 == other.curve2)) &&\n           captrawParametric == other.captrawParametric &&').replace('            saveToKeyfile("ToneCurve", "Curve2", toneCurve.curve2, keyFile);','            saveToKeyfile("ToneCurve", "Curve2", toneCurve.curve2, keyFile);\n            // CaptRAW: independent parametric curve serialization.\n            if (toneCurve.captrawParametric.size() > 1)\n                saveToKeyfile("ToneCurve", "CaptRAWParametric", toneCurve.captrawParametric, keyFile);').replace('            if (keyFile.has_group("ToneCurve") && RELEVANT_(toneCurve)) {','            if (keyFile.has_group("ToneCurve") && RELEVANT_(toneCurve)) {\n                toneCurve.captrawParametric = {art::utils::DCT_Linear};\n                assignFromKeyfile(keyFile, "ToneCurve", "CaptRAWParametric", toneCurve.captrawParametric);'));
 patch('iptonecurve.cc','// CaptRAW: apply the native parametric curve without replacing either point curve.',s=>s.replace('        auto satcurve_pts = params->toneCurve.saturation;',`        // CaptRAW: apply the native parametric curve without replacing either point curve.
        if (params->toneCurve.captrawParametric.size() > 1) {
            DiagonalCurve parametric(adjust(params->toneCurve.captrawParametric),
                                    CURVES_MIN_POLY_POINTS / max(int(scale), 1));
            if (!parametric.isIdentity()) {
                tc.Set(parametric, whitept);
                apply_tc(img, tc, ToneCurveParams::TcMode::STD,
                         params->icm.workingProfile, params->icm.outputProfile,
                         100, whitept, nullptr, multiThread);
            }
        }

        auto satcurve_pts = params->toneCurve.saturation;`));
}

export function patchColorGrading(upstream){
 const patch=(file,marker,edit)=>{const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');if(source.includes(marker))return;const changed=edit(source);if(changed===source||!changed.includes(marker))throw new Error('ART grading patch anchor mismatch: '+file);writeFileSync(path,changed);};
 patch('../gui/paramsedited.h','bool captrawGrading;',s=>s.replace('    bool blackwhite;','    bool blackwhite;\n    bool captrawGrading;'));
 patch('../gui/paramsedited.cc','captrawGrading = v;',s=>s.replace('    blackwhite = v;','    blackwhite = v;\n    captrawGrading = v;'));
 patch('procparams.h','std::vector<double> captrawGrading;',s=>s.replace('class ProcParams {\npublic:','class ProcParams {\npublic:\n    std::vector<double> captrawGrading;'));
 patch('procparams.cc','// CaptRAW: versioned post-monochrome grading.',s=>s.replace('void ProcParams::setDefaults()\n{','void ProcParams::setDefaults()\n{\n    captrawGrading.clear();').replace('return ppEQ_(exposure) &&','return ppEQ_(captrawGrading) && ppEQ_(exposure) &&').replace('        // Exposure\n',`        // CaptRAW: versioned post-monochrome grading.
        if (!pedited && !captrawGrading.empty()) {
            keyFile.set_integer("CaptRAW Color Grading", "Version", 1);
            keyFile.set_double_list("CaptRAW Color Grading", "Values", captrawGrading);
        }

        // Exposure
`).replace('        if (load_general) {',`        if (!pedited) {
            captrawGrading.clear();
            if (keyFile.has_group("CaptRAW Color Grading")) {
                if (keyFile.get_integer("CaptRAW Color Grading", "Version") != 1)
                    throw std::runtime_error("Unsupported color grading version");
                captrawGrading = keyFile.get_double_list("CaptRAW Color Grading", "Values");
                if (captrawGrading.size() != 14) throw std::runtime_error("Invalid color grading parameter count");
                for (int i=0;i<14;++i) {
                    const double v=captrawGrading[i];
                    const double low=(i==13 || (i<12 && i%3==2)) ? -100 : 0;
                    const double high=(i<12 && i%3==0) ? 360 : 100;
                    if (!std::isfinite(v) || v<low || v>high) throw std::runtime_error("Invalid color grading value");
                }
            }
        }
        if (load_general) {`));
 patch('procparams.cc','// CaptRAW: honor grading partial-profile selection.',s=>s.replace('        if (!pedited && !captrawGrading.empty()) {','        // CaptRAW: honor grading partial-profile selection.\n        if (RELEVANT_(captrawGrading) && !captrawGrading.empty()) {').replace('        if (!pedited) {\n            captrawGrading.clear();','        if (RELEVANT_(captrawGrading) && (!pedited || keyFile.has_group("CaptRAW Color Grading"))) {\n            captrawGrading.clear();'));
 patch('improcfun.h','void captrawColorGrading(',s=>s.replace('    void blackAndWhite(Imagefloat *rgb);','    void blackAndWhite(Imagefloat *rgb);\n    void captrawColorGrading(Imagefloat *img);'));
 patch('improcfun.cc','STEP_(captrawColorGrading,',s=>s.replace('            STEP_(blackAndWhite, !params->blackwhite.enabled);','            STEP_(blackAndWhite, !params->blackwhite.enabled);\n            STEP_(captrawColorGrading, params->captrawGrading.empty());'));
}

export function patchLensStatus(upstream){
 const path=join(upstream,'src/engine/rtlensfun.h'),source=readFileSync(path,'utf8');
 if(!source.includes('int correctionFlags() const')){
  const anchor='    Glib::ustring getDisplayString() const;';
  if(!source.includes(anchor))throw new Error('ART lens status patch anchor mismatch');
  writeFileSync(path,source.replace(anchor,'    int correctionFlags() const { return flags_; } // CaptRAW: actual interpolated capabilities.\n'+anchor));
 }
 const transform=join(upstream,'src/engine/iptransform.cc'),t=readFileSync(transform,'utf8');
 if(!t.includes('// CaptRAW: apply selected lens CA in fit previews too.')){
  const anchor='    if (needsCA() || scale == 1) {';
  if(!t.includes(anchor))throw new Error('ART lens CA preview patch anchor mismatch');
  writeFileSync(transform,t.replace(anchor,'    // CaptRAW: apply selected lens CA in fit previews too.\n    if (needsCA() || scale == 1 || (pLCPMap && params->lensProf.useCA && pLCPMap->isCACorrectionAvailable())) {'));
 }
 const cpp=join(upstream,'src/engine/rtlensfun.cc'),body=readFileSync(cpp,'utf8');
 if(!body.includes('// CaptRAW: missing focal length cannot select a calibration.')){
  const anchor='    const float focallen = idata->getFocalLen();';
  if(!body.includes(anchor))throw new Error('ART lens focal length patch anchor mismatch');
  writeFileSync(cpp,body.replace(anchor,anchor+'\n    // CaptRAW: missing focal length cannot select a calibration.\n    if (focallen <= 0.f) return nullptr;'));
 }
}
