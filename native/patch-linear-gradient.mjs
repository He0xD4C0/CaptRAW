import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Apply after the mask geometry patches; no legacy gradient code is replaced.
export function patchLinearGradient(upstream){
 const replace=(s,from,to)=>{if(!s.includes(from))throw new Error('Linear gradient patch anchor missing: '+from.slice(0,80));return s.replace(from,to);};
 const patch=(file,marker,edit)=>{
  const path=join(upstream,'src/engine',file),source=readFileSync(path,'utf8');
  if(source.includes(marker)){
   if(file==='masks.cc'){
    const at=source.indexOf(marker),gradient=source.indexOf('        case AreaMask::Shape::GRADIENT: {');
    const legacy=source.indexOf('            Coord center(w2 + area->x / 100.0 * w2, h2 + area->y / 100.0 * h2);',gradient);
    if(at<gradient||at>legacy||at!==source.lastIndexOf(marker))throw new Error('Misplaced Full/Zero patch: restore masks.cc before replay');
   }
   return;
  }
  const next=edit(source);if(next===source||!next.includes(marker))throw new Error('Linear gradient patch failed: '+file);
  writeFileSync(path,next);
 };
 patch('procparams.h','std::vector<double> captrawFullZero;',s=>replace(s,'    struct Gradient: public Shape {','    struct Gradient: public Shape {\n        std::vector<double> captrawFullZero; // Empty retains the legacy integer gradient.'));
 patch('procparams.cc','// Full/Zero gradient model v1.',s=>{
  s=replace(s,'#include "procparams.h"','#include "procparams.h"\n#include <stdexcept>');
  s=replace(s,'    return x == o->x && y == o->y && strengthStart == o->strengthStart &&','    return captrawFullZero == o->captrawFullZero &&\n           x == o->x && y == o->y && strengthStart == o->strengthStart &&');
  s=replace(s,'                AreaMask::Gradient *gradient = new AreaMask::Gradient();',`                AreaMask::Gradient *gradient = new AreaMask::Gradient();
                // Full/Zero gradient model v1.
                if(keyfile.has_key(group_name,prefix + "AreaMask" + n + "CaptRAWFullZeroV1" + suffix)){
                    gradient->captrawFullZero=keyfile.get_double_list(group_name,prefix + "AreaMask" + n + "CaptRAWFullZeroV1" + suffix);
                    if(gradient->captrawFullZero.size()!=4 || std::any_of(gradient->captrawFullZero.begin(),gradient->captrawFullZero.end(),[](double v){return !std::isfinite(v)||v<0||v>1;})){
                        delete gradient;throw std::runtime_error("Invalid Full/Zero gradient endpoints");
                    }
                }`);
  return replace(s,'            auto gradient = static_cast<AreaMask::Gradient *>(a.get());',`            auto gradient = static_cast<AreaMask::Gradient *>(a.get());
            if(!gradient->captrawFullZero.empty())
                putToKeyfile(group_name,prefix + "AreaMask" + n + "CaptRAWFullZeroV1" + suffix,gradient->captrawFullZero,keyfile);`);
 });
 const gradientCase='        case AreaMask::Shape::GRADIENT: {\n            auto area = static_cast<AreaMask::Gradient *>(area_.get());\n\n';
 patch('masks.cc','// Full/Zero projection uses continuous authoring coordinates.',s=>replace(s,gradientCase+'            Coord center(w2 + area->x / 100.0 * w2, h2 + area->y / 100.0 * h2);',gradientCase+`            // Full/Zero projection uses continuous authoring coordinates.
            if(!area->captrawFullZero.empty()){
                const auto &e=area->captrawFullZero;
                const double fx=e[0]*width,fy=e[1]*height;
                const double dx=(e[2]-e[0])*width,dy=(e[3]-e[1])*height;
                const double length2=dx*dx+dy*dy;
#ifdef _OPENMP
#pragma omp parallel for if(multithread)
#endif
                for(int y=0;y<raster_h;++y)for(int x=0;x<raster_w;++x){
                    const double t=length2>0?((x+origin.x-fx)*dx+(y+origin.y-fy)*dy)/length2:1.;
                    const float coverage=std::max(0.,std::min(1.,1.-t));
                    shape_mask[y][x]=area_->mode==AreaMask::Shape::SUBTRACT?1.f-coverage:coverage;
                }
                break;
            }
            Coord center(w2 + area->x / 100.0 * w2, h2 + area->y / 100.0 * h2);`));
}
