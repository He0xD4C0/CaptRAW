#include "white-balance.h"
#include <nlohmann/json.hpp>
#include <iostream>
int main(){
 using Json=nlohmann::json;
 try{Json input;std::cin>>input;Json rows=Json::array();for(const auto &pair:input){const std::array<double,2> xy=pair.is_object()?pair.at("xy").get<std::array<double,2>>():captraw::whiteBalanceXY(pair.at(0),pair.at(1));rows.push_back({{"input",pair},{"xy",xy},{"inverse",captraw::whiteBalanceTemperatureTint(xy)}});}std::cout<<rows.dump()<<'\n';}
 catch(const std::exception &e){std::cerr<<e.what()<<'\n';return 1;}
}
