// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>
#include <limits>
namespace captraw { namespace effects {
inline double clamp(double x){return std::max(0.,std::min(x,1.));}
inline double smooth(double x){x=clamp(x);return x*x*(3-2*x);}
// Counter-based noise is independent of thread scheduling and viewport origin.
inline double random(int x,int y,unsigned seed){
    uint32_t h=uint32_t(x)*0x9e3779b9u^uint32_t(y)*0x85ebca6bu^seed;
    h^=h>>16;h*=0x7feb352du;h^=h>>15;h*=0x846ca68bu;h^=h>>16;
    return (double(h)+.5)/4294967296.;
}
inline double gaussian(int x,int y,unsigned seed){return std::sqrt(-2*std::log(random(x,y,seed)))*std::cos(6.283185307179586*random(x,y,seed+1));}
// Gaussian lattice reconstruction, normalized for constant variance as cell size changes.
inline double field(double x,double y,double spacing,unsigned seed){
    x/=spacing;y/=spacing;const int ix=int(std::floor(x)),iy=int(std::floor(y));
    const double u=smooth(x-ix),v=smooth(y-iy);
    const double a=(1-u)*(1-v),b=u*(1-v),c=(1-u)*v,d=u*v;
    return (a*gaussian(ix,iy,seed)+b*gaussian(ix+1,iy,seed)+c*gaussian(ix,iy+1,seed)+d*gaussian(ix+1,iy+1,seed))/std::sqrt(a*a+b*b+c*c+d*d);
}
inline double grain(double x,double y,double size,double roughness){
    const double spacing=.6+size*size*.0012;
    const double n=field(x,y,spacing,1701);
    // Roughness controls spatial variation of particle amplitude, not just noise strength.
    const double envelope=std::exp(roughness/100.*.7*field(x,y,spacing*5,4201)-.245*roughness*roughness/10000.);
    return n*envelope;
}
// Box reconstruction of the full-resolution grain texture over the destination
// pixel footprint. Integrate texel overlap rather than sparsely sampling a high-
// frequency random field. At skip=1 this is exactly the original source sample.
inline double grainFootprint(double x,double y,double size,double roughness,double footprint){
    if(footprint<=1)return grain(x,y,size,roughness);
    const double left=x-footprint*.5,top=y-footprint*.5,right=x+footprint*.5,bottom=y+footprint*.5;
    double sum=0;
    for(int iy=int(std::floor(top));iy<int(std::ceil(bottom));++iy){
        const double wy=std::max(0.,std::min(bottom,double(iy+1))-std::max(top,double(iy)));
        for(int ix=int(std::floor(left));ix<int(std::ceil(right));++ix){
            const double wx=std::max(0.,std::min(right,double(ix+1))-std::max(left,double(ix)));
            sum+=wx*wy*grain(ix+.5,iy+.5,size,roughness);
        }
    }
    return sum/(footprint*footprint);
}
// A call-local row cache for deterministic lattice vertices. One sampler belongs
// to one processing thread; no image-sized or process-lifetime cache is retained.
class GrainSampler {
    class Field {
        double spacing_;
        unsigned seed_;
        int first_,width_,rows_;
        std::vector<int> tags_;
        std::vector<double> values_;
        const double *row(int y){
            const int slot=(y%rows_+rows_)%rows_;
            double *values=values_.data()+slot*width_;
            if(tags_[slot]!=y){
                for(int x=0;x<width_;++x)values[x]=gaussian(first_+x,y,seed_);
                tags_[slot]=y;
            }
            return values;
        }
    public:
        Field(double spacing,unsigned seed,double footprint,double left,double right):
            spacing_(spacing),seed_(seed),first_(int(std::floor(left/spacing))-1),
            width_(int(std::ceil(right/spacing))+2-first_),rows_(int(std::ceil(footprint/spacing))+3),
            tags_(rows_,std::numeric_limits<int>::min()),values_(size_t(rows_)*width_){}
        double at(double x,double y){
            x/=spacing_;y/=spacing_;const int ix=int(std::floor(x)),iy=int(std::floor(y));
            const double u=smooth(x-ix),v=smooth(y-iy);
            const double a=(1-u)*(1-v),b=u*(1-v),c=(1-u)*v,d=u*v;
            const double *top=row(iy),*bottom=row(iy+1);const int col=ix-first_;
            return (a*top[col]+b*top[col+1]+c*bottom[col]+d*bottom[col+1])/std::sqrt(a*a+b*b+c*c+d*d);
        }
    };
    double size_,roughness_;
    Field fine_,coarse_;
    double sample(double x,double y){
        const double n=fine_.at(x,y);
        const double envelope=std::exp(roughness_/100.*.7*coarse_.at(x,y)-.245*roughness_*roughness_/10000.);
        return n*envelope;
    }
public:
    GrainSampler(double size,double roughness,double footprint,double left,double right):
        size_(size),roughness_(roughness),
        fine_(.6+size*size*.0012,1701,footprint,left,right),
        coarse_((.6+size*size*.0012)*5,4201,footprint,left,right){}
    double footprint(double x,double y,double span){
        if(span<=1)return grain(x,y,size_,roughness_);
        const double left=x-span*.5,top=y-span*.5,right=x+span*.5,bottom=y+span*.5;
        double sum=0;
        for(int iy=int(std::floor(top));iy<int(std::ceil(bottom));++iy){
            const double wy=std::max(0.,std::min(bottom,double(iy+1))-std::max(top,double(iy)));
            for(int ix=int(std::floor(left));ix<int(std::ceil(right));++ix){
                const double wx=std::max(0.,std::min(right,double(ix+1))-std::max(left,double(ix)));
                sum+=wx*wy*sample(ix+.5,iy+.5);
            }
        }
        return sum/(span*span);
    }
};
// Optical candidate: a highlight gate and scale-invariant spatial support.
// Zero range selects the brightest stops; 100 includes the entire tonal range.
inline double glowGate(double luminance,double range){
    const double threshold=.95*(1-range/100.);
    return smooth((std::max(0.,luminance)-threshold)/std::max(.05,1-threshold));
}
inline double glowSigma(double spread,double shortestSide){return std::max(1.,shortestSide*.00625)*std::exp2((spread-50)/25.);}
inline double glowTint(int style,int channel,double warmth){
    const double t=warmth/100.;
    if(style==2)return channel==0?1:channel==1?.35*(1-t):0.;
    return channel==0?1+.35*t:channel==1?1:1-.35*t;
}
// Superellipse -> ellipse -> circle; coordinates are relative to the final crop.
inline double coverage(double x,double y,double width,double height,double midpoint,double roundness,double feather){
    double ax=width*.5,ay=height*.5;
    if(roundness>0){const double r=std::max(ax,ay);ax+=(r-ax)*roundness/100;ay+=(r-ay)*roundness/100;}
    const double exponent=roundness<0?2- roundness*.06:2;
    const double radius=std::pow(std::pow(std::abs(x-width*.5)/std::max(1.,ax),exponent)+std::pow(std::abs(y-height*.5)/std::max(1.,ay),exponent),1/exponent);
    const double edge=.15+midpoint*.0085,span=std::max(.001,feather*.012);
    return smooth((radius-edge+span*.5)/span);
}
inline void vignette(double *rgb,double mask,double amount,int style,double highlights){
    if(amount==0||mask==0)return;
    const double l=std::max(0.,.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]);
    const double protect=amount<0&&style!=3?1-highlights/100.*smooth((l-.5)*2):1;
    const double alpha=clamp(std::abs(amount)/100.*mask*protect);
    if(style==3){for(int c=0;c<3;++c)rgb[c]=rgb[c]*(1-alpha)+(amount>0?alpha:0);return;}
    const double gain=std::exp2((amount>0?2:-2)*alpha);
    if(style==2){for(int c=0;c<3;++c)rgb[c]*=gain;return;}
    // Reinhard's bounded exposure operator, channel-wise: highlight contrast survives
    // darkening, unlike a black paint overlay. It can shift hue, as documented.
    for(int c=0;c<3;++c){const double v=rgb[c];rgb[c]=v>=0&&v<=1?v*gain/(1+v*(gain-1)):v*gain;}
}
}}
