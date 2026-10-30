import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('This probe currently verifies macOS ARM64 only.');
const root=resolve(import.meta.dirname,'..');process.chdir(root);const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'inherit'});
const commit='581c41213ddcee1fbc72cbb532531102a6617a25',expected='7e9f4b0d62979e1a7d44e16febfe2c6ab337ceccdaf1dad092666ac14b2fdcd5';
const archive=resolve('build/upstream/xmp-sdk.tar.gz'),sdk=resolve('build/upstream/xmp-sdk'),project=resolve('build/xmp-project');
mkdirSync(sdk,{recursive:true});mkdirSync(project,{recursive:true});
if(!existsSync(archive))run('curl',['-fL','--retry','2',`https://codeload.github.com/adobe/XMP-Toolkit-SDK/tar.gz/${commit}`,'-o',archive]);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');if(hash(archive)!==expected)throw new Error('XMP SDK source checksum mismatch');
run('tar',['-xzf',archive,'-C',sdk,'--strip-components=1']);
// The upstream legacy repair overwrites a distinct language when an alt-text array has two items.
// Keep sorting x-default first, but preserve both values for lossless metadata editing.
const patchFile=join(sdk,'XMPCore/source/XMPCore_Impl.cpp'),patchBefore=hash(patchFile),patchText=readFileSync(patchFile,'utf8'),old='if ( itemLim == 2 ) array->children[1]->value = array->children[0]->value;';
if(patchText.split(old).length!==2)throw new Error('XMP language preservation patch no longer matches');
writeFileSync(patchFile,patchText.replace(old,'// CaptRAW: keep distinct language values; do not apply historical two-item repair.'));
const patches=[{file:'XMPCore/source/XMPCore_Impl.cpp',beforeSHA256:patchBefore,afterSHA256:hash(patchFile),reason:'Preserve distinct values in two-item language alternatives'}];
function patchSDK(file,before,after,count,reason){
 const path=join(sdk,file),source=readFileSync(path,'utf8'),beforeSHA256=hash(path);
 if(source.split(before).length!==count+1)throw new Error('XMP lossless-copy patch no longer matches: '+file);
 writeFileSync(path,source.replaceAll(before,after));
 patches.push({file,beforeSHA256,afterSHA256:hash(path),reason});
}
// Template application intentionally skips empty values; a file read must copy
// the complete parsed object into the caller's existing XMP reference instead.
patchSDK('XMPFiles/source/XMPFiles.cpp','SXMPUtils::ApplyTemplate(xmpObj, this->handler->xmpObj, applyTemplateFlags);',
 'std::string exactPacket;\n\t\t\tthis->handler->xmpObj.SerializeToBuffer(&exactPacket);\n\t\t\txmpObj->ParseFromBuffer(exactPacket.data(), exactPacket.size());',2,'Preserve empty properties and qualifiers when returning parsed file XMP');
patchSDK('XMPCore/source/XMPUtils.cpp','XMPUtils::ApplyTemplate ( fullXMP, extendedXMP, apFlags );',
 `for (const auto *schema : extendedXMP.tree.children) {
  for (const auto *prop : schema->children) {
   fullXMP->DeleteProperty(schema->name.c_str(), prop->name.c_str());
   XMPUtils::DuplicateSubtree(extendedXMP, fullXMP, schema->name.c_str(), prop->name.c_str(), schema->name.c_str(), prop->name.c_str(), 0);
  }
 }`,1,'Merge complete extended JPEG subtrees without template empty-value filtering');
