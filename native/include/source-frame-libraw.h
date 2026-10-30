#pragma once
#include <libraw.h>
#include <array>

namespace art { namespace engine {
// Opt-in at file decoding, before raw2image discards any physical samples.
// LibRaw's callback runs after identify and before CFA-aligned inset rounding.
class SourceFrameLibRaw: public LibRaw {
public:
    std::array<int,4> cameraCrop{};
    SourceFrameLibRaw() {
        callbacks.post_identify_cb=[](void *context){
            auto &self=*static_cast<SourceFrameLibRaw *>(static_cast<LibRaw *>(context));
            auto &d=self.imgdata;auto &s=d.sizes;
            self.cameraCrop={};
            if(!d.idata.dng_version&&d.idata.maker_index==LIBRAW_CAMERAMAKER_Fujifilm&&d.idata.filters==9){
                const auto &c=s.raw_inset_crops[0];
                if(c.cleft!=65535&&c.ctop!=65535&&c.cwidth>0&&c.cheight>0&&
                   int(c.cleft)+c.cwidth<=s.raw_width&&int(c.ctop)+c.cheight<=s.raw_height)
                    self.cameraCrop={int(c.cleft),int(c.ctop),int(c.cwidth),int(c.cheight)};
            }
            if(!d.idata.dng_version&&d.idata.maker_index==LIBRAW_CAMERAMAKER_Canon){
                const auto &c=d.makernotes.canon;
                const auto &a=c.DefaultCropAbsolute;
                // SensorInfo right/bottom are inclusive. Correct only the
                // identifiable exclusive-end calculation, within decoded RAW.
                if(c.SensorWidth==s.raw_width&&c.SensorHeight==s.raw_height&&
                   a.l>=0&&a.t>=0&&a.r>=s.left_margin&&a.b>=s.top_margin&&
                   a.r<s.raw_width&&a.b<s.raw_height&&
                   s.width==a.r-s.left_margin&&s.height==a.b-s.top_margin){
                    s.width=a.r-s.left_margin+1;s.height=a.b-s.top_margin+1;
                }
            }
        };
    }
};
}}
