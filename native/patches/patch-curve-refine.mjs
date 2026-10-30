import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Applied by the coordinated native build; probe exports the same pixel kernel.
const fields=`    // CaptRAW: explicit point-curve refinement policy.
    std::string captrawCurveRefineModel;
    double captrawCurveRefineAmount = 0.;
    TcMode curveMode;`;
const equal=`           captrawCurveRefineModel == other.captrawCurveRefineModel &&
           captrawCurveRefineAmount == other.captrawCurveRefineAmount &&
           (histmatching || (curve == other.curve)) &&`;
const save=`            saveToKeyfile("ToneCurve", "Curve2", toneCurve.curve2, keyFile);
            // CaptRAW: preserve opt-in point-curve refinement.
            if (!toneCurve.captrawCurveRefineModel.empty()) {
                saveToKeyfile("ToneCurve", "CaptRAWCurveRefineModel",
                              toneCurve.captrawCurveRefineModel, keyFile);
                saveToKeyfile("ToneCurve", "CaptRAWCurveRefineAmount",
                              toneCurve.captrawCurveRefineAmount, keyFile);
            }`;
const load=`            if (keyFile.has_group("ToneCurve") && RELEVANT_(toneCurve)) {
                toneCurve.captrawCurveRefineModel.clear();
                toneCurve.captrawCurveRefineAmount = 0.;
                if (keyFile.has_key("ToneCurve", "CaptRAWCurveRefineModel"))
                    toneCurve.captrawCurveRefineModel = keyFile.get_string(
                        "ToneCurve", "CaptRAWCurveRefineModel").raw();
                if (!toneCurve.captrawCurveRefineModel.empty() &&
                    toneCurve.captrawCurveRefineModel != "weighted-std-v1") return 1;
                const bool hasRefineAmount = assignFromKeyfile(
                    keyFile, "ToneCurve", "CaptRAWCurveRefineAmount",
                    toneCurve.captrawCurveRefineAmount);
                if (toneCurve.captrawCurveRefineModel == "weighted-std-v1" &&
                    (!hasRefineAmount || !std::isfinite(toneCurve.captrawCurveRefineAmount) ||
                     toneCurve.captrawCurveRefineAmount < 0. ||
                     toneCurve.captrawCurveRefineAmount > 100. ||
                     std::round(toneCurve.captrawCurveRefineAmount) != toneCurve.captrawCurveRefineAmount)) {
                    return 1;
                }`;