const systemSDK=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim(),expat=join(sdk,'third-party/expat/lib');mkdirSync(expat,{recursive:true});
for(const name of ['expat.h','expat_external.h'])copyFileSync(join(systemSDK,'usr/include',name),join(expat,name));
writeFileSync(join(project,'CMakeLists.txt'),"cmake_minimum_required(VERSION 3.20)\nproject(CaptRAWXMP LANGUAGES CXX)\nset(SDK \"${CMAKE_CURRENT_SOURCE_DIR}/../upstream/xmp-sdk\")\nfile(GLOB core \"${SDK}/XMPCore/source/XMP*.cpp\" \"${SDK}/XMPCore/source/WXMP*.cpp\")\nfile(GLOB zuid \"${SDK}/third-party/zuid/interfaces/*.cpp\")\nadd_library(xmp STATIC ${core} ${zuid} \"${SDK}/XMPCore/source/CoreObjectFactoryImpl.cpp\" \"${SDK}/XMPCore/source/ExpatAdapter.cpp\" \"${SDK}/XMPCore/source/ParseRDF.cpp\" \"${SDK}/source/UnicodeConversions.cpp\" \"${SDK}/source/XML_Node.cpp\" \"${SDK}/source/XMP_LibUtils.cpp\")\ntarget_include_directories(xmp PUBLIC \"${SDK}\" \"${SDK}/public/include\")\ntarget_compile_definitions(xmp PUBLIC MAC_ENV=1 XMP_64=1 XMP_StaticBuild=1 ENABLE_CPP_DOM_MODEL=0 PRIVATE BUILDING_XMPCORE_LIB=1 BUILDING_XMPCORE_AS_STATIC=1 XMP_COMPONENT_INT_NAMESPACE=AdobeXMPCore_Int BanAllEntityUsage=1)\ntarget_compile_features(xmp PUBLIC cxx_std_17)\ntarget_compile_options(xmp PUBLIC -funsigned-char -fshort-enums)\ntarget_link_libraries(xmp PUBLIC expat \"-framework CoreFoundation\")\nfind_package(nlohmann_json REQUIRED)\nadd_library(xmp-bridge STATIC \"${CMAKE_CURRENT_SOURCE_DIR}/../../native/src/xmp.cc\")\ntarget_include_directories(xmp-bridge PUBLIC \"${CMAKE_CURRENT_SOURCE_DIR}/../../native/include\")\ntarget_link_libraries(xmp-bridge PUBLIC xmp nlohmann_json::nlohmann_json)\nadd_executable(captraw-xmp \"${CMAKE_CURRENT_SOURCE_DIR}/../../native/src/xmp-worker.cc\")\ntarget_link_libraries(captraw-xmp PRIVATE xmp-bridge)\nadd_executable(xmp-probe \"${CMAKE_CURRENT_SOURCE_DIR}/../../tests/native/documents/xmp-sdk-probe.cc\")\ntarget_link_libraries(xmp-probe PRIVATE xmp-bridge)\n");
appendFileSync(join(project,'CMakeLists.txt'),'\ninclude("${CMAKE_CURRENT_SOURCE_DIR}/../../native/cmake/xmp-files.cmake")\n');
run('cmake',['-S',project,'-B','build/xmp','-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_OSX_ARCHITECTURES=arm64']);run('cmake',['--build','build/xmp','-j',process.env.CAPTRAW_BUILD_JOBS||'8']);
const binary=resolve('build/xmp/xmp-probe'),links=execFileSync('otool',['-L',binary],{encoding:'utf8'});if(links.includes('/opt/homebrew')||links.includes('/usr/local'))throw new Error('Probe has non-system runtime dependencies');
writeFileSync('build/xmp/build.json',JSON.stringify({sdkTag:'v2025.03',commit,sourceSHA256:expected,binarySHA256:hash(binary),systemSDK,expatHeaders:Object.fromEntries(['expat.h','expat_external.h'].map(n=>[n,hash(join(expat,n))])),links,entityDeclarationsRejected:true,patches,workerSHA256:hash(resolve('build/xmp/captraw-xmp')),fileHandlers:{publicFormats:['jpeg','tiff'],sdkPhotoHandlers:['JPEG','TIFF','PSD','GIF'],media:false,plugins:false,packetScanning:false},workerLinks:execFileSync('otool',['-L',resolve('build/xmp/captraw-xmp')],{encoding:'utf8'}),scope:'XMP document worker, SDK photo-file handlers and interoperability probe; no Adobe rendering equivalence claim.'},null,2)+'\n');
