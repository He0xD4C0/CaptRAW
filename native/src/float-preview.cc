#include "float-preview.h"
#include "engine/imagefloat.h"
#include "engine/improcfun.h"
#include "engine/iccstore.h"
#include "engine/halffloat.h"
#include <lcms2.h>
#include <cmath>
#include <algorithm>
#include <fstream>
#include <memory>
#include <stdexcept>
namespace captraw {
namespace ae=art::engine;
static const char *outputProfileName(const std::string &space)
{
    const std::pair<const char*,const char*> profiles[]={{"srgb","RTv4_sRGB"},{"adobe-rgb","RTv4_Medium"},{"prophoto-rgb","RTv4_Large"},{"display-p3","RTv4_DisplayP3"},{"rec2020","RTv4_Rec2020"}};
    const auto found=std::find_if(std::begin(profiles),std::end(profiles),[&](const auto &value){return space==value.first;});
    if(found==std::end(profiles))throw std::runtime_error("Unsupported output preview color space");
    return found->second;
}
LinearPixels linearPixels(ae::Imagefloat &source,const ae::procparams::ColorManagementParams &profile,int x,int y,int width,int height,const std::string &colorSpace,const std::string &outputPreview)
{
    if(x<0||y<0||width<1||height<1||x+width>source.getWidth()||y+height>source.getHeight())throw std::runtime_error("Invalid float preview region");
    ae::procparams::ProcParams params;params.icm=profile;
    params.icm.outputProfile="RTv4_Linear_Rec709";params.icm.outputBPC=false;
    // Only copy the delivered region, never change ART's cached image mode or pixels.
    source.syncCpu();ae::Imagefloat cropped(width,height,&source);
    for(int row=0;row<height;++row)for(int col=0;col<width;++col){cropped.r(row,col)=source.r(y+row,x+col);cropped.g(row,col)=source.g(y+row,x+col);cropped.b(row,col)=source.b(y+row,x+col);}
    std::unique_ptr<ae::Imagefloat> linear;
    if(colorSpace=="display-p3-linear"||colorSpace=="display-p3"){
        // Display P3 uses D65 and P3 primaries; its transport here is linear.
        // LittleCMS handles PCS chromatic adaptation. No display-device profile
        // or integer intermediate enters this conversion.
        const cmsCIExyY white={.3127,.3290,1.};
        const cmsCIExyYTRIPLE primaries={{.680,.320,1.},{.265,.690,1.},{.150,.060,1.}};
        std::unique_ptr<cmsToneCurve,decltype(&cmsFreeToneCurve)> curve(cmsBuildGamma(nullptr,1.),cmsFreeToneCurve);
        if(!curve)throw std::runtime_error("Cannot create linear P3 transfer curve");
        cmsToneCurve *curves[]={curve.get(),curve.get(),curve.get()};
        std::unique_ptr<void,decltype(&cmsCloseProfile)> output(cmsCreateRGBProfile(&white,&primaries,curves),cmsCloseProfile);
        if(!output)throw std::runtime_error("Cannot create linear Display P3 profile");
        cropped.setMode(ae::Imagefloat::Mode::RGB,false);
        auto *sourceProfile=ae::ICCStore::getInstance()->workingSpace(cropped.colorSpace());
        auto *proofProfile=outputPreview.empty()?sourceProfile:ae::ICCStore::getInstance()->getProfile(outputProfileName(outputPreview));
        if(!proofProfile)throw std::runtime_error("Output preview ICC is unavailable");
        std::unique_ptr<void,decltype(&cmsDeleteTransform)> transform(cmsCreateTransform(
            sourceProfile,TYPE_RGB_FLT,outputPreview.empty()?output.get():proofProfile,TYPE_RGB_FLT,INTENT_RELATIVE_COLORIMETRIC,
            cmsFLAGS_NOOPTIMIZE|cmsFLAGS_NOCACHE|(outputPreview.empty()?0:cmsFLAGS_BLACKPOINTCOMPENSATION)),cmsDeleteTransform);
        if(!transform)throw std::runtime_error("Cannot create float Display P3 transform");
        if(outputPreview.empty()){
            linear=std::make_unique<ae::Imagefloat>(width,height,&cropped);
            linear->ExecCMSTransform(transform.get(),&cropped,true);
        }else{
            ae::Imagefloat target(width,height,&cropped);
            target.ExecCMSTransform(transform.get(),&cropped,true);
            for(int row=0;row<height;++row)for(int col=0;col<width;++col){
                target.r(row,col)=std::clamp(target.r(row,col),0.f,65535.f);
                target.g(row,col)=std::clamp(target.g(row,col),0.f,65535.f);
                target.b(row,col)=std::clamp(target.b(row,col),0.f,65535.f);
            }
            std::unique_ptr<void,decltype(&cmsDeleteTransform)> display(cmsCreateTransform(
                proofProfile,TYPE_RGB_FLT,output.get(),TYPE_RGB_FLT,INTENT_RELATIVE_COLORIMETRIC,
                cmsFLAGS_NOOPTIMIZE|cmsFLAGS_NOCACHE),cmsDeleteTransform);
            if(!display)throw std::runtime_error("Cannot create output preview display transform");
            linear=std::make_unique<ae::Imagefloat>(width,height,&target);
            linear->ExecCMSTransform(display.get(),&target,true);
        }
    }else if(colorSpace=="rec709-linear"){
    if(!ae::ICCStore::getInstance()->getProfile(params.icm.outputProfile))throw std::runtime_error("Linear preview ICC is unavailable");
        ae::ImProcFunctions color(&params);color.setPipeline(ae::ImProcFunctions::Pipeline::OUTPUT);
        linear.reset(color.rgb2out(&cropped,params.icm));
    }else throw std::runtime_error("Unsupported float preview color space");
    LinearPixels result{width,height,std::vector<uint16_t>(size_t(width)*height*4)};
    for(int row=0;row<height;++row)for(int col=0;col<width;++col){
        const float values[]={linear->r(row,col),linear->g(row,col),linear->b(row,col)};
        for(int c=0;c<3;++c){float value=values[c]/65535.f;if(colorSpace=="display-p3"){const float magnitude=std::abs(value);value=std::copysign(magnitude<=.0031308f?12.92f*magnitude:1.055f*std::pow(magnitude,1.f/2.4f)-.055f,value);}if(!std::isfinite(value)||std::abs(value)>65504.f)throw std::runtime_error("Float preview contains unrepresentable pixels");result.rgba[(size_t(row)*width+col)*4+c]=ae::DNG_FloatToHalf(value);}
        result.rgba[(size_t(row)*width+col)*4+3]=0x3c00;
    }
    return result;
}
void writeLinearPixels(const LinearPixels &image,const std::string &file,int x,int y,int width,int height)
{
    if(x<0||y<0||width<1||height<1||x+width>image.width||y+height>image.height)throw std::runtime_error("Invalid float preview window");
    std::ofstream output(file,std::ios::binary);std::vector<unsigned char> row(size_t(width)*8);
    for(int iy=0;iy<height;++iy){for(int i=0;i<width*4;++i){const auto value=image.rgba[(size_t(y+iy)*image.width+x)*4+i];row[i*2]=value&255;row[i*2+1]=value>>8;}output.write(reinterpret_cast<const char *>(row.data()),row.size());}
    output.close();if(!output)throw std::runtime_error("Cannot write float preview");
}
HDRHistogram linearHistogram(const LinearPixels &image,int x,int y,int width,int height,double headroom)
{
    HDRHistogram result;const double peak=std::exp2(headroom);
    for(int row=y;row<y+height;++row)for(int col=x;col<x+width;++col)for(int c=0;c<3;++c){
        const double value=ae::DNG_HalfToFloat(image.rgba[(size_t(row)*image.width+col)*4+c]);
        result.below[c]+=value<0;result.above[c]+=value>peak;
        const double positive=std::max(0.,value);
        // Left half is encoded SDR; right half is logarithmic EV above white.
        const double coordinate=positive<1.?.5*(positive<=.0031308?12.92*positive:1.055*std::pow(positive,1./2.4)-.055):.5+.5*std::log2(positive)/headroom;
        ++result.bins[c][std::clamp(int(std::floor(coordinate*512)),0,511)];
    }
    return result;
}
}
