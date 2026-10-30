import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function patchRepairContinuous(upstream){
 const patch=(file,marker,edits)=>{
  const path=join(upstream,'src/engine',file);let source=readFileSync(path,'utf8');
  if(source.includes(marker))return;
  for(const [before,after] of edits){
   if(!source.includes(before)||source.indexOf(before)!==source.lastIndexOf(before))throw new Error('Continuous repair patch anchor mismatch: '+file+' / '+before.slice(0,70));
   source=source.replace(before,()=>after);
  }
  if(!source.includes(marker))throw new Error('Continuous repair marker missing: '+file);
  writeFileSync(path,source);
 };
 patch('procparams.h','std::vector<double> repairPath;',[
  ['struct SpotEntry {','struct SpotEntry {\n    std::vector<double> repairPath; // Source-image pixel centers, one connected target path.']
 ]);
 patch('procparams.cc','other.repairPath == repairPath',[
  ['           other.opacity == opacity && other.detail == detail;',
   '           other.opacity == opacity && other.detail == detail && other.repairPath == repairPath;'],
  ['                saveToKeyfile("Spot Removal", ss.str(), entry, keyFile);',`                saveToKeyfile("Spot Removal", ss.str(), entry, keyFile);
                if (!spot.entries[i].repairPath.empty())
                    keyFile.set_double_list("Spot Removal", "RepairPath" + std::to_string(i+1), spot.entries[i].repairPath);`],
  ['                        spot.entries.push_back(se);',`                        const auto pathKey = "RepairPath" + std::to_string(i);
                        if (keyFile.has_key("Spot Removal", pathKey)) {
                            const auto path = keyFile.get_double_list("Spot Removal", pathKey);
                            if (path.size()<4 || path.size()%2 || path.size()>65536)
                                throw std::runtime_error("Invalid stored repair path");
                            se.repairPath.assign(path.begin(),path.end());
                            for (const double v: se.repairPath)
                                if (!std::isfinite(v) || v<0 || v>1e7)
                                    throw std::runtime_error("Invalid stored repair path coordinate");
                        }
                        spot.entries.push_back(se);`]
 ]);
 patch('ipspot.cc','// Connected repair domain.',[
  ['#include "improcfun.h"','#include "improcfun.h"\n#include "repair.h"'],
  ['    int detail;\n\n    SpotBox(', '    int detail;\n    std::vector<double> repairPath;\n\n    SpotBox('],
  ['        imgArea = spotArea;\n    }',`        // Connected repair domain. Legacy points retain their original bounds.
        repairPath = spot.repairPath;
        if (!repairPath.empty()) {
            const double dx=type==Type::SOURCE ? spot.sourcePos.x-spot.targetPos.x : 0;
            const double dy=type==Type::SOURCE ? spot.sourcePos.y-spot.targetPos.y : 0;
            double xmin=1e20,ymin=1e20,xmax=-1e20,ymax=-1e20;
            for(size_t i=0;i<repairPath.size();i+=2){
                repairPath[i]+=dx;repairPath[i+1]+=dy;
                xmin=std::min(xmin,repairPath[i]);xmax=std::max(xmax,repairPath[i]);
                ymin=std::min(ymin,repairPath[i+1]);ymax=std::max(ymax,repairPath[i+1]);
            }
            const int edge=int(std::ceil(featherRadius))+2;
            spotArea=Rectangle(int(std::floor(xmin))-edge,int(std::floor(ymin))-edge,
                               int(std::ceil(xmax))+edge,int(std::ceil(ymax))+edge);
        }
        imgArea = spotArea;
    }`],
  ['        featherRadius = getWidth() / 2.f;',`        if(repairPath.empty()) featherRadius = getWidth() / 2.f;
        else {featherRadius/=float(v);for(auto &point:repairPath)point/=v;}`],
  ['        if (detail >= 2) {',`        if (!repairPath.empty()) {
            auto local=repairPath;
            for(size_t i=0;i<local.size();i+=2){local[i]-=x1;local[i+1]-=y1;}
            repairStroke(image,dstImg,src_x,src_y,dst_x,dst_y,x2-x1+1,y2-y1+1,
                         local,radius,featherRadius,opacity,detail,heal_laplace_loop);
            return true;
        }
        if (detail >= 2) {`],
  ['                        ->imageIntersects(*dstSpotBoxs.at(j))) {',
   '                        ->imageIntersects(*dstSpotBoxs.at(j)) ||\n                    (!srcSpotBoxs.at(spotNbr)->repairPath.empty() && dstSpotBoxs.at(spotNbr)->imageIntersects(*dstSpotBoxs.at(j)))) {']
 ]);
}
