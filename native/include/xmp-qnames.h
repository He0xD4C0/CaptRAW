#pragma once
#include <exiv2/exiv2.hpp>
#include <expat.h>
#include <cctype>
#include <exception>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>

namespace captraw::xmp_metadata {
inline size_t packetXMLSize(const std::string &packet) {
    size_t size=packet.size();
    const bool utf16=size>=2&&((static_cast<unsigned char>(packet[0])==0xff&&static_cast<unsigned char>(packet[1])==0xfe)||
        (static_cast<unsigned char>(packet[0])==0xfe&&static_cast<unsigned char>(packet[1])==0xff)||packet[0]==0||packet[1]==0);
    const size_t unit=utf16?2:1;
    while(size>=unit&&packet[size-1]==0&&(!utf16||packet[size-2]==0))size-=unit;
    return size;
}
struct NamespaceBindings {
    std::map<std::string,std::set<std::string>> aliases;
    XML_Parser parser=nullptr;
    std::exception_ptr error;
};
inline NamespaceBindings namespaceBindings(const std::string &packet) {
    NamespaceBindings result;
    if(packet.empty())return result;
    if(packet.size()>64*1024*1024)throw std::runtime_error("Source XMP exceeds 64 MiB");
    std::unique_ptr<XML_ParserStruct,decltype(&XML_ParserFree)> parser(XML_ParserCreateNS(nullptr,'\x1f'),XML_ParserFree);
    if(!parser)throw std::runtime_error("Cannot read XMP namespace bindings");
    result.parser=parser.get();XML_SetUserData(parser.get(),&result);
    XML_SetNamespaceDeclHandler(parser.get(),[](void *data,const XML_Char *prefix,const XML_Char *uri) noexcept {
        auto &bindings=*static_cast<NamespaceBindings*>(data);
        try{if(uri&&*uri)bindings.aliases[prefix?prefix:""].insert(uri);}
        catch(...){bindings.error=std::current_exception();XML_StopParser(bindings.parser,XML_FALSE);}
    },nullptr);
    XML_SetStartDoctypeDeclHandler(parser.get(),[](void *data,const XML_Char*,const XML_Char*,const XML_Char*,int) noexcept {
        XML_StopParser(static_cast<NamespaceBindings*>(data)->parser,XML_FALSE);
    });
    const auto size=packetXMLSize(packet);
    const auto status=XML_Parse(parser.get(),packet.data(),int(size),XML_TRUE);
    if(result.error)std::rethrow_exception(result.error);
    if(status==XML_STATUS_ERROR)throw std::runtime_error("Invalid source XMP namespace bindings");
    result.parser=nullptr;return result;
}
inline std::string namespaceURI(const std::string &prefix,const NamespaceBindings &bindings) {
    if(prefix=="xml")return "http://www.w3.org/XML/1998/namespace";
    const auto found=bindings.aliases.find(prefix);
    if(found!=bindings.aliases.end()&&found->second.size()==1)return *found->second.begin();
    // With a packet, only its expanded node names are authoritative. A global
    // registry entry cannot resolve a prefix rebound in a nested XML scope.
    if(bindings.aliases.empty())try{return Exiv2::XmpProperties::ns(prefix);}catch(const Exiv2::Error&){}
    throw std::runtime_error("Unresolved or ambiguous source XMP prefix: "+prefix);
}
inline std::string preferredPrefix(const std::string &uri) {
    if(uri=="http://www.w3.org/XML/1998/namespace")return "xml";
    auto prefix=Exiv2::XmpProperties::prefix(uri);if(!prefix.empty())return prefix;
    // A URI used only in a nested field may not be in Exiv2's schema table.
    // Add an unused name, never overwrite another URI or clear the registry.
    for(unsigned n=0;;++n){
        prefix="captrawNs"+std::to_string(n);bool occupied=true;
        try{Exiv2::XmpProperties::ns(prefix);}catch(const Exiv2::Error&){occupied=false;}
        if(!occupied){Exiv2::XmpProperties::registerNs(uri,prefix);return prefix;}
    }
}
// Exiv2's flattened XmpKey suffixes retain lexical prefixes, not the URI at
// each XML scope. Normalize expanded element/attribute names BEFORE decoding;
// doing so afterwards cannot recover a nested field's or qualifier's URI.
// This is XML serialization only: no RDF interpretation or value replacement.
struct NamespacePacket {
    std::map<std::string,std::string> prefixes;
    std::string output;
    XML_Parser parser=nullptr;
    std::exception_ptr error;
    bool root=true;
    template<class F> void run(F action) noexcept {
        try{action();}catch(...){error=std::current_exception();XML_StopParser(parser,XML_FALSE);}
    }
    std::string name(const char *expanded) const {
        const std::string value=expanded;const auto split=value.find('\x1f');
        if(split==std::string::npos)return value;
        return prefixes.at(value.substr(0,split))+":"+value.substr(split+1);
    }
    void text(const char *value,size_t size,bool attribute=false) {
        for(size_t i=0;i<size;++i)switch(value[i]){
            case '&':output+="&amp;";break;case '<':output+="&lt;";break;case '>':output+="&gt;";break;
            case '"':output+=attribute?"&quot;":"\"";break;case '\r':output+="&#13;";break;
            case '\n':output+=attribute?"&#10;":"\n";break;case '\t':output+=attribute?"&#9;":"\t";break;
            default:output+=value[i];
        }
    }
    void attribute(const std::string &key,const char *value) {
        output+=" "+key+"=\"";text(value,std::char_traits<char>::length(value),true);output+='"';
    }
};
inline std::string namespacePacket(const std::string &packet) {
    if(packet.empty())return packet;
    const auto bindings=namespaceBindings(packet);NamespacePacket result;
    // Keep the XML/RDF envelope's conventional names for Exiv2's packet reader.
    result.prefixes={{"adobe:ns:meta/","x"},{"http://www.w3.org/1999/02/22-rdf-syntax-ns#","rdf"},
        {"http://www.w3.org/XML/1998/namespace","xml"}};
    unsigned next=0;
    for(const auto &alias:bindings.aliases)for(const auto &uri:alias.second){
        if(result.prefixes.count(uri))continue;
        std::string prefix;
        for(;;){
            // Keep transient XML names separate from the stable Exiv2 schema
            // names allocated by preferredPrefix, including nested-only URIs.
            prefix="captrawXmlNs"+std::to_string(next++);if(bindings.aliases.count(prefix))continue;
            bool occupied=true;try{Exiv2::XmpProperties::ns(prefix);}catch(const Exiv2::Error&){occupied=false;}
            if(!occupied)break;
        }
        result.prefixes.emplace(uri,prefix);
    }
    std::unique_ptr<XML_ParserStruct,decltype(&XML_ParserFree)> parser(XML_ParserCreateNS(nullptr,'\x1f'),XML_ParserFree);
    if(!parser)throw std::runtime_error("Cannot normalize source XMP namespaces");
    result.parser=parser.get();XML_SetUserData(parser.get(),&result);
    XML_SetElementHandler(parser.get(),[](void *data,const XML_Char *name,const XML_Char **attributes) noexcept {
        auto &p=*static_cast<NamespacePacket*>(data);p.run([&]{
            p.output+="<"+p.name(name);
            if(p.root){
                p.root=false;
                // Superseded lexical declarations must not reach the old SDK:
                // it can fold both scoped URIs back to the same original alias.
                for(const auto &entry:p.prefixes)if(entry.second!="xml")p.attribute("xmlns:"+entry.second,entry.first.c_str());
            }
            for(auto a=attributes;*a;a+=2)p.attribute(p.name(a[0]),a[1]);p.output+='>';
        });
    },[](void *data,const XML_Char *name) noexcept {
        auto &p=*static_cast<NamespacePacket*>(data);p.run([&]{p.output+="</"+p.name(name)+">";});
    });
    XML_SetCharacterDataHandler(parser.get(),[](void *data,const XML_Char *value,int size) noexcept {
        auto &p=*static_cast<NamespacePacket*>(data);p.run([&]{p.text(value,size);});
    });
    XML_SetProcessingInstructionHandler(parser.get(),[](void *data,const XML_Char *target,const XML_Char *value) noexcept {
        auto &p=*static_cast<NamespacePacket*>(data);p.run([&]{p.output+="<?"+std::string(target);if(*value)p.output+=" "+std::string(value);p.output+="?>";});
    });
    XML_SetCommentHandler(parser.get(),[](void *data,const XML_Char *value) noexcept {
        auto &p=*static_cast<NamespacePacket*>(data);p.run([&]{p.output+="<!--"+std::string(value)+"-->";});
    });
    XML_SetXmlDeclHandler(parser.get(),[](void *data,const XML_Char *version,const XML_Char*,int standalone) noexcept {
        auto &p=*static_cast<NamespacePacket*>(data);p.run([&]{p.output+="<?xml version=\""+std::string(version)+"\" encoding=\"UTF-8\"";
            if(standalone>=0)p.output+=standalone?" standalone=\"yes\"":" standalone=\"no\"";p.output+="?>";});
    });
    XML_SetStartDoctypeDeclHandler(parser.get(),[](void *data,const XML_Char*,const XML_Char*,const XML_Char*,int) noexcept {
        XML_StopParser(static_cast<NamespacePacket*>(data)->parser,XML_FALSE);
    });
    const auto size=packetXMLSize(packet);
    const auto status=XML_Parse(parser.get(),packet.data(),int(size),XML_TRUE);
    if(result.error)std::rethrow_exception(result.error);
    if(status==XML_STATUS_ERROR)throw std::runtime_error("Cannot normalize source XMP namespaces");
    return result.output;
}
inline std::string qnamePath(const std::string &input,const NamespaceBindings &bindings) {
    const auto nameChar=[](unsigned char c){return std::isalnum(c)||c=='_'||c=='-'||c=='.'||c>=128;};
    std::string result;char quote=0;
    for(size_t at=0;at<input.size();){
        const char c=input[at];
        if(quote){result+=c;if(c==quote)quote=0;++at;continue;}
        if(c=='\''||c=='"'){quote=c;result+=c;++at;continue;}
        const bool start=at==0||input[at-1]=='/'||input[at-1]=='?'||input[at-1]=='@'||input[at-1]=='[';
        if(start&&nameChar(static_cast<unsigned char>(c))){
            size_t end=at;while(end<input.size()&&nameChar(static_cast<unsigned char>(input[end])))++end;
            if(end<input.size()&&input[end]==':'){
                result+=preferredPrefix(namespaceURI(input.substr(at,end-at),bindings));result+=':';at=end+1;continue;
            }
        }
        result+=c;++at;
    }
    return result;
}
// Immutable source metadata only. Apply rating, orientation and other output
// annotations afterwards. Re-read the original packet because cached XmpKeys
// can refer to a prefix which a later image registered for a different URI.
inline Exiv2::XmpData sourceXMP(const Exiv2::XmpData &source) {
    const auto &packet=source.xmpPacket();const auto normalized=namespacePacket(packet);const auto bindings=namespaceBindings(normalized);
    Exiv2::XmpData decoded=source;
    if(!packet.empty()&&Exiv2::XmpParser::decode(decoded,normalized))throw std::runtime_error("Cannot read source XMP for QName normalization");
    Exiv2::XmpData result;std::set<std::string> keys;
    for(const auto &datum:decoded){
        const auto uri=Exiv2::XmpKey(datum.key()).ns();
        const Exiv2::XmpKey key(preferredPrefix(uri),qnamePath(datum.tagName(),bindings));
        if(!keys.insert(key.key()).second)throw std::runtime_error("Source XMP QName collision");
        result.add(key,&datum.value()); // Clone the typed value; never replace text.
    }
    result.setPacket(packet);return result;
}
}
