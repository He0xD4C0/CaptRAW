// Robertson table and inverse projection adapted from ART src/engine/dcp.cc,
// Copyright (c) 2012 Oliver Duis; GPL-3.0-or-later. See THIRD_PARTY.md.
#include "white-balance.h"
#include "engine/iccmatrices.h"
#include "engine/iccstore.h"
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
namespace {
std::array<double,2> legacyXY(double temperature,double tint){
 const double r=1e6/temperature;int i=0;while(i<29&&table[i+1].mired<r)++i;
 const auto uv=uvAt(i,(r-table[i].mired)/(table[i+1].mired-table[i].mired),tint);
 const double d=uv[0]-4*uv[1]+2;return {1.5*uv[0]/d,uv[1]/d};
}
std::array<double,2> legacyTemperatureTint(const std::array<double,2> &xy){
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
// A physical chromaticity correction to the legacy locus, independent of tint.
// Cubic Hermite weighting reaches zero with zero slope at the unchanged 2000 K edge.
std::array<double,2> lowOffset(double temperature){
 if(temperature>=2000)return {0,0};
 const auto physical=ae::ColorTemp::captrawPlanckXY(temperature),legacy=legacyXY(temperature,0);
 const double t=std::clamp((2000-temperature)/333.,0.,1.),weight=t*t*(3-2*t);
 return {weight*(physical[0]-legacy[0]),weight*(physical[1]-legacy[1])};
}
struct LowProjection {double distance,tint;};
LowProjection lowProjection(const std::array<double,2> &xy,double temperature){
 const auto offset=lowOffset(temperature);const double x=xy[0]-offset[0],y=xy[1]-offset[1],divisor=1.5-x+6*y;
 const double u=2*x/divisor,v=3*y/divisor,r=1e6/temperature;int i=0;while(i<29&&table[i+1].mired<r)++i;
 const double weight=(r-table[i].mired)/(table[i+1].mired-table[i].mired);
 const auto a=direction(table[i]),b=direction(table[i+1]),base=uvAt(i,weight,0);
 const double du=a[0]*(1-weight)+b[0]*weight,dv=a[1]*(1-weight)+b[1]*weight,n=std::hypot(du,dv);
 return {(-(u-base[0])*dv+(v-base[1])*du)/n,-3000*((u-base[0])*du+(v-base[1])*dv)/n};
}
}
std::array<double,2> whiteBalanceXY(double temperature,double tint){
 if(!std::isfinite(temperature)||temperature<1500||temperature>50000||!std::isfinite(tint)||tint<-150||tint>150)throw std::runtime_error("白平衡范围为 1500–50000 K、色调 -150–150。");
 if(temperature>=2000)return legacyXY(temperature,tint);
 const auto xy=legacyXY(temperature,tint),offset=lowOffset(temperature);return {xy[0]+offset[0],xy[1]+offset[1]};
}
std::array<double,2> whiteBalanceTemperatureTint(const std::array<double,2> &xy){
 const double divisor=1.5-xy[0]+6*xy[1],u=2*xy[0]/divisor,v=3*xy[1]/divisor;
 const auto edge=direction(table[26]);
 // On/above the legacy edge keep the original projection, including its rounding.
 if(-(u-table[26].u)*edge[1]+(v-table[26].v)*edge[0]<=1e-12)return legacyTemperatureTint(xy);
 // Leave a small physical projection margin for camera estimates below the UI floor.
 double lo=1400,hi=2000;auto a=lowProjection(xy,lo),b=lowProjection(xy,hi);
 if(a.distance*b.distance>0)return legacyTemperatureTint(xy);
 // Each candidate temperature defines a tint line after subtracting its physical
 // offset. Solve the perpendicular residual rather than extrapolating the locus.
 for(int iteration=0;iteration<48;++iteration){
  const double mid=(lo+hi)*.5;const auto value=lowProjection(xy,mid);
  if(a.distance*value.distance<=0){hi=mid;b=value;}else{lo=mid;a=value;}
 }
 const double temperature=(lo+hi)*.5;return {temperature,lowProjection(xy,temperature).tint};
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
namespace {
// ART-ctlscripts wbchmix.ctl get_wb_matrix and _artlib.ctl temp_tint_to_xy,
// Copyright 2023 Alberto Griggio, GPL-3.0-or-later, revision
// 958935312489710b17dc4792d0677bdacf43a95c. This is not Adobe's pixel algorithm.
std::array<double,3> relativeWhite(double kelvin,double tint){
 const auto xy=[](double t){
  const double v=1000./t,v2=v*v,v3=v2*v;
  const double x=t<=4000?-.2661239*v3-.2343589*v2+.8776956*v+.179910:-3.0258469*v3+2.1070379*v2+.2226347*v+.24039;
  const double x2=x*x,x3=x2*x;
  const double y=t<=2222?-1.1063814*x3-1.34811020*x2+2.18555832*x-.20219683:t<=4000?-.9549476*x3-1.37418593*x2+2.09137015*x-.16748867:3.0817580*x3-5.87338670*x2+3.75112997*x-.37001483;
  return std::array<double,2>{x,y};
 };
 auto p=xy(kelvin);const auto hi=xy(kelvin-100);
 const double angle=std::atan(-(hi[0]-p[0])/(hi[1]-p[1]));
 p[0]+=std::cos(angle)*tint;p[1]+=std::sin(angle)*tint;
 return {p[0]/p[1],1,(1-p[0]-p[1])/p[1]};
}
std::array<double,3> relativeGains(double temperature,double tint){
 if(!std::isfinite(temperature)||!std::isfinite(tint)||temperature< -100||temperature>100||tint< -100||tint>100)throw std::runtime_error("相对白平衡范围为 -100–100。");
 if(temperature==0&&tint==0)return {1,1,1};
 // Public relative Tint increases toward magenta; negating this locus offset
 // reversed the independently measured green/magenta response.
 const auto ref=relativeWhite(5000,0),white=relativeWhite(5000-(temperature>0?20:50)*temperature,tint/1000.);
 auto *store=ae::ICCStore::getInstance();const auto inv=store->workingSpaceInverseMatrix("Rec2020"),work=store->workingSpaceMatrix("Rec2020");
 std::array<double,3> gains{};
 for(int r=0;r<3;++r){double a=0,b=0;for(int c=0;c<3;++c){a+=inv[r][c]*white[c];b+=inv[r][c]*ref[c];}gains[r]=a/b;}
 const double luminance=work[1][0]*gains[0]+work[1][1]*gains[1]+work[1][2]*gains[2];
 for(double &v:gains){v/=luminance;if(!std::isfinite(v))throw std::runtime_error("此相对白平衡组合超出 ART 矩阵的有效范围。");}
 return gains;
}
}
std::array<double,9> relativeWhiteBalanceMatrix(double temperature,double tint,const Glib::ustring &workingSpace){
 const auto gains=relativeGains(temperature,tint);std::array<double,9> result{};
 if(temperature==0&&tint==0){result[0]=result[4]=result[8]=1;return result;}
 auto *s=ae::ICCStore::getInstance();const auto ws=s->workingSpaceMatrix(workingSpace),inv=s->workingSpaceInverseMatrix(workingSpace),rec=s->workingSpaceMatrix("Rec2020"),ri=s->workingSpaceInverseMatrix("Rec2020");
 for(int r=0;r<3;++r)for(int c=0;c<3;++c)for(int i=0;i<3;++i)for(int j=0;j<3;++j)for(int k=0;k<3;++k)result[r*3+c]+=inv[r][i]*rec[i][j]*gains[j]*ri[j][k]*ws[k][c];
 return result;
}
std::array<double,3> solveRelativeWhiteBalance(const std::array<double,3> &mean){
 for(double v:mean)if(!std::isfinite(v)||v<=0)throw std::runtime_error("此区域没有可用于相对白平衡的有效颜色。");
 const auto error=[&](double t,double tint){
  try{const auto g=relativeGains(t,tint);if(g[0]<=0||g[1]<=0||g[2]<=0)return HUGE_VAL;const double r=std::log(g[0]*mean[0]/(g[1]*mean[1])),b=std::log(g[2]*mean[2]/(g[1]*mean[1]));return r*r+b*b;}catch(const std::runtime_error &){return HUGE_VAL;}
 };
 double t=0,tint=0,best=error(0,0);
 for(int a=-100;a<=100;a+=20)for(int b=-100;b<=100;b+=20){const auto e=error(a,b);if(e<best){best=e;t=a;tint=b;}}
 for(double step=10;step>=.015625;step*=.5){
  for(int iteration=0;iteration<32;++iteration){double nt=t,ng=tint;
   for(int a=-1;a<=1;++a)for(int b=-1;b<=1;++b){const double x=t+a*step,y=tint+b*step;if(x< -100||x>100||y< -100||y>100)continue;const auto e=error(x,y);if(e<best){best=e;nt=x;ng=y;}}
   if(nt==t&&ng==tint)break;t=nt;tint=ng;
  }
 }
 const double rt=std::round(t),rg=std::round(tint);best=HUGE_VAL;
 for(int a=-1;a<=1;++a)for(int b=-1;b<=1;++b){const double x=rt+a,y=rg+b;if(x< -100||x>100||y< -100||y>100)continue;const auto e=error(x,y);if(e<best){best=e;t=x;tint=y;}}
 if(!std::isfinite(best)||std::sqrt(best)>.025)throw std::runtime_error("此颜色超出相对白平衡可中和范围，请选择较中性的区域。");
 return {t,tint,std::sqrt(best)};
}
}
