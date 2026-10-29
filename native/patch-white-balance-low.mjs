import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
// Expose the pinned GPL ART integrator; do not duplicate its observer table.
export function patchWhiteBalanceLow(upstream){
 const patch=(name,marker,anchor,replacement)=>{
  const path=join(upstream,'src/engine',name),source=readFileSync(path,'utf8');
  if(source.includes(marker))return;
  if(source.split(anchor).length!==2)throw new Error('ART low white balance anchor mismatch: '+name);
  writeFileSync(path,source.replace(anchor,replacement));
 };
 patch('colortemp.h','static std::array<double, 2> captrawPlanckXY','    ColorTemp();','    static std::array<double, 2> captrawPlanckXY(double temperature);\n    ColorTemp();');
 patch('colortemp.cc','ColorTemp::captrawPlanckXY','} // namespace\n\nColorTemp::ColorTemp()',`} // namespace

std::array<double, 2> ColorTemp::captrawPlanckXY(double temperature)
{
    double x, y, z;
    spectrum_to_xyz_blackbody(temperature, x, y, z);
    return {x, y};
}

ColorTemp::ColorTemp()`);
}
