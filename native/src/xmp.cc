#include "xmp.h"
#include "XMP.incl_cpp"
#include <expat.h>
#include <memory>
#include <stdexcept>
#include <algorithm>
namespace captraw::xmp {
void initialize(){
 if(!SXMPMeta::Initialize())throw std::runtime_error("XMP initialization failed");
 SXMPMeta::SetDefaultErrorCallback([](void*,XMP_ErrorSeverity,XMP_Int32,XMP_StringPtr){return false;});
 std::string prefix;SXMPMeta::RegisterNamespace(extension,"ct",&prefix);
}
SXMPMeta parse(const std::string &packet){
 if(packet.empty()||packet.size()>64*1024*1024)throw std::runtime_error("XMP packet size invalid");
 // Validate XML before the SDK's legacy Latin-1/control-character repair can change input.
 std::unique_ptr<XML_ParserStruct,decltype(&XML_ParserFree)> parser(XML_ParserCreate(nullptr),XML_ParserFree);
 if(!parser)throw std::runtime_error("XML initialization failed");
 XML_SetUserData(parser.get(),parser.get());
 XML_SetStartDoctypeDeclHandler(parser.get(),[](void *p,const char*,const char*,const char*,int){XML_StopParser(static_cast<XML_Parser>(p),XML_FALSE);});
 if(XML_Parse(parser.get(),packet.data(),static_cast<int>(packet.size()),XML_TRUE)!=XML_STATUS_OK)throw std::runtime_error("Invalid XML or forbidden DTD declaration");
 SXMPMeta meta;meta.ParseFromBuffer(packet.data(),packet.size(),kXMP_StrictAliasing);return meta;
}
static Json node(const SXMPMeta &meta,const std::string &ns,const std::string &path,int depth){
 if(depth>32)throw std::runtime_error("XMP nesting limit exceeded");
 std::string value;XMP_OptionBits options=0;
 if(!meta.GetProperty(ns.c_str(),path.c_str(),&value,&options))throw std::runtime_error("Missing XMP node");
 Json result={{"value",value},{"options",options}};
 if(options&kXMP_PropValueIsArray){
  result["items"]=Json::array();for(XMP_Index i=1;i<=meta.CountArrayItems(ns.c_str(),path.c_str());++i){std::string child;SXMPUtils::ComposeArrayItemPath(ns.c_str(),path.c_str(),i,&child);result["items"].push_back(node(meta,ns,child,depth+1));}
 }else if(options&kXMP_PropValueIsStruct){
  result["fields"]=Json::array();SXMPIterator it(meta,ns.c_str(),path.c_str(),kXMP_IterJustChildren|kXMP_IterOmitQualifiers);std::string childNS,childPath,childValue;
  while(it.Next(&childNS,&childPath,&childValue,nullptr)){
   const auto field=childPath.substr(childPath.find_last_of('/')+1);const auto colon=field.find(':');std::string uri;
   if(colon==std::string::npos||!SXMPMeta::GetNamespaceURI(field.substr(0,colon+1).c_str(),&uri))throw std::runtime_error("Unregistered XMP field namespace");
   result["fields"].push_back({{"ns",uri},{"name",field.substr(colon+1)},{"node",node(meta,ns,childPath,depth+1)}});
  }
 }
 std::string lang;if(meta.GetQualifier(ns.c_str(),path.c_str(),kXMP_NS_XML,"lang",&lang,nullptr))result["lang"]=lang;
 std::string type;if(meta.GetQualifier(ns.c_str(),path.c_str(),extension,"Type",&type,nullptr))result["type"]=type;
 if(options&kXMP_PropHasQualifiers){
  result["qualifiers"]=Json::array();SXMPIterator it(meta,ns.c_str(),path.c_str(),kXMP_IterJustChildren);std::string childNS,childPath,childValue;XMP_OptionBits flags;
  while(it.Next(&childNS,&childPath,&childValue,&flags))if(flags&kXMP_PropIsQualifier){
   const auto leaf=childPath.substr(childPath.find_last_of('/')+1);const auto colon=leaf.find(':');std::string uri;
   if(leaf.empty()||leaf[0]!='?'||colon==std::string::npos||!SXMPMeta::GetNamespaceURI(leaf.substr(1,colon).c_str(),&uri))throw std::runtime_error("Unregistered XMP qualifier namespace");
   result["qualifiers"].push_back({{"ns",uri},{"name",leaf.substr(colon+1)},{"node",node(meta,ns,childPath,depth+1)}});
  }
  std::sort(result["qualifiers"].begin(),result["qualifiers"].end(),[](const Json&a,const Json&b){return std::pair(a["ns"],a["name"])<std::pair(b["ns"],b["name"]);});
 }
 if(result.contains("fields"))std::sort(result["fields"].begin(),result["fields"].end(),[](const Json&a,const Json&b){return std::pair(a["ns"],a["name"])<std::pair(b["ns"],b["name"]);});
 return result;
}
Json properties(const SXMPMeta &meta){
 Json result=Json::array();SXMPIterator it(meta);std::string ns,path,value;XMP_OptionBits flags;
 while(it.Next(&ns,&path,&value,&flags))if(!(flags&kXMP_SchemaNode)&&path.find_first_of("/[?")==std::string::npos){
  const auto colon=path.find(':');result.push_back({{"ns",ns},{"name",path.substr(colon+1)},{"node",node(meta,ns,path,0)}});
 }
 std::sort(result.begin(),result.end(),[](const Json&a,const Json&b){return std::pair(a["ns"],a["name"])<std::pair(b["ns"],b["name"]);});
 return result;
}
static void set(SXMPMeta &meta,const std::string &ns,const std::string &path,const Json &value,int depth){
 if(depth>32)throw std::runtime_error("XMP nesting limit exceeded");
 if(value.contains("items")){
  auto options=XMP_OptionBits(value.value("options",int(kXMP_PropArrayIsOrdered)));
  options&=kXMP_PropArrayFormMask;options|=kXMP_PropValueIsArray;
  meta.SetProperty(ns.c_str(),path.c_str(),nullptr,options);
  for(const auto &item:value.at("items")){
   const XMP_OptionBits itemOptions=item.contains("items")?kXMP_PropValueIsArray|kXMP_PropArrayIsOrdered:item.contains("fields")?kXMP_PropValueIsStruct:0;
   meta.AppendArrayItem(ns.c_str(),path.c_str(),options,itemOptions?nullptr:"",itemOptions);std::string child;
   SXMPUtils::ComposeArrayItemPath(ns.c_str(),path.c_str(),kXMP_ArrayLastItem,&child);set(meta,ns,child,item,depth+1);
  }
 }else if(value.contains("fields")){
  meta.SetProperty(ns.c_str(),path.c_str(),nullptr,kXMP_PropValueIsStruct);
  for(const auto &field:value.at("fields")){
   const std::string uri=field.at("ns"),name=field.at("name");std::string prefix,child;
   SXMPMeta::RegisterNamespace(uri.c_str(),"field",&prefix);SXMPUtils::ComposeStructFieldPath(ns.c_str(),path.c_str(),uri.c_str(),name.c_str(),&child);set(meta,ns,child,field.at("node"),depth+1);
  }
 }else{const std::string text=value.at("value");meta.SetProperty(ns.c_str(),path.c_str(),text.c_str(),value.value("options",0)&kXMP_PropValueIsURI);}
 if(value.contains("qualifiers"))for(const auto &qualifier:value.at("qualifiers")){
  if(qualifier.at("node").is_null())continue;
  const std::string uri=qualifier.at("ns"),name=qualifier.at("name");std::string prefix,child;
  SXMPMeta::RegisterNamespace(uri.c_str(),"qualifier",&prefix);SXMPUtils::ComposeQualifierPath(ns.c_str(),path.c_str(),uri.c_str(),name.c_str(),&child);
  set(meta,ns,child,qualifier.at("node"),depth+1);
 }
 if(value.contains("lang")){const std::string lang=value.at("lang");meta.SetQualifier(ns.c_str(),path.c_str(),kXMP_NS_XML,"lang",lang.c_str());}
 if(value.contains("type")){const std::string type=value.at("type");meta.SetQualifier(ns.c_str(),path.c_str(),extension,"Type",type.c_str());}
}
static Json content(Json value){
 value.erase("options");if(value.contains("items")){value.erase("value");for(auto &item:value["items"])item=content(item);}
 if(value.contains("fields")){value.erase("value");for(auto &field:value["fields"])field["node"]=content(field["node"]);}
 if(value.contains("qualifiers"))for(auto &qualifier:value["qualifiers"])qualifier["node"]=content(qualifier["node"]);
 return value;
}
// Value updates do not revoke metadata attached to surviving nodes. Struct fields
// still use replacement semantics; document-level merging decides field ownership.
static Json withQualifiers(const Json &previous,Json next,int depth=0){
 if(depth>32)throw std::runtime_error("XMP nesting limit exceeded");
 auto qualifiers=previous.value("qualifiers",Json::array());
 for(const auto &qualifier:next.value("qualifiers",Json::array())){
  auto found=std::find_if(qualifiers.begin(),qualifiers.end(),[&](const Json &p){return p["ns"]==qualifier["ns"]&&p["name"]==qualifier["name"];});
  if(found==qualifiers.end())qualifiers.push_back(qualifier);else *found=qualifier;
 }
 if(!qualifiers.empty())next["qualifiers"]=qualifiers;
 if(previous.contains("fields")&&next.contains("fields"))for(auto &field:next["fields"]){
  for(const auto &old:previous["fields"])if(old["ns"]==field["ns"]&&old["name"]==field["name"]&&!old["node"].is_null()&&!field["node"].is_null())field["node"]=withQualifiers(old["node"],field["node"],depth+1);
 }
 if(previous.contains("items")&&next.contains("items")){
  auto id=[](const Json &item)->Json{for(const auto &field:item.value("fields",Json::array()))if(field["ns"]==extension&&field["name"]=="id"&&field["node"].contains("value"))return field["node"]["value"];return nullptr;};
  for(size_t i=0;i<next["items"].size();++i){
   auto &item=next["items"][i];const auto key=id(item);
   if(!key.is_null()){for(const auto &old:previous["items"])if(id(old)==key){item=withQualifiers(old,item,depth+1);break;}}
   else if(i<previous["items"].size())item=withQualifiers(previous["items"][i],item,depth+1);
  }
 }
 return next;
}
void update(SXMPMeta &meta,const Json &changes){
 if(!changes.is_array()||changes.size()>4096)throw std::runtime_error("Invalid XMP property update");
 for(const auto &change:changes){
  const std::string ns=change.at("ns"),name=change.at("name");
  if(ns.empty()||name.empty()||name.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_")!=std::string::npos)throw std::runtime_error("Invalid XMP property name");
  std::string prefix;SXMPMeta::RegisterNamespace(ns.c_str(),"property",&prefix);
  auto next=change.at("node");
  if(next.is_object()&&next.contains("localized")){const std::string value=next.at("localized");meta.SetLocalizedText(ns.c_str(),name.c_str(),"","x-default",value.c_str());continue;}
  std::string value;XMP_OptionBits flags=0;
  const bool exists=meta.GetProperty(ns.c_str(),name.c_str(),&value,&flags);
  if(exists&&!next.is_null())next=withQualifiers(node(meta,ns,name,0),next);
  if(exists&&!next.is_null()&&content(node(meta,ns,name,0))==content(next))continue;
  meta.DeleteProperty(ns.c_str(),name.c_str());
  if(!next.is_null())set(meta,ns,name,next,0);
 }
}
std::string serialize(const SXMPMeta &meta){std::string packet;meta.SerializeToBuffer(&packet,kXMP_UseCompactFormat|kXMP_OmitPacketWrapper);return packet;}
}
