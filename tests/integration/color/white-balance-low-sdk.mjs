import {mkdir,writeFile,access,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
// The reference implementation is supplied locally by the reviewer. No SDK
// source, observer table, license text or resulting binary enters the repository.
const scratch=process.env.CAPTRAW_WB_LOW_SCRATCH,sdk=process.env.CAPTRAW_DNG_TEMPERATURE_DIR;
if(!scratch||!sdk)throw new Error('Set CAPTRAW_WB_LOW_SCRATCH and CAPTRAW_DNG_TEMPERATURE_DIR.');
for(const file of ['dng_temperature.cpp','dng_temperature.h','LICENSE.txt'])await access(join(sdk,file));
const out=join(resolve(scratch),'sdk-reference');await mkdir(out,{recursive:true});
const files={
 'dng_types.h':'#pragma once\n#include <cstdint>\nusing real64=double;using int32=int32_t;using uint32=uint32_t;\n',
 'dng_classes.h':'#pragma once\nclass dng_xy_coord;\n',
 'dng_xy_coord.h':'#pragma once\nstruct dng_xy_coord {double x=0,y=0;dng_xy_coord()=default;dng_xy_coord(double a,double b):x(a),y(b){}};\n',
 'dng_utils.h':'#pragma once\n#include <algorithm>\n#include "dng_types.h"\ninline double Pin_real64(double a,double x,double b){return std::clamp(x,a,b);}\ninline int32 Pin_int32(int32 a,int32 x,int32 b){return std::clamp(x,a,b);}\ninline double LerpReal64(double a,double b,double f){return a+(b-a)*f;}\ninline double SmoothStep(double x){x=std::clamp(x,0.,1.);return x*x*(3-2*x);}\n',
 'reference.cc':`#include ${JSON.stringify(join(resolve(sdk),'dng_temperature.h'))}
#include "dng_xy_coord.h"
#include <iostream>
#include <iomanip>
int main(){SetDNGEnableLowTemperatureLimit(true);InitExtendedTemperatureLUT();double t,g;
std::cout<<std::setprecision(17);
while(std::cin>>t>>g){dng_temperature value(t,g);const auto xy=value.Get_xy_coord();dng_temperature inverse(xy);std::cout<<t<<' '<<g<<' '<<xy.x<<' '<<xy.y<<' '<<inverse.Temperature()<<' '<<inverse.Tint()<<'\\n';}}
`
};
for(const [name,value] of Object.entries(files))await writeFile(join(out,name),value);
console.log('SDK_SOURCE_SHA256',createHash('sha256').update(await readFile(join(sdk,'dng_temperature.cpp'))).digest('hex'));
console.log('REFERENCE_COMPILE_ARGV',JSON.stringify(['clang++','-std=c++17','-O2','-I'+out,join(sdk,'dng_temperature.cpp'),join(out,'reference.cc'),'-o',join(out,'reference')]));
console.log('Reference preparation only: no compilation performed.');
