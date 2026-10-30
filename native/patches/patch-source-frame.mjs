import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function patchSourceFrame(upstream){
 const patch=(file,marker,edits)=>{
  const path=join(upstream,'src/engine',file);let source=readFileSync(path,'utf8');
  if(source.includes(marker))return;
  for(const [from,to] of edits){if(!source.includes(from))throw new Error('Source frame patch anchor changed: '+file+' '+from.slice(0,80));source=source.replace(from,to);}
  if(!source.includes(marker))throw new Error('Source frame marker missing: '+file);
  writeFileSync(path,source);
 };
 patch('procparams.h','std::string captrawSourceFrame;',[
  ['struct CommonTransformParams {\n    bool autofill;',`struct CommonTransformParams {
    bool autofill;
    std::string captrawSourceFrame;
    bool captrawSourceFrameSaved = false;`]
 ]);
 patch('procparams.cc','// CaptRAW: explicit document source frame.',[
  ['    return autofill == other.autofill;',`    return autofill == other.autofill && captrawSourceFrame == other.captrawSourceFrame;`],
  ['                          commonTrans.autofill, keyFile);',`                          commonTrans.autofill, keyFile);
            // CaptRAW: explicit document source frame.
            if(commonTrans.captrawSourceFrameSaved && !commonTrans.captrawSourceFrame.empty())
                saveToKeyfile("Common Properties for Transformations", "CaptRAWSourceFrameV1", commonTrans.captrawSourceFrame, keyFile);`],
  ['                              "AutoFill", commonTrans.autofill);',`                              "AutoFill", commonTrans.autofill);
            commonTrans.captrawSourceFrameSaved=keyFile.has_key("Common Properties for Transformations", "CaptRAWSourceFrameV1");
            commonTrans.captrawSourceFrame.clear();
            if(commonTrans.captrawSourceFrameSaved)
                commonTrans.captrawSourceFrame=keyFile.get_string("Common Properties for Transformations", "CaptRAWSourceFrameV1");`]
 ]);
 patch('imagesource.h','struct DecodedSourceFrame {',[
  ['class ImageMatrices {',`struct DecodedSourceFrame {
    int left=0,top=0,width=0,height=0,fullWidth=0,fullHeight=0,border=0,colors=3;
    bool rectangular=true;
};

class ImageMatrices {`],
  ['    virtual void setBorder(unsigned int border) {}',`    virtual DecodedSourceFrame getDecodedSourceFrame() {
        DecodedSourceFrame result;getFullSize(result.width,result.height);
        result.fullWidth=result.width;result.fullHeight=result.height;return result;
    }
    virtual bool getDefaultCrop(int &x,int &y,int &w,int &h) const { return getCameraCrop(x,y,w,h); }
    virtual void setBorder(unsigned int border) {}`]
 ]);
 patch('rawimage.h','default_crop_{};',[
  ['    std::array<int,4> camera_crop_{};',`    std::array<int,4> camera_crop_{};
    std::array<int,4> default_crop_{};`],
  ['    bool getCameraCrop(int &x, int &y, int &w, int &h) const;',`    bool getCameraCrop(int &x, int &y, int &w, int &h) const;
    bool getDefaultCrop(int &x, int &y, int &w, int &h) const;`]
 ]);
 patch('rawimage.cc','bool RawImage::getDefaultCrop(',[
  ['int RawImage::loadRaw(',`bool RawImage::getDefaultCrop(int &x,int &y,int &w,int &h) const
{
    if(default_crop_[2]<=0||default_crop_[3]<=0)return getCameraCrop(x,y,w,h);
    // LibRaw inset coordinates already include ActiveArea's sensor margins.
    // ART may refine those margins from camconst; intersect the decoded plane.
    const int left=default_crop_[0]-left_margin,top=default_crop_[1]-top_margin;
    const int right=std::min<int>(width,left+default_crop_[2]),bottom=std::min<int>(height,top+default_crop_[3]);
    x=std::max(0,left);y=std::max(0,top);w=right-x;h=bottom-y;
    return w>0&&h>0;
}

int RawImage::loadRaw(`],
  ['    camera_crop_ = {};','    camera_crop_ = {};default_crop_ = {};'],
  ['        int err = libraw_->open_buffer(ifp->data, ifp->size);',`        int err = libraw_->open_buffer(ifp->data, ifp->size);
        if(err==LIBRAW_SUCCESS){
            const auto &crop=libraw_->imgdata.sizes.raw_inset_crops[0];
            if(crop.cleft!=65535&&crop.ctop!=65535&&crop.cwidth>0&&crop.cheight>0&&crop.cwidth!=65535&&crop.cheight!=65535)
                default_crop_={int(crop.cleft),int(crop.ctop),int(crop.cwidth),int(crop.cheight)};
        }`]
 ]);
 patch('rawimagesource.h','DecodedSourceFrame getDecodedSourceFrame()',[
  ['    bool getCameraCrop(int &x, int &y, int &w, int &h) const override;',`    bool getCameraCrop(int &x, int &y, int &w, int &h) const override;
    bool getDefaultCrop(int &x,int &y,int &w,int &h) const override;
    DecodedSourceFrame getDecodedSourceFrame() override;`]
 ]);
 patch('rawimagesource.cc','DecodedSourceFrame RawImageSource::getDecodedSourceFrame()',[
  ['void RawImageSource::getFullSize(',`DecodedSourceFrame RawImageSource::getDecodedSourceFrame()
{
    DecodedSourceFrame result;
    result.left=ri->get_leftmargin();result.top=ri->get_topmargin();
    result.width=ri->get_width();result.height=ri->get_height();
    computeFullSize(ri,0,result.fullWidth,result.fullHeight,0);
    result.border=border;result.colors=ri->get_colors();
    if(ri->getSensorType()==ST_BAYER)for(int row=0;row<2;++row)for(int col=0;col<2;++col)
        if(FC(row,col)==3)result.colors=4;
    result.rectangular=!ri->get_FujiWidth()&&ri->get_model()!="D1X";
    return result;
}

bool RawImageSource::getDefaultCrop(int &x,int &y,int &w,int &h) const
{
    if(!ri||ri->get_FujiWidth()||ri->get_model()=="D1X"||!ri->getDefaultCrop(x,y,w,h))return false;
    const int W=ri->get_width()-2*border,H=ri->get_height()-2*border;
    const int right=std::min(x+w-border,W),bottom=std::min(y+h-border,H);
    x=std::max(0,x-border);y=std::max(0,y-border);w=right-x;h=bottom-y;
    if(w<=0||h<=0)return false;
    const int ox=x,oy=y,ow=w,oh=h;
    switch(ri->get_rotateDegree()){
    case 90:x=H-oy-oh;y=ox;w=oh;h=ow;break;
    case 180:x=W-ox-ow;y=H-oy-oh;break;
    case 270:x=oy;y=W-ox-ow;w=oh;h=ow;break;
    }
    return true;
}

void RawImageSource::getFullSize(`]
 ]);
 // Working margins may be relative to LibRaw's already cropped buffer.
 // Keep the physical origin separately; the old cameraCrop path is untouched.
 patch('rawimage.h','int source_frame_left_ = 0, source_frame_top_ = 0;',[
  ['    std::array<int,4> default_crop_{};',`    std::array<int,4> default_crop_{};
    int source_frame_left_ = 0, source_frame_top_ = 0;`],
  ['    bool getDefaultCrop(int &x, int &y, int &w, int &h) const;',`    bool getDefaultCrop(int &x, int &y, int &w, int &h) const;
    int getSourceFrameLeft() const { return source_frame_left_; }
    int getSourceFrameTop() const { return source_frame_top_; }`]
 ]);
 patch('rawimage.cc','// CaptRAW: retain physical sensor origin before working margins change.',[
  ['    camera_crop_ = {};default_crop_ = {};','    camera_crop_ = {};default_crop_ = {};source_frame_left_=source_frame_top_=0;'],
  ['        if (adjust_margins) {',`        // CaptRAW: retain physical sensor origin before working margins change.
        source_frame_left_=int(left_margin)+(adjust_margins?raw_left_margin:0);
        source_frame_top_=int(top_margin)+(adjust_margins?raw_top_margin:0);
        if (adjust_margins) {`],
  ['    const int left=default_crop_[0]-left_margin,top=default_crop_[1]-top_margin;','    const int left=default_crop_[0]-source_frame_left_,top=default_crop_[1]-source_frame_top_;']
 ]);
 patch('rawimagesource.cc','// CaptRAW: describe physical decoded sensor origin.',[
  ['    result.left=ri->get_leftmargin();result.top=ri->get_topmargin();',`    // CaptRAW: describe physical decoded sensor origin.
    result.left=ri->getSourceFrameLeft();result.top=ri->getSourceFrameTop();`]
 ]);
 // Bayer/XTrans retain the existing parameter-driven boundary. Linear RAW
 // needs the explicit document boundary in preview and independent export.
 for(const file of ['simpleprocess.cc','improccoordinator.cc'])patch(file,'// CaptRAW: source frame for already demosaiced RAW.',[
  ['#include "', '#include "source-frame.h"\n#include "'],
  ['if (imgsrc->getSensorType() == ST_BAYER) {','if (!params.commonTrans.captrawSourceFrameSaved && imgsrc->getSensorType() == ST_BAYER) {'],
  ['} else if (imgsrc->getSensorType() == ST_FUJI_XTRANS) {','} else if (!params.commonTrans.captrawSourceFrameSaved && imgsrc->getSensorType() == ST_FUJI_XTRANS) {'],
  [file==='simpleprocess.cc'?'        imgsrc->getFullSize(fw, fh, tr);':'            bool autoContrast =',file==='simpleprocess.cc'?`        // CaptRAW: source frame for already demosaiced RAW.
        applySourceFrame(imgsrc,params);
        imgsrc->getFullSize(fw, fh, tr);`:`            // CaptRAW: source frame for already demosaiced RAW.
            applySourceFrame(imgsrc,params);
            bool autoContrast =`]
 ]);
 patch('masks.cc','// CaptRAW: authoring frame raster dimensions.',[
  ['    const int raster_w=geometry ? width : guide.width(), raster_h=geometry ? height : guide.height();',`    // CaptRAW: authoring frame raster dimensions.
    if(geometry){width=geometry->referenceWidth();height=geometry->referenceHeight();}
    const int raster_w=geometry ? width : guide.width(), raster_h=geometry ? height : guide.height();`],
  ['    int mask_w = geometry ? width : guide.width();',`    if(geometry){width=geometry->referenceWidth();height=geometry->referenceHeight();}
    int mask_w = geometry ? width : guide.width();`],
  ['    const int dW = full_width;\n    const int dH = full_height;',`    const int dW = geometry ? geometry->referenceWidth() : full_width;
    const int dH = geometry ? geometry->referenceHeight() : full_height;`]
 ]);
 patch('masks.cc','// CaptRAW: center uses the authoring frame.',[
  ['    float w2 = float(width) / 2.f;',`    // CaptRAW: center uses the authoring frame.
    if(geometry){width=geometry->referenceWidth();height=geometry->referenceHeight();}
    float w2 = float(width) / 2.f;`],
  ['    // CaptRAW: authoring frame raster dimensions.\n    if(geometry){width=geometry->referenceWidth();height=geometry->referenceHeight();}',
   '    // CaptRAW: authoring frame raster dimensions.']
 ]);
 // Decoder policy is set before the initial RAW read, including export jobs.
 // The default argument preserves every existing ART caller's old geometry.
 patch('rtengine.h','bool sensorCrop = false);',[
  ['int *errorCode, ProgressListener *pl = nullptr);','int *errorCode, ProgressListener *pl = nullptr, bool sensorCrop = false);']
 ]);
 patch('loadinitial.cc','bool sensorCrop)',[
  ['int *errorCode, ProgressListener *pl)','int *errorCode, ProgressListener *pl, bool sensorCrop)'],
  ['        isrc = new RawImageSource();',`        auto *raw=new RawImageSource();raw->captrawSourceFrameDecode=sensorCrop;
        isrc=raw;`]
 ]);
 patch('imagesource.h','bool sensorCrop=false;',[
  ['    bool rectangular=true;','    bool rectangular=true;bool sensorCrop=false;']
 ]);
 patch('rawimage.h','bool captrawSourceFrameDecode = false;',[
  ['    explicit RawImage(const Glib::ustring &name);','    bool captrawSourceFrameDecode = false;\n    explicit RawImage(const Glib::ustring &name);']
 ]);
 patch('rawimagesource.h','bool captrawSourceFrameDecode = false;',[
  ['    RawImageSource();','    bool captrawSourceFrameDecode = false;\n    RawImageSource();']
 ]);
 patch('rawimagesource.cc','// CaptRAW: decoder model reaches every RAW frame.',[
  ['    ri = new RawImage(fname);',`    // CaptRAW: decoder model reaches every RAW frame.
    ri = new RawImage(fname);ri->captrawSourceFrameDecode=captrawSourceFrameDecode;`],
  ['                    errCodeThr = riFrames[i]->loadRaw(true, i + 1);','                    riFrames[i]->captrawSourceFrameDecode=captrawSourceFrameDecode;\n                    errCodeThr = riFrames[i]->loadRaw(true, i + 1);'],
  ['                    errCodeThr = riFrames[i]->loadRaw(true, i);','                    riFrames[i]->captrawSourceFrameDecode=captrawSourceFrameDecode;\n                    errCodeThr = riFrames[i]->loadRaw(true, i);'],
  ['    result.border=border;result.colors=ri->get_colors();','    result.sensorCrop=captrawSourceFrameDecode;\n    result.border=border;result.colors=ri->get_colors();']
 ]);
 patch('rawimage.cc','// CaptRAW: opt-in decoder endpoints and unrounded camera crop.',[
  ['#include "rawimage.h"','#include "rawimage.h"\n#ifdef ART_USE_LIBRAW\n#include "source-frame-libraw.h"\n#endif'],
  ['    libraw_.reset(new LibRaw());',`    // CaptRAW: opt-in decoder endpoints and unrounded camera crop.
    libraw_.reset(captrawSourceFrameDecode?new SourceFrameLibRaw():new LibRaw());`],
  ['                default_crop_={int(crop.cleft),int(crop.ctop),int(crop.cwidth),int(crop.cheight)};'
   ,`                default_crop_={int(crop.cleft),int(crop.ctop),int(crop.cwidth),int(crop.cheight)};
            if(captrawSourceFrameDecode){
                const auto &native=static_cast<SourceFrameLibRaw *>(libraw_.get())->cameraCrop;
                if(native[2]>0&&native[3]>0)default_crop_=native;
            }`]
 ]);
 patch('simpleprocess.cc','// CaptRAW: select decoder before independent export loading.',[
  ['            ii = InitialImage::load(job->fname, job->isRaw, &errorCode);',`            // CaptRAW: select decoder before independent export loading.
            ii = InitialImage::load(job->fname,job->isRaw,&errorCode,nullptr,sourceFrameDecode(job->pparams));`]
 ]);
 // Runtime only: reference bindings persist their own stable content identity.
 patch('procparams.h','std::string captrawSourceIdentity;',[
  ['    std::string captrawSourceFrame;','    std::string captrawSourceFrame;\n    std::string captrawSourceIdentity;']
 ]);
}
