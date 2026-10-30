import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function patchOutputOptions(upstream){
 const patch=(file,marker,edits)=>{
  const path=join(upstream,'src/engine',file);let source=readFileSync(path,'utf8');
  if(source.includes(marker))return;
  for(const [before,after] of edits){
   if(source.split(before).length!==2)throw new Error('ART output options anchor mismatch: '+file+' / '+before.slice(0,60));
   source=source.replace(before,()=>after);
  }
  writeFileSync(path,source);
 };
 patch('imageio.h','void setOutputResolution(',[
  ['    Exiv2Metadata metadataInfo;','    Exiv2Metadata metadataInfo;\n    int captrawOutputResolution = 0;'],
  ['    void setOutputProfile(const char *pdata, int plen);','    void setOutputProfile(const char *pdata, int plen);\n    void setOutputResolution(int resolution) { captrawOutputResolution=resolution; }']
 ]);
 patch('imageio.cc','// CaptRAW: encode the requested output file options.',[
  ['    TIFFSetField(out, TIFFTAG_XRESOLUTION, x_res);','    // CaptRAW: encode the requested output file options.\n    if(captrawOutputResolution>0){x_res=y_res=captrawOutputResolution;res_unit=RESUNIT_INCH;}\n    TIFFSetField(out, TIFFTAG_XRESOLUTION, x_res);']
 ]);
}
