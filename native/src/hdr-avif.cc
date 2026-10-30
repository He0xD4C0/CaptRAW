#include "hdr-avif.h"
#include "xmp-qnames.h"
#include "engine/imagefloat.h"
#include "engine/metadata.h"
#include "engine/settings.h"
#include "engine/improcfun.h"
#include <avif/avif_cxx.h>
#include <exiv2/exiv2.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <set>
#include <vector>
namespace captraw {
namespace ae=art::engine;
static void checked(avifResult result){if(result!=AVIF_RESULT_OK)throw std::runtime_error(std::string("HDR AVIF: ")+avifResultToString(result));}
Json saveHDRAVIF(ae::Imagefloat &source,const std::string &output,const Json &rating)
{
    const int width=source.getWidth(),height=source.getHeight();
    if(width>AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT||height>AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT||int64_t(width)*height>AVIF_DEFAULT_IMAGE_SIZE_LIMIT)throw std::runtime_error("AVIF 输出须每边不超过 32768 像素且不超过约 268 MP。");
    avif::ImagePtr image(avifImageCreate(width,height,12,AVIF_PIXEL_FORMAT_YUV444));
    if(!image)throw std::runtime_error("Cannot allocate HDR AVIF image");
    image->colorPrimaries=AVIF_COLOR_PRIMARIES_BT2020;image->transferCharacteristics=AVIF_TRANSFER_CHARACTERISTICS_SMPTE2084;
    image->matrixCoefficients=AVIF_MATRIX_COEFFICIENTS_IDENTITY;image->yuvRange=AVIF_RANGE_FULL;
    // Identity matrix keeps the quantized RGB codes exact through lossless AV1.
    std::vector<uint16_t> pixels(size_t(width)*height*3);std::array<double,4096> nits{};
    for(int i=0;i<4096;++i){const double p=std::pow(i/4095.,1./(2523./32));nits[i]=10000.*std::pow(std::max(p-3424./4096,0.)/(2413./128-2392./128*p),16384./2610);}
    double maximum=0,sum=0;uint64_t negative=0,overPeak=0,invalid=0;
    source.syncCpu();
#ifdef _OPENMP
#pragma omp parallel for reduction(max:maximum) reduction(+:sum,negative,overPeak,invalid) schedule(static)
#endif
    for(int y=0;y<height;++y)for(int x=0;x<width;++x){
        const float values[]={source.r(y,x)/65535.f,source.g(y,x)/65535.f,source.b(y,x)/65535.f};double peak=0;
        for(int c=0;c<3;++c){
            const float value=values[c];if(!std::isfinite(value)){++invalid;continue;}
            negative+=value<0;overPeak+=value>10000./203;
            // ST.2084, as in ART Color::eval_PQ_curve, promoted to double before 12-bit rounding.
            const double p=std::pow(std::clamp(double(value),0.,10000./203)*203/10000,2610./16384);
            const double pq=std::pow((3424./4096+2413./128*p)/(1+2392./128*p),2523./32);
            const auto code=uint16_t(std::lround(std::clamp(pq,0.,1.)*4095));
            pixels[(size_t(y)*width+x)*3+c]=code;peak=std::max(peak,nits[code]);
        }
        maximum=std::max(maximum,peak);sum+=peak;
    }
    if(invalid)throw std::runtime_error("HDR AVIF contains non-finite pixels; no output was written");
    image->clli.maxCLL=uint16_t(std::ceil(std::min(10000.,maximum)));image->clli.maxPALL=uint16_t(std::ceil(std::min(10000.,sum/(double(width)*height))));
    auto metadata=source.outputMetadata();Exiv2::XmpData xmp;
    if(!metadata.filename().empty()){
        metadata.load();auto exif=metadata.getOutputExifData();xmp=xmp_metadata::sourceXMP(metadata.xmpData());
        // Reuse ART's source/sidecar metadata, without writing back to either.
        if(ae::settings->metadata_xmp_sync!=ae::Settings::MetadataXmpSync::NONE){const auto sidecar=xmp_metadata::sourceXMP(ae::Exiv2Metadata::getXmpSidecar(metadata.filename()));for(const auto &entry:sidecar)xmp[entry.key()]=entry;}
        auto iptc=metadata.iptcData();Exiv2::copyIptcToXmp(iptc,xmp);
        Exiv2::ExifThumb(exif).erase();exif["Exif.Image.Orientation"]=uint16_t(1);
        exif["Exif.Photo.PixelXDimension"]=uint32_t(width);exif["Exif.Photo.PixelYDimension"]=uint32_t(height);
        // No SDR color-space declaration may override the AVIF CICP.
        exif["Exif.Photo.ColorSpace"]=uint16_t(65535);
        if(!rating.is_null())for(const char *key:{"Exif.Image.Rating","Exif.Image.RatingPercent"}){const auto found=exif.findKey(Exiv2::ExifKey(key));if(found!=exif.end())exif.erase(found);}
        Exiv2::Blob bytes;Exiv2::ExifParser::encode(bytes,Exiv2::littleEndian,exif);if(!bytes.empty())checked(avifImageSetMetadataExif(image.get(),bytes.data(),bytes.size()));
        xmp["Xmp.tiff.Orientation"]="1";xmp["Xmp.exif.PixelXDimension"]=uint32_t(width);xmp["Xmp.exif.PixelYDimension"]=uint32_t(height);xmp["Xmp.exif.ColorSpace"]="65535";
    }
    if(!rating.is_null())xmp["Xmp.xmp.Rating"]=rating.dump();
    // Rendered pixels must not publish the editor's private baked provenance.
    // Exiv2 flattens structs/qualifiers into paths; remove the whole owned tree
    // by namespace URI, without depending on the input's chosen XML prefix.
    const std::set<std::string> privateDevelop={"BakedCRS","EngineVersion","Source","ARTProfile","BaselineVersion","MaskAssets","InputProfileAsset","ARTAdjustments","ARTWhiteBalanceCoordinates"};
    for(auto it=xmp.begin();it!=xmp.end();){
        const Exiv2::XmpKey key(it->key());const auto name=it->tagName();
        const auto root=name.substr(0,name.find_first_of("/[?"));
        if(key.ns()=="https://captraw.org/ns/develop/1.0/"&&privateDevelop.count(root))it=xmp.erase(it);else ++it;
    }
    xmp["Xmp.crs.AlreadyApplied"]="True";
    if(!xmp.empty()){std::string packet;if(Exiv2::XmpParser::encode(packet,xmp,Exiv2::XmpParser::useCompactFormat|Exiv2::XmpParser::omitPacketWrapper)!=0)throw std::runtime_error("Cannot encode AVIF XMP metadata");checked(avifImageSetMetadataXMP(image.get(),reinterpret_cast<const uint8_t *>(packet.data()),packet.size()));}
    avifRGBImage rgb;avifRGBImageSetDefaults(&rgb,image.get());rgb.format=AVIF_RGB_FORMAT_RGB;rgb.depth=12;rgb.avoidLibYUV=AVIF_TRUE;rgb.pixels=reinterpret_cast<uint8_t *>(pixels.data());rgb.rowBytes=width*6;
    checked(avifImageRGBToYUV(image.get(),&rgb));
    avif::EncoderPtr encoder(avifEncoderCreate());if(!encoder)throw std::runtime_error("Cannot allocate AVIF encoder");
    encoder->codecChoice=AVIF_CODEC_CHOICE_AOM;encoder->quality=AVIF_QUALITY_LOSSLESS;encoder->qualityAlpha=AVIF_QUALITY_LOSSLESS;encoder->speed=6;encoder->maxThreads=8;encoder->autoTiling=AVIF_TRUE;
    avifRWData encoded=AVIF_DATA_EMPTY;
    try{
        const auto result=avifEncoderWrite(encoder.get(),image.get(),&encoded);if(result!=AVIF_RESULT_OK)throw std::runtime_error(std::string("HDR AVIF: ")+avifResultToString(result)+" "+encoder->diag.error);
        std::ofstream file(output,std::ios::binary);file.write(reinterpret_cast<const char *>(encoded.data),encoded.size);file.close();if(!file)throw std::runtime_error("Cannot write HDR AVIF output");
    }catch(...){avifRWDataFree(&encoded);throw;}
    avifRWDataFree(&encoded);
    return {{"referenceWhiteNits",203},{"depth",12},{"colorPrimaries",9},{"transferCharacteristics",16},{"matrixCoefficients",0},{"fullRange",true},{"maxCLL",image->clli.maxCLL},{"maxPALL",image->clli.maxPALL},{"negativeChannelsClipped",negative},{"over10000NitsChannelsClipped",overPeak}};
}
}
