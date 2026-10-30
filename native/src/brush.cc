#include "brush.h"
#include "geometry-reference.h"
#include "source-frame.h"
#include "geometry-field.h"
#include "engine/color.h"
#include "engine/iccstore.h"
#include "engine/imagefloat.h"
#include <png.h>
#include <lcms2.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <set>
#include <stdexcept>

namespace art { namespace engine {
namespace {
using Json=nlohmann::json;
double number(const Json &j,const char *key,double low,double high) {
    if(!j.contains(key)||!j.at(key).is_number())throw std::runtime_error("Missing brush number");
    const double n=j.at(key);if(!std::isfinite(n)||n<low||n>high)throw std::runtime_error(std::string("Invalid brush ")+key);return n;
}
void identity(const Json &j,const char *key) {
    if(!j.at(key).is_string()||j.at(key).get<std::string>().empty()||j.at(key).get<std::string>().size()>128)
        throw std::runtime_error("Invalid brush stroke identity");
}
procparams::ExternalMask asset(const Json &r,int rotation) {
    procparams::ExternalMask m;m.enabled=true;m.captrawRaster=true;m.captrawUnitCoverage=true;m.captrawRotation=rotation;
    m.filename=r.at("path").get<std::string>();m.captrawSha256=r.at("sha256").get<std::string>();
    if(m.filename.empty()||m.captrawSha256.size()!=64||m.captrawSha256.find_first_not_of("0123456789abcdef")!=std::string::npos)
        throw std::runtime_error("Invalid brush coverage identity");
    for(const char *key:{"width","height"})if(!r.at(key).is_number_integer())throw std::runtime_error("Invalid brush coverage dimensions");
    m.captrawWidth=number(r,"width",1,65000);m.captrawHeight=number(r,"height",1,65000);
    if(int64_t(m.captrawWidth)*m.captrawHeight>512000000)throw std::runtime_error("Brush coverage exceeds 512 MP");
    return m;
}
void stroke(const Json &s,bool preparing) {
    identity(s,"id");identity(s,"gestureId");
    if(s.at("operation")!="paint"&&s.at("operation")!="erase")throw std::runtime_error("Invalid brush operation");
    number(s,"flow",0,100);number(s,"density",0,100);number(s,"feather",0,100);
    const auto &canvas=s.at("canvas");number(canvas,"width",1,65000);number(canvas,"height",1,65000);
    if(!canvas.at("width").is_number_integer()||!canvas.at("height").is_number_integer()||
       canvas.at("width").get<int64_t>()*canvas.at("height").get<int64_t>()>512000000)throw std::runtime_error("Invalid brush canvas");
    const auto &r=s.at("geometryReference");if(r.at("version")!=1&&r.at("version")!=2&&r.at("version")!=3)throw std::runtime_error("Invalid brush geometry version");
    const auto geometry=geometryReferenceParams(r.at("data").get<std::string>());
    if(r.at("version")==3)checkedRenderBinding(Json::parse(geometry.commonTrans.captrawSourceFrame).at("renderBinding"));
    else if(r.at("version")==2){
        checkedSourceFrame(Json::parse(geometry.commonTrans.captrawSourceFrame));
        if(hasRenderBinding(geometry))throw std::runtime_error("A brush binding requires reference version 3");
    }
    else if(!geometry.commonTrans.captrawSourceFrame.empty())throw std::runtime_error("A framed brush reference requires version 2");
    const auto &points=s.at("points");if(!points.is_array()||points.empty()||points.size()>65536)throw std::runtime_error("Invalid brush points");
    for(const auto &p:points){number(p,"x",0,1);number(p,"y",0,1);number(p,"radius",.001,5);if(p.contains("erase"))throw std::runtime_error("Brush operation belongs to its stroke");}
    const auto &a=s.at("autoMask");
    if(a!=false){
        if(!a.is_object()||a.at("model")!="art-deltae-seed-v1")throw std::runtime_error("Invalid AutoMask model");
        number(a,"tolerance",.25,20);
        if(!preparing){const auto &seed=a.at("seed");number(seed,"l",-1000,1000);number(seed,"c",0,1000);number(seed,"h",0,360);}
        if(!preparing&&!s.contains("coverage"))throw std::runtime_error("AutoMask requires frozen coverage");
    }
    if(s.contains("coverage")){
        const auto m=asset(s.at("coverage"),0);
        if(m.captrawWidth!=canvas.at("width")||m.captrawHeight!=canvas.at("height"))throw std::runtime_error("Brush coverage dimensions differ from authoring canvas");
    }
}
struct Dab {double x,y,radius;};
std::vector<Dab> dabs(const Json &s) {
    const auto &canvas=s.at("canvas");const double w=canvas.at("width"),h=canvas.at("height"),minimum=std::min(w,h);
    const auto point=[&](const Json &p){return Dab{p.at("x").get<double>()*w,p.at("y").get<double>()*h,p.at("radius").get<double>()*minimum*.25};};
    std::vector<Dab> out;Dab last=point(s.at("points").at(0));out.push_back(last);
    // Fixed authoring arc length, with the remainder carried across all events.
    double remaining=std::max(.25,last.radius*.2);
    for(size_t i=1;i<s.at("points").size();++i){
        const auto next=point(s.at("points")[i]);const double length=std::hypot(next.x-last.x,next.y-last.y);
        double travelled=0;
        while(length-travelled>=remaining){
            travelled+=remaining;const double t=travelled/length;
            Dab d{last.x+(next.x-last.x)*t,last.y+(next.y-last.y)*t,last.radius+(next.radius-last.radius)*t};out.push_back(d);
            if(out.size()>1000000)throw std::runtime_error("Brush stroke is too long");
            remaining=std::max(.25,d.radius*.2);
        }
        remaining-=length-travelled;last=next;
    }
    return out;
}
void unit(const Json &s,int width,int height,int rotation,array2D<float> &out,int ox=0,int oy=0,int roiWidth=-1,int roiHeight=-1) {
    const int ow=roiWidth<0?width:roiWidth,oh=roiHeight<0?height:roiHeight;
    out(ow,oh);out.fill(0.f);
    const double flow=s.at("flow").get<double>()/100.;if(flow==0)return;
    const double feather=s.at("feather").get<double>()/100.;
    const double cw=s.at("canvas").at("width"),ch=s.at("canvas").at("height");
    const bool swap=rotation%180;const double factor=std::min(width,height)/std::min(cw,ch);
    for(auto d:dabs(s)){
        Coord2D q=maskCanvasRotation({d.x/cw*(swap?height:width),d.y/ch*(swap?width:height)},swap?height:width,swap?width:height,rotation);
        const double r=d.radius*factor,inner=r*(1-feather),edge=std::max(.5,r-inner);
        const int x0=std::max(ox,int(std::floor(q.x-r-.5))),x1=std::min(ox+ow-1,int(std::ceil(q.x+r+.5)));
        const int y0=std::max(oy,int(std::floor(q.y-r-.5))),y1=std::min(oy+oh-1,int(std::ceil(q.y+r+.5)));
        for(int y=y0;y<=y1;++y)for(int x=x0;x<=x1;++x){
            const double t=std::max(0.,std::min(1.,(r+.5-std::hypot(x-q.x,y-q.y))/edge));
            const float alpha=flow*t*t*(3-2*t);auto &v=out[y-oy][x-ox];v+=(1-v)*alpha;
        }
    }
}
void blend(array2D<float> *m,const array2D<float> &s,float density,bool erase) {
    if(!m)return;
    for(int y=0;y<m->height();++y)for(int x=0;x<m->width();++x){
        auto &v=(*m)[y][x];const float amount=erase?std::max(0.f,v-(1-density)):std::max(0.f,density-v);
        v=std::max(0.f,std::min(1.f,v+(erase?-amount:amount)*s[y][x]));
    }
}
void lab(Imagefloat &rgb,int x,int y,const TMatrix &ws,float &l,float &a,float &b) {
    float r=rgb.r(y,x),g=rgb.g(y,x),blue=rgb.b(y,x);
    switch(rgb.mode()){
    case Imagefloat::Mode::RGB:Color::rgb2lab(r,g,blue,l,a,b,ws);break;
    case Imagefloat::Mode::YUV:Color::yuv2rgb(g,blue,r,r,g,blue,ws);Color::rgb2lab(r,g,blue,l,a,b,ws);break;
    case Imagefloat::Mode::XYZ:Color::XYZ2Lab(r,g,blue,l,a,b);break;
    case Imagefloat::Mode::LAB:l=g;a=r;b=blue;break;
    default:throw std::runtime_error("Unsupported AutoMask guide");
    }
    l/=32768.f;a/=42000.f;b/=42000.f;
}
void png16(const std::string &path,const array2D<float> &pixels,int rotation) {
    const bool swap=rotation%180;const int w=swap?pixels.height():pixels.width(),h=swap?pixels.width():pixels.height();
    FILE *file=std::fopen(path.c_str(),"wbx");if(!file)throw std::runtime_error("Cannot create brush coverage");
    auto *png=png_create_write_struct(PNG_LIBPNG_VER_STRING,nullptr,nullptr,nullptr);auto *info=png?png_create_info_struct(png):nullptr;
    if(!png||!info){if(png)png_destroy_write_struct(&png,nullptr);std::fclose(file);throw std::runtime_error("Cannot allocate brush PNG");}
    std::vector<png_byte> row(size_t(w)*2);
    if(setjmp(png_jmpbuf(png))){png_destroy_write_struct(&png,&info);std::fclose(file);std::remove(path.c_str());throw std::runtime_error("Cannot write brush coverage");}
    png_init_io(png,file);png_set_IHDR(png,info,w,h,16,PNG_COLOR_TYPE_GRAY,PNG_INTERLACE_NONE,PNG_COMPRESSION_TYPE_DEFAULT,PNG_FILTER_TYPE_DEFAULT);png_write_info(png,info);
    for(int y=0;y<h;++y){for(int x=0;x<w;++x){
        const auto q=maskSourceRotation({double(x),double(y)},w,h,rotation);
        const unsigned n=std::lround(std::max(0.f,std::min(1.f,pixels[int(q.y)][int(q.x)]))*65535.f);row[x*2]=n>>8;row[x*2+1]=n&255;
    }png_write_row(png,row.data());}
    png_write_end(png,info);png_destroy_write_struct(&png,&info);if(std::fclose(file))throw std::runtime_error("Cannot close brush coverage");
    std::ifstream encoded(path,std::ios::binary|std::ios::ate);
    if(!encoded||encoded.tellg()>std::streamoff(256ll*1024*1024)){std::remove(path.c_str());throw std::runtime_error("Brush coverage asset exceeds 256 MiB");}
}
}
bool loadBrushCoverage(const Glib::ustring &path,int width,int height,std::shared_ptr<array2D<float>> &out) {
    FILE *file=std::fopen(path.c_str(),"rb");if(!file)return false;
    auto *png=png_create_read_struct(PNG_LIBPNG_VER_STRING,nullptr,nullptr,nullptr);auto *info=png?png_create_info_struct(png):nullptr;
    if(!png||!info){if(png)png_destroy_read_struct(&png,nullptr,nullptr);std::fclose(file);return false;}
    struct Buffers {std::vector<png_byte> row;std::shared_ptr<array2D<float>> pixels;};
    const std::unique_ptr<Buffers> buffers(new Buffers);
    if(setjmp(png_jmpbuf(png))){png_destroy_read_struct(&png,&info,nullptr);std::fclose(file);return false;}
    png_init_io(png,file);png_read_info(png,info);
    if(png_get_image_width(png,info)!=unsigned(width)||png_get_image_height(png,info)!=unsigned(height)||
       png_get_bit_depth(png,info)!=16||png_get_color_type(png,info)!=PNG_COLOR_TYPE_GRAY||
       png_get_interlace_type(png,info)!=PNG_INTERLACE_NONE||
       png_get_valid(png,info,PNG_INFO_gAMA|PNG_INFO_sRGB|PNG_INFO_iCCP)){
        png_destroy_read_struct(&png,&info,nullptr);std::fclose(file);return false;
    }
    // One scalar plane and one scanline. Frozen coverage never needs an RGB
    // image, color management or an additional full-image conversion buffer.
    buffers->row.resize(size_t(width)*2);buffers->pixels=std::make_shared<array2D<float>>(width,height);
    for(int y=0;y<height;++y){png_read_row(png,buffers->row.data(),nullptr);for(int x=0;x<width;++x)(*buffers->pixels)[y][x]=float((unsigned(buffers->row[x*2])<<8)|buffers->row[x*2+1])/65535.f;}
    png_read_end(png,info);png_destroy_read_struct(&png,&info,nullptr);std::fclose(file);out=std::move(buffers->pixels);return true;
}
void validateBrushProgram(const Json &p,bool preparing) {
    if(!p.is_object()||p.at("version")!=1||!p.at("strokes").is_array()||p.at("strokes").size()>4096)throw std::runtime_error("Invalid brush program");
    std::set<std::string> ids;size_t count=0;
    for(const auto &s:p.at("strokes")){stroke(s,preparing);if(!ids.insert(s.at("id").get<std::string>()).second)throw std::runtime_error("Duplicate brush stroke");count+=s.at("points").size();}
    if(count>1000000)throw std::runtime_error("Too many brush points");
}
void brushProgramAssets(Json &p,const Json &replacements,bool validate,std::vector<std::string> &paths) {
    validateBrushProgram(p);
    for(auto &s:p.at("strokes"))if(s.contains("coverage")){
        auto &r=s.at("coverage");const auto path=r.at("path").get<std::string>();if(replacements.contains(path))r["path"]=replacements.at(path);
        auto m=asset(r,0);
        if(validate){std::shared_ptr<array2D<float>> pixels;if(!ExternalMaskManager::getInstance()->load_mask(m.filename,pixels,true,nullptr,&m))throw std::runtime_error("Frozen brush coverage is missing or changed");}
        if(std::find(paths.begin(),paths.end(),std::string(m.filename))==paths.end())paths.push_back(m.filename);
    }
}
void applyBrushProgram(const std::string &data,int rotation,bool legacyBase,int x,int y,int width,int height,double scale,
                       array2D<float> &guide,array2D<float> *lightness,array2D<float> *chroma,bool multithread,
                       ProgressListener *listener,const MaskGeometryResolver &resolve) {
    if(data.empty())return;auto p=Json::parse(data);validateBrushProgram(p);
    if(!legacyBase){if(lightness)lightness->fill(0.f);if(chroma)chroma->fill(0.f);}
    for(const auto &s:p.at("strokes")){
        procparams::Mask leaf;leaf.captrawGeometryReference=s.at("geometryReference").at("data");
        const auto *geometry=resolve?resolve(leaf):nullptr;
        array2D<float> coverage;
        if(s.contains("coverage")){
            const auto m=asset(s.at("coverage"),rotation);
            if(!ExternalMaskManager::getInstance()->apply_mask(m.filename,false,0,x,y,width,height,scale,guide,&coverage,multithread,listener,&m,geometry))throw std::runtime_error("Cannot replay frozen brush coverage");
        }else if(geometry){
            array2D<float> author;unit(s,geometry->referenceWidth(),geometry->referenceHeight(),rotation,author);coverage(guide.width(),guide.height());
            geometry->warp(author,{0,0},coverage,{double(x),double(y)},multithread);
        }else{
            unit(s,width,height,rotation,coverage,x,y,guide.width(),guide.height());
        }
        const float density=s.at("density").get<float>()/100;const bool erase=s.at("operation")=="erase";
        blend(lightness,coverage,density,erase);if(chroma!=lightness)blend(chroma,coverage,density,erase);
    }
}
Json prepareBrushCoverage(const Json &s,Imagefloat &guide,int rotation,const std::string &output) {
    validateBrushProgram({{"version",1},{"strokes",Json::array({s})}},true);
    if(s.at("autoMask")==false)throw std::runtime_error("Frozen coverage requires AutoMask");
    const int w=guide.getWidth(),h=guide.getHeight();if(w>65000||h>65000||int64_t(w)*h>512000000)throw std::runtime_error("Brush coverage exceeds 512 MP");
    array2D<float> coverage;unit(s,w,h,rotation,coverage);
    const auto &first=s.at("points").at(0);const bool swap=rotation%180;
    auto q=maskCanvasRotation({first.at("x").get<double>()*(swap?h:w),first.at("y").get<double>()*(swap?w:h)},swap?h:w,swap?w:h,rotation);
    const int sx=std::max(0,std::min(w-1,int(std::lround(q.x)))),sy=std::max(0,std::min(h-1,int(std::lround(q.y))));
    float l,c,hue;if(!getDeltaEColorRegion(&guide,std::max(0,sx-2),std::max(0,sy-2),std::min(w-1,sx+2),std::min(h-1,sy+2),l,c,hue))throw std::runtime_error("Cannot sample AutoMask seed");
    const double radians=hue*3.141592653589793/180.;cmsCIELab seed{l*100,c*std::cos(radians)*100,c*std::sin(radians)*100};
    const auto ws=ICCStore::getInstance()->workingSpaceMatrix(guide.colorSpace());const double range=s.at("autoMask").at("tolerance");
    for(int y=0;y<h;++y)for(int x=0;x<w;++x)if(coverage[y][x]>0){
        float ll,a,b;lab(guide,x,y,ws,ll,a,b);cmsCIELab current{ll*100,a*100,b*100};
        const double d=cmsCIE2000DeltaE(&seed,&current,2.,100./75.,1.);
        const double gate=!std::isfinite(d)?0:d<=range*.4?1:d>=range*5?0:1-1/(1+100*std::exp(-1.5*(d-range)));
        coverage[y][x]*=gate;
    }
    png16(output,coverage,rotation);
    return {{"width",swap?h:w},{"height",swap?w:h},{"seed",{{"l",l*100},{"c",c*100},{"h",hue},{"point",{{"x",first.at("x")},{"y",first.at("y")}}}}}};
}
}} // namespace art::engine
