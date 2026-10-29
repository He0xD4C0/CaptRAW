#include "effects.h"
#include <cassert>
#include <iostream>
int main(){
 using namespace captraw::effects;
 double small=0,large=0,uniform2=0,uniform4=0,rough2=0,rough4=0;
 for(int y=0;y<160;++y)for(int x=0;x<160;++x){
  double a=grain(x+.5,y+.5,25,0),b=grain(x+.5,y+.5,25,100);
  assert(std::isfinite(a)&&std::isfinite(b));assert(a==grain(x+.5,y+.5,25,0));
  small+=std::pow(grain(x+.5,y+.5,5,50)-grain(x+1.5,y+.5,5,50),2);
  large+=std::pow(grain(x+.5,y+.5,95,50)-grain(x+1.5,y+.5,95,50),2);
  uniform2+=a*a;uniform4+=a*a*a*a;rough2+=b*b;rough4+=b*b*b*b;
 }
 assert(large<small*.25);assert(rough4/(rough2*rough2)>uniform4/(uniform2*uniform2)*1.5);
 assert(coverage(50,50,100,100,50,0,50)==0);
 assert(coverage(10,50,100,100,20,0,50)>coverage(10,50,100,100,80,0,50));
 assert(coverage(25,25,100,100,50,-100,50)!=coverage(25,25,100,100,50,100,50));
 double original[]={.2,.4,.8},color[]={.2,.4,.8},paint[]={.2,.4,.8},highlight[]={.2,.4,.8};
 vignette(color,1,-70,2,0);vignette(paint,1,-70,3,0);vignette(highlight,1,-70,1,0);
 assert(std::abs(color[0]/color[1]-.5)<1e-12);assert(std::abs(color[1]/color[2]-.5)<1e-12);
 for(int c=0;c<3;++c){assert(highlight[c]>0&&highlight[c]<original[c]);assert(paint[c]<original[c]);}
 assert(std::abs(highlight[0]/highlight[1]-.5)>.01);
 double bright[]={.9,.9,.9},protectedBright[]={.9,.9,.9};vignette(bright,1,-70,1,0);vignette(protectedBright,1,-70,1,100);assert(protectedBright[0]>bright[0]);
 double neutral[]={-.1,1,4};vignette(neutral,1,0,1,100);assert(neutral[0]==-.1&&neutral[2]==4);
 std::cout<<"grain-size, roughness kurtosis, deterministic field, crop shape, midpoint, hue, paint, highlight protection, neutral HDR: passed\n";
}
