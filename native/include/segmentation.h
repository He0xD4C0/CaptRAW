#pragma once
#include <nlohmann/json.hpp>
#include <functional>
#include <memory>
#include <string>
namespace captraw {
// Independent of the desktop, ART and display services. One cached image.
class Segmentation {
public:
    using Json=nlohmann::json;
    Segmentation(const std::string &modelDirectory,const std::string &cacheDirectory,
                 std::function<void(const Json &)> events);
    ~Segmentation();
    Json info() const;
    Json predict(const Json &request);
    Json parts(const Json &request);
    Json semanticMasks(const Json &request);
    Json sky(const Json &request);
    void close();
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
}
