#include "repair-source.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace captraw {
namespace {
using Point=art::engine::Coord2D;
Point rotate(Point p,int rotation){
    switch(rotation){case 90:return {1-p.y,p.x};case 180:return {1-p.x,1-p.y};case 270:return {p.y,1-p.x};default:return p;}
}
using RGB=std::array<double,3>;
std::optional<RGB> sample(const RepairSourceImage &image,art::engine::GeometryMap &geometry,Point source){
    Point display;
    if(!geometry.toDisplay(source,display)||!std::isfinite(display.x)||!std::isfinite(display.y)||
       display.x<0||display.y<0||display.x>=image.fullWidth||display.y>=image.fullHeight)return std::nullopt;
    const int x=std::min(image.width-1,int(std::floor((display.x+.5)*image.width/image.fullWidth)));
    const int y=std::min(image.height-1,int(std::floor((display.y+.5)*image.height/image.fullHeight)));
    const auto *pixel=image.rgb+(size_t(y)*image.width+x)*3;
    return RGB{double(pixel[0]),double(pixel[1]),double(pixel[2])};
}
}
RepairSourceMatch findRepairSource(const RepairSourceImage &image,const RepairSourceSearch &request,
                                  art::engine::GeometryMap &geometry,int width,int height,int rotation){
    if(!image.rgb||image.width<1||image.height<1||image.fullWidth<2||image.fullHeight<2||width<2||height<2||
       (rotation!=0&&rotation!=90&&rotation!=180&&rotation!=270)||request.path.empty()||request.path.size()>32768||
       !std::isfinite(request.radius)||request.radius<2||request.radius>200||
       !std::isfinite(request.feather)||request.feather<0||request.feather>100)
        throw std::runtime_error("Invalid repair source search");
    const auto pixel=[&](Point p){
        if(!std::isfinite(p.x)||!std::isfinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)throw std::runtime_error("Invalid repair source point");
        const auto q=rotate(p,rotation);return Point(q.x*(width-1),q.y*(height-1));
    };
    std::vector<Point> path;path.reserve(request.path.size());
    double left=std::numeric_limits<double>::infinity(),top=left,right=-left,bottom=-left;
    for(const auto &p:request.path){const auto q=pixel(p);path.push_back(q);left=std::min(left,q.x);right=std::max(right,q.x);top=std::min(top,q.y);bottom=std::max(bottom,q.y);}
    std::optional<Point> exclude;
    if(request.exclude){const auto p=pixel(*request.exclude);exclude=Point(std::lround(p.x),std::lround(p.y));}
    const double edge=request.radius*(1+request.feather/100)+2;
    const size_t count=std::min(size_t(8),path.size());
    std::vector<Point> samples;
    for(size_t i=0;i<count;++i){
        const auto p=path[std::lround(double(i)*(path.size()-1)/std::max(size_t(1),count-1))];
        for(const auto &d:std::array<Point,5>{{{0,0},{-request.radius,0},{request.radius,0},{0,-request.radius},{0,request.radius}}})
            samples.emplace_back(p.x+d.x,p.y+d.y);
    }
    std::vector<std::optional<RGB>> target;
    for(const auto &p:samples)target.push_back(sample(image,geometry,p));
    struct Candidate {Point offset;double error;};
    std::vector<Candidate> ranked;
    bool hasArea=false;
    for(int y=0;y<9;++y)for(int x=0;x<9;++x){
        const double dx=edge-left+x/8.*(width-1-2*edge-(right-left));
        const double dy=edge-top+y/8.*(height-1-2*edge-(bottom-top));
        if(left+dx-edge<0||right+dx+edge>=width||top+dy-edge<0||bottom+dy+edge>=height)continue;
        if(!(right+dx+edge<left-edge||left+dx-edge>right+edge||bottom+dy+edge<top-edge||top+dy-edge>bottom+edge))continue;
        hasArea=true;
        std::vector<std::pair<RGB,RGB>> pairs;
        RGB mean{{0,0,0}};
        for(size_t i=0;i<samples.size();++i){
            const auto color=sample(image,geometry,{samples[i].x+dx,samples[i].y+dy});
            if(!target[i]||!color)continue;
            pairs.emplace_back(*target[i],*color);
            for(int c=0;c<3;++c)mean[c]+=(*target[i])[c]-(*color)[c];
        }
        if(pairs.size()*2<samples.size()||pairs.empty())continue;
        for(auto &value:mean)value/=pairs.size();
        double error=0;
        for(const auto &pair:pairs)for(int c=0;c<3;++c){
            const double d=pair.first[c]-pair.second[c];error+=(d-mean[c])*(d-mean[c])+.15*d*d;
        }
        error/=pairs.size()*3;
        if(std::isfinite(error))ranked.push_back({{dx,dy},error});
    }
    if(!hasArea)throw std::runtime_error("没有足够的不重叠取样区域，请手动选择来源或缩小修复区域。");
    if(ranked.empty())throw std::runtime_error("无法在当前显影图像中找到可靠来源，请手动取样。");
    // Preserve the renderer algorithm's stable grid order for equally scored patches.
    std::stable_sort(ranked.begin(),ranked.end(),[](const Candidate &a,const Candidate &b){return a.error<b.error;});
    if(exclude)ranked.erase(std::remove_if(ranked.begin(),ranked.end(),[&](const Candidate &c){
        return std::hypot(path.front().x+c.offset.x-exclude->x,path.front().y+c.offset.y-exclude->y)<=1;
    }),ranked.end());
    if(ranked.empty())throw std::runtime_error("没有其他有效来源，请手动选择来源。");
    const auto offset=ranked[request.seed%ranked.size()].offset;
    const Point normalized((path.front().x+offset.x)/(width-1),(path.front().y+offset.y)/(height-1));
    const auto source=rotate(normalized,(360-rotation)%360);
    return {source,{source.x-request.path.front().x,source.y-request.path.front().y}};
}
}
