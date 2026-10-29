#include "output-metadata.h"
#include <exiv2/exiv2.hpp>
#include <set>
#include <string>
#include <stdexcept>
namespace captraw {
Json metadataPacket(const Json &request){
 auto image=Exiv2::ImageFactory::open(request.at("path").get<std::string>());image->readMetadata();
 const auto mime=image->mimeType();
 return {{"packet",image->xmpPacket()},{"format",mime=="image/jpeg"?"jpeg":mime=="image/tiff"?"tiff":"other"}};
}
Json outputMetadata(const Json &request){
 const auto &policy=request.at("policy");const auto include=policy.at("include").get<std::string>();
 if(include!="all"&&include!="all-except-develop"&&include!="copyright"&&include!="none")throw std::runtime_error("Invalid output metadata policy");
 const bool removeLocation=policy.at("removeLocation").get<bool>();
 const auto packet=request.at("xmpPacket").get<std::string>();
 if(packet.size()>64*1024*1024)throw std::runtime_error("Output XMP exceeds limit");
 auto image=Exiv2::ImageFactory::open(request.at("path").get<std::string>());
 if(image->mimeType()!="image/jpeg"&&image->mimeType()!="image/tiff")throw std::runtime_error("Metadata finalization requires rendered JPEG or TIFF");
 image->readMetadata();auto &exif=image->exifData();auto &iptc=image->iptcData();
 if(!packet.empty()){
  Exiv2::XmpData current;
  if(Exiv2::XmpParser::decode(current,packet))throw std::runtime_error("Cannot read output XMP for EXIF/IPTC reconciliation");
  Exiv2::copyXmpToExif(current,exif);Exiv2::copyXmpToIptc(current,iptc);
 }
 // TIFF storage/interpretation and print tags are technical output information.
 const std::set<std::string> technical={"Exif.Image.ImageWidth","Exif.Image.ImageLength","Exif.Image.BitsPerSample","Exif.Image.Compression","Exif.Image.PhotometricInterpretation","Exif.Image.StripOffsets","Exif.Image.SamplesPerPixel","Exif.Image.RowsPerStrip","Exif.Image.StripByteCounts","Exif.Image.XResolution","Exif.Image.YResolution","Exif.Image.PlanarConfiguration","Exif.Image.ResolutionUnit","Exif.Image.Predictor","Exif.Image.Orientation","Exif.Image.SampleFormat","Exif.Image.ExifTag","Exif.Photo.PixelXDimension","Exif.Photo.PixelYDimension","Exif.Photo.ColorSpace","Exif.Image.InterColorProfile"};
 const std::set<std::string> rights={"Exif.Image.Artist","Exif.Image.Copyright"};
 for(auto it=exif.begin();it!=exif.end();){
  const auto key=it->key(),group=it->groupName();
  const bool minimal=include=="none"||include=="copyright";
  const bool vendor=group!="Image"&&group!="Photo"&&group!="Iop"&&group.rfind("SubImage",0)!=0;
  const bool remove=(minimal&&!technical.count(key)&&!(include=="copyright"&&rights.count(key)))||
   (removeLocation&&(group=="GPSInfo"||vendor||key=="Exif.Photo.MakerNote"||key.find("GPS")!=std::string::npos));
  if(remove)it=exif.erase(it);else ++it;
 }
 const std::set<std::string> iptcRights={"Iptc.Application2.Byline","Iptc.Application2.BylineTitle","Iptc.Application2.Copyright","Iptc.Application2.Credit","Iptc.Application2.Source","Iptc.Envelope.CharacterSet"};
 const std::set<std::string> iptcLocation={"Iptc.Application2.City","Iptc.Application2.SubLocation","Iptc.Application2.ProvinceState","Iptc.Application2.CountryCode","Iptc.Application2.CountryName","Iptc.Application2.LocationCode","Iptc.Application2.LocationName"};
 for(auto it=iptc.begin();it!=iptc.end();){
  const bool remove=include=="none"||(include=="copyright"&&!iptcRights.count(it->key()))||(removeLocation&&iptcLocation.count(it->key()));
  if(remove)it=iptc.erase(it);else ++it;
 }
 exif["Exif.Image.Orientation"]=uint16_t(1);
 exif["Exif.Photo.PixelXDimension"]=uint32_t(image->pixelWidth());
 exif["Exif.Photo.PixelYDimension"]=uint32_t(image->pixelHeight());
 if(include=="copyright"||include=="none")image->clearComment();
 // Container XMP is written afterwards by the pinned XMPFiles photo handler.
 // Do not let Exiv2 reserialize qualified standard properties.
 image->clearXmpData();image->clearXmpPacket();image->writeMetadata();
 return {{"path",request.at("path")}};
}
}
