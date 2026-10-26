#pragma once
#include <functional>
#include <memory>
#include <nlohmann/json.hpp>
#include <string>
namespace captraw {
using Json = nlohmann::json;
using EventSink = std::function<void(const Json &)>;
class Engine {
public:
    Engine(const std::string &resources, const std::string &cache, EventSink sink);
    ~Engine();
    Json call(const std::string &method, const Json &params);
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
}
