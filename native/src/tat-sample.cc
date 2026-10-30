#include "tat-sample.h"
#include "engine/dcrop.h"
#include "engine/curves.h"
#include "gui/edit.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
namespace ae=art::engine;
namespace au=art::utils;
namespace captraw {
struct CurveSampler::Impl {
    struct Provider:art::gui::EditDataProvider {
        int width,height;
        void getImageSize(int &w,int &h) override {w=width;h=height;}
    } provider;
    art::gui::EditSubscriber subscriber{au::ET_PIPETTE};
    ae::StagedImageProcessor *processor;
    ae::procparams::ProcParams params;
    std::unique_ptr<ae::DetailedCrop> crop;
    std::string channel;bool ready=false;
    Impl(ae::StagedImageProcessor *p,const ae::procparams::ProcParams &v):processor(p),params(v){
        provider.width=p->getFullWidth();provider.height=p->getFullHeight();subscriber.setEditProvider(&provider);
    }
    ~Impl(){crop.reset();subscriber.unsubscribe();subscriber.setEditProvider(nullptr);}
};
CurveSampler::CurveSampler(ae::StagedImageProcessor *p,const ae::procparams::ProcParams &v):impl(new Impl(p,v)){}
CurveSampler::~CurveSampler()=default;
void CurveSampler::prepare(const std::string &channel){
    if(channel==impl->channel&&impl->crop)return;
    au::EditUniqueID id;au::BufferType type;
    if(channel=="curve"){id=au::EUID_ToneCurve1;type=au::BT_IMAGEFLOAT;}
    else if(channel=="redCurve"){id=au::EUID_RGB_R;type=au::BT_SINGLEPLANE_FLOAT;}
    else if(channel=="greenCurve"){id=au::EUID_RGB_G;type=au::BT_SINGLEPLANE_FLOAT;}
    else if(channel=="blueCurve"){id=au::EUID_RGB_B;type=au::BT_SINGLEPLANE_FLOAT;}
    else throw std::runtime_error("不支持的曲线取样通道。");
    if(impl->params.toneCurve.captrawHDREditMode)throw std::runtime_error("曲线定点取样暂用于 SDR 编辑。");
    impl->crop.reset();impl->subscriber.unsubscribe();impl->subscriber.setEditID(id,type);impl->subscriber.subscribe();
    impl->crop.reset(impl->processor->createCrop(&impl->provider,true));
    impl->crop->setWindow(0,0,impl->provider.width,impl->provider.height,1);
    impl->channel=channel;impl->ready=false;
}
Json CurveSampler::sample(const Json &point){
    const double px=point.at("x"),py=point.at("y");
    const int w=impl->provider.width,h=impl->provider.height;
    if(!std::isfinite(px)||!std::isfinite(py)||px<0||py<0||px>w-1||py>h-1)throw std::runtime_error("曲线取样位置超出照片。");
    const int x=std::lround(px),y=std::lround(py),size=8;
    const auto &c=impl->params.crop;
    if(c.enabled&&(x<c.x||y<c.y||x>=c.x+c.w||y>=c.y+c.h))throw std::runtime_error("曲线取样位置在裁切范围之外。");
    const bool reused=impl->ready;
    if(!impl->ready){impl->crop->fullUpdate();impl->ready=true;}
    auto *buffer=dynamic_cast<ae::Crop *>(impl->crop.get());
    if(!buffer||!buffer->isReady()||!buffer->bufferCreated())throw std::runtime_error("无法取得曲线处理阶段数据，请重试。");
    float values[3];buffer->getPipetteData(values,x+buffer->getLeftBorder(),y+buffer->getUpperBorder(),size);
    const int count=impl->channel=="curve"?3:1;double input=0;Json channels=Json::array();
    for(int i=0;i<count;++i){
        if(!std::isfinite(values[i])||values[i]<0||values[i]>1)throw std::runtime_error("曲线取样数据无效。");
        input+=values[i]/count;channels.push_back(values[i]);
    }
    input=std::round(input*255)/255;
    const auto &p=impl->params;
    const auto &points=impl->channel=="curve"?p.toneCurve.curve:impl->channel=="redCurve"?p.rgbCurves.rcurve:impl->channel=="greenCurve"?p.rgbCurves.gcurve:p.rgbCurves.bcurve;
    ae::DiagonalCurve curve(points);const double output=curve.getVal(input);
    if(!std::isfinite(output)||output<0||output>1)throw std::runtime_error("当前曲线无法在此位置创建控制点。");
    return {{"channel",impl->channel},{"domain",impl->channel=="curve"?"art-tone-input-v1":"art-rgb-input-v1"},
        {"input",input},{"output",output},{"values",channels},{"point",{{"x",x},{"y",y}}},{"sampleSize",size},{"reused",reused}};
}
}
