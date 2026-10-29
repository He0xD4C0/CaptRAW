#include "repair.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace art { namespace engine {
void repairStroke(Imagefloat *src, Imagefloat *dst, int sx, int sy, int tx, int ty,
                  int width, int height, const std::vector<double> &path,
                  double radius, double outer, double opacity, int detail, RepairRelax relax)
{
    if(path.size()<4 || path.size()%2 || width<1 || height<1 || radius<=0 || outer<radius)
        throw std::runtime_error("Invalid continuous repair domain");
    if(opacity==0)return;
    Imagefloat difference(width,height);
    array2D<int32_t> domain(width,height);
    array2D<float> coverage(width,height);
    // Rasterize the union of swept segments, then solve once over that union.
    // Repeated samples and self-intersections do not compound opacity.
    coverage.fill(0);
    for(size_t i=2;i<path.size();i+=2){
        const double ax=path[i-2],ay=path[i-1],bx=path[i],by=path[i+1];
        const double dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;
        const int x0=std::max(0,int(std::floor(std::min(ax,bx)-outer)));
        const int x1=std::min(width-1,int(std::ceil(std::max(ax,bx)+outer)));
        const int y0=std::max(0,int(std::floor(std::min(ay,by)-outer)));
        const int y1=std::min(height-1,int(std::ceil(std::max(ay,by)+outer)));
        for(int y=y0;y<=y1;++y)for(int x=x0;x<=x1;++x){
            const double u=length?std::max(0.,std::min(1.,((x-ax)*dx+(y-ay)*dy)/length)):0;
            const double d=std::hypot(x-ax-u*dx,y-ay-u*dy);
            const double a=d<=radius?1:outer>radius?std::max(0.,std::min(1.,(outer-d)/(outer-radius))):0;
            coverage[y][x]=std::max(coverage[y][x],float(a*a*(3-2*a)));
        }
    }
    for(int y=0;y<height;++y)for(int x=0;x<width;++x){
        domain[y][x]=coverage[y][x]>0 && x>0 && y>0 && x+1<width && y+1<height;
        difference.r(y,x)=dst->r(ty+y,tx+x)-src->r(sy+y,sx+x);
        difference.g(y,x)=dst->g(ty+y,tx+x)-src->g(sy+y,sx+x);
        difference.b(y,x)=dst->b(ty+y,tx+x)-src->b(sy+y,sx+x);
        // Keep the outside target/source difference as a Dirichlet boundary.
        // A zero interior seed avoids preserving the original blemish.
        if(domain[y][x]){
            const float weight=1-std::pow(coverage[y][x],.125f*std::max(1,detail-1));
            difference.r(y,x)*=weight;difference.g(y,x)*=weight;difference.b(y,x)*=weight;
        }
    }
    if(detail>=2)relax(&difference,domain); // ART's ordered Laplace solver.
    for(int y=0;y<height;++y)for(int x=0;x<width;++x){
        const float a=coverage[y][x]*opacity;
        if(!a)continue;
        const auto blend=[&](float source,float old,float correction){return old+a*(source+(detail>=2?correction:0)-old);};
        dst->r(ty+y,tx+x)=blend(src->r(sy+y,sx+x),dst->r(ty+y,tx+x),difference.r(y,x));
        dst->g(ty+y,tx+x)=blend(src->g(sy+y,sx+x),dst->g(ty+y,tx+x),difference.g(y,x));
        dst->b(ty+y,tx+x)=blend(src->b(sy+y,sx+x),dst->b(ty+y,tx+x),difference.b(y,x));
    }
}
}}
