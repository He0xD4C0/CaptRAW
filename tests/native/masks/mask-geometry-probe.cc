#include "core.h"
#include "geometry-field.h"
#include "engine/halffloat.h"
#include "engine/imagefloat.h"
#include "engine/imagesource.h"
#include "engine/improcfun.h"
#include "engine/masks.h"
#include "engine/rtengine.h"
#include <glibmm/checksum.h>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace ae = art::engine;
namespace pp = ae::procparams;
using Json = nlohmann::json;
using Plane = ae::array2D<float>;
using Coverage = std::unique_ptr<Plane>;
constexpr int Width = 641, Height = 427;
static Json report = {{"width", Width}, {"height", Height}, {"cases", Json::array()},
                      {"checks", Json::array()}, {"failures", Json::array()}};

static void require(bool ok, const std::string &message) {
    if (!ok) throw std::runtime_error(message);
}
static void check(bool ok, const std::string &message) {
    report["checks"].push_back({{"name", message}, {"ok", ok}});
    if (!ok) report["failures"].push_back(message);
}
struct Listener final : ae::ProgressListener {
    std::mutex mutex;
    std::vector<std::string> errors;
    void setProgress(double) override {}
    void setProgressStr(const Glib::ustring &) override {}
    void setProgressState(bool) override {}
    void error(const Glib::ustring &message) override {
        std::lock_guard<std::mutex> lock(mutex);
        errors.push_back(message.raw());
    }
};
struct View {
    int x = 0, y = 0, w = Width, h = Height;
    double scale = 1;
};
static Json statistics(const Plane &a, const Plane &b) {
    require(a.width() == b.width() && a.height() == b.height(), "Coverage dimensions differ");
    double maximum = 0, sum = 0, squares = 0, coverage = 0;
    double low = std::numeric_limits<double>::infinity(), high = -low;
    size_t different = 0, nonfinite = 0;
    for (int y = 0; y < a.height(); ++y) for (int x = 0; x < a.width(); ++x) {
        if (!std::isfinite(a[y][x]) || !std::isfinite(b[y][x])) { ++nonfinite; continue; }
        const double d = std::abs(double(a[y][x]) - b[y][x]);
        maximum = std::max(maximum, d); sum += d; squares += d*d;
        different += a[y][x] != b[y][x]; coverage += a[y][x];
        low = std::min(low, double(a[y][x])); high = std::max(high, double(a[y][x]));
    }
    const double count = double(a.width()) * a.height();
    return {{"maxError", maximum}, {"meanError", sum/count}, {"rmse", std::sqrt(squares/count)},
            {"differentPixels", different}, {"nonfinite", nonfinite}, {"min", low},
            {"max", high}, {"coverageSum", coverage}, {"pixels", count}};
}
static void compare(const std::string &name, const Plane &a, const Plane &b,
                    double maxError, double meanError) {
    Json row = statistics(a, b); row["name"] = name;
    row["maxLimit"] = maxError; row["meanLimit"] = meanError;
    const bool ok = row["nonfinite"] == 0 && row["maxError"].get<double>() <= maxError &&
                    row["meanError"].get<double>() <= meanError;
    row["ok"] = ok; report["cases"].push_back(row); check(ok, name);
}
static std::vector<Plane> renderMany(const std::vector<pp::Mask> &masks,
                                    const ae::GeometryField *field, View view = {},
                                    bool parallel = false,
                                    const ae::MaskGeometryResolver &resolver = ae::MaskGeometryResolver()) {
    ae::Imagefloat rgb(view.w, view.h);
    rgb.assignColorSpace("ProPhoto"); rgb.assignMode(ae::Imagefloat::Mode::RGB);
    for (int y = 0; y < view.h; ++y) for (int x = 0; x < view.w; ++x)
        rgb.r(y,x) = rgb.g(y,x) = rgb.b(y,x) = 18000.f;
    pp::ProcParams params; params.colorcorrection.masks = masks;
    ae::LinkedMaskManager manager; manager.init(params);
    Listener listener;
    std::vector<Plane> lightness(masks.size()), chroma(masks.size());
    require(ae::generateMasks(&rgb, "colorcorrection", manager, masks, view.x, view.y,
                             Width, Height, view.scale, parallel, -1, &lightness, &chroma,
                             &listener, field, resolver), "Unexpected show-mask early return");
    require(listener.errors.empty(), "ART mask error: " + Json(listener.errors).dump());
    for (size_t i = 0; i < masks.size(); ++i) for (int y = 0; y < view.h; ++y)
        for (int x = 0; x < view.w; ++x)
            require(lightness[i][y][x] == chroma[i][y][x], "Spatial L/ab masks disagree or are nonfinite");
    return lightness;
}
static Coverage render(const pp::Mask &mask, const ae::GeometryField *field, View view = {},
                       bool parallel = false,
                       const ae::MaskGeometryResolver &resolver = ae::MaskGeometryResolver()) {
    auto values = renderMany({mask}, field, view, parallel, resolver);
    return std::make_unique<Plane>(view.w, view.h, static_cast<float **>(values.front()));
}
static Coverage warp(const Plane &base, const ae::GeometryField &field, View view = {}) {
    auto out = std::make_unique<Plane>(view.w, view.h);
    field.warp(base, {0,0}, *out, {double(view.x),double(view.y)}, false);
    return out;
}
static pp::Mask blank() {
    pp::Mask m; m.parametricMask.enabled = false; return m;
}
static pp::Mask radial(double x = -24, double y = -12, double w = 48, double h = 57) {
    auto m = blank(); m.areaMask.enabled = true;
    auto shape = std::make_unique<pp::AreaMask::Rectangle>();
    shape->x = x; shape->y = y; shape->width = w; shape->height = h;
    shape->roundness = 100; shape->angle = 17;
    m.areaMask.shapes.push_back(std::move(shape)); return m;
}
static pp::Mask gradient() {
    auto m = blank(); m.areaMask.enabled = true;
    auto shape = std::make_unique<pp::AreaMask::Gradient>();
    shape->x = -11; shape->y = 9; shape->angle = 32;
    // This is the intrinsic ramp width, not guided feathering.
    shape->feather = 38; shape->strengthStart = 15; shape->strengthEnd = 90;
    m.areaMask.shapes.push_back(std::move(shape)); return m;
}
static pp::Mask brush(bool additive = false, bool erase = true) {
    auto m = additive ? gradient() : blank();
    if (additive) {
        auto &g = static_cast<pp::AreaMask::Gradient &>(*m.areaMask.shapes.front());
        g.strengthStart = g.strengthEnd = 50;
    }
    m.drawnMask.enabled = true;
    m.drawnMask.mode = additive ? pp::DrawnMask::ADD : pp::DrawnMask::INTERSECT;
    // Keep ADD unsaturated so signed erasing can be compared with scalar warp.
    m.drawnMask.opacity = additive ? .25 : 1;
    for (int i = 0; i < 9; ++i) {
        pp::DrawnMask::Stroke s;
        s.x = .28 + i*.027; s.y = .37 + i*.019; s.radius = .46; s.opacity = .8;
        m.drawnMask.strokes.push_back(s);
    }
    if (erase) {
        pp::DrawnMask::Stroke s;
        s.x = .37; s.y = .44; s.radius = .2; s.opacity = 1; s.erase = true;
        m.drawnMask.strokes.push_back(s);
    }
    return m;
}
struct Asset {
    std::filesystem::path path;
    std::string hash;
    static constexpr int width = 321, height = 214;
    explicit Asset(const std::filesystem::path &cache) {
        // Unique subdirectory avoids overwriting another probe's fixture.
        const auto pattern = (cache/"mask-geometry-XXXXXX").string();
        std::vector<char> buffer(pattern.begin(), pattern.end()); buffer.push_back(0);
        require(mkdtemp(buffer.data()) != nullptr, "Cannot create mask fixture directory");
        path = std::filesystem::path(buffer.data())/"coverage.tiff";
        ae::Imagefloat image(width, height); image.assignColorSpace("ProPhoto");
        for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x) {
            const double dx = (x/double(width-1)-.32)/.14, dy = (y/double(height-1)-.57)/.2;
            const float v = 65535*(.03 + .82*std::exp(-(dx*dx+dy*dy)/2) + .1*x/(width-1));
            image.r(y,x) = image.g(y,x) = image.b(y,x) = v;
        }
        require(image.saveTIFF(path.string(),16) == 0, "Cannot save mask TIFF");
        std::ifstream input(path, std::ios::binary);
        Glib::Checksum checksum(Glib::Checksum::CHECKSUM_SHA256);
        unsigned char bytes[65536];
        while (input.read(reinterpret_cast<char *>(bytes), sizeof(bytes)) || input.gcount())
            checksum.update(bytes, input.gcount());
        require(input.eof() && !input.bad(), "Cannot hash mask TIFF");
        hash = checksum.get_string();
    }
    ~Asset() {
        std::error_code error; std::filesystem::remove(path, error);
        std::filesystem::remove(path.parent_path(), error);
    }
    pp::Mask mask(bool raster, int rotation = 0) const {
        auto m = blank(); auto &e = m.externalMask;
        e.enabled = true; e.filename = path.string(); e.captrawRaster = raster;
        if (raster) {
            e.captrawRotation = rotation; e.captrawWidth = width; e.captrawHeight = height;
            e.captrawSha256 = hash;
        }
        return m;
    }
};
static void identityAndROI(const std::string &name, const pp::Mask &mask,
                           const ae::GeometryField &field, const ae::GeometryField &identity,
                           bool roiCheck = true) {
    for (double scale : {1.,4.}) {
        View view; view.scale = scale;
        const std::string tag = name+"/scale"+std::to_string(int(scale));
        auto base = render(mask, nullptr, view), same = render(mask, &identity, view);
        compare(tag+"/identity", *same, *base, 0, 0);
        View roi{117,79,377,239,scale};
        auto plainROI = render(mask, nullptr, roi), identityROI = render(mask, &identity, roi);
        compare(tag+"/identityROI", *identityROI, *plainROI, 0, 0);
        if (roiCheck) {
            auto full = render(mask, &field, view), actual = render(mask, &field, roi);
            Plane expected(roi.w, roi.h, roi.x, roi.y, *full);
            compare(tag+"/ROI", *actual, expected, 2e-6, 2e-7);
            auto parallel = render(mask, &field, roi, true);
            compare(tag+"/parallelROI", *parallel, *actual, 0, 0);
        }
    }
}
static void leaf(const std::string &name, const pp::Mask &mask,
                 const ae::GeometryField &field, const ae::GeometryField &identity,
                 double maximum = 2e-6, double mean = 2e-7) {
    auto base = render(mask, nullptr), actual = render(mask, &field), expected = warp(*base, field);
    compare(name+"/warpBase", *actual, *expected, maximum, mean);
    const auto movement = statistics(*actual, *base);
    report["cases"].push_back({{"name", name+"/movement"}, {"metrics", movement}});
    check(movement["meanError"].get<double>() > .001, name+" visibly moves coverage");
    check(movement["max"].get<double>() - movement["min"].get<double>() > .1,
          name+" has nontrivial coverage");
    identityAndROI(name, mask, field, identity);
}
static void feather(const std::string &name, const pp::Mask &plain, pp::Mask softened,
                    const ae::GeometryField &field, const ae::GeometryField &identity) {
    auto hard = render(plain, &field), soft = render(softened, &field);
    Json row = statistics(*soft, *hard); row["name"] = name+"/featherChange";
    report["cases"].push_back(row);
    check(row["nonfinite"] == 0 && row["min"].get<double>() >= -1e-5 &&
          row["max"].get<double>() <= 1.00001, name+" feather remains finite coverage");
    check(row["meanError"].get<double>() > 1e-6, name+" feather changes coverage");
    // No warp(feather(base)) assertion: guided feather and transport do not commute.
    identityAndROI(name+"/feather", softened, field, identity, false);
}
static void combine(Plane &dst, const Plane &src, int mode, bool area = false) {
    for (int y = 0; y < dst.height(); ++y) for (int x = 0; x < dst.width(); ++x) {
        float &v = dst[y][x], next = src[y][x];
        if (mode == 1) v = area ? std::max(v-next,0.f) : v*(1.f-next);
        else if (mode == 2) v *= next;
        else v = area ? std::min(v+next,1.f) : std::max(v,next);
    }
}
static void areaComposition(const ae::GeometryField &field, const ae::GeometryField &identity) {
    const std::vector<pp::Mask> shapes{radial(), radial(7,-5,30,43), gradient(), radial(23,20,24,31)};
    const int modes[] = {0,1,2,0};
    auto m = blank(); m.areaMask.enabled = true;
    Plane expected(Width, Height); expected.fill(0);
    for (size_t i = 0; i < shapes.size(); ++i) {
        auto shape = shapes[i].areaMask.shapes.front()->clone();
        shape->mode = modes[i] == 1 ? pp::AreaMask::Shape::SUBTRACT :
                      modes[i] == 2 ? pp::AreaMask::Shape::INTERSECT : pp::AreaMask::Shape::ADD;
        m.areaMask.shapes.push_back(std::move(shape));
        auto base = render(shapes[i], nullptr), mapped = warp(*base, field);
        combine(expected, *mapped, modes[i], true);
    }
    auto actual = render(m, &field);
    compare("area/perShapeCompose", *actual, expected, .015, .0015);
    auto base = render(m, nullptr), late = warp(*base, field);
    report["cases"].push_back({{"name", "area/lateWarpDiagnosticOnly"}, {"metrics", statistics(*actual,*late)}});
    identityAndROI("area/composed", m, field, identity);
    auto soft = m; soft.areaMask.feather = 7;
    soft.areaMask.shapes.front()->feather = 12;
    feather("area/perShapeAndGlobal", m, soft, field, identity);
}
static Coverage groupOracle(const pp::Mask &m, const ae::GeometryField &field) {
    if (m.components.empty()) return render(m, &field);
    auto result = std::make_unique<Plane>(Width, Height); result->fill(0);
    for (size_t i = 0; i < m.components.size(); ++i) {
        auto child = groupOracle(m.components[i], field);
        combine(*result, *child, m.componentModes.at(i));
    }
    for (int y = 0; y < Height; ++y) for (int x = 0; x < Width; ++x) {
        float &v = (*result)[y][x];
        if (m.inverted) v = 1.f-v;
        if (m.opacity < 100) v *= float(m.opacity)/100.f;
    }
    return result;
}
static void groups(const pp::Mask &external, const ae::GeometryField &field,
                   const ae::GeometryField &identity) {
    for (int mode : {0,1,2}) {
        auto inner = blank(); inner.components = {radial(), brush()}; inner.componentModes = {0,mode};
        inner.opacity = 73; inner.inverted = mode == 1;
        auto outer = blank(); outer.components = {inner,external,gradient()};
        outer.componentModes = {0,1,2}; outer.opacity = 81; outer.inverted = mode == 2;
        auto actual = render(outer, &field), expected = groupOracle(outer, field);
        const auto name = "group/nestedMode"+std::to_string(mode);
        compare(name+"/composeMappedLeaves", *actual, *expected, 2e-6, 2e-7);
        identityAndROI(name, outer, field, identity);
    }
}
static void linked(const ae::GeometryField &field, const ae::GeometryField &identity) {
    auto source = radial(); source.name = "transport-source"; source.opacity = 83;
    auto target = gradient(); target.linkedMask.enabled = true;
    target.linkedMask.toolname = "colorcorrection"; target.linkedMask.name = source.name;
    for (bool inverted : {false,true}) {
        target.linkedMask.inverted = inverted;
        const std::vector<pp::Mask> masks{source,target};
        auto values = renderMany(masks, &field), plain = renderMany(masks, nullptr), same = renderMany(masks, &identity);
        auto unlinked = target; unlinked.linkedMask.enabled = false;
        auto baseTarget = render(unlinked, &field), sourceExpected = render(source, &field);
        Plane expected(Width, Height), quantized(Width, Height), wrong(Width, Height);
        for (int y = 0; y < Height; ++y) for (int x = 0; x < Width; ++x)
            quantized[y][x] = ae::DNG_HalfToFloat(ae::DNG_FloatToHalf((*sourceExpected)[y][x]));
        auto twice = warp(quantized, field);
        for (int y = 0; y < Height; ++y) for (int x = 0; x < Width; ++x) {
            expected[y][x] = (*baseTarget)[y][x]*(inverted ? 1.f-quantized[y][x] : quantized[y][x]);
            wrong[y][x] = (*baseTarget)[y][x]*(inverted ? 1.f-(*twice)[y][x] : (*twice)[y][x]);
        }
        const std::string name = inverted ? "linked/inverted" : "linked/normal";
        compare(name+"/sourceOnce", values[0], *sourceExpected, 0, 0);
        compare(name+"/halfFloatOracle", values[1], expected, 2e-6, 2e-7);
        compare(name+"/identitySource", same[0], plain[0], 0, 0);
        compare(name+"/identityTarget", same[1], plain[1], 0, 0);
        auto difference = statistics(values[1], wrong);
        report["cases"].push_back({{"name", name+"/doubleWarpNegativeControl"}, {"metrics", difference}});
        check(difference["meanError"].get<double>() > .001, name+" detects double warp");
        View roi{117,79,377,239,1}; auto cropped = renderMany(masks, &field, roi);
        Plane expectedROI(roi.w,roi.h,roi.x,roi.y,values[1]);
        compare(name+"/ROI", cropped[1], expectedROI, 2e-6, 2e-7);
    }
}
static void failurePropagation(const Asset &asset, const ae::GeometryField &field) {
    ae::Coord2D failedPoint(1e9,1e9), result;
    require(!field.map(failedPoint,result), "Inverse failure fixture unexpectedly converged");
    const std::vector<pp::Mask> masks{radial(),brush(),asset.mask(false),asset.mask(true)};
    for (size_t i=0;i<masks.size();++i) for (bool parallel:{false,true}) {
        auto mask=masks[i];mask.externalMask.inverted=true;
        bool rejected=false;
        try { render(mask,&field,View{1000000000,1000000000,16,16,1},parallel); }
        catch (const std::runtime_error &error) {
            rejected=std::string(error.what())=="Mask geometry inverse failed; coverage was not rendered";
            if(!rejected)throw;
        }
        check(rejected,"inverse failure propagates for leaf "+std::to_string(i)+(parallel?" parallel":" serial"));
    }
}
static std::vector<ae::Coord2D> cacheOracle(const std::string &name, const ae::GeometryField *field,
        const pp::ProcParams &params, const ae::FramesMetaData *metadata, int rotation,
        int width = Width, int height = Height, int fullWidth = Width, int fullHeight = Height) {
    require(field != nullptr, name+" unexpectedly bypassed mapping");
    auto reference = params;
    reference.rotate.degree = params.rotate.captrawMaskReferenceDegree;
    reference.rotate.enabled = reference.rotate.degree != 0;
    ae::GeometryMap currentMap(params,width,height,metadata,rotation,fullWidth,fullHeight);
    ae::GeometryMap referenceMap(reference,width,height,metadata,rotation,fullWidth,fullHeight);
    double maximum = 0, sum = 0, movement = 0;
    int mismatches = 0, failures = 0, nonfinite = 0, samples = 0;
    std::vector<ae::Coord2D> coordinates;
    // Include corners and fractional coordinates; do not compare only field nodes.
    for (int y = 0; y <= 16; ++y) for (int x = 0; x <= 24; ++x) {
        const ae::Coord2D q((width-1)*x/24.,(height-1)*y/16.);
        ae::Coord2D expected, actual;
        const bool valid = referenceMap.toDisplay(currentMap.toSource(q),expected);
        const bool mapped = field->map(q,actual);
        mismatches += valid != mapped;
        if (!valid || !mapped) { ++failures; continue; }
        if (!std::isfinite(actual.x) || !std::isfinite(actual.y) ||
            !std::isfinite(expected.x) || !std::isfinite(expected.y)) { ++nonfinite; continue; }
        const double error = std::hypot(actual.x-expected.x,actual.y-expected.y);
        maximum = std::max(maximum,error); sum += error;
        movement = std::max(movement,std::hypot(actual.x-q.x,actual.y-q.y));
        coordinates.push_back(actual); ++samples;
    }
    report["cases"].push_back({{"name",name},{"processingWidth",width},{"processingHeight",height},
        {"fullWidth",fullWidth},{"fullHeight",fullHeight},{"samples",samples},{"failedSamples",failures},
        {"validityMismatches",mismatches},{"nonfinite",nonfinite},{"maxErrorPixels",maximum},
        {"meanErrorPixels",samples ? sum/samples : 0},{"maxMovementPixels",movement},{"limitPixels",.05}});
    check(samples == 425 && failures == 0 && mismatches == 0 && nonfinite == 0 && maximum < .05,
          name+" matches independent GeometryMap inverse composition");
    return coordinates;
}
static void cacheTests(const pp::ProcParams &fixture, const ae::FramesMetaData *metadata, int rotation) {
    pp::ProcParams params = fixture;
    params.rotate.enabled = true; params.rotate.degree = 23;
    params.rotate.captrawMaskCoordinates = true; params.rotate.captrawMaskReferenceDegree = 0;
    params.commonTrans.autofill = true;
    ae::MaskGeometryCache cache;
    auto inactive = params; inactive.rotate.captrawMaskCoordinates = false;
    check(cache.get(inactive) == nullptr,"cache/inactive bypass without source");
    auto equal = params; equal.rotate.captrawMaskReferenceDegree = equal.rotate.degree;
    check(cache.get(equal) == nullptr,"cache/equal nonzero angles bypass without source");
    equal.rotate.enabled = false; equal.rotate.captrawMaskReferenceDegree = 0;
    check(cache.get(equal) == nullptr,"cache/disabled stored angle has effective zero");
    const auto rejects = [&](const std::string &name, const pp::ProcParams &p, const char *message) {
        bool rejected = false;
        try { cache.get(p); }
        catch (const std::runtime_error &error) { rejected = error.what() == std::string(message); }
        check(rejected,name);
    };
    rejects("cache/missing source throws",params,"Mask geometry source is unavailable");
    cache.setSource(metadata,rotation,Width,Height,Width,Height);
    for (bool reference : {false,true}) for (double angle : {-46.,46.,
            std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()}) {
        auto invalid = params;
        if (reference) invalid.rotate.captrawMaskReferenceDegree = angle;
        else invalid.rotate.degree = angle;
        const auto label = std::isfinite(angle) ? std::to_string(angle) : std::isnan(angle) ? "NaN" : "infinity";
        rejects(std::string("cache/invalid ")+(reference ? "reference " : "current ")+label,
                invalid,"Invalid mask reference rotation");
    }
    const auto *base = cache.get(params);
    cacheOracle("cache/base",base,params,metadata,rotation);
    for (int variant = 0; variant < 3; ++variant) {
        auto changed = params;
        if (variant == 0) changed.exposure.expcomp += 1.25;
        if (variant == 1) changed.colorcorrection.masks = {radial(),brush()};
        if (variant == 2) {
            changed.crop.enabled = true; changed.crop.x = 117; changed.crop.y = 79;
            changed.crop.w = 377; changed.crop.h = 239;
        }
        const std::string name = std::string("cache/reuse/")+std::vector<std::string>{"exposure","masks","crop"}[variant];
        const auto *reused = cache.get(changed);
        check(reused == base,name+" preserves field instance");
        cacheOracle(name,reused,changed,metadata,rotation);
    }
    check(cache.get(inactive) == nullptr,"cache/inactive bypass after populated cache");
    check(cache.get(equal) == nullptr,"cache/equal effective angles bypass after populated cache");
    // Match transform's ceil dimensions, independently of detail mask's floor bounds.
    const int fitWidth = (Width+3)/4, fitHeight = (Height+3)/4;
    cache.setSource(metadata,rotation,fitWidth,fitHeight,Width,Height);
    const auto *fit = cache.get(params);
    check(fit != base,"cache/fit and detail have different fields");
    cacheOracle("cache/fit",fit,params,metadata,rotation,fitWidth,fitHeight);
    for (int i = 0; i < 3; ++i) {
        cache.setSource(metadata,rotation,Width,Height,Width,Height);
        const auto *detail = cache.get(params);
        check(detail == base,"cache/alternation detail "+std::to_string(i));
        cacheOracle("cache/alternation/detail"+std::to_string(i),detail,params,metadata,rotation);
        cache.setSource(metadata,rotation,fitWidth,fitHeight,Width,Height);
        const auto *again = cache.get(params);
        check(again == fit,"cache/alternation fit "+std::to_string(i));
        cacheOracle("cache/alternation/fit"+std::to_string(i),again,params,metadata,rotation,fitWidth,fitHeight);
    }
    cache.setSource(metadata,rotation,Width,Height,Width,Height);
    auto disabled = params; disabled.rotate.enabled = false; disabled.rotate.captrawMaskReferenceDegree = -17;
    cacheOracle("cache/disabledCurrentNonzeroReference",cache.get(disabled),disabled,metadata,rotation);
    const auto invalidation = [&](const std::string &name, const pp::ProcParams &before, const pp::ProcParams &after) {
        const auto *oldField = cache.get(before);
        const auto oldCoordinates = cacheOracle(name+"/before",oldField,before,metadata,rotation);
        const auto *newField = cache.get(after);
        check(newField != oldField,name+" invalidates cached field");
        const auto newCoordinates = cacheOracle(name+"/after",newField,after,metadata,rotation);
        double change = 0;
        for (size_t i = 0; i < std::min(oldCoordinates.size(),newCoordinates.size()); ++i)
            change = std::max(change,std::hypot(oldCoordinates[i].x-newCoordinates[i].x,
                                              oldCoordinates[i].y-newCoordinates[i].y));
        report["cases"].push_back({{"name",name+"/coordinateChange"},{"maxChangePixels",change}});
    };
    auto changed = params; changed.lensProf.useDist = false;
    invalidation("cache/lensDistortionToggle",params,changed);
    changed = params; changed.cacorrection.enabled = false;
    changed.cacorrection.red = .012; changed.cacorrection.blue = -.009;
    invalidation("cache/retainedDisabledCA",params,changed);
    auto automatic = params; automatic.distortion.enabled = true; automatic.distortion.autocompute = true;
    automatic.distortion.amount = .08; changed = automatic; changed.distortion.amount = .23;
    invalidation("cache/autocomputedDistortionAmount",automatic,changed);
    changed = params; changed.rotate.captrawMaskReferenceDegree = -11;
    invalidation("cache/referenceAngle",params,changed);
}
static void profileTests(const pp::ProcParams &fixture, const ae::FramesMetaData *metadata, int rotation) {
    pp::ProcParams defaults; ae::MaskGeometryCache cache;
    check(!defaults.rotate.captrawMaskCoordinates && defaults.rotate.captrawMaskReferenceDegree == 0 &&
          cache.get(defaults) == nullptr,"profile/default no opt-in");
    for (bool enabled : {false,true}) for (bool optIn : {false,true}) {
        auto original = fixture; original.rotate.enabled = enabled; original.rotate.degree = 23;
        original.rotate.captrawMaskCoordinates = optIn; original.rotate.captrawMaskReferenceDegree = -13.25;
        pp::KeyFile saved; require(original.save(nullptr,saved) == 0,"Cannot save geometry profile");
        pp::KeyFile reparsed; require(reparsed.load_from_data(saved.to_data()),"Cannot parse geometry profile text");
        pp::ProcParams loaded; require(loaded.load(nullptr,reparsed) == 0,"Cannot load geometry profile");
        const std::string name = std::string(enabled ? "profile/enabled" : "profile/disabledCurrent")+
                                 (optIn ? "/optIn" : "/legacyCoordinates");
        check(loaded.rotate == original.rotate,name+" roundtrips opt-in, reference and stored rotation");
        report["cases"].push_back({{"name",name},{"enabled",loaded.rotate.enabled},
            {"degree",loaded.rotate.degree},{"optIn",loaded.rotate.captrawMaskCoordinates},
            {"referenceDegree",loaded.rotate.captrawMaskReferenceDegree},{"serializedBytes",saved.to_data().bytes()}});
        cache.setSource(metadata,rotation,Width,Height,Width,Height);
        if (optIn) cacheOracle(name+"/restoredMap",cache.get(loaded),original,metadata,rotation);
        else check(cache.get(loaded) == nullptr,name+" restored inactive profile bypasses populated cache");
        loaded.setDefaults();
        check(!loaded.rotate.captrawMaskCoordinates && loaded.rotate.captrawMaskReferenceDegree == 0 &&
              cache.get(loaded) == nullptr,name+" setDefaults removes opt-in");
        // An old ART profile has no extension keys, while retaining its nonzero angle.
        std::istringstream input(saved.to_data().raw()); std::string line, legacyText;
        while (std::getline(input,line))
            if (line.rfind("CaptRAWMaskCoordinates=",0) != 0 && line.rfind("CaptRAWMaskReferenceDegree=",0) != 0)
                legacyText += line+'\n';
        pp::KeyFile legacy; require(legacy.load_from_data(legacyText),"Cannot parse legacy profile");
        require(!legacy.has_key("Rotation","CaptRAWMaskCoordinates") &&
                !legacy.has_key("Rotation","CaptRAWMaskReferenceDegree"),"Legacy fixture still contains opt-in keys");
        loaded.rotate.captrawMaskCoordinates=true;
        loaded.rotate.captrawMaskReferenceDegree=-13.25;
        require(loaded.load(nullptr,legacy) == 0,"Cannot load legacy profile");
        check(loaded.rotate.enabled == enabled && loaded.rotate.degree == 23 &&
              !loaded.rotate.captrawMaskCoordinates && loaded.rotate.captrawMaskReferenceDegree == 0 &&
              cache.get(loaded) == nullptr,name+" legacy profile preserves angle without opt-in");
    }
}
static void strokePersistence() {
    auto original=brush(true);auto &strokes=original.drawnMask.strokes;
    for(size_t i=0;i<strokes.size();++i) {
        strokes[i].x+=.00001234567890123;strokes[i].radius+=.00005678901234567;
    }
    pp::KeyFile saved;original.save(saved,"","Mask","","_1");
    pp::KeyFile parsed;require(parsed.load_from_data(saved.to_data()),"Cannot parse exact stroke profile");
    pp::Mask loaded;require(loaded.load(2000,parsed,"","Mask","","_1"),"Cannot load exact strokes");
    check(loaded.drawnMask.strokes==strokes,"stroke/full precision coordinates, radius, opacity and erase roundtrip");
    compare("stroke/coverage exact after save",*render(original,nullptr),*render(loaded,nullptr),0,0);
    std::istringstream input(saved.to_data().raw());std::string line,packed;
    while(std::getline(input,line))if(line.rfind("CaptRAWDrawnMaskStrokes_1=",0)!=0)packed+=line+'\n';
    pp::KeyFile old;require(old.load_from_data(packed),"Cannot parse packed stroke profile");
    pp::Mask quantized;require(quantized.load(2000,old,"","Mask","","_1"),"Cannot load ART packed strokes");
    check(quantized.drawnMask.strokes.size()==strokes.size() && quantized.drawnMask.strokes!=strokes,
          "stroke/ART packed fallback loads and demonstrates half precision loss");
    for(const std::string value:{"1;0.4;1;1;0.2;","-1;0.4;1;1;0.2;0.3;",
            "1.5;0.4;1;1;0.2;0.3;","2049;0.4;1;1;0.2;0.3;","1;0.4;1;1;nan;0.3;",
            "1;0.4;1;1;0.2;0.3;7;"}) {
        pp::KeyFile bad;require(bad.load_from_data("[Mask]\nCaptRAWDrawnMaskStrokes_1="+value+"\n"),"Cannot parse malformed fixture");
        bool rejected=false;try{pp::Mask candidate;candidate.load(2000,bad,"","Mask","","_1");}catch(...){rejected=true;}
        check(rejected,"stroke/reject malformed exact list "+value);
    }
    pp::KeyFile empty;require(empty.load_from_data("[Mask]\nCaptRAWDrawnMaskStrokes_1=\n"),"Cannot parse empty strokes");
    loaded.load(2000,empty,"","Mask","","_1");check(loaded.drawnMask.strokes.empty(),"stroke/empty exact list clears previous strokes");
}
static void pipelineFailure(const pp::ProcParams &fixture,const ae::FramesMetaData *metadata,int rotation) {
    auto params=fixture;params.rotate.enabled=true;params.rotate.degree=23;
    params.rotate.captrawMaskCoordinates=true;params.rotate.captrawMaskReferenceDegree=0;
    params.colorcorrection.enabled=true;params.colorcorrection.masks={radial()};
    params.colorcorrection.regions.resize(1);
    ae::Imagefloat image(Width,Height);image.assignColorSpace("ProPhoto");image.assignMode(ae::Imagefloat::Mode::RGB);
    for(int y=0;y<Height;++y)for(int x=0;x<Width;++x)image.r(y,x)=image.g(y,x)=image.b(y,x)=18000;
    ae::ImProcFunctions processor(&params,false);Listener listener;processor.setMaskErrorListener(&listener);
    const bool stopped=processor.process(ae::ImProcFunctions::Stage::STAGE_2,&image);
    check(stopped && listener.errors==std::vector<std::string>{"Mask geometry source is unavailable"},
          "pipeline geometry error stops processing and reaches listener");
    listener.errors.clear();processor.setMaskGeometrySource(metadata,rotation,Width,Height,Width,Height);
    check(!processor.process(ae::ImProcFunctions::Stage::STAGE_2,&image) && listener.errors.empty(),
          "pipeline recovers after geometry context is restored");
}
static Coverage referenceOracle(const pp::Mask &mask, const pp::ProcParams &params,
                                const ae::FramesMetaData *metadata, int rotation) {
    if (mask.components.empty()) {
        if (!mask.captrawReferenceAngleSet && !params.rotate.captrawMaskCoordinates)
            return render(mask,nullptr);
        const double angle = mask.captrawReferenceAngleSet ? mask.captrawReferenceAngle : params.rotate.captrawMaskReferenceDegree;
        if (angle == (params.rotate.enabled ? params.rotate.degree : 0)) return render(mask,nullptr);
        auto reference = params; reference.rotate.degree = angle; reference.rotate.enabled = angle != 0;
        ae::GeometryMap currentMap(params,Width,Height,metadata,rotation);
        ae::GeometryMap referenceMap(reference,Width,Height,metadata,rotation);
        ae::GeometryField field(currentMap,referenceMap,Width,Height);
        return render(mask,&field);
    }
    auto result = std::make_unique<Plane>(Width,Height); result->fill(0);
    for (size_t i = 0; i < mask.components.size(); ++i) {
        auto child = referenceOracle(mask.components[i],params,metadata,rotation);
        combine(*result,*child,mask.componentModes.at(i));
    }
    for (int y = 0; y < Height; ++y) for (int x = 0; x < Width; ++x) {
        float &v = (*result)[y][x]; if (mask.inverted) v = 1-v; v *= mask.opacity/100.f;
    }
    return result;
}
static void mixedReferences(const pp::ProcParams &fixture, const Asset &asset,
                            const ae::FramesMetaData *metadata, int rotation) {
    auto params = fixture; params.rotate.enabled = true; params.rotate.degree = 23;
    params.rotate.captrawMaskReferenceDegree = 5;
    ae::MaskGeometryCache cache; cache.setSource(metadata,rotation,Width,Height,Width,Height);
    std::vector<std::string> resolved;
    const ae::MaskGeometryResolver resolver = [&](const pp::Mask &mask) {
        resolved.push_back(mask.name.raw());
        return mask.captrawReferenceAngleSet ? cache.get(params,mask.captrawReferenceAngle) : cache.get(params);
    };
    const auto at = [](pp::Mask mask, double angle, const char *name) {
        mask.captrawReferenceAngleSet = true; mask.captrawReferenceAngle = angle; mask.name = name; return mask;
    };
    auto inherited = gradient(); inherited.name = "global-fallback";
    auto inner = blank(); inner.name = "inner-group"; inner.captrawReferenceAngleSet = true; inner.captrawReferenceAngle = 41;
    inner.components = {at(radial(),-17,"radial-minus17"),at(brush(true),7,"brush-plus7"),inherited};
    inner.componentModes = {0,1,2}; inner.opacity = 79; inner.inverted = true;
    auto outer = blank(); outer.name = "outer-group";
    outer.components = {inner,at(asset.mask(true),0,"raster-zero"),at(radial(7,-5,60,70),23,"equal-current"),
                        at(asset.mask(false),-9,"external-minus9")};
    outer.componentModes = {0,1,2,0}; outer.opacity = 83;
    for (bool global : {false,true}) {
        params.rotate.captrawMaskCoordinates = global;
        const std::string name = global ? "mixed/globalFallback" : "mixed/globalDisabled";
        auto expected = referenceOracle(outer,params,metadata,rotation);
        resolved.clear(); auto actual = render(outer,nullptr,{},false,resolver);
        compare(name+"/independentLeafComposition",*actual,*expected,2e-6,2e-7);
        check(resolved == std::vector<std::string>{"radial-minus17","brush-plus7","global-fallback",
              "raster-zero","equal-current","external-minus9"},name+" resolves spatial leaves once, never groups");
        auto parallel = render(outer,nullptr,{},true,resolver);
        compare(name+"/parallel",*parallel,*actual,0,0);
        View roi{117,79,377,239,1}; auto cropped = render(outer,nullptr,roi,false,resolver);
        Plane expectedROI(roi.w,roi.h,roi.x,roi.y,*expected);
        compare(name+"/ROI",*cropped,expectedROI,2e-6,2e-7);
        pp::KeyFile saved; outer.save(saved,"","Mixed","","_1");
        pp::KeyFile parsed; require(parsed.load_from_data(saved.to_data()),"Cannot parse mixed reference group");
        pp::Mask loaded; require(loaded.load(2000,parsed,"","Mixed","","_1"),"Cannot load mixed reference group");
        compare(name+"/serializedCoverage",*render(loaded,nullptr,{},false,resolver),*actual,2e-6,2e-7);
    }
    // Different references must coexist with already transported linked coverage.
    auto source = at(radial(),-17,"mixed-link-source"); source.opacity = 83;
    auto target = at(gradient(),11,"mixed-link-target");
    target.linkedMask.enabled = true; target.linkedMask.toolname = "colorcorrection"; target.linkedMask.name = source.name;
    auto linkedOnly = at(blank(),-31,"linked-only"); linkedOnly.linkedMask = target.linkedMask;
    const auto sourceExpected = referenceOracle(source,params,metadata,rotation);
    auto unlinked = target; unlinked.linkedMask.enabled = false;
    const auto targetExpected = referenceOracle(unlinked,params,metadata,rotation);
    for (bool invert : {false,true}) {
        target.linkedMask.inverted = linkedOnly.linkedMask.inverted = invert;
        resolved.clear(); auto values = renderMany({source,target,linkedOnly},nullptr,{},false,resolver);
        Plane expected(Width,Height),linkedExpected(Width,Height);
        for (int y = 0; y < Height; ++y) for (int x = 0; x < Width; ++x) {
            float v = ae::DNG_HalfToFloat(ae::DNG_FloatToHalf((*sourceExpected)[y][x]));
            if (invert) v = 1-v;
            linkedExpected[y][x] = v; expected[y][x] = v*(*targetExpected)[y][x];
        }
        const std::string name = invert ? "mixed/linkedInverted" : "mixed/linked";
        compare(name,values[1],expected,2e-6,2e-7);
        compare(name+"/pureLink",values[2],linkedExpected,0,0);
        check(resolved == std::vector<std::string>{source.name.raw(),target.name.raw()},name+" never resolves linked-only coverage");
    }
    // Explicit references ignore the profile default, including its opt-in bit.
    params.rotate.captrawMaskCoordinates = false;
    check(cache.get(params) == nullptr,"mixed/legacy global bypass retained");
    check(cache.get(params,23) == nullptr,"mixed/explicit current angle bypass");
    const auto *explicitField = cache.get(params,-17);
    auto oracle = params; oracle.rotate.captrawMaskReferenceDegree = -17;
    cacheOracle("mixed/explicitCache",explicitField,oracle,metadata,rotation);
    params.rotate.captrawMaskCoordinates = true; params.rotate.captrawMaskReferenceDegree = 33;
    check(cache.get(params,-17) == explicitField,"mixed/explicit cache ignores global default changes");
    for (double angle : {-46.,46.,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()}) {
        bool rejected = false; try { cache.get(params,angle); } catch (const ae::MaskGeometryError &) { rejected = true; }
        check(rejected,"mixed/explicit cache rejects invalid reference");
    }
}
static void leafReferencePersistence() {
    pp::Mask original;
    check(!original.captrawReferenceAngleSet && original.captrawReferenceAngle == 0,"leafReference/default unset");
    auto unequal = original; unequal.captrawReferenceAngleSet = true;
    check(unequal != original,"leafReference/equality includes presence");
    unequal = original; unequal.captrawReferenceAngle = 1;
    check(unequal != original,"leafReference/equality includes stored angle even when unset");
    const Glib::ustring key = "Test_CaptRAWReferenceAngle_2";
    for (double angle : {-45.,0.,23.125,45.}) {
        original.captrawReferenceAngleSet = true; original.captrawReferenceAngle = angle;
        pp::KeyFile saved; original.save(saved,"","Leaf","Test_","_2");
        check(saved.has_key("Leaf",key) && saved.get_double("Leaf",key) == angle,"leafReference/save present "+std::to_string(angle));
        pp::KeyFile parsed; require(parsed.load_from_data(saved.to_data()),"Cannot parse leaf reference");
        pp::Mask loaded; require(loaded.load(2000,parsed,"","Leaf","Test_","_2"),"Cannot load leaf reference");
        check(loaded.captrawReferenceAngleSet && loaded.captrawReferenceAngle == angle,"leafReference/roundtrip "+std::to_string(angle));
        original.captrawReferenceAngleSet = false;
        pp::KeyFile absent; original.save(absent,"","Leaf","Test_","_2");
        check(!absent.has_key("Leaf",key),"leafReference/unset omits key");
        require(loaded.load(2000,absent,"","Leaf","Test_","_2"),"Cannot load legacy mask over reference");
        check(!loaded.captrawReferenceAngleSet && loaded.captrawReferenceAngle == 0,"leafReference/missing key clears reused mask");
    }
    for (const std::string value : {"nan","inf","-inf","45.00001","-45.00001","not-a-number"}) {
        pp::KeyFile bad; require(bad.load_from_data("[Leaf]\nTest_CaptRAWReferenceAngle_2="+value+"\n"),"Cannot parse invalid leaf fixture");
        bool rejected = false; try { pp::Mask loaded; loaded.load(2000,bad,"","Leaf","Test_","_2"); } catch (...) { rejected = true; }
        check(rejected,"leafReference/reject invalid "+value);
    }
}
int main(int argc, char **argv) {
    try {
        require(argc == 4 || argc == 6, "Usage: mask-geometry-probe resources cache metadataImage [angle autofill]");
        const double angle = argc == 6 ? std::stod(argv[4]) : 23;
        const bool autofill = argc == 4 || std::string(argv[5]) == "true";
        require(std::isfinite(angle) && std::abs(angle) <= 45, "Invalid test angle");
        require(argc == 4 || std::string(argv[5]) == "true" || std::string(argv[5]) == "false", "Invalid test autofill");
        captraw::Engine runtime(argv[1], argv[2], [](const Json &) {});
        int error = 0; auto *image = ae::InitialImage::load(argv[3],false,&error,nullptr);
        require(image != nullptr, "Cannot load geometry-target.png metadata: "+std::to_string(error));
        struct Owner { ae::InitialImage *image; ~Owner() { image->decreaseRef(); } } owner{image};
        const auto *metadata = image->getMetaData();
        const int rawRotation = image->getImageSource()->getRotateDegree();
        pp::ProcParams current; current.rotate.enabled = true; current.rotate.degree = angle;
        current.commonTrans.autofill = autofill;
        current.lensProf.lcMode = pp::LensProfParams::LcMode::LENSFUNAUTOMATCH;
        current.lensProf.useDist = true; current.lensProf.useCA = true; current.lensProf.useVign = false;
        ae::ImProcFunctions processor(&current,false);
        const auto lens = processor.getLensCorrection(Width,Height,metadata,rawRotation);
        require(lens && lens->isCACorrectionAvailable(), "Metadata fixture must resolve real lens distortion/CA");
        cacheTests(current,metadata,rawRotation);
        profileTests(current,metadata,rawRotation);
        strokePersistence();
        leafReferencePersistence();
        pipelineFailure(current,metadata,rawRotation);
        auto reference = current; reference.rotate.degree = 0;
        ae::GeometryMap currentMap(current,Width,Height,metadata,rawRotation);
        ae::GeometryMap referenceMap(reference,Width,Height,metadata,rawRotation);
        ae::GeometryField field(currentMap,referenceMap,Width,Height);
        ae::GeometryField identity(referenceMap,referenceMap,Width,Height);
        report["geometry"] = {{"angle",angle},{"referenceAngle",0},{"lensAuto",true},{"autofill",autofill},
                              {"nodes",field.nodeCount()},{"exactCells",field.exactCellCount()}};
        Asset asset(argv[2]); report["asset"] = {{"sha256",asset.hash},{"width",Asset::width},{"height",Asset::height}};
        mixedReferences(current,asset,metadata,rawRotation);
        for(const ae::GeometryField *mapping:std::vector<const ae::GeometryField *>{nullptr,&field}) {
            auto outside=render(radial(),mapping,{0,0,24,16,1});
            double sum=0;for(int y=0;y<outside->height();++y)for(int x=0;x<outside->width();++x)sum+=(*outside)[y][x];
            check(sum==0,std::string("empty ROI is valid without warning ")+(mapping?"mapped":"ordinary"));
        }
        for (bool additive : {false,true}) {
            const std::string name = additive ? "drawn/addSignedErase" : "drawn/intersectErase";
            auto m = brush(additive); leaf(name,m,field,identity);
            auto erased = render(m,&field), intact = render(brush(additive,false),&field);
            const auto change = statistics(*erased,*intact);
            report["cases"].push_back({{"name",name+"/eraseEffect"},{"metrics",change}});
            check(change["meanError"].get<double>() > .0001, name+" erase affects coverage");
            auto soft = m; soft.drawnMask.feather = 11;
            feather(name,m,soft,field,identity);
        }
        leaf("area/radial",radial(),field,identity);
        // Gradient evaluation quantizes coordinates; tolerate at most 1.5% at its ramp.
        leaf("area/gradient",gradient(),field,identity,.015,.0015);
        auto soft = radial(); soft.areaMask.shapes.front()->feather = 12;
        feather("area/radial",radial(),soft,field,identity);
        auto softGradient = gradient(); softGradient.areaMask.shapes.front()->feather = 55;
        feather("area/gradientRampWidth",gradient(),softGradient,field,identity);
        areaComposition(field,identity);
        for (int variant : {0,1,2}) {
            const auto name = variant == 0 ? "external/plain" : variant == 1 ? "external/raster" : "external/raster90";
            auto m = asset.mask(variant != 0, variant == 2 ? 90 : 0);
            // Direct asset sampling vs warp(resampled asset): smooth fixture bounds the second interpolation.
            leaf(name,m,field,identity,.001,.0001);
            auto inverted=m;inverted.externalMask.inverted=true;
            auto normal=render(m,&field),inverse=render(inverted,&field);
            Plane complement(Width,Height);
            for(int y=0;y<Height;++y)for(int x=0;x<Width;++x)complement[y][x]=1.f-(*normal)[y][x];
            compare(std::string(name)+"/invertedIncludingOutside",*inverse,complement,0,0);
            auto softened = m; softened.externalMask.feather = 35;
            feather(name,m,softened,field,identity);
        }
        groups(asset.mask(true),field,identity); linked(field,identity);
        failurePropagation(asset,field);
    } catch (const std::exception &error) {
        report["failures"].push_back(error.what());
    }
    report["ok"] = report["failures"].empty();
    std::cout << report.dump(2) << '\n';
    return report["ok"].get<bool>() ? 0 : 1;
}
