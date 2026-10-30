import {join} from 'node:path';
import {writeFile,copyFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {rgbTable,hsvTable,lookDefinition} from '../native/color/enhanced-table-native.mjs';
import {CRS,property,text} from '@captraw/desktop-core/documents';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function profilePacket(xmp,profile,{missing=false,unsupported=false}={}){
 const fields=[property(CRS,'PresetType',text('Look')),property(CRS,'UUID',text(profile.uuid)),property(CRS,'Name',{localized:profile.name}),property(CRS,'Group',{localized:profile.group}),property(CRS,'Copyright',text(profile.copyright)),property(CRS,'SupportsAmount',text(profile.supportsAmount?'True':'False'))];
 for(const key of ['SceneReferred','OutputReferred','Color','Monochrome','HighDynamicRange','NormalDynamicRange'])fields.push(property(CRS,'Supports'+key,text(profile['supports'+key]?'True':'False')));
 for(const [name,value] of Object.entries(profile.parameters))fields.push(property(CRS,name,text(value)));
 if(profile.baseProfile&&!profile.parameters.CameraProfile)fields.push(property(CRS,'CameraProfile',text(profile.baseProfile)));
 if(profile.cameraModelRestriction)fields.push(property(CRS,'CameraModelRestriction',text(profile.cameraModelRestriction)));
 if(profile.curve)fields.push(property(CRS,'ToneCurvePV2012',{options:0x600,items:profile.curve.map(p=>text(`${p.x*255}, ${p.y*255}`))}));
 if(!missing)for(const t of profile.tables)fields.push(property(CRS,'Table_'+t.fingerprint,text(t.data)));
 if(unsupported)fields.push(property(CRS,'UnknownRequiredFeature',text('1')));
 fields.push(property('urn:enhanced-test:opaque','Metadata',{fields:[property('urn:enhanced-test:opaque','Note',{value:'未知内容 原文',qualifiers:[property('urn:enhanced-test:opaque','Language',{value:'中文'})]})]}));
 return (await xmp.call('write','',fields)).packet;
}
export async function enhancedFixtures(root,xmp){
 const png=join(root,'中文 空格 彩色.png'),other=join(root,'第二张 彩色.png'),raw=join(root,'原始 测试.dng'),dcp=join(root,'基础 配置.dcp'),icc=join(root,'标准 显示.icc');
 execFileSync(process.env.CAPTRAW_QA_PYTHON||'build/qa-venv/bin/python',['-c',`import sys,numpy as np,tifffile
from pathlib import Path
from PIL import Image,ImageCms
p=Path(sys.argv[1]);x=np.linspace(0,1,256);y=np.linspace(0,1,128)[:,None];a=np.zeros((128,256,3));a[:,:,0]=x;a[:,:,1]=y;a[:,:,2]=(.2+.6*x*y)
icc=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes();Image.fromarray(np.rint(a*255).astype(np.uint8)).save(sys.argv[2],icc_profile=icc);Path(sys.argv[4]).write_bytes(icc)
matrix=[1,1,0,1,0,1,0,1,1,1,0,1,0,1,0,1,1,1]
tags=[(50721,'2i',9,matrix,False),(50778,'H',1,21,False),(50936,'s',0,'Enhanced Test Base',False),(50941,'I',1,0,False),(50708,'s',0,'CaptRAW Synthetic Bayer',False),(50940,'f',6,(0,0,.5,.6,1,1),False)]
tifffile.imwrite(sys.argv[3],np.zeros((1,1),np.uint8),metadata=None,extratags=tags);b=bytearray(Path(sys.argv[3]).read_bytes());b[2:4]=b'RC';Path(sys.argv[3]).write_bytes(b)
`,root,png,dcp,icc]);
 await copyFile(png,other);await copyFile('build/samples/synthetic.dng',raw);
 const rgb=lookDefinition(rgbTable());rgb.name='彩色 Look 中文';rgb.group='独立测试';
 const hsv=lookDefinition(hsvTable(),'LookTable');hsv.name='HSV Look';hsv.parameters={LookTable:hsv.tables[0].fingerprint};
 const both=structuredClone(rgb);both.uuid='CDEFAB1234567890CDEFAB1234567890';both.name='HSV + RGB 曲线';both.tables.push(hsv.tables[0]);both.parameters.LookTable=hsv.parameters.LookTable;both.curve=[{x:0,y:0},{x:.3,y:.38},{x:.7,y:.78},{x:1,y:1}];
 const rawLook=structuredClone(both);rawLook.uuid='DEFABC1234567890DEFABC1234567890';rawLook.name='RAW 基础 DCP Look';rawLook.baseProfile='Enhanced Test Base';rawLook.parameters.CameraProfile=rawLook.baseProfile;
 const fixed=structuredClone(rgb);fixed.uuid='EFABCD1234567890EFABCD1234567890';fixed.name='固定强度 Look';fixed.supportsAmount=false;
 const curveOnly=structuredClone(rgb);curveOnly.uuid='FABCD01234567890FABCD01234567890';curveOnly.name='仅曲线 无表 Look';curveOnly.parameters={};curveOnly.tables=[];curveOnly.curve=[{x:0,y:0},{x:.4,y:.6},{x:1,y:1}];
 const files={};for(const [key,profile] of Object.entries({rgb,hsv,both,rawLook,fixed,curveOnly})){files[key]=join(root,key+'.xmp');await writeFile(files[key],await profilePacket(xmp,profile));}
 const missing=join(root,'缺资产.xmp'),unsupported=join(root,'未知必要特性.xmp');await writeFile(missing,await profilePacket(xmp,rgb,{missing:true}));await writeFile(unsupported,await profilePacket(xmp,rgb,{unsupported:true}));
 const before=new Map(await Promise.all([png,other,raw,dcp,icc].map(async path=>[path,digest(await readFile(path))])));
 return {png,other,raw,dcp,icc,files,profiles:{rgb,hsv,both,rawLook,fixed,curveOnly},missing,unsupported,before};
}
