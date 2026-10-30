#include "engine/improcfun.h"
#include "engine/imagefloat.h"
#include <algorithm>
#include <map>
#include <memory>

namespace art { namespace engine {
namespace {
// Collect both passes before publishing. Mask coverage and range samples must
// use the same cropped processing context as the pixels they describe.
class CropPlanes final: public MaskPreviewListener {
    MaskPreviewListener *target;
    int ox, oy;
    double scale;
    bool detail;
    std::map<int, std::unique_ptr<array2D<float>>> masks;
    std::unique_ptr<PlanarWhateverData<float>> luminance;
    std::unique_ptr<Imagefloat> color;
public:
    CropPlanes(MaskPreviewListener *t, int x, int y, double s, bool d)
        : target(t), ox(x), oy(y), scale(s), detail(d) {}
    bool cropped = false;
    bool wantsMask(int region) const override { return target->wantsMask(region); }
    bool wantsColorSample() const override { return target->wantsColorSample(); }
    bool wantsLuminance() const override { return target->wantsLuminance(); }
    bool luminanceSampleOnly() const override { return target->luminanceSampleOnly(); }
    void maskReady(int region, const array2D<float> &src, int x, int y, double, bool) override {
        if (!wantsMask(region)) return;
        auto &dst = masks[region];
        if (!cropped) dst.reset(new array2D<float>(src.width(), src.height()));
        for (int row=0; row<src.height(); ++row)
            for (int col=0; col<src.width(); ++col) (*dst)[y-oy+row][x-ox+col] = src[row][col];
    }
    void luminanceReady(const PlanarWhateverData<float> &src, int x, int y, double, bool) override {
        if (!cropped) { luminance.reset(new PlanarWhateverData<float>()); src.copyData(luminance.get()); }
        else for (int row=0; row<src.getHeight(); ++row)
            for (int col=0; col<src.getWidth(); ++col) luminance->v(y-oy+row,x-ox+col)=src.v(row,col);
    }
    void colorSampleReady(const Imagefloat &src, int x, int y, double, bool) override {
        if (!cropped) color.reset(src.copy());
        else {
            color->setMode(src.mode(), true);
            for (int row=0; row<src.getHeight(); ++row) for (int col=0; col<src.getWidth(); ++col) {
                color->r(y-oy+row,x-ox+col)=src.r(row,col);
                color->g(y-oy+row,x-ox+col)=src.g(row,col);
                color->b(y-oy+row,x-ox+col)=src.b(row,col);
            }
        }
    }
    void publish() {
        if (color) target->colorSampleReady(*color,ox,oy,scale,detail);
        if (luminance) target->luminanceReady(*luminance,ox,oy,scale,detail);
        for (const auto &entry:masks) target->maskReady(entry.first,*entry.second,ox,oy,scale,detail);
    }
};
}

bool ImProcFunctions::processPreview(Stage stage, Imagefloat *img)
{
    bool localTone = false;
    if (params->colorcorrection.enabled)
        for (size_t i=0; i<params->colorcorrection.regions.size(); ++i)
            if (params->colorcorrection.masks[i].enabled && !params->colorcorrection.regions[i].toneBands.empty()) localTone=true;
    if (!localTone || !params->crop.enabled || cur_pipeline==Pipeline::OUTPUT || stage==Stage::STAGE_0)
        return process(stage,img);
    const int W=img->getWidth(), H=img->getHeight();
    const int fw=full_width>0?full_width:W, fh=full_height>0?full_height:H;
    // Same rounding as SimpleProcess::stage_finish, with scale_factor=1/scale.
    const int cx=int(params->crop.x/scale+0.5), cy=int(params->crop.y/scale+0.5);
    const int cw=std::min(int(params->crop.w/scale+0.5),fw-cx);
    const int ch=std::min(int(params->crop.h/scale+0.5),fh-cy);
    const int x0=cx-offset_x, y0=cy-offset_y;
    if (cw<=0 || ch<=0 || x0<0 || y0<0 || x0+cw>W || y0+ch>H || (cw==W && ch==H))
        return process(stage,img);

    img->syncCpu();
    Imagefloat region(cw,ch,img);
    for (int y=0; y<ch; ++y) for (int x=0; x<cw; ++x) {
        region.r(y,x)=img->r(y0+y,x0+x);
        region.g(y,x)=img->g(y0+y,x0+x);
        region.b(y,x)=img->b(y0+y,x0+x);
    }
    const int ox=offset_x, oy=offset_y, originalWidth=full_width, originalHeight=full_height;
    auto *listener=maskPreviewListener;
    auto *toneHistogram=histToneCurve, *cHistogram=histCCurve, *lHistogram=histLCurve;
    CropPlanes planes(listener,ox,oy,scale,cur_pipeline==Pipeline::PREVIEW);
    if (listener) maskPreviewListener=&planes;
    bool swapped=false;
    const auto restore=[&] {
        if (swapped) std::swap(linked_mask_mgr_,preview_crop_masks_);
        setViewport(ox,oy,originalWidth,originalHeight);
        setOutputHistograms(toneHistogram,cHistogram,lHistogram);
        maskPreviewListener=listener;
    };
    bool stop;
    try {
        stop=process(stage,img);
        planes.cropped=true;
        setViewport(cx,cy,fw,fh);
        setOutputHistograms(nullptr,nullptr,nullptr);
        std::swap(linked_mask_mgr_,preview_crop_masks_); swapped=true;
        stop=process(stage,&region)||stop;
    } catch (...) { restore(); throw; }
    restore();
    img->setMode(region.mode(),multiThread);
    img->syncCpuForWrite(); region.syncCpu();
    for (int y=0; y<ch; ++y) for (int x=0; x<cw; ++x) {
        img->r(y0+y,x0+x)=region.r(y,x);
        img->g(y0+y,x0+x)=region.g(y,x);
        img->b(y0+y,x0+x)=region.b(y,x);
    }
    if (listener) planes.publish();
    return stop;
}
}} // namespace art::engine
