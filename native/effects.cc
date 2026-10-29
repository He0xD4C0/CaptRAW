// SPDX-License-Identifier: GPL-3.0-or-later
#include "effects.h"
#include "engine/improcfun.h"
#include "engine/iccstore.h"
#include "engine/rt_algo.h"
#include "engine/masks.h"
#include <stdexcept>
#include <memory>
namespace art { namespace engine {
void ImProcFunctions::captrawEffects(Imagefloat *img){
    const auto &s=params->captrawEffects;
    if(s.empty()||((s[0]==0||s[1]==0)&&(s[4]==0||s[5]==0)))return;
    img->setMode(Imagefloat::Mode::RGB,multiThread);
    const auto work=ICCStore::getInstance()->workingSpaceMatrix(params->icm.workingProfile);
    const auto srgb=ICCStore::getInstance()->workingSpaceInverseMatrix("sRGB"),
        m=ICCStore::getInstance()->workingSpaceMatrix("sRGB"),
        inv=ICCStore::getInstance()->workingSpaceInverseMatrix(params->icm.workingProfile);
    const double step=scale;
    const double cx=params->crop.enabled?params->crop.x:0,cy=params->crop.enabled?params->crop.y:0;
    const double cw=params->crop.enabled?params->crop.w:(full_width>0?full_width:img->getWidth())*step,ch=params->crop.enabled?params->crop.h:(full_height>0?full_height:img->getHeight())*step;
#ifdef _OPENMP
#pragma omp parallel if(multiThread)
#endif
    {
    std::unique_ptr<captraw::effects::GrainSampler> grainSampler;
    if(s[0]!=0&&s[1]>0&&step>1)grainSampler.reset(new captraw::effects::GrainSampler(s[2],s[3],step,offset_x*step-1,(offset_x+img->getWidth())*step+1));
#ifdef _OPENMP
#pragma omp for schedule(static)
#endif
    for(int y=0;y<img->getHeight();++y)for(int x=0;x<img->getWidth();++x){
        const double px=(x+offset_x+.5)*step,py=(y+offset_y+.5)*step;
        double rgb[]={img->r(y,x)/65535.,img->g(y,x)/65535.,img->b(y,x)/65535.};
        if(s[4]!=0){
            // Convert into display-referred sRGB light for artistic blending.
            // Signed transfer preserves out-of-gamut and HDR values.
            double xyz[3],v[3];
            for(int c=0;c<3;++c)xyz[c]=work[c][0]*rgb[0]+work[c][1]*rgb[1]+work[c][2]*rgb[2];
            for(int c=0;c<3;++c){const double t=srgb[c][0]*xyz[0]+srgb[c][1]*xyz[1]+srgb[c][2]*xyz[2];v[c]=std::abs(t)<=.0031308?12.92*t:std::copysign(1.055*std::pow(std::abs(t),1/2.4)-.055,t);}
            captraw::effects::vignette(v,captraw::effects::coverage(px-cx,py-cy,cw,ch,s[6],s[7],s[8]),s[5],int(s[4]),s[9]);
            for(double &t:v)t=std::abs(t)<=.04045?t/12.92:std::copysign(std::pow((std::abs(t)+.055)/1.055,2.4),t);
            for(int c=0;c<3;++c)xyz[c]=m[c][0]*v[0]+m[c][1]*v[1]+m[c][2]*v[2];
            for(int c=0;c<3;++c)rgb[c]=inv[c][0]*xyz[0]+inv[c][1]*xyz[1]+inv[c][2]*xyz[2];
        }
        if(s[0]!=0&&s[1]>0){
            const double l=std::max(0.,work[1][0]*rgb[0]+work[1][1]*rgb[1]+work[1][2]*rgb[2]);
            const double noise=grainSampler?grainSampler->footprint(px,py,step):captraw::effects::grainFootprint(px,py,s[2],s[3],step);
            const double n=noise*s[1]/100.*.08*std::sqrt(l/(1+l));
            // Monochromatic, signal-dependent grain; no 8-bit intermediate or clipping.
            for(double &v:rgb)v+=n;
        }
        img->r(y,x)=rgb[0]*65535;img->g(y,x)=rgb[1]*65535;img->b(y,x)=rgb[2]*65535;
    }
    }
}
void ImProcFunctions::captrawGlow(Imagefloat *img){
    const auto &g=params->captrawGlow;
    if(g.empty())return;
    if(g.size()<5||(g.size()-5)%2)throw std::runtime_error("Invalid glow state");
    const int W=img->getWidth(),H=img->getHeight(),style=int(g[1]);
    img->setMode(Imagefloat::Mode::RGB,multiThread);
    const auto ws=ICCStore::getInstance()->workingSpaceMatrix(params->icm.workingProfile);
    array2D<float> amount(W,H),gate(W,H),emission(W,H),blurred(W,H);
#ifdef _OPENMP
#pragma omp parallel for if(multiThread)
#endif
    for(int y=0;y<H;++y)for(int x=0;x<W;++x){
        amount[y][x]=g[0]/100.;
        const double l=(ws[1][0]*img->r(y,x)+ws[1][1]*img->g(y,x)+ws[1][2]*img->b(y,x))/65535.;
        gate[y][x]=captraw::effects::glowGate(l,g[2]);
    }
    for(size_t i=5;i+1<g.size();i+=2){
        const size_t index=size_t(g[i]);
        if(index>=params->colorcorrection.masks.size())throw std::runtime_error("Glow mask index is stale");
        array2D<float> coverage(W,H);
        for(int y=0;y<H;++y)for(int x=0;x<W;++x)coverage[y][x]=1;
        if(!linked_mask_mgr_.apply_mask("colorcorrection",params->colorcorrection.masks[index].name,false,&coverage,nullptr,multiThread,maskErrorListener?maskErrorListener:plistener))throw std::runtime_error("Glow mask coverage unavailable");
#ifdef _OPENMP
#pragma omp parallel for if(multiThread)
#endif
        for(int y=0;y<H;++y)for(int x=0;x<W;++x)amount[y][x]+=coverage[y][x]*g[i+1]/100.;
    }
    const double sigma=captraw::effects::glowSigma(g[3],std::min(full_width>0?full_width:W,full_height>0?full_height:H)*scale)/scale;
    array2D<float> kernel;
    if(style==2){
        // ART's finite radial halation scatter, normalized to unit energy.
        const int radius=std::max(1,int(std::ceil(4*sigma)));kernel(2*radius+1,2*radius+1);double norm=0;
        for(int y=-radius;y<=radius;++y)for(int x=-radius;x<=radius;++x){const double d2=double(x)*x+double(y)*y;const double k=(d2==0?1.:1./d2)*std::max(0.,1-std::sqrt(d2)/radius);kernel[y+radius][x+radius]=k;norm+=k;}
        for(int y=0;y<kernel.height();++y)for(int x=0;x<kernel.width();++x)kernel[y][x]/=norm;
    }else build_gaussian_kernel(float(sigma),kernel);
    Convolution convolve(kernel,W,H,multiThread);
    for(int c=0;c<3;++c){
#ifdef _OPENMP
#pragma omp parallel for if(multiThread)
#endif
        for(int y=0;y<H;++y)for(int x=0;x<W;++x){const float v=c==0?img->r(y,x):c==1?img->g(y,x):img->b(y,x);emission[y][x]=v*gate[y][x];}
        convolve(emission,blurred);
        const double tint=captraw::effects::glowTint(style,c,g[4]);
#ifdef _OPENMP
#pragma omp parallel for if(multiThread)
#endif
        for(int y=0;y<H;++y)for(int x=0;x<W;++x){
            float &v=c==0?img->r(y,x):c==1?img->g(y,x):img->b(y,x);
            const double a=captraw::effects::clamp(amount[y][x]);if(a==0)continue;
            // Diffusion softens selected light; Bloom adds scatter; Halation adds
            // only scattered light outside its emitter, with yellow-to-red tint.
            if(style==0)v+=a*.65*(blurred[y][x]*tint-emission[y][x]);
            else if(style==1)v+=a*.65*blurred[y][x]*tint;
            else v+=a*tint*std::max(0.f,blurred[y][x]-emission[y][x]);
        }
    }
}

}}
