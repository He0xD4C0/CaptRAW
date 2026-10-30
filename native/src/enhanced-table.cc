// C++ adaptation of RAWmakase's enhanced.rs, rgb_table.rs and mod.rs.
// Pinned source and SHA-256: native/config/enhanced-profile-sources.json.
// Copyright (c) 2026 RAWmakase contributors. MIT: native/config/enhanced-profile.LICENSE.
#include "enhanced-table.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <glib.h>
#include <zlib.h>

namespace captraw::enhanced {
namespace {
void require(bool valid,const char *message){if(!valid)throw std::runtime_error(message);}
float pin(float x,float lo=0,float hi=1){return std::clamp(x,lo,hi);}
float fract(float x){return x-std::floor(x);}
float srgbEncode(float v){return v<=0.0031308f?12.92f*v:1.055f*std::pow(v,1.f/2.4f)-0.055f;}
float srgbDecode(float v){return v<=0.04045f?v/12.92f:std::pow((v+0.055f)/1.055f,2.4f);}
float gammaEncode(float v,uint32_t code){
    switch(code){
    case 0:return v;
    case 1:return srgbEncode(v);
    case 2:return std::pow(v,1.f/1.8f);
    case 3:return std::pow(v,1.f/2.2f);
    case 4:return v<0.01805397f?4.5f*v:1.0992968f*std::pow(v,0.45f)-(1.0992968f-1.f);
    default:throw std::runtime_error("不支持的 RGB 表编码。");
    }
}
float gammaDecode(float v,uint32_t code){
    switch(code){
    case 0:return v;
    case 1:return srgbDecode(v);
    case 2:return std::pow(v,1.8f);
    case 3:return std::pow(v,2.2f);
    case 4:return v<4.5f*0.01805397f?v/4.5f:std::pow((v+1.0992968f-1.f)/1.0992968f,1.f/0.45f);
    default:throw std::runtime_error("不支持的 RGB 表编码。");
    }
}
using Matrix=std::array<Pixel,3>;
constexpr Matrix identity{{{1,0,0},{0,1,0},{0,0,1}}};
constexpr Matrix proToRGB{{{2.034075f,-0.727334f,-0.306742f},{-0.228813f,1.231731f,-0.002918f},{-0.00857f,-0.153286f,1.161856f}}};
constexpr Matrix rgbToPro{{{0.529345f,0.330072f,0.140583f},{0.098374f,0.873462f,0.028164f},{0.016883f,0.117673f,0.865444f}}};
constexpr Matrix proToAdobe{{{1.3896414f,-0.169455f,-0.2201864f},{-0.2288268f,1.2317534f,-0.0029266f},{-0.0176251f,-0.096258f,1.1138831f}}};
constexpr Matrix adobeToPro{{{0.7401223f,0.1132767f,0.146601f},{0.137551f,0.8330699f,0.0293791f},{0.0235977f,0.0737835f,0.9026188f}}};
constexpr Matrix proToP3{{{1.6325645f,-0.3797686f,-0.2527959f},{-0.1537019f,1.1667131f,-0.0130112f},{0.0103933f,-0.0628079f,1.0524146f}}};
constexpr Matrix p3ToPro{{{0.6316912f,0.2139282f,0.1543806f},{0.0832043f,0.8858575f,0.0309382f},{-0.0012727f,0.0507551f,0.9505176f}}};
constexpr Matrix proToRec{{{1.2006506f,-0.0575637f,-0.1430869f},{-0.0699434f,1.080628f,-0.0106845f},{0.0055415f,-0.0407826f,1.035241f}}};
constexpr Matrix recToPro{{{0.8351932f,0.0488653f,0.1159414f},{0.0540346f,0.9289099f,0.0170555f},{-0.002342f,0.0363322f,0.9660099f}}};
Pixel mul(const Matrix &m,const Pixel &p){Pixel out{};for(int i=0;i<3;++i)out[i]=m[i][0]*p[0]+m[i][1]*p[1]+m[i][2]*p[2];return out;}
Matrix mul(const Matrix &a,const Matrix &b){Matrix out{};for(int i=0;i<3;++i)for(int j=0;j<3;++j)for(int k=0;k<3;++k)out[i][j]+=a[i][k]*b[k][j];return out;}
std::array<Matrix,2> matrices(uint32_t code){
    switch(code){
    case 0:return {identity,identity};
    case 1:return {mul(proToAdobe,rgbToPro),mul(proToRGB,adobeToPro)};
    case 2:return {rgbToPro,proToRGB};
    case 3:return {mul(proToP3,rgbToPro),mul(proToRGB,p3ToPro)};
    case 4:return {mul(proToRec,rgbToPro),mul(proToRGB,recToPro)};
    default:throw std::runtime_error("不支持的 RGB 表色域。");
    }
}
std::vector<uint8_t> expand(const std::string &text){
    require(text.size()<=16000000,"Look 表编码过大。");
    const std::string alphabet="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?`'|()[]{}@%$#";
    std::string digits;digits.reserve(text.size());
    for(const unsigned char c:text){if(c==' '||c=='\t'||c=='\r'||c=='\n'||c=='\v'||c=='\f')continue;require(alphabet.find(c)!=std::string::npos,"Look 表 base85 字符无效。");digits+=char(c);}
    require(digits.size()%5!=1,"Look 表 base85 被截断。");
    std::vector<uint8_t> compressed;compressed.reserve(digits.size()*4/5);
    for(size_t i=0;i<digits.size();i+=5){
        const size_t count=std::min<size_t>(5,digits.size()-i);uint64_t value=0,power=1;
        for(size_t j=0;j<count;++j){value+=alphabet.find(digits[i+j])*power;power*=85;}
        require(value<=UINT32_MAX,"Look 表 base85 溢出。");
        for(size_t j=0;j+1<count;++j)compressed.push_back(uint8_t(value>>(8*j)));
    }
    require(compressed.size()>=5,"Look 表压缩数据被截断。");
    const uint32_t expected=uint32_t(compressed[0])|(uint32_t(compressed[1])<<8)|(uint32_t(compressed[2])<<16)|(uint32_t(compressed[3])<<24);
    require(expected>0&&expected<=12000048,"Look 表展开大小无效。");
    std::vector<uint8_t> data(expected);uLongf length=expected;uLong input=compressed.size()-4;
    const int status=uncompress2(data.data(),&length,compressed.data()+4,&input);
    require(status==Z_OK&&length==expected&&input==compressed.size()-4,"Look 表 zlib 数据或长度无效。");
    return data;
}
struct Reader {
    const std::vector<uint8_t> &bytes;size_t offset=0;
    uint64_t integer(size_t n){require(offset+n<=bytes.size(),"Look 表数据被截断。");uint64_t v=0;for(size_t i=0;i<n;++i)v|=uint64_t(bytes[offset++])<<(i*8);return v;}
    uint32_t u32(){return uint32_t(integer(4));}
    uint16_t u16(){return uint16_t(integer(2));}
    float f32(){const uint32_t v=u32();float f;std::memcpy(&f,&v,4);require(std::isfinite(f),"Look 表包含非有限数值。");return f;}
    double f64(){const uint64_t v=integer(8);double f;std::memcpy(&f,&v,8);require(std::isfinite(f),"Look 表包含非有限数值。");return f;}
};
std::string digest(GChecksumType type,const std::vector<uint8_t> &data){gchar *text=g_compute_checksum_for_data(type,data.data(),data.size());require(text,"Look 表摘要计算失败。");std::string out(text);g_free(text);return out;}
}

Table Table::decode(const std::string &encoded){
    const auto data=expand(encoded);Reader r{data};Table t;
    t.type=r.u32();t.version=r.u32();
    if(t.type==0){
        require(t.version==1||t.version==2,"不支持的 HSV Look 表版本。");
        uint64_t count=1;for(auto &n:t.hsvDimensions){n=r.u32();require(n>=1&&n<=256,"HSV Look 表维度无效。");count*=n;}
        require(t.hsvDimensions[1]>=2&&count<=1000000,"HSV Look 表样本数无效。");
        const size_t expected=20+size_t(count)*12+(t.version==2?20:4);
        require(data.size()==expected||data.size()==expected+4,"HSV Look 表 payload 大小无效。");
        t.samples.reserve(count);
        for(uint64_t i=0;i<count;++i){Pixel p{r.f32(),r.f32(),r.f32()};require(std::abs(p[0])<=360&&p[1]>=0&&p[1]<=10&&p[2]>=0&&p[2]<=10,"HSV Look 表样本值无效。");t.samples.push_back(p);}
        t.gamma=r.u32();require(t.gamma<=1,"不支持的 HSV Look 表编码。");
        if(t.version==2){const double lo=r.f64(),hi=r.f64();require(lo>=0&&lo<=1&&hi>=1,"HSV Look 表强度范围无效。");t.bounds={float(lo),float(std::min(hi,2.))};}
        if(data.size()==expected+4){t.flags=r.u32();require(t.flags==0,"不支持的 HSV Look 表 flags。");}
    }else if(t.type==1){
        require(t.version==1,"不支持的 RGB Look 表版本。");t.dimensions=r.u32();t.divisions=r.u32();
        require((t.dimensions==1&&t.divisions>=2&&t.divisions<=4096)||(t.dimensions==3&&t.divisions>=2&&t.divisions<=64),"RGB Look 表维度无效。");
        const size_t n=t.divisions,count=t.dimensions==1?n:n*n*n,expected=16+count*6+28;
        require(data.size()==expected||data.size()==expected+4,"RGB Look 表 payload 大小无效。");
        t.samples.reserve(count);
        const auto grid=[&](size_t i){return uint16_t((i*65535+(n-1)/2)/(n-1));};
        for(size_t i=0;i<count;++i){const std::array<size_t,3> indexes=t.dimensions==1?std::array<size_t,3>{i,i,i}:std::array<size_t,3>{i/(n*n),(i/n)%n,i%n};Pixel p{};for(int c=0;c<3;++c)p[c]=float(uint16_t(r.u16()+grid(indexes[c])))/65535.f;t.samples.push_back(p);}
        t.primaries=r.u32();t.gamma=r.u32();t.gamut=r.u32();
        require(t.primaries<=4&&t.gamma<=4&&t.gamut<=1,"RGB Look 表色域、编码或扩展方式不受支持。");
        const double lo=r.f64(),hi=r.f64();require(lo>=0&&lo<=1&&hi>=1&&hi<=4,"RGB Look 表强度范围无效。");t.bounds={float(lo),float(hi)};
        if(data.size()==expected+4){t.flags=r.u32();require(t.flags<=1,"不支持的 RGB Look 表 flags。");}
    }else throw std::runtime_error("不支持的 Look 表类型。");
    require(r.offset==data.size(),"Look 表包含未识别数据。");
    t.wireMD5=digest(G_CHECKSUM_MD5,data);t.sha256=digest(G_CHECKSUM_SHA256,data);return t;
}
nlohmann::json Table::describe() const {
    return {{"type",type==0?"hsv":"rgb"},{"version",version},{"dimensions",type==0?nlohmann::json(hsvDimensions):nlohmann::json(dimensions)},{"divisions",divisions},{"primaries",primaries},{"gamma",gamma},{"gamut",gamut},{"flags",flags},{"bounds",bounds},{"samples",samples.size()},{"wireMD5",wireMD5},{"sha256",sha256}};
}
float Table::rgbAmount(float tableAmount,float profileAmount) const {
    require(type==1&&std::isfinite(tableAmount)&&std::isfinite(profileAmount),"RGB Look 表强度无效。");return pin(tableAmount*profileAmount,bounds[0],bounds[1]);
}
bool Table::isIdentity() const {
    if(type==0)return std::all_of(samples.begin(),samples.end(),[](const Pixel &p){return p==Pixel{0,1,1};});
    if(gamut!=1)return false; // A clipping table can still affect out-of-gamut input.
    const size_t n=divisions;
    for(size_t i=0;i<samples.size();++i)for(size_t c=0;c<3;++c){
        const size_t index=dimensions==1?i:c==0?i/(n*n):c==1?(i/n)%n:i%n;
        const float expected=float((index*65535+(n-1)/2)/(n-1))/65535.f;
        if(samples[i][c]!=expected)return false;
    }
    return true;
}
Pixel Table::applyRGB(Pixel rgb,float amount) const {
    require(type==1&&std::isfinite(amount),"RGB Look 表强度无效。");if(amount==0)return rgb;
    const auto m=matrices(primaries);Pixel full=mul(m[0],rgb),encoded{},looked{};
    for(int c=0;c<3;++c){require(std::isfinite(full[c]),"RGB Look 输入包含非有限数值。");full[c]=std::copysign(gammaEncode(std::abs(full[c]),gamma),full[c]);encoded[c]=pin(full[c]);}
    const size_t n=divisions;std::array<size_t,3> base{};Pixel f{};
    for(int c=0;c<3;++c){const float v=encoded[c]*float(n-1);base[c]=std::min(size_t(v),n-2);f[c]=v-float(base[c]);}
    if(dimensions==1){for(int c=0;c<3;++c){const float a=samples[base[c]][c];looked[c]=a+(samples[base[c]+1][c]-a)*f[c];}}
    else{
        const auto at=[&](int r,int g,int b){return samples[((base[0]+r)*n+base[1]+g)*n+base[2]+b];};
        const Pixel a0=at(0,0,0),a3=at(1,1,1);Pixel a1{},a2{},w{};
        if(f[0]>f[1]){if(f[1]>f[2]){a1=at(1,0,0);a2=at(1,1,0);w={f[0],f[1],f[2]};}else if(f[0]>f[2]){a1=at(1,0,0);a2=at(1,0,1);w={f[0],f[2],f[1]};}else{a1=at(0,0,1);a2=at(1,0,1);w={f[2],f[0],f[1]};}}
        else if(f[2]>f[1]){a1=at(0,0,1);a2=at(0,1,1);w={f[2],f[1],f[0]};}else if(f[2]>f[0]){a1=at(0,1,0);a2=at(0,1,1);w={f[1],f[2],f[0]};}else{a1=at(0,1,0);a2=at(1,1,0);w={f[1],f[0],f[2]};}
        for(int c=0;c<3;++c)looked[c]=a0[c]+w[0]*(a1[c]-a0[c])+w[1]*(a2[c]-a1[c])+w[2]*(a3[c]-a2[c]);
    }
    Pixel out{};for(int c=0;c<3;++c){float v=encoded[c]+amount*(looked[c]-encoded[c]);v=gamut==0?pin(v):v+full[c]-encoded[c];out[c]=std::copysign(gammaDecode(std::abs(v),gamma),v);}return mul(m[1],out);
}
Pixel Table::applyHSV(Pixel rgb,float profileAmount) const {
    require(type==0&&std::isfinite(profileAmount),"HSV Look 表强度无效。");for(float v:rgb)require(std::isfinite(v),"HSV Look 输入包含非有限数值。");
    const float strength=pin(profileAmount,bounds[0],bounds[1]);const auto dims=hsvDimensions;
    const float max=std::max({0.f,rgb[0],rgb[1],rgb[2]}),min=std::max(0.f,std::min({rgb[0],rgb[1],rgb[2]})),d=max-min;
    float h=0;if(d>=1e-9f){if(max==rgb[0])h=fract((rgb[1]-rgb[2])/d/6.f);else if(max==rgb[1])h=((rgb[2]-rgb[0])/d+2.f)/6.f;else h=((rgb[0]-rgb[1])/d+4.f)/6.f;}
    const float sat=max>0?d/max:0;const bool encoded=gamma==1&&dims[2]>1;float v=encoded?srgbEncode(max):max;
    const Pixel coords{fract(h)*dims[0],pin(sat)*(dims[1]-1),pin(v)*(dims[2]-1)};
    std::array<uint32_t,3> base{};Pixel f{},delta{};for(int c=0;c<3;++c){base[c]=uint32_t(std::floor(coords[c]));f[c]=coords[c]-base[c];}
    for(uint32_t z=0;z<2;++z)for(uint32_t y=0;y<2;++y)for(uint32_t x=0;x<2;++x){const uint32_t ix=(base[0]+x)%dims[0],iy=std::min(base[1]+y,dims[1]-1),iz=std::min(base[2]+z,dims[2]-1);const float weight=(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);const auto p=samples[(iz*dims[0]+ix)*dims[1]+iy];const Pixel scaled{p[0]*strength,std::max(0.f,1.f+(p[1]-1.f)*strength),std::max(0.f,1.f+(p[2]-1.f)*strength)};for(int c=0;c<3;++c)delta[c]+=scaled[c]*weight;}
    h=fract(h+delta[0]/360.f)*6.f;const float s=pin(sat*delta[1]);v=encoded?srgbDecode(v*delta[2]):v*delta[2];const float c=v*s,x=c*(1.f-std::abs(std::fmod(h,2.f)-1.f));
    Pixel out{};switch(int(h)){case 0:out={c,x,0};break;case 1:out={x,c,0};break;case 2:out={0,c,x};break;case 3:out={0,x,c};break;case 4:out={x,0,c};break;default:out={c,0,x};}
    for(float &a:out)a+=v-c;return out;
}
}