const mixer=`// CaptRAW: mix mature modes only at the primary point-curve stage.
struct PointCurveRefineEndpoints {
    float black = 0.f, white;
    explicit PointCurveRefineEndpoints(const ToneCurve &tc): white(tc.whitept)
    {
        float unused = 0.f;
        static_cast<const StandardToneCurve &>(tc).Apply(black,white,unused);
    }
};

// WeightedStd's Triangle assumes F(0)=0 and F(wp)=wp. Re-anchor the
// same two linear segments when the author moves an endpoint. Each segment
// remains a convex interpolation, including flat/reversed endpoint spans.
float curve_refine_triangle(float a, float mapped, float b,
                            const PointCurveRefineEndpoints &ends, float wp)
{
    if (a == b) return mapped;
    const double t = b < a ? double(b)/a : (double(wp)-b)/(double(wp)-a);
    const double end = b < a ? ends.black : ends.white;
    return float((1.-t)*end+t*mapped);
}

void refine_point_rgb(const ToneCurve &tc, float amount, float &r, float &g, float &b,
                      const PointCurveRefineEndpoints *prepared = nullptr)
{
    const auto &standard = static_cast<const StandardToneCurve &>(tc);
    const float ir = r, ig = g, ib = b;
    standard.Apply(r, g, b);
    if (amount == 0.f || (ir == ig && ig == ib) || (tc.curve && tc.curve->isIdentity())) return;
    if (!std::isfinite(ir) || !std::isfinite(ig) || !std::isfinite(ib) ||
        !std::isfinite(r) || !std::isfinite(g) || !std::isfinite(b) ||
        !std::isfinite(tc.whitept) || tc.whitept <= 0.f) return;
    // Clamp only the coordinates of the compensation. STD(original) above
    // remains the baseline; extend its boundary delta without clipping it.
    const float cr = std::max(0.f,std::min(tc.whitept,ir));
    const float cg = std::max(0.f,std::min(tc.whitept,ig));
    const float cb = std::max(0.f,std::min(tc.whitept,ib));
    float sr = cr, sg = cg, sb = cb, wr = cr, wg = cg, wb = cb;
    standard.Apply(sr,sg,sb);
    // Endpoints are prepared once per image, not once per pixel. Scalar probes
    // use the same path without requiring a second LUT or any frame copy.
    const PointCurveRefineEndpoints ends = prepared ? *prepared : PointCurveRefineEndpoints(tc);
    if (!std::isfinite(ends.black) || !std::isfinite(ends.white)) return;
    if (ends.black == 0.f && ends.white == tc.whitept) {
        static_cast<const WeightedStdToneCurve &>(tc).Apply(wr, wg, wb);
    } else {
        wr = sr*.50f + curve_refine_triangle(cg,sg,cr,ends,tc.whitept)*.25f +
                       curve_refine_triangle(cb,sb,cr,ends,tc.whitept)*.25f;
        wg = curve_refine_triangle(cr,sr,cg,ends,tc.whitept)*.25f + sg*.50f +
                       curve_refine_triangle(cb,sb,cg,ends,tc.whitept)*.25f;
        wb = curve_refine_triangle(cr,sr,cb,ends,tc.whitept)*.25f +
             curve_refine_triangle(cg,sg,cb,ends,tc.whitept)*.25f + sb*.50f;
    }
    if (!std::isfinite(sr) || !std::isfinite(sg) || !std::isfinite(sb) ||
        !std::isfinite(wr) || !std::isfinite(wg) || !std::isfinite(wb)) return;
    const float strength = amount / 100.f;
    if (wr != sr) r += strength * (wr - sr);
    if (wg != sg) g += strength * (wg - sg);
    if (wb != sb) b += strength * (wb - sb);
}

void apply_point_curve_refine(Imagefloat *rgb, const ToneCurve &tc,
                              float amount, bool multithread)
{
    const int W = rgb->getWidth(), H = rgb->getHeight();
    const PointCurveRefineEndpoints ends(tc);
#ifdef _OPENMP
#pragma omp parallel for if (multithread)
#endif
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x)
        refine_point_rgb(tc, amount, rgb->r(y,x), rgb->g(y,x), rgb->b(y,x), &ends);
}

void apply_combined_curve_refine(Imagefloat *rgb, const ToneCurve &combined,
                                const ToneCurve *contrast, const ToneCurve &point,
                                const ToneCurve *second, float amount, bool multithread)
{
    const int W = rgb->getWidth(), H = rgb->getHeight();
    const auto &baseline = static_cast<const StandardToneCurve &>(combined);
    const auto &standard = static_cast<const StandardToneCurve &>(point);
    const PointCurveRefineEndpoints ends(point);
#ifdef _OPENMP
#pragma omp parallel for if (multithread)
#endif
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
            float &r = rgb->r(y, x), &g = rgb->g(y, x), &b = rgb->b(y, x);
            const float ir = r, ig = g, ib = b;
            baseline.Apply(r, g, b);
            if (amount == 0.f || (ir == ig && ig == ib)) continue;
            float pr = ir, pg = ig, pb = ib;
            if (contrast) static_cast<const StandardToneCurve &>(*contrast).Apply(pr,pg,pb);
            float sr = pr, sg = pg, sb = pb, mr = pr, mg = pg, mb = pb;
            standard.Apply(sr,sg,sb);
            refine_point_rgb(point,amount,mr,mg,mb,&ends);
            if (sr == mr && sg == mg && sb == mb) continue;
            if (second) {
                const auto &tail = static_cast<const StandardToneCurve &>(*second);
                tail.Apply(sr,sg,sb); tail.Apply(mr,mg,mb);
            }
            // Anchor the local effect to the original optimized STD result.
            // Preserve zero deltas without another floating-point operation.
            if (mr != sr) r += mr - sr;
            if (mg != sg) g += mg - sg;
            if (mb != sb) b += mb - sb;
    }
}

void apply_tc(Imagefloat *rgb, const ToneCurve &tc,`;
const enabled=`        const bool refine_point_curve =
            params->toneCurve.captrawCurveRefineModel == "weighted-std-v1" &&
            params->toneCurve.captrawCurveRefineAmount > 0. &&
            params->toneCurve.captrawCurveRefineAmount <= 100. &&
            std::isfinite(params->toneCurve.captrawCurveRefineAmount) &&
            params->toneCurve.curveMode == ToneCurveParams::TcMode::STD &&
            !tcurve1.isIdentity();

        if (single_curve && editImgFloat &&`;
const combinedBefore=`            apply_tc(img, tc, params->toneCurve.curveMode,
                     params->icm.workingProfile, params->icm.outputProfile,
                     params->toneCurve.perceptualStrength, whitept,
                     basecurve.get(), multiThread);`;
const combinedAfter=`            if (refine_point_curve) {
                ToneCurve point, contrast, second;
                point.Set(tcurve1,whitept);
                if (ccurve) contrast.Set(*ccurve,whitept);
                if (!tcurve2.isIdentity()) second.Set(tcurve2,whitept);
                apply_combined_curve_refine(img,tc,ccurve?&contrast:nullptr,point,
                    tcurve2.isIdentity()?nullptr:&second,
                    float(params->toneCurve.captrawCurveRefineAmount),multiThread);
            } else {
${combinedBefore}
            }`;
