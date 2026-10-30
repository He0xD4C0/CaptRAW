#pragma once
// RAWmakase MIT adaptation. Pinned sources: native/config/enhanced-profile-sources.json.
#include "enhanced-table.h"
#include <memory>
namespace captraw { namespace enhanced {
class Profile {
public:
    static Profile parse(const nlohmann::json &settings);
    Pixel applyHSV(Pixel proPhoto) const;
    Pixel applyCurve(Pixel proPhoto) const;
    Pixel applyRGB(Pixel displayRGB) const;
    nlohmann::json controls() const;
    nlohmann::json describe() const;
    bool hasHSV() const {return hsvActive;}
    bool hasCurve() const {return curveEnabled;}
    bool hasRGB() const {return rgbActive;}
    bool isIdentity() const;
private:
    nlohmann::json definition,parameters;
    std::shared_ptr<Table> hsv,rgb;
    float amount=1,rgbStrength=1;
    bool curveEnabled=false,hsvActive=false,rgbActive=false;
    std::array<float,4097> curve{};
    float evaluate(float x) const;
};
}}
