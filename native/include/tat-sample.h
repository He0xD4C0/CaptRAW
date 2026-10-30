#pragma once
#include "core.h"
#include <memory>
namespace art { namespace engine {class StagedImageProcessor;namespace procparams {class ProcParams;}}}
namespace captraw {
// Read-only stage buffers. The caller owns and stops the processor before use.
class CurveSampler {
public:
    CurveSampler(art::engine::StagedImageProcessor *,const art::engine::procparams::ProcParams &);
    ~CurveSampler();
    void prepare(const std::string &channel);
    Json sample(const Json &point);
private:
    struct Impl;std::unique_ptr<Impl> impl;
};
}