const pointBefore=`                tc.Set(tcurve1, whitept);
                apply_tc(img, tc, params->toneCurve.curveMode,
                         params->icm.workingProfile, params->icm.outputProfile,
                         params->toneCurve.perceptualStrength, whitept, nullptr,
                         multiThread);`;
const pointAfter=`                tc.Set(tcurve1, whitept);
                if (refine_point_curve) apply_point_curve_refine(img,tc,
                    float(params->toneCurve.captrawCurveRefineAmount),multiThread);
                else apply_tc(img, tc, params->toneCurve.curveMode,
                         params->icm.workingProfile, params->icm.outputProfile,
                         params->toneCurve.perceptualStrength, whitept, nullptr,
                         multiThread);`;
const loadStart='#define DO_APPEND_(l, o) l.insert(l.begin(), o.begin(), o.end())\n\n    try {';
const headerGuard=`${loadStart}
        // Validate owned policy before legacy header dispatch can skip ToneCurve.
        if (keyFile.has_group("ToneCurve")) {
            const bool hasModel = keyFile.has_key("ToneCurve","CaptRAWCurveRefineModel");
            const bool hasAmount = keyFile.has_key("ToneCurve","CaptRAWCurveRefineAmount");
            const auto model = hasModel?keyFile.get_string("ToneCurve","CaptRAWCurveRefineModel"):Glib::ustring();
            if (!model.empty()) {
                if (model != "weighted-std-v1" || !hasAmount ||
                    !keyFile.has_key("Version","Version")) return 1;
                if (!keyFile.has_key("ToneCurve","CurveMode") ||
                    keyFile.get_string("ToneCurve","CurveMode") != "Standard") return 1;
                const int version = keyFile.get_integer("Version","Version");
                const double amount = keyFile.get_double("ToneCurve","CaptRAWCurveRefineAmount");
                if (version < 350 || version > PPVERSION || !std::isfinite(amount) ||
                    amount < 0. || amount > 100. || std::round(amount) != amount) return 1;
            } else if (hasAmount) return 1;
        }`;
const modeBefore=`                assignFromKeyfile(keyFile, "ToneCurve", "CurveMode2",
                                  tc_mapping, toneCurve.curveMode2);`;

const patches=[
 ['procparams.h','// CaptRAW: explicit point-curve refinement policy.',[
  ['    TcMode curveMode;',fields],
 ]],
 ['procparams.cc','// CaptRAW: preserve opt-in point-curve refinement.',[
  ['           (histmatching || (curve == other.curve)) &&',equal],
  ['            saveToKeyfile("ToneCurve", "Curve2", toneCurve.curve2, keyFile);',save],
  ['            if (keyFile.has_group("ToneCurve") && RELEVANT_(toneCurve)) {',load],
  [loadStart,headerGuard],
  [modeBefore,`${modeBefore}
                if (!toneCurve.captrawCurveRefineModel.empty() &&
                    toneCurve.curveMode != ToneCurveParams::TcMode::STD) return 1;`],
 ]],
 ['iptonecurve.cc','// CaptRAW: mix mature modes only at the primary point-curve stage.',[
  ['void apply_tc(Imagefloat *rgb, const ToneCurve &tc,',mixer],
  ['        if (single_curve && editImgFloat &&',enabled],
  [combinedBefore,combinedAfter],
  [pointBefore,pointAfter],
 ]],
];

export function patchCurveRefine(upstream){
 const count=(s,needle)=>s.split(needle).length-1;
 const files=patches.map(([name,marker,edits])=>({path:join(upstream,'src/engine',name),name,marker,edits}));
 for(const f of files)f.source=readFileSync(f.path,'utf8');
 const present=files.filter(f=>f.source.includes(f.marker));
 if(present.length&&present.length!==files.length)throw new Error('Partial curve-refine patch: restore the source fixture before replay');
 for(const f of files){
  let next=f.source;
  for(const [before,after] of f.edits){
   if(present.length){
    if(count(next,after)!==1)throw new Error('Modified curve-refine patch: '+f.name);
   }else{
    if(count(next,before)!==1)throw new Error('Curve-refine patch anchor mismatch: '+f.name+' / '+before.slice(0,70));
    next=next.replace(before,()=>after);
   }
  }
  if(count(next,f.marker)!==1)throw new Error('Curve-refine patch marker mismatch: '+f.name);
  f.next=next;
 }
 // Resolve every source anchor before writing any file.
 for(const f of files)if(f.next!==f.source)writeFileSync(f.path,f.next);
}

// Compile diagnostics against exactly the inserted kernel, not a JS imitation.
export function curveRefineProbeKernel(){return mixer.slice(0,mixer.indexOf('void apply_tc('));}
