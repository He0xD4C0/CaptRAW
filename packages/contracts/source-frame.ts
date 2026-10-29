import type {Adjustments,SourceFrame} from './index.js';

export function sourceFramePolicyForDocument(document?:{engineVersion?:string;artProfile?:string;adjustments?:Pick<Adjustments,'sourceFrame'>}):SourceFrame['policy']{
 if(document?.adjustments?.sourceFrame)return document.adjustments.sourceFrame.policy;
 // A foreign Adobe sidecar is a new import, not a historical ART canvas.
 return document?.engineVersion||document?.artProfile?.trim()?'legacy':'active-area-v1';
}

export function validateSourceFrame(value:unknown):asserts value is SourceFrame{
 const f=value as SourceFrame;
 if(!f||f.version!==1||!['legacy','active-area-v1'].includes(f.policy)||!['rendered','bayer','xtrans','linear','foveon'].includes(f.sensor))throw new Error('原片框架版本或策略无效。');
 if(f.decoderModel!==undefined&&(f.decoderModel!=='sensor-crop-v1'||f.policy!=='active-area-v1'))throw new Error('原片解码框架模型无效。');
 for(const key of ['border','fullWidth','fullHeight','width','height','layoutWidth','layoutHeight'] as const)if(!Number.isInteger(f[key])||f[key]<(key==='border'?0:1)||f[key]>65000)throw new Error('原片框架尺寸无效。');
 if(f.width!==f.fullWidth-2*f.border||f.height!==f.fullHeight-2*f.border||f.fullWidth*f.fullHeight>512000000)throw new Error('原片框架边界不一致。');
 if(!f.decoded)throw new Error('原片缺少解码框架。');
 for(const key of ['left','top','width','height','rotation'] as const)if(!Number.isInteger(f.decoded[key])||f.decoded[key]<0||f.decoded[key]>65000)throw new Error('原片解码框架无效。');
 if(!f.decoded.width||!f.decoded.height||![0,90,180,270].includes(f.decoded.rotation))throw new Error('原片解码方向无效。');
}

// Geometry metadata travels with the existing document snapshot, before open
// computes any dimensions. The native side verifies it against the decoder.
export function sourceFrameOpenSnapshot(adjustments:Pick<Adjustments,'sourceFrame'>,artProfile:string,frame?:SourceFrame){
 const sourceFrame=adjustments.sourceFrame??frame;
 return {artProfile,...(sourceFrame?{sourceFrame:structuredClone(sourceFrame)}:{})};
}
