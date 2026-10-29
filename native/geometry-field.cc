#include "geometry-field.h"
#include "geometry-reference.h"
#include "source-frame.h"
#include "engine/improcfun.h"
#include "engine/rtengine.h"
#include <array>
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

namespace art { namespace engine {
struct GeometryField::Impl {
    struct Node {
        double x0,y0,x1,y1;
        std::array<Coord2D,4> corners;
        std::array<int,4> children{{-1,-1,-1,-1}};
        bool exact=false;
    };
    GeometryMap &current, &reference;
    int width,height,referenceRotation;
    int referenceWidth,referenceHeight;
    std::unique_ptr<SourceFrameTransform> sourceTransform;
    double tolerance;
    bool identity;
    bool referenceHorizontalFlip,referenceVerticalFlip;
    size_t exactCells=0;
    std::vector<Node> nodes;
    Impl(GeometryMap &c,GeometryMap &r,int w,int h,double t,int rotation,bool horizontal,bool vertical,int rw,int rh,const procparams::ProcParams *p,const procparams::ProcParams *rp)
        :current(c),reference(r),width(w),height(h),referenceRotation(rotation),referenceWidth(rw?rw:rotation%180?h:w),referenceHeight(rh?rh:rotation%180?w:h),tolerance(t),identity(&c==&r&&!horizontal&&!vertical),referenceHorizontalFlip(horizontal),referenceVerticalFlip(vertical) {
        if(w<2||h<2||!std::isfinite(t)||t<.005||t>.25)
            throw std::runtime_error("Invalid geometry field bounds or tolerance");
        if(p&&rp)sourceTransform.reset(new SourceFrameTransform(w,h,referenceWidth,referenceHeight,*p,*rp));
        if(!identity) build(0,0,w-1,h-1,0);
    }
    bool exact(Coord2D q,Coord2D &result) const {
        const auto p=current.toSource(q);
        if(!std::isfinite(p.x)||!std::isfinite(p.y))return false;
        const auto source=sourceTransform?
            sourceTransform->map(p):
            maskSourceRotation(p,width,height,referenceRotation);
        if(!reference.toDisplay(source,result))return false;
        result=geometrySourceFlip(result,referenceWidth,referenceHeight,referenceHorizontalFlip,referenceVerticalFlip);
        result=maskCanvasRotation(result,referenceWidth,referenceHeight,-referenceRotation);
        return true;
    }
    static Coord2D interpolate(const Node &n,double x,double y) {
        const double u=(x-n.x0)/(n.x1-n.x0),v=(y-n.y0)/(n.y1-n.y0);
        const auto &p=n.corners;
        return {(1-v)*((1-u)*p[0].x+u*p[1].x)+v*((1-u)*p[2].x+u*p[3].x),
                (1-v)*((1-u)*p[0].y+u*p[1].y)+v*((1-u)*p[2].y+u*p[3].y)};
    }
    int build(double x0,double y0,double x1,double y1,int depth) {
        Node node;node.x0=x0;node.y0=y0;node.x1=x1;node.y1=y1;
        bool valid=exact({x0,y0},node.corners[0]);
        valid=exact({x1,y0},node.corners[1])&&valid;
        valid=exact({x0,y1},node.corners[2])&&valid;
        valid=exact({x1,y1},node.corners[3])&&valid;
        const double mx=(x0+x1)/2,my=(y0+y1)/2;
        bool accurate=valid;
        const std::array<Coord2D,5> probes{{{mx,my},{mx,y0},{mx,y1},{x0,my},{x1,my}}};
        for(const auto &q:probes) {
            Coord2D result;
            if(!exact(q,result)){accurate=false;continue;}
            if(valid){const auto approx=interpolate(node,q.x,q.y);if(std::hypot(result.x-approx.x,result.y-approx.y)>tolerance)accurate=false;}
        }
        const int index=nodes.size();nodes.push_back(node);
        // Keep a bounded maximum span even for cells whose midpoint happens
        // to hide curvature. Failed/singular cells use exact lookup at render.
        if(accurate&&x1-x0<=128&&y1-y0<=128)return index;
        if(depth>=12||(x1-x0<=4&&y1-y0<=4)||(!valid&&x1-x0<=32&&y1-y0<=32)){nodes[index].exact=true;++exactCells;return index;}
        const int a=build(x0,y0,mx,my,depth+1),b=build(mx,y0,x1,my,depth+1);
        const int c=build(x0,my,mx,y1,depth+1),d=build(mx,my,x1,y1,depth+1);
        nodes[index].children={{a,b,c,d}};
        return index;
    }
    bool map(Coord2D q,Coord2D &result) const {
        if(!std::isfinite(q.x)||!std::isfinite(q.y))return false;
        if(identity){result=q;return true;}
        if(q.x<0||q.y<0||q.x>width-1||q.y>height-1)return exact(q,result);
        int index=0;
        for(;;){const auto &n=nodes[index];
            if(n.exact)return exact(q,result);
            if(n.children[0]<0){result=interpolate(n,q.x,q.y);return true;}
            const int quadrant=(q.x>(n.x0+n.x1)/2?1:0)+(q.y>(n.y0+n.y1)/2?2:0);
            index=n.children[quadrant];
        }
    }
};
GeometryField::GeometryField(GeometryMap &current,GeometryMap &reference,int w,int h,double t,int rotation,bool horizontal,bool vertical,int rw,int rh,const procparams::ProcParams *p,const procparams::ProcParams *rp)
    :impl(new Impl(current,reference,w,h,t,rotation,horizontal,vertical,rw,rh,p,rp)) {}
GeometryField::~GeometryField()=default;
bool GeometryField::map(Coord2D current,Coord2D &reference) const {return impl->map(current,reference);}
bool GeometryField::isIdentity() const {return impl->identity;}
int GeometryField::referenceWidth() const {return impl->referenceRotation%180?impl->referenceHeight:impl->referenceWidth;}
int GeometryField::referenceHeight() const {return impl->referenceRotation%180?impl->referenceWidth:impl->referenceHeight;}
size_t GeometryField::nodeCount() const {return impl->nodes.size();}
size_t GeometryField::exactCellCount() const {return impl->exactCells;}
void GeometryField::warp(const array2D<float> &source,Coord2D sourceOrigin,
                        array2D<float> &output,Coord2D outputOrigin,bool multithread,float outside) const {
    const int width=source.width(),height=source.height();
    if(width<1||height<1||output.width()<1||output.height()<1||&source==&output)
        throw std::runtime_error("Invalid scalar geometry buffers");
    int failed=0;
#ifdef _OPENMP
#pragma omp parallel for if(multithread) reduction(|:failed)
#endif
    for(int y=0;y<output.height();++y)for(int x=0;x<output.width();++x){
        Coord2D p;
        if(!map({x+outputOrigin.x,y+outputOrigin.y},p)){failed=1;output[y][x]=outside;continue;}
        p.x-=sourceOrigin.x;p.y-=sourceOrigin.y;
        if(p.x<-.5||p.y<-.5||p.x>=width-.5||p.y>=height-.5){output[y][x]=outside;continue;}
        p.x=std::max(0.,std::min(double(width-1),p.x));p.y=std::max(0.,std::min(double(height-1),p.y));
        const int x0=p.x,y0=p.y,x1=std::min(x0+1,width-1),y1=std::min(y0+1,height-1);
        const double dx=p.x-x0,dy=p.y-y0;
        output[y][x]=(1-dy)*((1-dx)*source[y0][x0]+dx*source[y0][x1])+dy*((1-dx)*source[y1][x0]+dx*source[y1][x1]);
    }
    if(failed)throw MaskGeometryError("Mask geometry inverse failed; coverage was not rendered");
}

struct MaskGeometryCache::Impl {
    struct Source {
        const FramesMetaData *metadata=nullptr;
        int rotation=0,width=0,height=0,fullWidth=0,fullHeight=0;
        bool operator==(const Source &other) const {
            return metadata==other.metadata && rotation==other.rotation && width==other.width &&
                height==other.height && fullWidth==other.fullWidth && fullHeight==other.fullHeight;
        }
    } source;
    std::string sourceIdentity;
    static procparams::ProcParams geometryParams(const procparams::ProcParams &p) {
        procparams::ProcParams result;
        result.rotate=p.rotate;result.commonTrans=p.commonTrans;result.coarse=p.coarse;
        result.distortion=p.distortion;result.cacorrection=p.cacorrection;
        result.perspective=p.perspective;result.lensProf=p.lensProf;
        return result;
    }
    static bool sameGeometry(const procparams::ProcParams &a,const procparams::ProcParams &b) {
        // ART's equality ignores useDist and auto-computed distortion amount;
        // both still change the sampling transform and must invalidate here.
        return a.rotate==b.rotate && a.commonTrans==b.commonTrans && a.coarse==b.coarse &&
            a.distortion==b.distortion && a.distortion.amount==b.distortion.amount &&
            a.cacorrection==b.cacorrection && a.perspective==b.perspective &&
            a.lensProf==b.lensProf && a.lensProf.useDist==b.lensProf.useDist;
    }
    struct Entry {
        Source source;
        procparams::ProcParams params;
        procparams::ProcParams referenceParams;
        std::string referenceKey;
        bool mirrorLegacy;
        int rw,rh,rfw,rfh;
        GeometryMap current,reference;
        GeometryField field;
        Entry(const Source &s,const procparams::ProcParams &p,const procparams::ProcParams &r,const std::string &key,bool mirror)
            :source(s),params(geometryParams(p)),referenceParams(r),referenceKey(key),mirrorLegacy(mirror),
             rw(referenceSize(s,p,r,true,false)),rh(referenceSize(s,p,r,false,false)),
             rfw(referenceSize(s,p,r,true,true)),rfh(referenceSize(s,p,r,false,true)),
             current(params,s.width,s.height,s.metadata,s.rotation,s.fullWidth,s.fullHeight),
             reference(referenceParams,rw,rh,s.metadata,s.rotation,rfw,rfh),
             field(current,reference,s.width,s.height,.02,r.coarse.rotate-p.coarse.rotate,false,false,rw,rh,&params,&referenceParams) {}
        static int referenceSize(const Source &s,const procparams::ProcParams &p,const procparams::ProcParams &r,bool horizontal,bool full){
            const bool swap=(r.coarse.rotate-p.coarse.rotate)%180;
            const int current=horizontal?(swap?s.height:s.width):(swap?s.width:s.height);
            const int currentFull=horizontal?(swap?s.fullHeight:s.fullWidth):(swap?s.fullWidth:s.fullHeight);
            if(p.commonTrans.captrawSourceFrame.empty()||r.commonTrans.captrawSourceFrame.empty())return full?currentFull:current;
            const auto a=checkedSourceFrame(nlohmann::json::parse(p.commonTrans.captrawSourceFrame));
            const auto b=checkedSourceFrame(nlohmann::json::parse(r.commonTrans.captrawSourceFrame));
            const char *key=(horizontal!=(r.coarse.rotate%180!=0))?"width":"height";
            const double ratio=b.at(key).get<double>()/a.at(key).get<double>();
            return std::max(2,int(std::lround((full?currentFull:current)*ratio)));
        }
    };
    // Fit and detail alternate on one ART processor. Keep both resolutions;
    // exposure/local changes and ROI panning reuse the same coordinate field.
    std::array<std::unique_ptr<Entry>,2> entries;
};
MaskGeometryCache::MaskGeometryCache():impl(new Impl) {}
MaskGeometryCache::~MaskGeometryCache()=default;
void MaskGeometryCache::setSource(const FramesMetaData *metadata,int rotation,int width,int height,
                                  int fullWidth,int fullHeight) {
    auto &source=impl->source;
    if(source.metadata!=metadata)impl->sourceIdentity.clear();
    source.metadata=metadata;source.rotation=rotation;source.width=width;source.height=height;
    source.fullWidth=fullWidth;source.fullHeight=fullHeight;
}
const GeometryField *MaskGeometryCache::get(const procparams::ProcParams &params) {
    if(!params.rotate.captrawMaskCoordinates)return nullptr;
    return get(params,params.rotate.captrawMaskReferenceDegree);
}
const GeometryField *MaskGeometryCache::get(const procparams::ProcParams &params,double reference,bool mirrorLegacy) {
    const double angle=params.rotate.enabled?params.rotate.degree:0;
    if(!std::isfinite(angle)||!std::isfinite(reference)||std::abs(angle)>45||std::abs(reference)>45)
        throw MaskGeometryError("Invalid mask reference rotation");
    const auto basis=geometrySourceBasis(params);
    if(angle==reference&&!(mirrorLegacy&&(params.coarse.hflip!=basis.first||params.coarse.vflip!=basis.second)))return nullptr;
    auto p=maskGeometryParams(params);p.rotate.degree=reference;p.rotate.enabled=reference!=0;
    if(mirrorLegacy){p.coarse.hflip=basis.first;p.coarse.vflip=basis.second;}
    return get(params,geometryReference(p),mirrorLegacy);
}
const GeometryField *MaskGeometryCache::get(const procparams::ProcParams &params,const std::string &key,bool mirrorLegacy) {
    auto reference=geometryReferenceParams(key);
    // v1 snapshots deliberately have no frame: their source canvas is the
    // document's historical canvas. Binding for copy upgrades them explicitly.
    if(reference.commonTrans.captrawSourceFrame.empty())reference.commonTrans.captrawSourceFrame=params.commonTrans.captrawSourceFrame;
    auto geometry=maskGeometryParams(params);
    if(Impl::sameGeometry(geometry,reference))return nullptr;
    const auto &source=impl->source;
    if(!source.metadata||source.width<2||source.height<2||source.fullWidth<source.width||source.fullHeight<source.height)
        throw MaskGeometryError("Mask geometry source is unavailable");
    if(hasRenderBinding(reference)&&geometry.commonTrans.captrawSourceIdentity.empty()){
        // Standalone ART profile rendering has no Node snapshot. Resolve the
        // actual input once per processor, never from the reference's label.
        if(impl->sourceIdentity.empty())impl->sourceIdentity=sourceContentIdentity(source.metadata->getFileName().raw()).dump();
        geometry.commonTrans.captrawSourceIdentity=impl->sourceIdentity;
    }
    // Copy only transform parameters, never the profile's masks or strokes.
    for(size_t i=0;i<impl->entries.size();++i) {
        const auto &entry=impl->entries[i];
        if(entry && entry->source==source && entry->referenceKey==key && entry->mirrorLegacy==mirrorLegacy &&
           entry->params.commonTrans.captrawSourceIdentity==geometry.commonTrans.captrawSourceIdentity&&Impl::sameGeometry(entry->params,geometry)) {
            if(i)std::swap(impl->entries[0],impl->entries[i]);
            return &impl->entries[0]->field;
        }
    }
    std::unique_ptr<Impl::Entry> next(new Impl::Entry(source,geometry,reference,key,mirrorLegacy));
    impl->entries[1]=std::move(impl->entries[0]);impl->entries[0]=std::move(next);
    return &impl->entries[0]->field;
}
void ImProcFunctions::setMaskGeometrySource(const FramesMetaData *metadata,int rotation,int width,int height,
                                            int fullWidth,int fullHeight) {
    if(!maskGeometryCache_)maskGeometryCache_.reset(new MaskGeometryCache);
    maskGeometryCache_->setSource(metadata,rotation,width,height,fullWidth,fullHeight);
}
const GeometryField *ImProcFunctions::maskGeometry() {
    if(!params->rotate.captrawMaskCoordinates)return nullptr;
    if(!maskGeometryCache_)maskGeometryCache_.reset(new MaskGeometryCache);
    return maskGeometryCache_->get(*params);
}
const GeometryField *ImProcFunctions::maskGeometry(const procparams::Mask &mask) {
    if(!mask.captrawGeometryReference.empty()){
        if(!maskGeometryCache_)maskGeometryCache_.reset(new MaskGeometryCache);
        return maskGeometryCache_->get(*params,mask.captrawGeometryReference);
    }
    if(mask.captrawMirrorCoordinates){
        if(!maskGeometryCache_)maskGeometryCache_.reset(new MaskGeometryCache);
        const double reference=mask.captrawReferenceAngleSet?mask.captrawReferenceAngle:
            params->rotate.captrawMaskCoordinates?params->rotate.captrawMaskReferenceDegree:
            params->rotate.enabled?params->rotate.degree:0;
        return maskGeometryCache_->get(*params,reference,true);
    }
    if(!mask.captrawReferenceAngleSet)return maskGeometry();
    if(!maskGeometryCache_)maskGeometryCache_.reset(new MaskGeometryCache);
    return maskGeometryCache_->get(*params,mask.captrawReferenceAngle);
}
}} // namespace art::engine
