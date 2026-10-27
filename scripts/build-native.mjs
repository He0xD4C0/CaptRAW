import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import './build-libraw.mjs';
import {patchRasterMasks} from '../native/patch-raster.mjs';
import {patchMaskGroups,patchMaskPreview,patchQualityFixes,patchBlackWhiteMixer,patchCameraCrop,patchLocalWhiteBalance,patchLocalTone,patchParametricCurve,patchColorGrading,patchLensStatus,patchExternalMaskErrors} from '../native/patch-art.mjs';
const root = resolve(import.meta.dirname, '..');
const commit = '1e0e12c62e4f329d30bb5624d62a23a663ffbe6b';
const upstream = resolve(root, 'build/upstream', `ART-${commit}`);
function run(command, args, env = {}) {
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status || 1);
}
mkdirSync(resolve(root, 'build/upstream'), { recursive: true });
if (!existsSync(upstream)) {
  run('curl', ['-fL', '--retry', '3', `https://codeload.github.com/artraweditor/ART/tar.gz/${commit}`, '-o', 'build/upstream/art.tar.gz']);
  const digest=createHash('sha256').update(readFileSync('build/upstream/art.tar.gz')).digest('hex');
  if(digest!=='cee0ccf71e10e13c195e7ab3fb426564ba051bbaaa39ad43e6ed4d0e997a1855')throw new Error('ART source archive checksum mismatch');
  run('tar', ['-xzf', 'build/upstream/art.tar.gz', '-C', 'build/upstream']);
}
const cmakePath = resolve(upstream, 'CMakeLists.txt');
patchMaskGroups(upstream);
patchExternalMaskErrors(upstream);
patchRasterMasks(upstream);
patchMaskPreview(upstream);
patchQualityFixes(upstream);
patchBlackWhiteMixer(upstream);
patchCameraCrop(upstream);
patchLocalWhiteBalance(upstream);
patchLocalTone(upstream);
patchParametricCurve(upstream);
patchColorGrading(upstream);
patchLensStatus(upstream);
writeFileSync(resolve(upstream,'ReleaseInfo.cmake'),`set(GIT_DESCRIBE "1.26.10")\nset(GIT_BRANCH "1.26.10")\nset(GIT_COMMIT "${commit}")\nset(GIT_COMMIT_DATE "")\n`);
let cmake = readFileSync(cmakePath, 'utf8');
cmake = cmake.replace('add_subdirectory(src/gui)', 'include("${CAPTRAW_SOURCE_DIR}/targets.cmake")');
if(!cmake.includes('set(LIBRAW_LIBRARIES "${CAPTRAW_LIBRAW_LIBRARY}")'))cmake=cmake.replace('add_subdirectory(src/engine)','set(LIBRAW_LIBRARIES "${CAPTRAW_LIBRAW_LIBRARY}")\nadd_subdirectory(src/engine)');
writeFileSync(cmakePath, cmake);
// Upstream's scalar tetrahedral LUT branch redeclares an existing local.
const lutPath = resolve(upstream, 'src/engine/LUT3D.cc');
if (existsSync(lutPath)) {
  let lut = readFileSync(lutPath, 'utf8');
  lut = lut.replace('#ifndef ART_SIMD\n    float out[3];\n#endif\n', '');
  writeFileSync(lutPath, lut);
}
const prefix = process.env.HOMEBREW_PREFIX || '/opt/homebrew';
const pkg = [resolve(root,'build/vendor/libraw'),prefix, `${prefix}/opt/jpeg-turbo`, `${prefix}/opt/libomp`, `${prefix}/opt/glibmm@2.66`, `${prefix}/opt/cairomm@1.14`, `${prefix}/opt/pangomm@2.46`, `${prefix}/opt/atkmm@2.28`, `${prefix}/opt/libsigc++@2`];
const env = { PKG_CONFIG_PATH: pkg.map(p => `${p}/lib/pkgconfig`).join(':') };
run('cmake', ['-S', upstream, '-B', 'build/native', '-G', 'Ninja',
  '-U','*LIBRAW*',
  `-DCAPTRAW_SOURCE_DIR=${root}/native`, '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
  `-DCAPTRAW_LIBRAW_LIBRARY=${root}/build/vendor/libraw/lib/libraw_r.dylib`,
  `-DCMAKE_PREFIX_PATH=${pkg.join(';')}`, '-DCMAKE_BUILD_TYPE=Release',
  '-DENABLE_VULKAN=OFF', '-DENABLE_OCIO=OFF', '-DENABLE_CTL=OFF', '-DENABLE_MIMALLOC=OFF',
  '-DENABLE_SIMDE=OFF', '-DOPTION_OMP=ON', '-DWITH_LTO=OFF',
  '-DOpenMP_CXX_FLAGS=-Xpreprocessor -fopenmp', '-DOpenMP_CXX_LIB_NAMES=omp',
  `-DOpenMP_omp_LIBRARY=${prefix}/opt/libomp/lib/libomp.dylib`,
  `-DOpenMP_CXX_INCLUDE_DIR=${prefix}/opt/libomp/include`,
  `-DCMAKE_CXX_FLAGS=-I${prefix}/opt/libomp/include`,
  '-DPROC_TARGET_NUMBER=0', '-DCMAKE_OSX_DEPLOYMENT_TARGET=26.0'], env);
run('cmake', ['--build', 'build/native', '--target', 'captraw-engine', 'captraw-art-reference', '-j', process.env.CAPTRAW_BUILD_JOBS||'8'], env);
const resources = resolve(root, 'build/native/resources');
mkdirSync(resources, { recursive: true });
for (const name of ['iccprofiles', 'dcpprofiles', 'profiles']) {
  if (existsSync(`${upstream}/data/${name}`)) cpSync(`${upstream}/data/${name}`, `${resources}/${name}`, { recursive: true });
}
cpSync(`${upstream}/data/wbpresets.json`, `${resources}/wbpresets.json`);
cpSync(`${upstream}/src/engine/camconst.json`, `${resources}/camconst.json`);
if (existsSync(`${prefix}/share/lensfun/version_1`)) cpSync(`${prefix}/share/lensfun/version_1`, `${resources}/lensfun`, { recursive: true });
console.log(`Native engine ready: ${root}/build/native/captraw-engine`);
