import {XMP,CRS,CT,TIFF,lookup,encodeAdjustments,decodeAdjustments,encode,property,readExtension,standardKeys,text} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
import {Presets} from '@captraw/desktop-core/presets';
import {Synchronizer} from '@captraw/desktop-core/synchronize';
import {saveRecipeWithMasks,restoreRecipeMasks} from '@captraw/desktop-core/mask-assets';
import {ENGINE_VERSION} from '@captraw/contracts';
import {resolve,join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,cpSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {EngineClient} from './engine-client.mjs';
const out=resolve(process.env.CAPTRAW_XMP_DOCUMENTS_OUT||'artifacts/xmp-documents');mkdirSync(out,{recursive:true});
const binary=resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp'),xmp=new XMP(binary),documents=new Documents(xmp),e=new EngineClient({cache:join(out,'core')}),sync=new Synchronizer(resolve(process.env.CAPTRAW_ENGINE||'build/native/captraw-engine'),resolve(process.env.CAPTRAW_RESOURCES||'build/native/resources'),join(out,'sync'),()=>{});
e.on('error',()=>{});const root=join(out,'library');rmSync(root,{recursive:true,force:true});const store=new Presets(root,e,join(out,'cache'),xmp);
const checks=[],pass=s=>{checks.push(s);console.log('PASS',s);},hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const fixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="fixture" xmlns:c="${CRS}" xmlns:u="https://example.invalid/unknown/" c:ProcessVersion="15.4" c:Exposure2012="1.25" c:DefringePurpleAmount="-35" u:Opaque="保留 &amp; 未知"><c:Name><rdf:Alt><rdf:li xml:lang="x-default">Adobe 测试预设</rdf:li><rdf:li xml:lang="en-US">English preset name</rdf:li></rdf:Alt></c:Name><c:MaskGroupBasedCorrections><rdf:Seq><rdf:li rdf:parseType="Resource"><c:CorrectionName>未接入选区</c:CorrectionName><u:Unknown>keep</u:Unknown></rdf:li></rdf:Seq></c:MaskGroupBasedCorrections></rdf:Description></rdf:RDF></x:xmpmeta>`;
try{
 const source=resolve('build/samples/synthetic.dng'),before=hash(source),image=await e.call('open',{path:source,sessionId:'xmp'}),profile=(await e.call('save')).artProfile;
 const external=join(out,'adobe.xmp');writeFileSync(external,fixture);const read=await documents.read(external);assert.deepEqual({...read.adjustments},{exposure:1.25});assert(read.warnings.some(x=>x.includes('Defringe*')&&x.includes('不完整')));pass('standard exposure imports without manufacturing absent defaults; incomplete standard groups are disclosed');
 const standardFields={Exposure2012:.75,Contrast2012:17,Highlights2012:-21,Shadows2012:32,Whites2012:11,Blacks2012:-14,Vibrance:18,Saturation:-9,Texture:23,Clarity2012:-16,Dehaze:12,PostCropVignetteAmount:-20,GrainAmount:7,Sharpness:44,SharpenRadius:1.2,LuminanceSmoothing:19,ColorNoiseReduction:28,LensManualDistortionAmount:-24,VignetteAmount:36,Temperature:5200,Tint:12};
 const mappedFixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="mapped" xmlns:c="${CRS}" c:ProcessVersion="15.4" ${Object.entries(standardFields).map(([key,value])=>`c:${key}="${value}"`).join(' ')}/></rdf:RDF></x:xmpmeta>`;
 const mappedFile=join(out,'all-standard-fields.xmp');writeFileSync(mappedFile,mappedFixture);const mapped=await documents.read(mappedFile);
 assert.deepEqual({...mapped.adjustments},{exposure:.75,contrast:17,highlights:-21,shadows:32,whites:11,blacks:-14,vibrance:18,saturation:-9,texture:23,clarity:-16,dehaze:12,vignette:-20,grain:7,sharpening:44,sharpenRadius:1.2,luminanceNoise:19,colorNoise:28,lensManualDistortion:-24,lensVignette:36,temperature:5200,tint:12});
 assert(mapped.warnings.some(value=>value.includes('尚未验证与 ACR 的像素等效')));
 const mappedDocument={xmpPacket:mapped.xmpPacket,engineVersion:ENGINE_VERSION,source:{path:source,size:readFileSync(source).length,sha256:before},artProfile:profile,adjustments:{...image.adjustments,...mapped.adjustments},baselineVersion:4};
 const mappedSaved=join(out,'all-standard-fields-saved.xmp');writeFileSync(mappedSaved,await documents.serialize(mappedDocument));const mappedProperties=(await xmp.read(mappedSaved)).properties,mappedExtension=readExtension(mappedProperties,'ARTAdjustments');
 for(const [key,value] of Object.entries(standardFields))assert.equal(Number(lookup(mappedProperties,CRS,key).value),value,key);
 for(const key of standardKeys)assert(!Object.hasOwn(mappedExtension,key),`${key} must not remain in the private extension`);
 pass('21 Adobe CRS controls import into real adjustment fields and save as standard properties without duplicate private ownership');
 const parametricCurve={shadows:14,darks:-8,lights:21,highlights:-17,splits:[19,53,81]},hsl={hue:[5,-4,3,2,-6,8,-3,1],saturation:[-9,4,7,-5,3,11,-2,6],luminance:[2,-3,8,5,-7,4,1,-5]},colorGrading={shadows:{hue:218,saturation:23,luminance:-5},midtones:{hue:44,saturation:8,luminance:3},highlights:{hue:31,saturation:12,luminance:7},global:{hue:197,saturation:4,luminance:-2},blending:73,balance:-14};
 const groupFields={ParametricShadows:parametricCurve.shadows,ParametricDarks:parametricCurve.darks,ParametricLights:parametricCurve.lights,ParametricHighlights:parametricCurve.highlights,ParametricShadowSplit:parametricCurve.splits[0],ParametricMidtoneSplit:parametricCurve.splits[1],ParametricHighlightSplit:parametricCurve.splits[2],
  HueAdjustmentRed:hsl.hue[0],HueAdjustmentOrange:hsl.hue[1],HueAdjustmentYellow:hsl.hue[2],HueAdjustmentGreen:hsl.hue[3],HueAdjustmentAqua:hsl.hue[4],HueAdjustmentBlue:hsl.hue[5],HueAdjustmentPurple:hsl.hue[6],HueAdjustmentMagenta:hsl.hue[7],
  SaturationAdjustmentRed:hsl.saturation[0],SaturationAdjustmentOrange:hsl.saturation[1],SaturationAdjustmentYellow:hsl.saturation[2],SaturationAdjustmentGreen:hsl.saturation[3],SaturationAdjustmentAqua:hsl.saturation[4],SaturationAdjustmentBlue:hsl.saturation[5],SaturationAdjustmentPurple:hsl.saturation[6],SaturationAdjustmentMagenta:hsl.saturation[7],
  LuminanceAdjustmentRed:hsl.luminance[0],LuminanceAdjustmentOrange:hsl.luminance[1],LuminanceAdjustmentYellow:hsl.luminance[2],LuminanceAdjustmentGreen:hsl.luminance[3],LuminanceAdjustmentAqua:hsl.luminance[4],LuminanceAdjustmentBlue:hsl.luminance[5],LuminanceAdjustmentPurple:hsl.luminance[6],LuminanceAdjustmentMagenta:hsl.luminance[7],
  SplitToningShadowHue:colorGrading.shadows.hue,SplitToningShadowSaturation:colorGrading.shadows.saturation,ColorGradeShadowLum:colorGrading.shadows.luminance,ColorGradeMidtoneHue:colorGrading.midtones.hue,ColorGradeMidtoneSat:colorGrading.midtones.saturation,ColorGradeMidtoneLum:colorGrading.midtones.luminance,SplitToningHighlightHue:colorGrading.highlights.hue,SplitToningHighlightSaturation:colorGrading.highlights.saturation,ColorGradeHighlightLum:colorGrading.highlights.luminance,ColorGradeGlobalHue:colorGrading.global.hue,ColorGradeGlobalSat:colorGrading.global.saturation,ColorGradeGlobalLum:colorGrading.global.luminance,ColorGradeBlending:colorGrading.blending,SplitToningBalance:colorGrading.balance};
 const groupFixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="groups" xmlns:c="${CRS}" c:ProcessVersion="15.4" ${Object.entries(groupFields).map(([key,value])=>`c:${key}="${value}"`).join(' ')}/></rdf:RDF></x:xmpmeta>`;
 const groupFile=join(out,'parametric-hsl.xmp');writeFileSync(groupFile,groupFixture);const grouped=await documents.read(groupFile);
 assert.deepEqual(grouped.adjustments,{parametricCurve,hsl,colorGrading});assert(grouped.warnings.some(value=>value.includes('尚未验证与 ACR 的像素等效')));
 const groupedDocument={xmpPacket:grouped.xmpPacket,engineVersion:ENGINE_VERSION,source:{path:source,size:readFileSync(source).length,sha256:before},artProfile:profile,adjustments:{...image.adjustments,parametricCurve,hsl,colorGrading},baselineVersion:4};
 const groupedSaved=join(out,'parametric-hsl-saved.xmp');writeFileSync(groupedSaved,await documents.serialize(groupedDocument));const groupedProperties=(await xmp.read(groupedSaved)).properties,groupedExtension=readExtension(groupedProperties,'ARTAdjustments');
 for(const [key,value] of Object.entries(groupFields))assert.equal(Number(lookup(groupedProperties,CRS,key).value),value,key);
 assert(!Object.hasOwn(groupedExtension,'parametricCurve'));assert(!Object.hasOwn(groupedExtension,'hsl'));assert(!Object.hasOwn(groupedExtension,'colorGrading'));
 pass('Parametric, HSL and Color Grade groups import and save as standard CRS properties without private duplicates');
 const partialParametric=groupFixture.replace(` c:ParametricHighlights="${groupFields.ParametricHighlights}"`,''),partialParametricRead=await documents.read((writeFileSync(join(out,'partial-parametric.xmp'),partialParametric),join(out,'partial-parametric.xmp')));
 assert.equal(partialParametricRead.adjustments.parametricCurve.highlights,undefined);assert.equal(partialParametricRead.adjustments.parametricCurve.shadows,parametricCurve.shadows);
 const partialHsl=groupFixture.replace(` c:LuminanceAdjustmentBlue="${groupFields.LuminanceAdjustmentBlue}"`,''),partialHslPath=join(out,'partial-hsl.xmp');writeFileSync(partialHslPath,partialHsl);const partialHslRead=await documents.read(partialHslPath);
 assert.equal(partialHslRead.adjustments.hsl.luminance[5],undefined);assert.equal(partialHslRead.adjustments.hsl.hue[0],hsl.hue[0]);
 const partialGrading=groupFixture.replace(` c:SplitToningBalance="${groupFields.SplitToningBalance}"`,''),partialGradingPath=join(out,'partial-grading.xmp');writeFileSync(partialGradingPath,partialGrading);const partialGradingRead=await documents.read(partialGradingPath);
 assert.equal(partialGradingRead.adjustments.colorGrading.balance,undefined);assert.equal(partialGradingRead.adjustments.colorGrading.blending,colorGrading.blending);
 const invalidSplits=groupFixture.replace(`c:ParametricShadowSplit="${parametricCurve.splits[0]}"`,'c:ParametricShadowSplit="53"').replace(`c:ParametricMidtoneSplit="${parametricCurve.splits[1]}"`,'c:ParametricMidtoneSplit="53"');
 writeFileSync(join(out,'invalid-group-splits.xmp'),invalidSplits);await assert.rejects(documents.read(join(out,'invalid-group-splits.xmp')),/参数曲线分界无效/);
 const invalidGrading=groupFixture.replace(`c:ColorGradeGlobalHue="${colorGrading.global.hue}"`,'c:ColorGradeGlobalHue="361"');writeFileSync(join(out,'invalid-grading.xmp'),invalidGrading);await assert.rejects(documents.read(join(out,'invalid-grading.xmp')),/ColorGradeGlobalHue/);
 pass('partial Parametric / HSL / Color Grade groups retain only supplied fields and invalid splits or ranges are rejected');
 const mixer=[12,-18,7,31,-9,14,-5,3],blackWhite={enabled:true,mixer,base:{preset:'RGB-Rel',filter:'Red',weights:[33,33,33],gamma:[-15,-15,-15],tint:{amount:0,hue:0}}};
 const grayNames=['Red','Orange','Yellow','Green','Aqua','Blue','Purple','Magenta'],grayFields={ConvertToGrayscale:'True',...Object.fromEntries(grayNames.map((name,index)=>[`GrayMixer${name}`,mixer[index]]))};
 const blackWhiteFixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="black-white" xmlns:c="${CRS}" c:ProcessVersion="15.4" ${Object.entries(grayFields).map(([key,value])=>`c:${key}="${value}"`).join(' ')}/></rdf:RDF></x:xmpmeta>`;
 const blackWhiteFile=join(out,'black-white.xmp');writeFileSync(blackWhiteFile,blackWhiteFixture);const blackWhiteRead=await documents.read(blackWhiteFile);
 assert.deepEqual(blackWhiteRead.adjustments,{blackWhite:{enabled:true,mixer}});assert(blackWhiteRead.warnings.some(value=>value.includes('尚未验证与 ACR 的像素等效')));
 const blackWhiteDocument={...mappedDocument,adjustments:{...image.adjustments,blackWhite}},savedBlackWhite=join(out,'black-white-saved.xmp');
 writeFileSync(savedBlackWhite,await documents.serialize(blackWhiteDocument));const blackWhiteProperties=(await xmp.read(savedBlackWhite)).properties,blackWhiteExtension=readExtension(blackWhiteProperties,'ARTAdjustments');
 for(const [key,value] of Object.entries(grayFields))assert.equal(lookup(blackWhiteProperties,CRS,key).value,String(value),key);
 assert.deepEqual(blackWhiteExtension.blackWhite,{base:blackWhite.base});assert(!Object.hasOwn(blackWhiteExtension.blackWhite,'enabled'));assert(!Object.hasOwn(blackWhiteExtension.blackWhite,'mixer'));
 pass('ConvertToGrayscale and all eight GrayMixer fields import and save as standard CRS properties while ART base metadata remains private');
 const partialGray=blackWhiteFixture.replace(` c:GrayMixerBlue="${grayFields.GrayMixerBlue}"`,''),partialGrayFile=join(out,'partial-gray.xmp');writeFileSync(partialGrayFile,partialGray);const partialGrayRead=await documents.read(partialGrayFile);
 assert(!Object.hasOwn(partialGrayRead.adjustments,'blackWhite'));assert(partialGrayRead.warnings.some(value=>value.includes('GrayMixer*')&&value.includes('不完整')));
 for(const [name,value] of [['ConvertToGrayscale','Yes'],['GrayMixerRed','1.5'],['GrayMixerGreen','-101']]){
  const invalid=join(out,`invalid-${name}.xmp`);writeFileSync(invalid,blackWhiteFixture.replace(`c:${name}="${grayFields[name]}"`,`c:${name}="${value}"`));
  await assert.rejects(documents.read(invalid),new RegExp(name));
 }
 pass('partial GrayMixer groups are not applied and invalid boolean, fractional or out-of-range values are rejected');
 const defringe={purpleAmount:60,purpleHueLo:20,purpleHueHi:80,greenAmount:40,greenHueLo:35,greenHueHi:65},defringeFields={DefringePurpleAmount:defringe.purpleAmount,DefringePurpleHueLo:defringe.purpleHueLo,DefringePurpleHueHi:defringe.purpleHueHi,DefringeGreenAmount:defringe.greenAmount,DefringeGreenHueLo:defringe.greenHueLo,DefringeGreenHueHi:defringe.greenHueHi};
 const defringeFixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="defringe" xmlns:c="${CRS}" ${Object.entries(defringeFields).map(([key,value])=>`c:${key}="${value}"`).join(' ')}/></rdf:RDF></x:xmpmeta>`;
 const defringeFile=join(out,'defringe.xmp');writeFileSync(defringeFile,defringeFixture);const defringeRead=await documents.read(defringeFile);assert.deepEqual(defringeRead.adjustments,{defringe});
 const defringeDocument={...mappedDocument,adjustments:{...image.adjustments,defringe}},savedDefringe=join(out,'defringe-saved.xmp');writeFileSync(savedDefringe,await documents.serialize(defringeDocument));const defringeProperties=(await xmp.read(savedDefringe)).properties,defringeExtension=readExtension(defringeProperties,'ARTAdjustments');
 for(const [key,value] of Object.entries(defringeFields))assert.equal(lookup(defringeProperties,CRS,key).value,String(value));assert(!Object.hasOwn(defringeExtension,'defringe'));
 const partialDefringe=defringeFixture.replace(' c:DefringeGreenHueHi="65"',''),partialDefringeFile=join(out,'partial-defringe.xmp');writeFileSync(partialDefringeFile,partialDefringe);const partialDefringeRead=await documents.read(partialDefringeFile);assert(!Object.hasOwn(partialDefringeRead.adjustments,'defringe'));assert(partialDefringeRead.warnings.some(value=>value.includes('Defringe*')&&value.includes('不完整')));
 for(const [label,packet] of [['amount',defringeFixture.replace('c:DefringePurpleAmount="60"','c:DefringePurpleAmount="101"')],['range',defringeFixture.replace('c:DefringeGreenHueLo="35"','c:DefringeGreenHueLo="65"')]]){const file=join(out,`invalid-defringe-${label}.xmp`);writeFileSync(file,packet);await assert.rejects(documents.read(file),/Defringe|色差去边/);}
 pass('six Defringe fields import and save as an atomic standard group; partial groups and invalid amounts or hue ranges are rejected');
 const calibration={redHue:-14,redSaturation:5,greenHue:41,greenSaturation:-45,blueHue:-3,blueSaturation:1},calibrationFields={RedHue:calibration.redHue,RedSaturation:calibration.redSaturation,GreenHue:calibration.greenHue,GreenSaturation:calibration.greenSaturation,BlueHue:calibration.blueHue,BlueSaturation:calibration.blueSaturation};
 const calibrationFixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="calibration" xmlns:c="${CRS}" ${Object.entries(calibrationFields).map(([key,value])=>`c:${key}="${value}"`).join(' ')}/></rdf:RDF></x:xmpmeta>`;
 const calibrationFile=join(out,'calibration.xmp');writeFileSync(calibrationFile,calibrationFixture);const calibrationRead=await documents.read(calibrationFile);assert.deepEqual(calibrationRead.adjustments,{calibration});
 const calibrationDocument={...mappedDocument,adjustments:{...image.adjustments,calibration}},savedCalibration=join(out,'calibration-saved.xmp');writeFileSync(savedCalibration,await documents.serialize(calibrationDocument));const calibrationProperties=(await xmp.read(savedCalibration)).properties,calibrationExtension=readExtension(calibrationProperties,'ARTAdjustments');
 for(const [key,value] of Object.entries(calibrationFields))assert.equal(lookup(calibrationProperties,CRS,key).value,String(value));assert(!Object.hasOwn(calibrationExtension,'calibration'));
 for(const [name,value] of [['RedHue','1.5'],['GreenSaturation','-101']]){const file=join(out,`invalid-calibration-${name}.xmp`);writeFileSync(file,calibrationFixture.replace(`c:${name}="${calibrationFields[name]}"`,`c:${name}="${value}"`));await assert.rejects(documents.read(file),new RegExp(name));}
 pass('six calibration fields import and save as standard XMP, preserving the ART primaries/chroma mapping and rejecting invalid values');
 const sharpeningDetail={sharpenDetail:70,sharpenEdgeMask:35},sharpeningDetailFixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="sharpen" xmlns:c="${CRS}" c:SharpenDetail="${sharpeningDetail.sharpenDetail}" c:SharpenEdgeMasking="${sharpeningDetail.sharpenEdgeMask}"/></rdf:RDF></x:xmpmeta>`;
 const sharpeningDetailFile=join(out,'sharpening-detail.xmp');writeFileSync(sharpeningDetailFile,sharpeningDetailFixture);const sharpeningDetailRead=await documents.read(sharpeningDetailFile);assert.deepEqual(sharpeningDetailRead.adjustments,sharpeningDetail);
 const sharpeningDetailDocument={...mappedDocument,adjustments:{...image.adjustments,sharpening:60,...sharpeningDetail}},savedSharpeningDetail=join(out,'sharpening-detail-saved.xmp');writeFileSync(savedSharpeningDetail,await documents.serialize(sharpeningDetailDocument));const sharpeningDetailProperties=(await xmp.read(savedSharpeningDetail)).properties,sharpeningDetailExtension=readExtension(sharpeningDetailProperties,'ARTAdjustments');
 assert.equal(lookup(sharpeningDetailProperties,CRS,'SharpenDetail').value,'70');assert.equal(lookup(sharpeningDetailProperties,CRS,'SharpenEdgeMasking').value,'35');assert(!Object.hasOwn(sharpeningDetailExtension,'sharpenDetail'));assert(!Object.hasOwn(sharpeningDetailExtension,'sharpenEdgeMask'));
 for(const [name,value] of [['SharpenDetail','1.5'],['SharpenEdgeMasking','101']]){const file=join(out,`invalid-${name}.xmp`);writeFileSync(file,sharpeningDetailFixture.replace(new RegExp(`c:${name}="\\d+"`),`c:${name}="${value}"`));await assert.rejects(documents.read(file),new RegExp(name));}
 pass('SharpenDetail and SharpenEdgeMasking import and save as standard fields while invalid values are rejected');
 const postVignette={postCropVignetteFeather:75,postCropVignetteRoundness:40},postVignetteFixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="post-vignette" xmlns:c="${CRS}" c:PostCropVignetteFeather="${postVignette.postCropVignetteFeather}" c:PostCropVignetteRoundness="${postVignette.postCropVignetteRoundness}"/></rdf:RDF></x:xmpmeta>`;
 const postVignetteFile=join(out,'post-vignette.xmp');writeFileSync(postVignetteFile,postVignetteFixture);const postVignetteRead=await documents.read(postVignetteFile);assert.deepEqual(postVignetteRead.adjustments,postVignette);
 const postVignetteDocument={...mappedDocument,adjustments:{...image.adjustments,vignette:60,...postVignette}},savedPostVignette=join(out,'post-vignette-saved.xmp');writeFileSync(savedPostVignette,await documents.serialize(postVignetteDocument));const postVignetteProperties=(await xmp.read(savedPostVignette)).properties,postVignetteExtension=readExtension(postVignetteProperties,'ARTAdjustments');
 assert.equal(lookup(postVignetteProperties,CRS,'PostCropVignetteFeather').value,'75');assert.equal(lookup(postVignetteProperties,CRS,'PostCropVignetteRoundness').value,'40');assert(!Object.hasOwn(postVignetteExtension,'postCropVignetteFeather'));assert(!Object.hasOwn(postVignetteExtension,'postCropVignetteRoundness'));
 for(const [name,value] of [['PostCropVignetteFeather','101'],['PostCropVignetteRoundness','-101']]){const file=join(out,`invalid-${name}.xmp`);writeFileSync(file,postVignetteFixture.replace(new RegExp(`c:${name}="\\d+"`),`c:${name}="${value}"`));await assert.rejects(documents.read(file),new RegExp(name));}
 pass('PostCropVignetteFeather and PostCropVignetteRoundness import and save as standard fields while invalid values are rejected');
 const noiseReduction={luminanceNoiseDetail:70,luminanceNoiseContrast:25,colorNoiseDetail:60,colorNoiseSmoothness:40},noiseReductionFields={LuminanceNoiseReductionDetail:noiseReduction.luminanceNoiseDetail,LuminanceNoiseReductionContrast:noiseReduction.luminanceNoiseContrast,ColorNoiseReductionDetail:noiseReduction.colorNoiseDetail,ColorNoiseReductionSmoothness:noiseReduction.colorNoiseSmoothness};
 const noiseReductionFixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="noise" xmlns:c="${CRS}" ${Object.entries(noiseReductionFields).map(([key,value])=>`c:${key}="${value}"`).join(' ')}/></rdf:RDF></x:xmpmeta>`;
 const noiseReductionFile=join(out,'noise-reduction.xmp');writeFileSync(noiseReductionFile,noiseReductionFixture);const noiseReductionRead=await documents.read(noiseReductionFile);assert.deepEqual(noiseReductionRead.adjustments,noiseReduction);
 const noiseReductionDocument={...mappedDocument,adjustments:{...image.adjustments,luminanceNoise:50,colorNoise:50,...noiseReduction}},savedNoiseReduction=join(out,'noise-reduction-saved.xmp');writeFileSync(savedNoiseReduction,await documents.serialize(noiseReductionDocument));const noiseReductionProperties=(await xmp.read(savedNoiseReduction)).properties,noiseReductionExtension=readExtension(noiseReductionProperties,'ARTAdjustments');
 for(const [key,value] of Object.entries(noiseReductionFields))assert.equal(lookup(noiseReductionProperties,CRS,key).value,String(value));for(const key of Object.keys(noiseReduction))assert(!Object.hasOwn(noiseReductionExtension,key));
 for(const [name,value] of [['LuminanceNoiseReductionDetail','1.5'],['ColorNoiseReductionSmoothness','101']]){const file=join(out,`invalid-${name}.xmp`);writeFileSync(file,noiseReductionFixture.replace(new RegExp(`c:${name}="\\d+"`),`c:${name}="${value}"`));await assert.rejects(documents.read(file),new RegExp(name));}
 pass('four noise-reduction detail fields import and save as standard XMP while invalid values are rejected');
 const orientedCrop={x:.12,y:.18,width:.65,height:.61},cropAngle=-7.5,cropFields={HasCrop:'True',CropTop:.12,CropLeft:.21,CropBottom:.77,CropRight:.82,CropAngle:cropAngle};
 const cropFixture=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="crop" xmlns:c="${CRS}" xmlns:t="${TIFF}" t:Orientation="6" ${Object.entries(cropFields).map(([key,value])=>`c:${key}="${value}"`).join(' ')}/></rdf:RDF></x:xmpmeta>`;
 const cropFile=join(out,'crop-rotation.xmp');writeFileSync(cropFile,cropFixture);const cropRead=await documents.read(cropFile);
 assert.deepEqual(cropRead.adjustments,{rotation:90,crop:orientedCrop,fineRotation:cropAngle});
 const cropDocument={...mappedDocument,adjustments:{...image.adjustments,...cropRead.adjustments}},savedCrop=join(out,'crop-rotation-saved.xmp');
 writeFileSync(savedCrop,await documents.serialize(cropDocument));const cropProperties=(await xmp.read(savedCrop)).properties,cropExtension=readExtension(cropProperties,'ARTAdjustments');
 assert.equal(lookup(cropProperties,TIFF,'Orientation').value,'6');assert.equal(lookup(cropProperties,CRS,'HasCrop').value,'True');assert.equal(Number(lookup(cropProperties,CRS,'CropTop').value),cropFields.CropTop);assert.equal(Number(lookup(cropProperties,CRS,'CropLeft').value),cropFields.CropLeft);assert.equal(Number(lookup(cropProperties,CRS,'CropBottom').value),cropFields.CropBottom);assert.equal(Number(lookup(cropProperties,CRS,'CropRight').value),cropFields.CropRight);assert.equal(Number(lookup(cropProperties,CRS,'CropAngle').value),cropAngle);
 for(const key of ['rotation','crop','fineRotation'])assert(!Object.hasOwn(cropExtension,key));
 pass('tiff Orientation, HasCrop, CropTop/Left/Bottom/Right and CropAngle import into native geometry and save without private duplicates');
 const partialCropFixture=cropFixture.replace(` c:CropAngle="${cropAngle}"`,''),partialCropFile=join(out,'partial-crop.xmp');writeFileSync(partialCropFile,partialCropFixture);const partialCropRead=await documents.read(partialCropFile);
 assert(!Object.hasOwn(partialCropRead.adjustments,'crop'));assert(partialCropRead.warnings.some(value=>value.includes('Crop*')&&value.includes('不完整')));
 const mirroredCropFile=join(out,'mirrored-orientation-crop.xmp');writeFileSync(mirroredCropFile,cropFixture.replace('t:Orientation="6"','t:Orientation="2"'));const mirroredCropRead=await documents.read(mirroredCropFile);
 assert(!Object.hasOwn(mirroredCropRead.adjustments,'crop'));assert(mirroredCropRead.warnings.some(value=>value.includes('镜像方向')));assert(mirroredCropRead.warnings.some(value=>value.includes('Crop*')));
 for(const [source,label,pattern] of [[cropFixture,'crop-order','裁切矩形'],[cropFixture,'crop-boolean','HasCrop'],[cropFixture,'crop-angle','CropAngle'],[cropFixture,'orientation','Orientation']]){
  let packet=source;
  if(label==='crop-boolean')packet=packet.replace('c:HasCrop="True"','c:HasCrop="Yes"');
  if(label==='crop-order')packet=packet.replace('c:CropTop="0.12"','c:CropTop="0.77"');
  if(label==='crop-angle')packet=packet.replace('c:CropAngle="-7.5"','c:CropAngle="46"');
  if(label==='orientation')packet=packet.replace('t:Orientation="6"','t:Orientation="9"');
  const file=join(out,`invalid-${label}.xmp`);writeFileSync(file,packet);
  await assert.rejects(documents.read(file),new RegExp(pattern,'i'));
 }
 pass('partial crop groups are not applied and invalid orientation, boolean, rectangle or angle values are rejected');
 for(const [name,value] of [['Contrast2012','12.5'],['Texture','-101'],['GrainAmount','-1'],['SharpenRadius','3.1'],['LensManualDistortionAmount','1.5'],['VignetteAmount','-101']]){
  const invalid=join(out,`invalid-${name}.xmp`);writeFileSync(invalid,mappedFixture.replace(`c:${name}="${standardFields[name]}"`,`c:${name}="${value}"`));
  await assert.rejects(documents.read(invalid),new RegExp(name));
 }
 pass('standard CRS fields reject fractional integer controls and values outside the active ART ranges');
 const curveFields={curve:'ToneCurvePV2012',redCurve:'ToneCurvePV2012Red',greenCurve:'ToneCurvePV2012Green',blueCurve:'ToneCurvePV2012Blue'},identity=[{x:0,y:0},{x:1,y:1}],bent=[{x:0,y:0},{x:64/255,y:96/255},{x:1,y:1}];
 const linearCurves=Object.fromEntries(Object.keys(curveFields).map(key=>[key,identity]));
 const curvePacket=(name,values={})=>fixture.replace(' c:Exposure2012="1.25"',name===undefined?'':` c:ToneCurveName2012="${name}"`).replace('<c:Name>',Object.entries(values).map(([key,items])=>`<c:${key}><rdf:Seq>${items.map(value=>`<rdf:li>${value}</rdf:li>`).join('')}</rdf:Seq></c:${key}>`).join('')+'<c:Name>');
 const curveInput=join(out,'curve-input.xmp'),readCurvePacket=async packet=>{writeFileSync(curveInput,packet);return documents.read(curveInput);};
 for(const [values,name] of [[{exposure:.75},undefined],[{curve:identity},'Custom'],[{redCurve:identity},'Custom'],[{redCurve:bent},'Custom'],[linearCurves,'Linear'],[{...linearCurves,curve:bent},'Custom'],[{...linearCurves,redCurve:bent},'Custom'],[{...linearCurves,greenCurve:bent},'Custom'],[{...linearCurves,blueCurve:bent},'Custom'],[{...linearCurves,curve:[{x:0,y:0},{x:.5,y:.5},{x:1,y:1}]},'Custom']]){
  const result=await xmp.call('write',curvePacket(name===undefined?undefined:name==='Linear'?'Custom':'Linear'),encodeAdjustments(values));
  const properties=(await xmp.call('read',result.packet)).properties;
  assert.equal(lookup(properties,CRS,'ToneCurveName2012')?.value,name);
  for(const [key,field] of Object.entries(curveFields))assert.equal(!!lookup(properties,CRS,field),values[key]!==undefined,field);
  assert.deepEqual(decodeAdjustments(properties).adjustments,values);
 }
 pass('only four endpoint identity curves save as Linear; partial or edited curves replace stale names with Custom; absent curves stay absent');
 for(const name of ['Linear','Medium Contrast','Strong Contrast','Custom','Vendor Curve']){
  const packet=curvePacket(name),named=await readCurvePacket(packet);assert.deepEqual(named.adjustments,{});
  assert(named.warnings.some(v=>v.includes('ToneCurveName2012')&&v.includes('尚未应用')&&v.includes('没有 PV2012 曲线坐标')));
  const retained=await xmp.call('write',packet,encodeAdjustments({exposure:.25}));assert.equal(lookup((await xmp.call('read',retained.packet)).properties,CRS,'ToneCurveName2012').value,name);
  await assert.rejects(store.importFile(curveInput),/尚无可应用的调节.*尚未应用/);
 }
 pass('name-only presets never manufacture curves and clearly disclose the unapplied name');
 const rawBent=['0, 0','64, 96','255, 255'];
 const conflict=await readCurvePacket(curvePacket('Linear',{ToneCurvePV2012Red:rawBent}));assert.deepEqual(conflict.adjustments,{redCurve:bent});
 assert(conflict.warnings.some(v=>v.includes('坐标不一致')&&v.includes('Adobe')&&v.includes('优先级尚未验证')));
 for(const name of ['Medium Contrast','Strong Contrast','Vendor Curve']){
  const named=await readCurvePacket(curvePacket(name,{ToneCurvePV2012:rawBent}));assert.deepEqual(named.adjustments,{curve:bent});
  assert(named.warnings.some(v=>v.includes(name)&&v.includes('对应关系尚未验证')&&v.includes('优先级尚未验证')));
 }
 const custom=await readCurvePacket(curvePacket('Custom',{ToneCurvePV2012:['0, 0','255, 255'],ToneCurvePV2012Red:rawBent}));assert.deepEqual(custom.adjustments,{curve:identity,redCurve:bent});assert(!custom.warnings.some(v=>v.includes('ToneCurveName2012')));
 const collinear=await readCurvePacket(curvePacket('Linear',{ToneCurvePV2012:['0, 0','128, 128','255, 255']}));assert(!collinear.warnings.some(v=>v.includes('坐标不一致')));assert.equal(collinear.adjustments.curve.length,3);
 pass('conflicting Linear and unverified named curves disclose CaptRAW coordinate use without claiming Adobe precedence; Custom may have a straight master and bent RGB');
 const valid=await readCurvePacket(curvePacket(undefined,{ToneCurvePV2012:[' +0 , 0 ','6.4e1, +9.6e1','255, 255']}));assert.deepEqual(valid.adjustments,{curve:bent});
 for(const value of ['', ' ', ', 0', '0,', ' , 0', '0, ', '0,,0', '0,0,0', 'NaN,0', 'Infinity,0', '1e309,0', '0x10,0', '0b10,0', '0o10,0', '64oops,0', '1_0,0', '-1,0', '256,0', '0,256', '0,-1', '0,NaN', '1e,0', '64 65,0'])await assert.rejects(readCurvePacket(curvePacket(undefined,{ToneCurvePV2012:[value,'255,255']})),/XMP 曲线点无效/);
 for(const items of [[],['0,0'],['0,0','64,96','64,100','255,255'],['64,96','0,0'],Array.from({length:129},(_,i)=>`${i},${i}`)])await assert.rejects(readCurvePacket(curvePacket(undefined,{ToneCurvePV2012:items})),/XMP 曲线点/);
 pass('real RDF parsing accepts decimal coordinates and rejects empty, non-decimal, non-finite, out-of-range, duplicate and unordered coordinates');
 const adjustments={...image.adjustments,exposure:.75,contrast:17,curve:[{x:0,y:0},{x:.4,y:.6},{x:1,y:1}],crop:{x:.1,y:.1,width:.8,height:.8},rotation:90,spots:[{id:'repair',name:'修复点',enabled:true,method:'clone',source:{x:.3,y:.3},target:{x:.6,y:.6},radius:20,feather:50,opacity:100,detail:0,retainTexture:false}]};
 const document={xmpPacket:fixture,engineVersion:ENGINE_VERSION,source:{path:source,size:readFileSync(source).length,sha256:before},artProfile:profile,adjustments,baselineVersion:4};
 const versionFile=join(out,'engine-version.xmp'),currentPacket=await documents.serialize(document);
 for(const version of ['CaptRAW-20_ART-1.26.10_LibRaw-3b20539','CaptRAW-21_ART-1.26.10_LibRaw-3b20539','CaptRAW-22_ART-1.26.10_LibRaw-3b20539','CaptRAW-23_ART-1.26.10_LibRaw-3b20539','CaptRAW-24_ART-1.26.10_LibRaw-3b20539','CaptRAW-25_ART-1.26.10_LibRaw-3b20539',ENGINE_VERSION]){
  const packet=(await xmp.call('write',currentPacket,[property(CT,'EngineVersion',encode(version))])).packet;
  writeFileSync(versionFile,packet);const originalHash=hash(versionFile),loaded=await documents.read(versionFile);
  assert.equal(loaded.engineVersion,version);assert.equal(loaded.artProfile,profile);assert.deepEqual(loaded.adjustments,adjustments);
  const resaved=await documents.serialize(loaded);assert.equal(readExtension((await xmp.call('read',resaved)).properties,'EngineVersion'),ENGINE_VERSION);
  const presetInput=join(out,'engine-version-preset-input.xmp');
  writeFileSync(presetInput,(await xmp.call('write',fixture,[property(CT,'EngineVersion',encode(version))])).packet);const presetHash=hash(presetInput);
  const importedVersion=await store.importFile(presetInput),exportedVersion=join(out,'engine-version-preset.xmp');
  await store.exportFile(importedVersion.id,exportedVersion);assert.equal(readExtension((await xmp.read(exportedVersion)).properties,'EngineVersion'),ENGINE_VERSION);
  assert.equal(hash(versionFile),originalHash);assert.equal(hash(presetInput),presetHash);
 }
 for(const version of ['CaptRAW-19_ART-1.26.10_LibRaw-3b20539','CaptRAW-999_ART-1.26.10_LibRaw-3b20539']){
  writeFileSync(versionFile,(await xmp.call('write',currentPacket,[property(CT,'EngineVersion',encode(version))])).packet);
  await assert.rejects(documents.read(versionFile),/不支持的 ART 显影版本/);await assert.rejects(store.importFile(versionFile),/不支持的 ART 显影版本/);
 }
 pass('version 20 through 25 XMP documents/presets read without modifying source, save as current version, and reject unsupported older/future renderers');
 const legacyProperties=(await xmp.call('read',currentPacket)).properties,legacyExtension=readExtension(legacyProperties,'ARTAdjustments');legacyExtension.contrast=17;
 const migratedPacket=(await xmp.call('write',currentPacket,[
  property(CRS,'Contrast2012',null),
  property(CT,'ARTAdjustments',encode(legacyExtension)),
  property(CT,'EngineVersion',encode('CaptRAW-22_ART-1.26.10_LibRaw-3b20539')),
 ])).packet,migratedFile=join(out,'legacy-22-private-contrast.xmp');writeFileSync(migratedFile,migratedPacket);
 const migrated=await documents.read(migratedFile);assert.equal(migrated.adjustments.contrast,17);assert.equal(migrated.engineVersion,'CaptRAW-22_ART-1.26.10_LibRaw-3b20539');
 const migratedSaved=await documents.serialize(migrated),migratedProperties=(await xmp.call('read',migratedSaved)).properties,migratedExtension=readExtension(migratedProperties,'ARTAdjustments');
 assert.equal(lookup(migratedProperties,CRS,'Contrast2012').value,'17');assert(!Object.hasOwn(migratedExtension,'contrast'));
 pass('a version 22 private contrast migrates to standard Contrast2012 on the next save while preserving its value');
 const cropPacket=readFileSync(savedCrop,'utf8'),legacyCropExtension=readExtension((await xmp.call('read',cropPacket)).properties,'ARTAdjustments');
 legacyCropExtension.rotation=90;legacyCropExtension.crop=orientedCrop;legacyCropExtension.fineRotation=cropAngle;
 const migratedCropPacket=(await xmp.call('write',cropPacket,[
  property(TIFF,'Orientation',null),
  property(CRS,'HasCrop',null),property(CRS,'CropTop',null),property(CRS,'CropLeft',null),property(CRS,'CropBottom',null),property(CRS,'CropRight',null),property(CRS,'CropAngle',null),
  property(CT,'ARTAdjustments',encode(legacyCropExtension)),property(CT,'EngineVersion',encode('CaptRAW-23_ART-1.26.10_LibRaw-3b20539')),
 ])).packet,migratedCropFile=join(out,'legacy-23-private-crop-rotation.xmp');writeFileSync(migratedCropFile,migratedCropPacket);
 const migratedCrop=await documents.read(migratedCropFile);assert.deepEqual({rotation:migratedCrop.adjustments.rotation,crop:migratedCrop.adjustments.crop,fineRotation:migratedCrop.adjustments.fineRotation},{rotation:90,crop:orientedCrop,fineRotation:cropAngle});
 const migratedCropSaved=await documents.serialize(migratedCrop),migratedCropProperties=(await xmp.call('read',migratedCropSaved)).properties,migratedCropExtension=readExtension(migratedCropProperties,'ARTAdjustments');
 assert.equal(lookup(migratedCropProperties,TIFF,'Orientation').value,'6');assert.equal(Number(lookup(migratedCropProperties,CRS,'CropLeft').value),.21);assert.equal(Number(lookup(migratedCropProperties,CRS,'CropAngle').value),cropAngle);
 for(const key of ['rotation','crop','fineRotation'])assert(!Object.hasOwn(migratedCropExtension,key));
 pass('version 23 private rotation and crop migrate to tiff Orientation and standard crop fields without changing geometry');
 const blackWhitePacket=readFileSync(savedBlackWhite,'utf8'),legacyBlackWhiteExtension=readExtension((await xmp.call('read',blackWhitePacket)).properties,'ARTAdjustments');
 legacyBlackWhiteExtension.blackWhite=blackWhite;
 const migratedBlackWhitePacket=(await xmp.call('write',blackWhitePacket,[
  property(CRS,'ConvertToGrayscale',null),
  ...grayNames.map(name=>property(CRS,`GrayMixer${name}`,null)),
  property(CT,'ARTAdjustments',encode(legacyBlackWhiteExtension)),
  property(CT,'EngineVersion',encode('CaptRAW-22_ART-1.26.10_LibRaw-3b20539')),
 ])).packet,migratedBlackWhiteFile=join(out,'legacy-22-private-black-white.xmp');writeFileSync(migratedBlackWhiteFile,migratedBlackWhitePacket);
 const migratedBlackWhite=await documents.read(migratedBlackWhiteFile);assert.deepEqual(migratedBlackWhite.adjustments.blackWhite,blackWhite);
 const migratedBlackWhiteSaved=await documents.serialize(migratedBlackWhite),migratedBlackWhiteProperties=(await xmp.call('read',migratedBlackWhiteSaved)).properties,migratedBlackWhiteExtension=readExtension(migratedBlackWhiteProperties,'ARTAdjustments');
 assert.equal(lookup(migratedBlackWhiteProperties,CRS,'ConvertToGrayscale').value,'True');assert.equal(lookup(migratedBlackWhiteProperties,CRS,'GrayMixerGreen').value,'31');assert.deepEqual(migratedBlackWhiteExtension.blackWhite,{base:blackWhite.base});
 pass('version 22 private black-and-white settings migrate to ConvertToGrayscale and GrayMixer fields while preserving the ART base');
 const groupedPacket=readFileSync(groupedSaved,'utf8'),groupedPacketProperties=(await xmp.call('read',groupedPacket)).properties,legacyGroupsExtension=readExtension(groupedPacketProperties,'ARTAdjustments');
  legacyGroupsExtension.parametricCurve=parametricCurve;legacyGroupsExtension.hsl=hsl;legacyGroupsExtension.colorGrading=colorGrading;
 const migratedGroupsPacket=(await xmp.call('write',groupedPacket,[
  ...Object.keys(groupFields).map(name=>property(CRS,name,null)),
  property(CT,'ARTAdjustments',encode(legacyGroupsExtension)),
  property(CT,'EngineVersion',encode('CaptRAW-22_ART-1.26.10_LibRaw-3b20539')),
 ])).packet,migratedGroupsFile=join(out,'legacy-22-private-groups.xmp');writeFileSync(migratedGroupsFile,migratedGroupsPacket);
 const migratedGroups=await documents.read(migratedGroupsFile);assert.deepEqual({parametricCurve:migratedGroups.adjustments.parametricCurve,hsl:migratedGroups.adjustments.hsl,colorGrading:migratedGroups.adjustments.colorGrading},{parametricCurve,hsl,colorGrading});
 const migratedGroupsSaved=await documents.serialize(migratedGroups),migratedGroupsProperties=(await xmp.call('read',migratedGroupsSaved)).properties,currentGroupsExtension=readExtension(migratedGroupsProperties,'ARTAdjustments');
 assert.equal(lookup(migratedGroupsProperties,CRS,'ParametricLights').value,String(parametricCurve.lights));assert.equal(lookup(migratedGroupsProperties,CRS,'HueAdjustmentBlue').value,String(hsl.hue[5]));assert.equal(lookup(migratedGroupsProperties,CRS,'SplitToningBalance').value,String(colorGrading.balance));assert(!Object.hasOwn(currentGroupsExtension,'parametricCurve'));assert(!Object.hasOwn(currentGroupsExtension,'hsl'));assert(!Object.hasOwn(currentGroupsExtension,'colorGrading'));
 pass('version 22 private Parametric, HSL and Color Grade groups migrate to standard CRS fields');
 const saved=join(out,'中文 空格.xmp');await saveRecipeWithMasks(e,saved,document,v=>documents.serialize(v));const restored=await documents.read(saved);assert.deepEqual({...restored.adjustments},adjustments);assert.equal(restored.artProfile,profile);assert(!readFileSync(saved,'utf8').includes('"adjustments"'));assert(readFileSync(saved,'utf8').includes('crs:Exposure2012'));const props=(await xmp.read(saved)).properties;assert.equal(lookup(props,CRS,'Contrast2012').value,'17');assert.equal(lookup(props,CRS,'DefringePurpleAmount').value,'-35');assert.equal(lookup(props,'https://example.invalid/unknown/','Opaque').value,'保留 & 未知');assert.deepEqual(lookup(props,CRS,'MaskGroupBasedCorrections'),lookup((await xmp.read(external)).properties,CRS,'MaskGroupBasedCorrections'));pass('XMP restores the full ART edit state and preserves untouched Adobe masks and unknown metadata');
 const a=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments,artProfile:profile}),b=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:restored.adjustments,artProfile:restored.artProfile});
 await e.call('export',{path:source,artProfile:a.artProfile,output:join(out,'before.tiff'),format:'tiff'});await e.call('export',{path:source,artProfile:b.artProfile,output:join(out,'restored.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np,json;from pathlib import Path\np=Path(${JSON.stringify(out)});a=tifffile.imread(p/'before.tiff');b=tifffile.imread(p/'restored.tiff');assert a.dtype==np.uint16;assert np.array_equal(a,b);print('equal TIFF16 pixels',a.shape)`],{stdio:'inherit'});pass('XMP save/reopen produces exactly equal native 16-bit TIFF pixels');
 const groupedProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,parametricCurve,hsl,colorGrading},artProfile:profile});
 await e.call('export',{path:source,artProfile:groupedProfile.artProfile,output:join(out,'parametric-hsl.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});assert not np.array_equal(tifffile.imread(p/'before.tiff'),tifffile.imread(p/'parametric-hsl.tiff'))`]);
 pass('standard Parametric, HSL and Color Grade groups drive the native pipeline and change TIFF16 pixels');
 const distortionProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,lensManualDistortion:40},artProfile:profile});
 const lensVignetteProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,lensVignette:55},artProfile:profile});
 await e.call('export',{path:source,artProfile:distortionProfile.artProfile,output:join(out,'manual-distortion.tiff'),format:'tiff'});
 await e.call('export',{path:source,artProfile:lensVignetteProfile.artProfile,output:join(out,'lens-vignette.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});base=tifffile.imread(p/'before.tiff');dist=tifffile.imread(p/'manual-distortion.tiff');vig=tifffile.imread(p/'lens-vignette.tiff');assert base.dtype==dist.dtype==vig.dtype==np.uint16;assert dist.shape==base.shape==vig.shape;assert not np.array_equal(base,dist);assert not np.array_equal(base,vig)`]);
 pass('standard manual lens distortion and lens vignette fields drive native TIFF16 processing');
 const fringePath=join(out,'defringe-fringes.png');execFileSync('build/qa-venv/bin/python',['-c',`from PIL import Image,ImageDraw\nfrom pathlib import Path\np=Path(${JSON.stringify(fringePath)});im=Image.new('RGB',(480,320),'white');d=ImageDraw.Draw(im)\nfor y in range(0,320,20):\n d.rectangle((0,y,479,y+9),fill=(10,10,10));d.line((0,y-2,479,y-2),fill=(160,0,160),width=2);d.line((0,y+11,479,y+11),fill=(0,160,0),width=2)\nim.save(p)`]);
 const fringeImage=await e.call('open',{path:fringePath,sessionId:'defringe'}),fringeBase=await e.call('compose',{path:fringePath,width:fringeImage.width,height:fringeImage.height,adjustments:fringeImage.adjustments,artProfile:''});
 const fringeDefringe=await e.call('compose',{path:fringePath,width:fringeImage.width,height:fringeImage.height,adjustments:{...fringeImage.adjustments,...defringeRead.adjustments},artProfile:fringeBase.artProfile});
 await e.call('export',{path:fringePath,artProfile:fringeBase.artProfile,output:join(out,'defringe-base.tiff'),format:'tiff'});await e.call('export',{path:fringePath,artProfile:fringeDefringe.artProfile,output:join(out,'defringe-applied.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});base=tifffile.imread(p/'defringe-base.tiff');fixed=tifffile.imread(p/'defringe-applied.tiff');assert base.dtype==fixed.dtype==np.uint16;assert base.shape==fixed.shape;assert not np.array_equal(base,fixed)`]);
 pass('standard Defringe amounts and hue windows drive native fringe suppression and change TIFF16 pixels');
 const calibrationProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,calibration},artProfile:profile});
 await e.call('export',{path:source,artProfile:calibrationProfile.artProfile,output:join(out,'calibration.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});base=tifffile.imread(p/'before.tiff');graded=tifffile.imread(p/'calibration.tiff');assert base.dtype==graded.dtype==np.uint16;assert base.shape==graded.shape;assert not np.array_equal(base,graded)`]);
 pass('standard calibration hue and saturation fields drive ART primaries/chroma and change TIFF16 pixels');
 const detailedSharpenProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,sharpening:60,sharpenRadius:1,sharpenDetail:85,sharpenEdgeMask:0},artProfile:profile});
 const maskedSharpenProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,sharpening:60,sharpenRadius:1,sharpenDetail:85,sharpenEdgeMask:80},artProfile:profile});
 await e.call('export',{path:source,artProfile:detailedSharpenProfile.artProfile,output:join(out,'sharpen-detail.tiff'),format:'tiff'});await e.call('export',{path:source,artProfile:maskedSharpenProfile.artProfile,output:join(out,'sharpen-edge-mask.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});base=tifffile.imread(p/'before.tiff');detail=tifffile.imread(p/'sharpen-detail.tiff');masked=tifffile.imread(p/'sharpen-edge-mask.tiff');assert base.dtype==detail.dtype==masked.dtype==np.uint16;assert base.shape==detail.shape==masked.shape;assert not np.array_equal(base,detail);assert not np.array_equal(detail,masked)`]);
 pass('standard sharpen detail and edge-masking fields drive distinct native TIFF16 results');
 const postVignetteShapeProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,vignette:60,postCropVignetteFeather:75,postCropVignetteRoundness:40},artProfile:profile});
 await e.call('export',{path:source,artProfile:postVignetteShapeProfile.artProfile,output:join(out,'post-vignette-shape.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});base=tifffile.imread(p/'before.tiff');vignette=tifffile.imread(p/'post-vignette-shape.tiff');assert base.dtype==vignette.dtype==np.uint16;assert base.shape==vignette.shape;assert not np.array_equal(base,vignette)`]);
 pass('standard post-crop vignette feather and roundness drive native TIFF16 processing');
 const noisePath=join(out,'noise-source.png');execFileSync('build/qa-venv/bin/python',['-c',`from PIL import Image\nimport numpy as np\np=${JSON.stringify(noisePath)};rng=np.random.default_rng(7);y,x=np.mgrid[0:240,0:320];base=np.stack([(x*3+y*2)%256,(y*4)%256,(x*2)%256],axis=2).astype(np.int16);noise=rng.normal(0,28,base.shape);Image.fromarray(np.clip(base+noise,0,255).astype(np.uint8),'RGB').save(p)`]);
 const noiseImage=await e.call('open',{path:noisePath,sessionId:'noise'}),noiseBase=await e.call('compose',{path:noisePath,width:noiseImage.width,height:noiseImage.height,adjustments:noiseImage.adjustments,artProfile:''});
 const lowDetailNoise=await e.call('compose',{path:noisePath,width:noiseImage.width,height:noiseImage.height,adjustments:{...noiseImage.adjustments,luminanceNoise:60,luminanceNoiseDetail:10,luminanceNoiseContrast:20},artProfile:noiseBase.artProfile});
 const highDetailNoise=await e.call('compose',{path:noisePath,width:noiseImage.width,height:noiseImage.height,adjustments:{...noiseImage.adjustments,luminanceNoise:60,luminanceNoiseDetail:90,luminanceNoiseContrast:20},artProfile:noiseBase.artProfile});
 const chromaNoise=await e.call('compose',{path:noisePath,width:noiseImage.width,height:noiseImage.height,adjustments:{...noiseImage.adjustments,colorNoise:70,colorNoiseDetail:20,colorNoiseSmoothness:80},artProfile:noiseBase.artProfile});
 for(const [profile,name] of [[lowDetailNoise,'noise-low-detail'],[highDetailNoise,'noise-high-detail'],[chromaNoise,'noise-chroma-detail']])await e.call('export',{path:noisePath,artProfile:profile.artProfile,output:join(out,`${name}.tiff`),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});low=tifffile.imread(p/'noise-low-detail.tiff');high=tifffile.imread(p/'noise-high-detail.tiff');chroma=tifffile.imread(p/'noise-chroma-detail.tiff');assert low.dtype==high.dtype==chroma.dtype==np.uint16;assert low.shape==high.shape==chroma.shape;assert not np.array_equal(low,high);assert not np.array_equal(high,chroma)`]);
 pass('luminance and color noise-reduction detail fields drive distinct native TIFF16 results');
 const neutralBlackWhiteProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,blackWhite:{...blackWhite,mixer:Array(8).fill(0)}},artProfile:profile});
 const mixedBlackWhiteProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,blackWhite},artProfile:profile});
 await e.call('export',{path:source,artProfile:neutralBlackWhiteProfile.artProfile,output:join(out,'black-white-neutral.tiff'),format:'tiff'});
 await e.call('export',{path:source,artProfile:mixedBlackWhiteProfile.artProfile,output:join(out,'black-white-mixed.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});neutral=tifffile.imread(p/'black-white-neutral.tiff');mixed=tifffile.imread(p/'black-white-mixed.tiff');assert neutral.dtype==np.uint16;assert mixed.dtype==np.uint16;assert not np.array_equal(neutral,mixed)`]);
 pass('standard GrayMixer values drive the native black-and-white pipeline and change TIFF16 pixels');
 const croppedProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,...cropRead.adjustments},artProfile:profile});
 await e.call('export',{path:source,artProfile:croppedProfile.artProfile,output:join(out,'standard-crop-rotation.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});base=tifffile.imread(p/'before.tiff');crop=tifffile.imread(p/'standard-crop-rotation.tiff');assert crop.dtype==np.uint16;assert crop.ndim==3 and crop.shape[2]==3;assert crop.shape[1]<crop.shape[0];assert not np.array_equal(base,crop)`]);
 pass('standard rotation, crop rectangle and CropAngle drive the native pipeline and produce a rotated portrait TIFF16 result');
 const standardContrast=join(out,'standard-contrast-edit.xmp'),standardContrastPacket=await xmp.call('write',readFileSync(saved,'utf8'),[property(CRS,'Contrast2012',text('45'))]);writeFileSync(standardContrast,standardContrastPacket.packet);
 const standardContrastRead=await documents.read(standardContrast);assert.equal(standardContrastRead.adjustments.contrast,45);
 const contrastProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:standardContrastRead.adjustments,artProfile:standardContrastRead.artProfile});
 await e.call('export',{path:source,artProfile:contrastProfile.artProfile,output:join(out,'standard-contrast.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});assert not np.array_equal(tifffile.imread(p/'before.tiff'),tifffile.imread(p/'standard-contrast.tiff'))`]);
 pass('editing standard Contrast2012 overrides the stored ART profile and changes native TIFF pixels');
 const edited=join(out,'external-curve.xmp'),editedPacket=await xmp.call('write',readFileSync(saved,'utf8'),[{ns:CRS,name:'ToneCurvePV2012',node:{items:rawBent.map(value=>({value})),options:0x600}},{ns:CRS,name:'ToneCurveName2012',node:{value:'Linear'}}]);writeFileSync(edited,editedPacket.packet);
 const editedRead=await documents.read(edited);assert.deepEqual(editedRead.adjustments,{...adjustments,curve:bent});assert(editedRead.warnings.some(v=>v.includes('坐标不一致')));
 const editedProfile=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:editedRead.adjustments,artProfile:editedRead.artProfile});await e.call('export',{path:source,artProfile:editedProfile.artProfile,output:join(out,'external-curve.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});assert not np.array_equal(tifffile.imread(p/'before.tiff'),tifffile.imread(p/'external-curve.tiff'))`]);
 writeFileSync(edited,await documents.serialize(editedRead));assert.equal(lookup((await xmp.read(edited)).properties,CRS,'ToneCurveName2012').value,'Custom');pass('external standard curve edits override the stored ART profile, change native TIFF pixels and replace conflicting Linear on save');
 // 0.34 packets stored fractional coordinates without ToneCurveName2012; retain that existing representation's precision.
 const decimals=['0, 0','82.875, 110.125','85.000000000001, 127.5','254.99999999999997, 254.5','255, 255'],fractional=decimals.map(value=>{const [x,y]=value.split(',').map(Number);return {x:x/255,y:y/255};});
 const legacyFile=join(out,'legacy-0.34-fractional.xmp'),legacyPacket=await xmp.call('write',readFileSync(saved,'utf8'),[{ns:CRS,name:'ToneCurvePV2012',node:{items:decimals.map(value=>({value})),options:0x600}},{ns:CRS,name:'ToneCurveName2012',node:null}]);writeFileSync(legacyFile,legacyPacket.packet);
 for(let round=0;round<3;round++){
  const legacy=await documents.read(legacyFile);assert.deepEqual(legacy.adjustments,{...adjustments,curve:fractional});assert.equal(legacy.engineVersion,ENGINE_VERSION);
  writeFileSync(legacyFile,await documents.serialize(legacy));const properties=(await xmp.read(legacyFile)).properties;
  assert.deepEqual(lookup(properties,CRS,'ToneCurvePV2012').items.map(item=>item.value),decimals);assert.equal(lookup(properties,CRS,'ToneCurveName2012').value,'Custom');
 }
 pass('0.34 fractional XMP coordinates, including real near-integer decimals, survive three document save/reopen cycles exactly');
 const wbPreview=e.preview(17);await e.call('update',{revision:17,adjustments:image.adjustments,artProfile:profile});await wbPreview;
 const wb=await e.call('whiteBalance',{mode:'camera'}),wbFile=join(out,'camera-white-balance.xmp');
 await saveRecipeWithMasks(e,wbFile,{...document,adjustments:{...adjustments,...wb}},v=>documents.serialize(v));
 const changedWB=await xmp.call('write',readFileSync(wbFile,'utf8'),[{ns:CRS,name:'Temperature',node:{value:'4500'}}]);writeFileSync(wbFile,changedWB.packet);
 const wbRead=await documents.read(wbFile);assert.equal(wbRead.adjustments.temperature,4500);assert.equal(wbRead.adjustments.wbMode,'custom');assert.equal(wbRead.adjustments.wbMultipliers,null);
 const tintFile=join(out,'tint-edited.xmp');await saveRecipeWithMasks(e,tintFile,{...document,adjustments:{...adjustments,...wb}},v=>documents.serialize(v));
 const tintPacket=await xmp.call('write',readFileSync(tintFile,'utf8'),[{ns:CRS,name:'Tint',node:{value:'25'}}]);writeFileSync(tintFile,tintPacket.packet);const tintRead=await documents.read(tintFile);
 assert.equal(tintRead.adjustments.tint,25);assert.equal(tintRead.adjustments.temperature,wb.temperature);assert.equal(tintRead.adjustments.wbMultipliers,null);assert.equal(tintRead.adjustments.wbMode,'custom');pass('external Tint edit invalidates exact coefficients while preserving Temperature');
 const wbOriginal=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:{...adjustments,...wb},artProfile:profile}),wbChanged=await e.call('compose',{path:source,width:image.width,height:image.height,adjustments:wbRead.adjustments,artProfile:wbRead.artProfile});
 await e.call('export',{path:source,artProfile:wbOriginal.artProfile,output:join(out,'wb-before.tiff'),format:'tiff'});await e.call('export',{path:source,artProfile:wbChanged.artProfile,output:join(out,'wb-after.tiff'),format:'tiff'});
 execFileSync('build/qa-venv/bin/python',['-c',`import tifffile,numpy as np;from pathlib import Path\np=Path(${JSON.stringify(out)});assert not np.array_equal(tifffile.imread(p/'wb-before.tiff'),tifffile.imread(p/'wb-after.tiff'))`]);pass('external standard Temperature edit invalidates camera multipliers and changes actual native pixels');
 const qualified=fixture.replace(' c:Exposure2012="1.25"','').replace('<c:Name>','<c:Exposure2012 rdf:parseType="Resource"><rdf:value>1.25</rdf:value><u:Source>retain qualifier</u:Source></c:Exposure2012><c:Name>');
 const qualifiedResult=await xmp.call('write',qualified,[{ns:CRS,name:'Exposure2012',node:{value:'0.25'}}]);assert(qualifiedResult.packet.includes('retain qualifier'));pass('editing a standard scalar preserves its unknown RDF qualifier');
 const imported=await store.importFile(external),target={image,profile,adjustments:{...image.adjustments,contrast:23,highlights:12,saturation:-17}};
 const curveTarget={...target,adjustments:{...target.adjustments,curve:adjustments.curve,greenCurve:[{x:0,y:0},{x:.5,y:.48},{x:1,y:1}],blueCurve:[{x:0,y:0},{x:.5,y:.52},{x:1,y:1}]}};
 const redOnly=join(out,'red-only.xmp');writeFileSync(redOnly,curvePacket('Linear',{ToneCurvePV2012Red:rawBent}));const redBefore=hash(redOnly),redPreset=await store.importFile(redOnly),redApplied=(await store.apply(redPreset.id,curveTarget,sync))[0];
 assert.deepEqual(redApplied.adjustments,{...curveTarget.adjustments,redCurve:bent});assert.equal(hash(redOnly),redBefore);assert(redPreset.warnings.some(v=>v.includes('坐标不一致')));
 const redExport=join(out,'red-only-exported.xmp');await store.exportFile(redPreset.id,redExport);const redProps=(await xmp.read(redExport)).properties;
 assert.equal(lookup(redProps,CRS,'ToneCurveName2012').value,'Custom');assert.deepEqual((await documents.read(redExport)).adjustments,{redCurve:bent});
 for(const field of ['ToneCurvePV2012','ToneCurvePV2012Green','ToneCurvePV2012Blue','Temperature','Tint'])assert.equal(lookup(redProps,CRS,field),undefined);
 pass('R-only preset import/apply/export keeps master, G/B curves, color and white balance unchanged without injecting missing channels');
 const tintOnly=join(out,'tint-only.xmp');writeFileSync(tintOnly,fixture.replace(' c:Exposure2012="1.25"',' c:WhiteBalance="Custom" c:Tint="25"'));
 const tintPreset=await store.importFile(tintOnly),tintApplied=(await store.apply(tintPreset.id,target,sync))[0];assert.equal(tintApplied.adjustments.tint,25);assert.equal(tintApplied.adjustments.temperature,target.adjustments.temperature);assert.equal(tintApplied.adjustments.exposure,target.adjustments.exposure);assert.equal(tintApplied.adjustments.wbMultipliers,null);assert(!tintPreset.warnings.some(v=>v.includes('尚未参与显影：')&&v.includes('Tint')));pass('Tint-only Adobe preset preserves temperature and exposure and resolves new camera coefficients');
 const applied=(await store.apply(imported.id,target,sync))[0];assert.equal(applied.adjustments.exposure,1.25);for(const key of ['contrast','highlights','saturation'])assert.equal(applied.adjustments[key],target.adjustments[key]);assert(imported.warnings.length);pass('exposure-only Adobe preset leaves contrast, highlights and saturation unchanged');
 await store.rename(imported.id,'改名','分组');const translated=join(out,'translated.xmp');await store.exportFile(imported.id,translated);const translatedProps=(await xmp.read(translated)).properties;assert.equal(lookup(translatedProps,CRS,'Name').items.find(n=>n.lang==='en-US').value,'English preset name');for(const field of [...Object.values(curveFields),'ToneCurveName2012','Contrast2012','Texture','PostCropVignetteAmount'])assert.equal(lookup(translatedProps,CRS,field),undefined);pass('renaming and exporting an exposure-only preset preserves alternate-language names without manufacturing curves or absent standard controls');
 const colorPreset=await store.create({name:'仅色彩',group:'分组',groups:['color'],adjustments:{...adjustments,saturation:44}}),colorExport=join(out,'color-only.xmp');await store.exportFile(colorPreset.id,colorExport);
 const colorProps=(await xmp.read(colorExport)).properties;for(const field of [...Object.values(curveFields),'ToneCurveName2012'])assert.equal(lookup(colorProps,CRS,field),undefined);
 const colorApplied=(await store.apply(colorPreset.id,curveTarget,sync))[0];assert.deepEqual(colorApplied.adjustments,{...curveTarget.adjustments,saturation:44,vibrance:adjustments.vibrance});pass('new color-only presets contain no curves or curve name and preserve target curves on apply');
 const own=await store.create({name:'自己的预设',group:'分组',groups:['light','curves'],adjustments});const exported=join(out,'预设.xmp');await store.exportFile(own.id,exported);assert.equal((await store.importFile(exported)).name,'自己的预设');await store.rename(own.id,'已重命名','第二组');await store.update(own.id,{name:'更新',group:'第二组',groups:['color'],adjustments:{...adjustments,saturation:44}});const updated=(await store.apply(own.id,target,sync))[0];assert.equal(updated.adjustments.saturation,44);assert.equal(updated.adjustments.exposure,target.adjustments.exposure);await store.remove(own.id);assert(!(await store.list()).items.some(p=>p.id===own.id));pass('XMP preset create, import, export, rename, selective update and delete work without JSON files');
 const raster=join(out,'mask.png');execFileSync('build/qa-venv/bin/python',['-c',`from PIL import Image\nImage.new('L',(64,64),180).save(${JSON.stringify(raster)})`]);
 const masks=[{id:'raster',name:'栅格',type:'raster',enabled:true,inverted:false,feather:0,points:[],start:{x:0,y:0},end:{x:1,y:1},brightness:.5,contrast:0,saturation:0,raster:{path:raster,sha256:hash(raster),width:64,height:64}}];
 const masked=join(out,'蒙版.xmp');await saveRecipeWithMasks(e,masked,{...document,adjustments:{...adjustments,masks}},v=>documents.serialize(v));rmSync(raster);const restoredMask=await restoreRecipeMasks(e,masked,await documents.read(masked),join(out,'mask-cache'));assert.equal(hash(restoredMask.adjustments.masks[0].raster.path),masks[0].raster.sha256);pass('XMP structured mask state and content-addressed raster assets survive original asset removal');
 const original=readFileSync(saved);await assert.rejects(saveRecipeWithMasks(e,saved,document,async()=>{throw new Error('serialization failed');}));assert.deepEqual(readFileSync(saved),original);pass('failed serialization leaves the prior XMP file intact');
 for(const body of ['{}','<broken>','<!DOCTYPE x>'+fixture]){const file=join(out,'invalid.xmp');writeFileSync(file,body);await assert.rejects(documents.read(file));await assert.rejects(store.importFile(file));}pass('old JSON content, broken XML and DTD declarations are rejected');
 const cancelled=store.apply(imported.id,target,sync);store.cancel();sync.cancel();assert.equal(await cancelled,null);assert.equal(hash(source),before);assert.equal(readFileSync(external,'utf8'),fixture);pass('cancellation prevents late apply; source RAW and imported Adobe XMP remain unchanged');
 writeFileSync(join(out,'report.json'),JSON.stringify({checks,sourceSHA256:before,binarySHA256:hash(binary),scope:'Substantial CRS mapping; ART-specific state persisted as typed RDF extension. No Adobe pixel equivalence claim.'},null,2)+'\n');
}finally{sync.cancel();await e.stop();}
