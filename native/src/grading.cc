// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental color grading. HDR range weights are relative to the ART peak.
// Range/tint semantics are not Adobe's algorithm; legacy profiles retain SDR behavior.
#include "engine/improcfun.h"
#include "engine/color.h"
#include "engine/iccstore.h"
#include <algorithm>
#include <cmath>

namespace art { namespace engine {
namespace {
float lightness(const float *v) { return .5f*(*std::min_element(v,v+3)+*std::max_element(v,v+3)); }
float smooth(float a,float b,float x) {
    const float t=std::max(0.f,std::min(1.f,(x-a)/(b-a)));return t*t*(3.f-2.f*t);
}
void weights(float l,float blend,float balance,float *w) {
    const float x=std::max(0.f,std::min(1.f,l)),b=blend/100.f;
    const float t=x/(x+(1.f-x)*std::exp2(-balance/25.f));
    w[0]=1.f-smooth(.05f,.45f+.55f*b,t);
    w[1]=smooth(0.f,.35f-.30f*b,t)*(1.f-smooth(.65f+.30f*b,1.f,t));
    w[2]=smooth(.55f-.55f*b,.95f,t);
}
void luminance(float *v,float amount) {
    if(amount==0.f)return;
    for(int c=0;c<3;++c)v[c]=amount>0.f?v[c]+amount*(1.f-v[c]):v[c]*(1.f+amount);
}
void tint(float *v,const float *settings,const float *w,int count) {
    const float l=lightness(v);if(l<=0.f||l>=1.f)return;
    float target[3]={},sum=0.f,remaining=1.f;
    for(int i=0;i<count;++i){
        const float opacity=w[i]*settings[3*i+1]/100.f;if(opacity==0.f)continue;
        float color[3];Color::hsl2rgb(settings[3*i]/360.f,1.f,l,color[0],color[1],color[2]);
        for(int c=0;c<3;++c)target[c]+=opacity*(color[c]/65535.f);
        sum+=opacity;remaining*=1.f-opacity;
    }
    if(sum==0.f)return;
    for(float &c:target)c/=sum;
    const float targetShift=l-lightness(target),alpha=(1.f-remaining)*4.f*l*(1.f-l);
    for(int c=0;c<3;++c)v[c]+=(target[c]+targetShift-v[c])*alpha;
    const float shift=l-lightness(v);for(int c=0;c<3;++c)v[c]+=shift;
}
float encode(float x) {return std::abs(x)<=.0031308f?12.92f*x:std::copysign(1.055f*std::pow(std::abs(x),1.f/2.4f)-.055f,x);}
float decode(float x) {return std::abs(x)<=.04045f?x/12.92f:std::copysign(std::pow((std::abs(x)+.055f)/1.055f,2.4f),x);}
void multiply(const float m[3][3],const float *v,float *out) {
    for(int r=0;r<3;++r)out[r]=m[r][0]*v[0]+m[r][1]*v[1]+m[r][2]*v[2];
}
}

// Versioned relative-WB matrix in the current linear working space.
void ImProcFunctions::captrawRelativeWhiteBalance(Imagefloat *img)
{
    const auto &m=params->wb.captrawRelativeMatrix;
    if(m.empty())return;
    img->setMode(Imagefloat::Mode::RGB,multiThread);
    const int width=img->getWidth(),height=img->getHeight();
#ifdef _OPENMP
#pragma omp parallel for if(multiThread) schedule(static)
#endif
    for(int y=0;y<height;++y)for(int x=0;x<width;++x){
        const double v[]={img->r(y,x),img->g(y,x),img->b(y,x)};
        img->r(y,x)=m[0]*v[0]+m[1]*v[1]+m[2]*v[2];
        img->g(y,x)=m[3]*v[0]+m[4]*v[1]+m[5]*v[2];
        img->b(y,x)=m[6]*v[0]+m[7]*v[1]+m[8]*v[2];
    }
}

// Shadow calibration: ART-ctlscripts wbchmix.ctl / _artlib.ctl, GPL-3.0-or-later,
// Copyright 2023 Alberto Griggio. Revision 958935312489710b17dc4792d0677bdacf43a95c.
// https://github.com/artraweditor/ART-ctlscripts/blob/958935312489710b17dc4792d0677bdacf43a95c/wbchmix.ctl
// Uses its zero-luminance Rec2020 chroma lift, restricted to the green/magenta
// axis (hue 135/315 degrees, saturation abs(tint)/100, maximum chroma .02).
// This is ART's additive shadow tint, not an Adobe pixel-equivalence claim.
void ImProcFunctions::captrawCalibration(Imagefloat *img)
{
    const int amount=params->chmixer.captrawShadowTint;
    if(!amount)return; // Old recipes and explicit zero do not even change image mode.
    auto *store=ICCStore::getInstance();
    const auto rec2020=store->workingSpaceMatrix("Rec2020");
    const auto inv=store->workingSpaceInverseMatrix(params->icm.workingProfile);
    const float chroma=float(amount)*(.02f/100.f)*std::sqrt(.5f);
    float lift[3],xyz[3],offset[3];
    Color::yuv2rgb(0.f,-chroma,chroma,lift[0],lift[1],lift[2],rec2020);
    multiply(rec2020,lift,xyz);multiply(inv,xyz,offset);
    img->setMode(Imagefloat::Mode::RGB,multiThread);
    const int width=img->getWidth(),height=img->getHeight();
#ifdef _OPENMP
#pragma omp parallel for if(multiThread) schedule(static)
#endif
    for(int y=0;y<height;++y)for(int x=0;x<width;++x){
        img->r(y,x)+=offset[0]*65535.f;
        img->g(y,x)+=offset[1]*65535.f;
        img->b(y,x)+=offset[2]*65535.f;
    }
}

void ImProcFunctions::captrawColorGrading(Imagefloat *img)
{
    const auto &settings=params->captrawGrading;
    if(settings.empty())return;
    bool active=false;float p[14];
    for(int i=0;i<14;++i)p[i]=settings[i];
    for(int i=0;i<4;++i)active|=p[3*i+1]!=0.f||p[3*i+2]!=0.f;
    if(!active)return; // Neutral settings bypass all conversion, including image mode.
    img->setMode(Imagefloat::Mode::RGB,multiThread);
    auto *store=ICCStore::getInstance();
    const auto work=store->workingSpaceMatrix(params->icm.workingProfile);
    const auto inv=store->workingSpaceInverseMatrix(params->icm.workingProfile);
    const auto srgb=store->workingSpaceMatrix("sRGB"),srgbInv=store->workingSpaceInverseMatrix("sRGB");
    const bool hdr=params->toneCurve.captrawHDREditMode;
    const float peak=params->toneCurve.whitePoint;
    const int width=img->getWidth(),height=img->getHeight();
#ifdef _OPENMP
#pragma omp parallel for if(multiThread) schedule(static)
#endif
    for(int y=0;y<height;++y)for(int x=0;x<width;++x){
        float rgb[]={img->r(y,x)/65535.f,img->g(y,x)/65535.f,img->b(y,x)/65535.f},xyz[3],v[3];
        multiply(work,rgb,xyz);multiply(srgbInv,xyz,v);
        if(hdr)for(float &c:v)c/=peak;
        for(float &c:v)c=encode(c);
        float w[3];weights(lightness(v),p[12],p[13],w);
        float lum=0.f,total=0.f;for(int i=0;i<3;++i){lum+=w[i]*p[3*i+2]/100.f;total+=w[i];}
        luminance(v,lum/std::max(1.f,total));tint(v,p,w,3);
        luminance(v,p[11]/100.f);const float global=1.f;tint(v,p+9,&global,1);
        for(float &c:v)c=decode(c);
        if(hdr)for(float &c:v)c*=peak;
        multiply(srgb,v,xyz);multiply(inv,xyz,rgb);
        img->r(y,x)=rgb[0]*65535.f;img->g(y,x)=rgb[1]*65535.f;img->b(y,x)=rgb[2]*65535.f;
    }
}
}}
