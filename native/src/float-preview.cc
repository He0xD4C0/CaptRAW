#include "float-preview.h"
#include "engine/imagefloat.h"
#include "engine/improcfun.h"
#include "engine/iccstore.h"
#include "engine/halffloat.h"
#include <cmath>
#include <algorithm>
#include <fstream>
#include <memory>
#include <stdexcept>
namespace captraw {
namespace ae=art::engine;
LinearPixels linearPixels(ae::Imagefloat &source,const ae::procparams::ColorManagementParams &profile,int x,int y,int width,int height)
{
    if(x<0||y<0||width<1||height<1||x+width>source.getWidth()||y+height>source.getHeight())throw std::runtime_error("Invalid float preview region");
    ae::procparams::ProcParams params;params.icm=profile;
    params.icm.outputProfile="RTv4_Linear_Rec709";params.icm.outputBPC=false;
    if(!ae::ICCStore::getInstance()->getProfile(params.icm.outputProfile))throw std::runtime_error("Linear preview ICC is unavailable");
    // Only copy the delivered region, never change ART's cached image mode or pixels.
    source.syncCpu();ae::Imagefloat cropped(width,height,&source);
    for(int row=0;row<height;++row)for(int col=0;col<width;++col){cropped.r(row,col)=source.r(y+row,x+col);cropped.g(row,col)=source.g(y+row,x+col);cropped.b(row,col)=source.b(y+row,x+col);}
    ae::ImProcFunctions color(&params);color.setPipeline(ae::ImProcFunctions::Pipeline::OUTPUT);
    std::unique_ptr<ae::Imagefloat> linear(color.rgb2out(&cropped,params.icm));
    LinearPixels result{width,height,std::vector<uint16_t>(size_t(width)*height*4)};
    for(int row=0;row<height;++row)for(int col=0;col<width;++col){
        const float values[]={linear->r(row,col),linear->g(row,col),linear->b(row,col)};
        for(int c=0;c<3;++c){const float value=values[c]/65535.f;if(!std::isfinite(value)||std::abs(value)>65504.f)throw std::runtime_error("Float preview contains unrepresentable pixels");result.rgba[(size_t(row)*width+col)*4+c]=ae::DNG_FloatToHalf(value);}
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
