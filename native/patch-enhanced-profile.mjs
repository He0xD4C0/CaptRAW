import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
// Applied after the other ART patches. No changes to existing recipes without a Look.
export function patchEnhancedProfile(upstream){
 const patch=(file,marker,changes)=>{const path=join(upstream,'src/engine',file);let source=readFileSync(path,'utf8');if(source.includes(marker))return;for(const [before,after] of changes){if(!source.includes(before)||source.indexOf(before)!==source.lastIndexOf(before))throw new Error('ART enhanced profile anchor mismatch: '+file+' / '+before.slice(0,70));source=source.replace(before,()=>after);}writeFileSync(path,source);};
 patch('procparams.h','std::string captrawEnhanced;',[
  ['struct ColorManagementParams {','struct ColorManagementParams {\n    std::string captrawEnhanced;']
 ]);
 patch('procparams.cc','// CaptRAW enhanced profile persistence.',[
  ['return inputProfile == other.inputProfile && toneCurve == other.toneCurve &&','return captrawEnhanced == other.captrawEnhanced && inputProfile == other.inputProfile && toneCurve == other.toneCurve &&'],
  ['        // Color management\n','        // CaptRAW enhanced profile persistence.\n        if (RELEVANT_(icm)) keyFile.set_string("Color Management", "CaptRAWEnhancedProfile", icm.captrawEnhanced);\n        // Color management\n'],
  ['        if (keyFile.has_group("Color Management") && RELEVANT_(icm)) {','        if (keyFile.has_group("Color Management") && RELEVANT_(icm)) {\n            icm.captrawEnhanced.clear();\n            if (keyFile.has_key("Color Management", "CaptRAWEnhancedProfile")) icm.captrawEnhanced=keyFile.get_string("Color Management", "CaptRAWEnhancedProfile").raw();']
 ]);
 patch('dcp.h','const std::string &enhanced = ""',[
  ['bool apply_baseline_exposure, ApplyState &as_out);','bool apply_baseline_exposure, ApplyState &as_out, const std::string &enhanced = "");']
 ]);
 patch('dcp.cc','// CaptRAW enhanced HSV precedes base tone curve.',[
  ['#include "dcp.h"','#include "dcp.h"\n#include "enhanced-profile.h"'],
  ['    float bl_scale;','    float bl_scale;\n    std::shared_ptr<captraw::enhanced::Profile> enhanced;'],
  ['                                    ApplyState &as_out)\n','                                    ApplyState &as_out, const std::string &enhanced)\n'],
  ['    as_out.data->use_tone_curve = use_tone_curve;','    as_out.data->enhanced = enhanced.empty() ? nullptr : std::make_shared<captraw::enhanced::Profile>(captraw::enhanced::Profile::parse(nlohmann::json::parse(enhanced)));\n    as_out.data->use_tone_curve = use_tone_curve;'],
  ['    if (!as_in.data->use_tone_curve && !as_in.data->apply_look_table) {','    if (!as_in.data->use_tone_curve && !as_in.data->apply_look_table && !as_in.data->enhanced) {'],
  ['                if (as_in.data->use_tone_curve) {\n                    tone_curve.Apply(newr, newg, newb);\n                }',`                // CaptRAW enhanced HSV precedes base tone curve.
                if (as_in.data->enhanced) {
                    const auto p=as_in.data->enhanced->applyHSV({newr/65535.f,newg/65535.f,newb/65535.f});
                    newr=p[0]*65535.f;newg=p[1]*65535.f;newb=p[2]*65535.f;
                }
                if (as_in.data->use_tone_curve) {
                    tone_curve.Apply(newr, newg, newb);
                }
                if (as_in.data->enhanced) {
                    const auto p=as_in.data->enhanced->applyCurve({newr/65535.f,newg/65535.f,newb/65535.f});
                    newr=p[0]*65535.f;newg=p[1]*65535.f;newb=p[2]*65535.f;
                }`],
  ['return !(!as.data->use_tone_curve && !as.data->apply_look_table && as.data->bl_scale == 1.f);','return as.data->enhanced || !(!as.data->use_tone_curve && !as.data->apply_look_table && as.data->bl_scale == 1.f);']
 ]);
 patch('rawimagesource.cc','cmp.captrawEnhanced);',[
  ['cmp.applyBaselineExposureOffset, as);','cmp.applyBaselineExposureOffset, as, cmp.captrawEnhanced);']
 ]);
 patch('dcp.cc','// CaptRAW: no neutral Look colour-space round trip.',[
  ['    as_out.data->use_tone_curve = use_tone_curve;',`    // CaptRAW: no neutral Look colour-space round trip.
    if (as_out.data->enhanced && !as_out.data->enhanced->hasHSV() && !as_out.data->enhanced->hasCurve()) as_out.data->enhanced.reset();
    as_out.data->use_tone_curve = use_tone_curve;`]
 ]);
 patch('improcfun.h','void captrawEnhancedEarly(',[
  ['    void blackAndWhite(Imagefloat *rgb);','    void blackAndWhite(Imagefloat *rgb);\n    void captrawEnhancedEarly(Imagefloat *img);\n    void captrawEnhancedRGB(Imagefloat *img);']
 ]);
 patch('improcfun.cc','// CaptRAW: rendering-only Look controls.',[
  ['#include "improcfun.h"','#include "improcfun.h"\n#include "enhanced-art.h"'],
  ['bool ImProcFunctions::process(Stage stage, Imagefloat *img)\n{',`bool ImProcFunctions::process(Stage stage, Imagefloat *img)
{
    // CaptRAW: rendering-only Look controls. Restore even if a stage throws.
    auto lookParams=captraw::enhanced::processingParams(*params);
    struct Restore {const ProcParams *&target; const ProcParams *original; ~Restore(){target=original;}} restore{params,params};
    if(lookParams)params=lookParams.get();`],
  ['        STEP_(hslEqualizer, !params->hsl.enabled);',`        if (!params->icm.captrawEnhanced.empty()) {
            if (needsDCPProfile()) {img->syncCpuForWrite();dcpProfile(img,dcpProf,dcpApplyState,multiThread);}
            else STEP_(captrawEnhancedEarly, false);
        }
        STEP_(hslEqualizer, !params->hsl.enabled);`],
  ['if (params->icm.dcp_look_early && needsDCPProfile()) {','if (params->icm.captrawEnhanced.empty() && params->icm.dcp_look_early && needsDCPProfile()) {'],
  ['if (!params->icm.dcp_look_early && needsDCPProfile()) {','if (params->icm.captrawEnhanced.empty() && !params->icm.dcp_look_early && needsDCPProfile()) {'],
  ['            STEP_(labAdjustments, !params->labCurve.enabled);','            STEP_(labAdjustments, !params->labCurve.enabled);\n            STEP_(captrawEnhancedRGB, params->icm.captrawEnhanced.empty());']
 ]);
}
