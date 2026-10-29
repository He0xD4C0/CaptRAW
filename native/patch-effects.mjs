import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
// Applied after patchART. Integration/build ownership remains with the native build coordinator.
export function patchEffects(upstream){
 const patch=(name,marker,anchor,replacement)=>{const path=join(upstream,'src',name),s=readFileSync(path,'utf8');if(s.includes(marker))return;if(!s.includes(anchor))throw new Error('ART effects anchor mismatch: '+name);writeFileSync(path,s.replace(anchor,replacement));};
 patch('engine/procparams.h','std::vector<double> captrawEffects;','class ProcParams {\npublic:','class ProcParams {\npublic:\n    std::vector<double> captrawEffects;');
 patch('gui/paramsedited.h','bool captrawEffects;','    bool blackwhite;','    bool blackwhite;\n    bool captrawEffects;');
 patch('gui/paramsedited.cc','captrawEffects = v;','    blackwhite = v;','    blackwhite = v;\n    captrawEffects = v;');
 patch('engine/procparams.cc','captrawEffects.clear();','void ProcParams::setDefaults()\n{','void ProcParams::setDefaults()\n{\n    captrawEffects.clear();');
 patch('engine/procparams.cc','ppEQ_(captrawEffects)','ppEQ_(exposure) &&','ppEQ_(captrawEffects) && ppEQ_(exposure) &&');
 // The previous grading patch may already prefix the equality expression.
 if(!readFileSync(join(upstream,'src/engine/procparams.cc'),'utf8').includes('ppEQ_(captrawEffects)'))throw new Error('Missing effects equality');
 patch('engine/procparams.cc','keyFile.set_double_list("CaptRAW Effects"','        // Exposure\n',`        if (RELEVANT_(captrawEffects) && !captrawEffects.empty()) {
            keyFile.set_integer("CaptRAW Effects", "Version", 1);
            keyFile.set_double_list("CaptRAW Effects", "Values", captrawEffects);
        }
        // Exposure
`);
 patch('engine/procparams.cc','keyFile.has_group("CaptRAW Effects")','        if (load_general) {',`        if (RELEVANT_(captrawEffects) && (!pedited || keyFile.has_group("CaptRAW Effects"))) {
            captrawEffects.clear();
            if (keyFile.has_group("CaptRAW Effects")) {
                if (keyFile.get_integer("CaptRAW Effects", "Version") != 1) throw std::runtime_error("Unsupported effects version");
                captrawEffects = keyFile.get_double_list("CaptRAW Effects", "Values");
                if (captrawEffects.size() != 10) throw std::runtime_error("Invalid effects parameter count");
                for (int i=0;i<10;++i) {
                    const double v=captrawEffects[i], lo=(i==5 || i==7)?-100:0, hi=i==0?1:i==4?3:100;
                    if (!std::isfinite(v) || v<lo || v>hi || ((i==0 || i==4) && std::floor(v)!=v)) throw std::runtime_error("Invalid effects parameter");
                }
            }
        }
        if (load_general) {`);
 patch('engine/improcfun.h','void captrawEffects(','    void blackAndWhite(Imagefloat *rgb);','    void blackAndWhite(Imagefloat *rgb);\n    void captrawEffects(Imagefloat *img);');
 patch('engine/improcfun.cc','STEP_(captrawEffects,','            STEP_(captrawColorGrading, params->captrawGrading.empty());','            STEP_(captrawColorGrading, params->captrawGrading.empty());\n            STEP_(captrawEffects, params->captrawEffects.empty());');
 // Glow is independent of legacy smoothing and the existing grain/vignette vector.
 patch('engine/procparams.h','std::vector<double> captrawGlow;','    std::vector<double> captrawEffects;','    std::vector<double> captrawEffects;\n    std::vector<double> captrawGlow;');
 patch('gui/paramsedited.h','bool captrawGlow;','    bool captrawEffects;','    bool captrawEffects;\n    bool captrawGlow;');
 patch('gui/paramsedited.cc','captrawGlow = v;','    captrawEffects = v;','    captrawEffects = v;\n    captrawGlow = v;');
 patch('engine/procparams.cc','captrawGlow.clear();','    captrawEffects.clear();','    captrawEffects.clear();\n    captrawGlow.clear();');
 patch('engine/procparams.cc','ppEQ_(captrawGlow)','ppEQ_(captrawEffects) &&','ppEQ_(captrawGlow) && ppEQ_(captrawEffects) &&');
 patch('engine/procparams.cc','keyFile.set_double_list("CaptRAW Glow"','        // Exposure\n',`        if (RELEVANT_(captrawGlow) && !captrawGlow.empty()) {
            keyFile.set_integer("CaptRAW Glow", "Version", 1);
            keyFile.set_double_list("CaptRAW Glow", "Values", captrawGlow);
        }
        // Exposure
`);
 patch('engine/procparams.cc','keyFile.has_group("CaptRAW Glow")','        if (load_general) {',`        if (RELEVANT_(captrawGlow) && (!pedited || keyFile.has_group("CaptRAW Glow"))) {
            captrawGlow.clear();
            if (keyFile.has_group("CaptRAW Glow")) {
                if (keyFile.get_integer("CaptRAW Glow", "Version") != 1) throw std::runtime_error("Unsupported glow version");
                captrawGlow = keyFile.get_double_list("CaptRAW Glow", "Values");
                const auto &g=captrawGlow;
                if(g.size()<5 || g.size()>1029 || (g.size()-5)%2) throw std::runtime_error("Invalid glow parameter count");
                for(size_t i=0;i<g.size();++i){
                    double lo=(i==4||(i>=6&&i%2==0))?-100:0, hi=i==1?2:i>=5&&i%2?1023:100; // Signed local Glow amounts.
                    if(!std::isfinite(g[i])||g[i]<lo||g[i]>hi||((i==1||(i>=5&&i%2))&&std::floor(g[i])!=g[i])) throw std::runtime_error("Invalid glow parameter");
                }
            }
        }
        if (load_general) {`);
 // Upgrade already-patched ART trees without changing the processing formula.
 patch('engine/procparams.cc','// Signed local Glow amounts.','double lo=i==4?-100:0, hi=i==1?2:i>=5&&i%2?1023:100;','double lo=(i==4||(i>=6&&i%2==0))?-100:0, hi=i==1?2:i>=5&&i%2?1023:100; // Signed local Glow amounts.');
 patch('engine/improcfun.h','void captrawGlow(','    void captrawEffects(Imagefloat *img);','    void captrawEffects(Imagefloat *img);\n    void captrawGlow(Imagefloat *img);');
 patch('engine/improcfun.cc','STEP_(captrawGlow,','            STEP_(captrawEffects, params->captrawEffects.empty());','            STEP_(captrawGlow, params->captrawGlow.empty());\n            STEP_(captrawEffects, params->captrawEffects.empty());');
 patch('engine/masks.cc','// Glow consumes the original color-correction coverage.','    auto mp = pparams.get_maskable();',`    // Glow consumes the original color-correction coverage.
    for(size_t i=5;i+1<pparams.captrawGlow.size();i+=2){
        const size_t index=size_t(pparams.captrawGlow[i]);
        if(index<pparams.colorcorrection.masks.size())
            needed_.insert(key("colorcorrection",pparams.colorcorrection.masks[index].name));
    }
    auto mp = pparams.get_maskable();`);

}
