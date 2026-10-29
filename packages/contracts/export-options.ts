export type ExportFormat='jpeg'|'tiff'|'avif';
export interface OutputMetadataOptions {include:'all'|'all-except-develop'|'copyright'|'none';removeLocation:boolean}
export interface ExportOptions {
 size:{mode:'original'|'long-edge'|'short-edge'|'bounds';width:number;height:number;dontEnlarge:boolean};
 sharpen:{enabled:boolean;amount:number;radius:number};
 resolution?:number;
 jpegQuality?:number;
 tiffCompression?:'zip'|'none';
 metadata?:OutputMetadataOptions;
}
export const DEFAULT_EXPORT_OPTIONS:ExportOptions={size:{mode:'original',width:2048,height:2048,dontEnlarge:true},sharpen:{enabled:false,amount:80,radius:.5},resolution:300,jpegQuality:12,tiffCompression:'zip',metadata:{include:'all-except-develop',removeLocation:false}};
export function validateExportOptions(value:ExportOptions|undefined){
 if(value===undefined)return;
 const s=value?.size,p=value?.sharpen;
 if(!s||!['original','long-edge','short-edge','bounds'].includes(s.mode)||!Number.isInteger(s.width)||!Number.isInteger(s.height)||s.width<1||s.height<1||s.width>65000||s.height>65000||typeof s.dontEnlarge!=='boolean')throw new Error('输出尺寸须为 1–65000 的整数像素。');
 if(!p||typeof p.enabled!=='boolean'||!Number.isInteger(p.amount)||p.amount<0||p.amount>300||!Number.isFinite(p.radius)||p.radius<.1||p.radius>3)throw new Error('输出锐化数量须为 0–300，半径须为 0.1–3 像素。');
 if(value.resolution!==undefined&&(!Number.isInteger(value.resolution)||value.resolution<1||value.resolution>999))throw new Error('输出分辨率须为 1–999 的整数 PPI。');
 if(value.jpegQuality!==undefined&&(!Number.isInteger(value.jpegQuality)||value.jpegQuality<0||value.jpegQuality>12))throw new Error('JPEG 质量须为 0–12 的整数。');
 if(value.tiffCompression!==undefined&&!['zip','none'].includes(value.tiffCompression))throw new Error('TIFF 压缩须选择 ZIP 或无压缩。');
 if(value.metadata!==undefined&&(!value.metadata||!['all','all-except-develop','copyright','none'].includes(value.metadata.include)||typeof value.metadata.removeLocation!=='boolean'))throw new Error('输出元数据选项无效。');
}
export function outputDimensions(width:number,height:number,options:ExportOptions){
 validateExportOptions(options);const s=options.size;
 let scale=s.mode==='original'?1:s.mode==='long-edge'?s.width/Math.max(width,height):s.mode==='short-edge'?s.width/Math.min(width,height):Math.min(s.width/width,s.height/height);
 if(s.dontEnlarge)scale=Math.min(scale,1);
 if(Math.abs(scale-1)<=1e-5)scale=1;
 const w=Math.round(width*scale),h=Math.round(height*scale);
 if(w<1||h<1||w>65000||h>65000||w*h>512000000)throw new Error('计算后的输出须至少 1 像素，每边不超过 65000 像素且不超过 512 MP。');
 return {width:w,height:h};
}
