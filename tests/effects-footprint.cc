#include "effects.h"
#include <cassert>
#include <fstream>
#include <string>
#include <vector>
int main(int argc,char **argv){
 assert(argc==4);const std::string out=argv[1];const double size=std::stod(argv[2]),rough=std::stod(argv[3]);
 constexpr int width=3072,height=2048;
 const auto write=[&](const std::string &name,const std::vector<float> &v){std::ofstream f(out+"/"+name,std::ios::binary);f.write(reinterpret_cast<const char *>(v.data()),v.size()*sizeof(float));assert(f.good());};
 std::vector<float> full(width*height);
 for(int y=0;y<height;++y)for(int x=0;x<width;++x){
  const double n=captraw::effects::grain(x+.5,y+.5,size,rough);
  assert(n==captraw::effects::grainFootprint(x+.5,y+.5,size,rough,1));
  full[y*width+x]=float(n);
 }
 write("full.f32",full);
 for(int skip:{2,4,8}){
  const int w=width/skip,h=height/skip;std::vector<float> old(w*h),fit(w*h);
  for(int y=0;y<h;++y)for(int x=0;x<w;++x){
   const double px=(x+.5)*skip,py=(y+.5)*skip;
   old[y*w+x]=float(captraw::effects::grain(px,py,size,rough));
   fit[y*w+x]=float(captraw::effects::grainFootprint(px,py,size,rough,skip));
  }
  write("old-"+std::to_string(skip)+".f32",old);write("fit-"+std::to_string(skip)+".f32",fit);
 }
 // Offset detail coordinates must address the same full-resolution texture.
 for(int y=0;y<64;++y)for(int x=0;x<64;++x){const int ox=731,oy=543;
  assert(float(captraw::effects::grainFootprint(x+ox+.5,y+oy+.5,size,rough,1))==full[(y+oy)*width+x+ox]);
 }
 // Non-integral footprint: compare against explicit source-texel overlap, not
 // a normalization by sample count that changes edge weights.
 const double a=captraw::effects::grainFootprint(101.25,72.75,size,rough,2.5);
 double reference=0;for(int y=71;y<74;++y)for(int x=100;x<103;++x){
  const double wx=x==102?.5:1.,wy=y==71?.5:1.;reference+=wx*wy*captraw::effects::grain(x+.5,y+.5,size,rough);
 }
 assert(std::abs(a-reference/6.25)<1e-12);
}
