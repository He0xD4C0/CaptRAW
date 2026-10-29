// Runtime validation at XMP/IPC boundaries; authoring transforms remain opaque.
export function validateBrushPrograms(masks:unknown):void {
 if(masks===undefined)return;
 if(!Array.isArray(masks))throw new Error('蒙版必须为数组。');
 const object=(value:unknown):Record<string,any>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('画笔程序结构无效。');return value as Record<string,any>;};
 const number=(o:Record<string,any>,key:string,low:number,high:number)=>{const n=o[key];if(typeof n!=='number'||!Number.isFinite(n)||n<low||n>high)throw new Error('画笔参数无效：'+key);return n;};
 const point=(value:unknown,radius=false)=>{const p=object(value);number(p,'x',0,1);number(p,'y',0,1);if(radius){number(p,'radius',.001,5);if(p.erase!==undefined)throw new Error('擦除操作必须保存在笔画上。');}};
 const visit=(value:unknown,depth:number)=>{
  const m=object(value);if(depth>8)throw new Error('蒙版分组过深。');
  if(m.brush!==undefined){
   if(m.type!=='brush')throw new Error('画笔程序仅适用于画笔蒙版。');
   const program=object(m.brush);if(program.version!==1||!Array.isArray(program.strokes)||program.strokes.length>4096)throw new Error('画笔程序版本或笔画数量无效。');
   const ids=new Set<string>();let count=0;
   for(const value of program.strokes){
    const s=object(value);
    for(const key of ['id','gestureId'])if(typeof s[key]!=='string'||!s[key]||s[key].length>128)throw new Error('画笔笔画标识无效。');
    if(ids.has(s.id))throw new Error('画笔笔画标识重复。');ids.add(s.id);
    if(!['paint','erase'].includes(s.operation))throw new Error('画笔操作无效。');
    number(s,'flow',0,100);number(s,'density',0,100);number(s,'feather',0,100);
    const canvas=object(s.canvas),w=number(canvas,'width',1,65000),h=number(canvas,'height',1,65000);
    if(!Number.isInteger(w)||!Number.isInteger(h)||w*h>512000000)throw new Error('画笔画布尺寸无效。');
    const ref=object(s.geometryReference);if(![1,2,3].includes(ref.version)||typeof ref.data!=='string'||!ref.data||ref.data.length>65536)throw new Error('画笔几何引用无效。');
    if(!Array.isArray(s.points)||!s.points.length||s.points.length>65536)throw new Error('画笔坐标数量无效。');
    count+=s.points.length;if(count>1000000)throw new Error('画笔坐标过多。');for(const p of s.points)point(p,true);
    if(s.autoMask!==false){
     const a=object(s.autoMask);if(a.model!=='art-deltae-seed-v1')throw new Error('自动蒙版模型无效。');number(a,'tolerance',.25,20);
     const seed=object(a.seed);number(seed,'l',-1000,1000);number(seed,'c',0,1000);number(seed,'h',0,360);point(seed.point);
     if(!s.coverage)throw new Error('自动蒙版缺少已冻结的覆盖率资产。');
    }
    if(s.coverage!==undefined){
     const r=object(s.coverage);if(typeof r.path!=='string'||!r.path||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256))throw new Error('画笔覆盖率资产标识无效。');
     if(r.width!==w||r.height!==h)throw new Error('画笔覆盖率资产与创作画布尺寸不符。');
    }
   }
  }
  if(m.components!==undefined){if(!Array.isArray(m.components)||m.components.length>32)throw new Error('蒙版组件无效。');for(const child of m.components)visit(child,depth+1);}
 };
 for(const m of masks)visit(m,0);
}
