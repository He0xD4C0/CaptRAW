// Robertson table and inverse projection adapted from ART src/engine/dcp.cc,
// Copyright (c) 2012 Oliver Duis; GPL-3.0-or-later. See THIRD_PARTY.md.
#include "white-balance.h"
#include "engine/iccmatrices.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
namespace captraw {
namespace ae=art::engine;
namespace {
struct Row {double mired,u,v,slope;};
constexpr Row table[]={
 {0,.18006,.26352,-.24341},{10,.18066,.26589,-.25479},{20,.18133,.26846,-.26876},
 {30,.18208,.27119,-.28539},{40,.18293,.27407,-.30470},{50,.18388,.27709,-.32675},
 {60,.18494,.28021,-.35156},{70,.18611,.28342,-.37915},{80,.18740,.28668,-.40955},
 {90,.18880,.28997,-.44278},{100,.19032,.29326,-.47888},{125,.19462,.30141,-.58204},
 {150,.19962,.30921,-.70471},{175,.20525,.31647,-.84901},{200,.21142,.32312,-1.0182},
 {225,.21807,.32909,-1.2168},{250,.22511,.33439,-1.4512},{275,.23247,.33904,-1.7298},
 {300,.24010,.34308,-2.0637},{325,.24702,.34655,-2.4681},{350,.25591,.34951,-2.9641},
 {375,.26400,.35200,-3.5814},{400,.27218,.35407,-4.3633},{425,.28039,.35577,-5.3762},
 {450,.28863,.35714,-6.7262},{475,.29685,.35823,-8.5955},{500,.30505,.35907,-11.324},
 {525,.31320,.35968,-15.628},{550,.32129,.36011,-23.325},{575,.32931,.36038,-40.770},
 {600,.33724,.36051,-116.45}
};
// Preserve the pinned ART/DNG table (including its 325-mired entry).
std::array<double,2> direction(const Row &r){const double n=std::hypot(1.,r.slope);return {1/n,r.slope/n};}
std::array<double,2> uvAt(int i,double weight,double tint){
 const auto &a=table[i],&b=table[i+1];const auto da=direction(a),db=direction(b);
 const double du=da[0]*(1-weight)+db[0]*weight,dv=da[1]*(1-weight)+db[1]*weight,n=std::hypot(du,dv);
 return {a.u*(1-weight)+b.u*weight-du/n*tint/3000.,a.v*(1-weight)+b.v*weight-dv/n*tint/3000.};
}
void validate(const std::array<double,3> &m){for(double v:m)if(!std::isfinite(v)||v<=0||v>100)throw std::runtime_error("此白平衡超出当前相机可用范围，请降低色偏后重试。");}
}
std::array<double,2> whiteBalanceXY(double temperature,double tint){
 if(!std::isfinite(temperature)||temperature<2000||temperature>50000||!std::isfinite(tint)||tint<-150||tint>150)throw std::runtime_error("白平衡范围为 2000–50000 K、色调 -150–150。");
 const double r=1e6/temperature;int i=0;while(i<29&&table[i+1].mired<r)++i;
 const auto uv=uvAt(i,(r-table[i].mired)/(table[i+1].mired-table[i].mired),tint);
 const double d=uv[0]-4*uv[1]+2;return {1.5*uv[0]/d,uv[1]/d};
}
std::array<double,2> whiteBalanceTemperatureTint(const std::array<double,2> &xy){
 const double divisor=1.5-xy[0]+6*xy[1],u=2*xy[0]/divisor,v=3*xy[1]/divisor;
 double previous=0;
 for(int i=1;i<31;++i){
  const auto d=direction(table[i]);const double distance=-(u-table[i].u)*d[1]+(v-table[i].v)*d[0];
  if(distance<=0||i==30){
   const double below=std::max(0.,-distance),weight=i==1?1:previous/(previous+below);
   const auto base=uvAt(i-1,weight,0),a=direction(table[i-1]);
   const double du=a[0]*(1-weight)+d[0]*weight,dv=a[1]*(1-weight)+d[1]*weight;
   return {1e6/(table[i-1].mired*(1-weight)+table[i].mired*weight),-3000*((u-base[0])*du+(v-base[1])*dv)/std::hypot(du,dv)};
  }
  previous=distance;
 }
 throw std::runtime_error("无法计算白平衡坐标。");
}
std::array<double,3> whiteBalanceMultipliers(ae::ImageSource *source,const ae::procparams::ColorManagementParams &profile,double temperature,double tint){
 const auto xy=whiteBalanceXY(temperature,tint);const std::array<double,3> xyz{xy[0]/xy[1],1,(1-xy[0]-xy[1])/xy[1]};
 ae::DCPProfile::ApplyState state;std::array<double,3> m{};
 const bool embeddedICC=profile.inputProfile=="(embedded)"&&source->getEmbeddedProfile();
 if(auto *dcp=embeddedICC?nullptr:source->getDCP(profile,state)){
  const auto matrix=dcp->findXyztoCamera(xy,profile.dcpIlluminant,0);
  for(int i=0;i<3;++i)m[i]=1/(matrix[i][0]*xyz[0]+matrix[i][1]*xyz[1]+matrix[i][2]*xyz[2]);
  m[0]/=m[1];m[2]/=m[1];m[1]=1;
 }else{
  for(int i=0;i<3;++i)for(int j=0;j<3;++j)m[i]+=ae::sRGBd65_xyz[i][j]*xyz[j];
  source->wbMul2Camera(m[0],m[1],m[2]);
 }
 validate(m);return m;
}
std::array<double,2> whiteBalanceCoordinates(ae::ImageSource *source,const ae::procparams::ColorManagementParams &profile,const std::array<double,3> &multipliers){
 validate(multipliers);ae::DCPProfile::ApplyState state;std::array<double,2> xy;
 const bool embeddedICC=profile.inputProfile=="(embedded)"&&source->getEmbeddedProfile();
 if(auto *dcp=embeddedICC?nullptr:source->getDCP(profile,state)){
  xy=dcp->neutralToXy({1/multipliers[0],1/multipliers[1],1/multipliers[2]},profile.dcpIlluminant,0);
 }else{
  auto m=multipliers;source->wbCamera2Mul(m[0],m[1],m[2]);std::array<double,3> xyz{};
  for(int i=0;i<3;++i)for(int j=0;j<3;++j)xyz[i]+=ae::xyz_sRGBd65[i][j]*m[j];
  const double sum=xyz[0]+xyz[1]+xyz[2];xy={xyz[0]/sum,xyz[1]/sum};
 }
 return whiteBalanceTemperatureTint(xy);
}
}
