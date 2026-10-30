"""Prepare byte-preserved upstream CPU functions and a private host adapter.

No compiler, shared build, production edit, or Adobe interaction is performed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import urllib.request

here = Path(__file__).resolve().parent
root = next(candidate for candidate in here.parents if (candidate / 'package.json').is_file())
pin = json.loads((here/'source-pin.json').read_text())
parser = argparse.ArgumentParser()
parser.add_argument('--sources', type=Path, help='Use an already-downloaded private source tree')
parser.add_argument('--check', action='store_true', help='Verify preparation and remove its scratch')
args = parser.parse_args()
work = Path(tempfile.mkdtemp(prefix='captraw-dt-color-equalizer-probe-'))
complete = False
sha = lambda b: hashlib.sha256(b).hexdigest()
try:
    files = {}
    for path, expected in pin['sha256'].items():
        data = (args.sources/path).read_bytes() if args.sources else urllib.request.urlopen(
            f"https://raw.githubusercontent.com/darktable-org/darktable/{pin['commit']}/{path}", timeout=30).read()
        assert sha(data) == expected, 'Pinned source mismatch: '+path
        dest = work/'upstream'/path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        files[path] = data.decode()
    blocks = []
    def record(path, start, end):
        text = files[path][start:end]
        blocks.append({'source': path, 'firstLine': files[path].count('\n', 0, start)+1,
                       'sha256': sha(text.encode()), 'bytes': len(text.encode())})
        return f'\n/* Original {path}:{blocks[-1]["firstLine"]} */\n'+text+'\n'
    def clean(text):
        return re.sub(r'/\*.*?\*/|//[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',
                      lambda m: ''.join('\n' if c == '\n' else ' ' for c in m[0]), text, flags=re.S)
    def fn(path, name, last=False):
        text = files[path]
        masked = clean(text)
        matches = list(re.finditer(r'(?m)^[\w \t*]+?\b'+re.escape(name)+r'\s*\(', masked))
        definitions = []
        for match in matches:
            opening = masked.find('{', match.end())
            semi = masked.find(';', match.end())
            if opening < 0 or 0 <= semi < opening:
                continue
            depth, end = 1, opening+1
            while depth and end < len(masked):
                depth += (masked[end] == '{') - (masked[end] == '}')
                end += 1
            assert depth == 0, name
            definitions.append((match.start(), end))
        assert len(definitions) == (2 if last else 1), (path, name, len(definitions))
        return record(path, *definitions[-1 if last else 0])
    def span(path, first, after):
        text = files[path]
        start = text.index(first)
        end = text.index(after, start)
        return record(path, start, end)
    def declaration(path, first):
        text = files[path]
        start = text.index(first)
        end = text.index(';', start)+1
        return record(path, start, end)
    def typedef(path, name):
        text = files[path]
        match = re.search(r'typedef (?:struct|enum) '+name+r'\b', text)
        assert match, name
        end = text.index('} '+name+';', match.start())+len('} '+name+';')
        return record(path, match.start(), end)
    c = 'src/iop/colorequal.c'
    math = 'src/common/math.h'
    types = 'src/common/dttypes.h'
    conversion = 'src/common/colorspaces_inline_conversions.h'
    helper = 'src/common/darktable_ucs_22_helpers.h'
    gaussian = 'src/common/gaussian.c'
    text = '''#include <glib.h>
#include <lcms2.h>
#include <assert.h>
#include <float.h>
#include <math.h>
#include <stdint.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef __SSE__
#include <xmmintrin.h>
#endif
// Original serial CPU paths; scheduling/clone annotations have no arithmetic.
#define DT_OMP_FOR(...)
#define DT_OMP_FOR_SIMD(...)
#define DT_OMP_SIMD(...)
#define DT_OMP_DECLARE_SIMD(...)
#define DT_OMP_PRAGMA(...)
#define __DT_CLONE_TARGETS__
#define DT_IS_ALIGNED_PIXEL(x) (x)
'''
    text += span(types, '// Configure the size of a CPU cacheline', '// A function to compute')
    text += span(types, '#if defined(_OPENMP)', '// transpose a padded')
    text += span(math, '#define LUT_ELEM', '//*****************')
    text += '#include "host.h"\n'
    for name in ['dt_colormatrix_mul', 'max3f', 'min3f']:
        text += fn(types, name)
    for name in ['sqrf', 'interpolatef', 'scalar_product', 'dot_product', 'scharr_gradient', 'deg2radf', 'dt_vector_max']:
        if name == 'scharr_gradient':
            text += fn(math, 'dt_fast_hypotf', last=True)
        text += fn(math, name)
    text += declaration('src/common/colorspaces.h', 'static const cmsCIExyY D65xyY')
    for name in ['XYZ_D50_to_D65_CAT16', 'XYZ_D65_to_D50_CAT16']:
        text += declaration('src/common/chromatic_adaptation.h', 'static const dt_colormatrix_t '+name+'\n')
    text += span(conversion, '#define DT_UCS_L_STAR_RANGE', 'static inline float Y_to_dt_UCS_L_star')
    for name in ['dt_D65_XYZ_to_xyY', 'dt_xyY_to_XYZ', 'Y_to_dt_UCS_L_star', 'dt_UCS_L_star_to_Y',
                 'xyY_to_dt_UCS_UV', 'dt_UCS_LUV_to_JCH', 'dt_UCS_JCH_to_xyY',
                 'dt_UCS_JCH_to_HSB', 'dt_UCS_HSB_to_JCH', 'dt_UCS_HSB_to_XYZ']:
        text += fn(conversion, name)
    for name in ['Delta_H', 'dt_UCS_22_build_gamut_LUT', 'lookup_gamut', 'soft_clip', 'gamut_map_HSB']:
        text += fn(helper, name)
    text += typedef('src/common/gaussian.h', 'dt_gaussian_order_t')
    text += typedef('src/common/gaussian.h', 'dt_gaussian_t')
    for name in ['_compute_gauss_params', 'dt_gaussian_init', 'dt_gaussian_blur', 'dt_gaussian_blur_4c', 'dt_gaussian_free']:
        text += fn(gaussian, name)
    text += fn('src/common/gaussian.h', 'dt_gaussian_mean_blur')
    text += fn('src/common/fast_guided_filter.h', 'interpolate_bilinear')
    for name in ['_choleski_decompose', '_triangular_descent', '_triangular_ascent', '_solve_hermitian',
                 '_transpose_dot_matrix', '_transpose_dot_vector', 'pseudo_solve']:
        text += fn('src/iop/choleski.h', name)
    text += span(c, '#define NODES', 'DT_MODULE_INTROSPECTION')
    text += typedef(c, 'dt_iop_colorequal_params_t')
    text += typedef(c, 'dt_iop_colorequal_data_t')
    text += typedef(c, 'dt_iop_colorequal_channel_t')
    text += fn(c, '_get_scaling')
    text += span(c, '#define ANGLE_SHIFT', '// dt_gaussian_mean_blur_cl()')
    for name in ['_get_hue_node', '_cosine_coeffs', '_periodic_RBF_interpolate', 'init_pipe', 'cleanup_pipe',
                 '_pack_saturation', '_pack_hue', '_pack_brightness', 'commit_params']:
        text += fn(c, name)
    params = re.search(r'typedef struct dt_iop_colorequal_params_t\b.*?} dt_iop_colorequal_params_t;', files[c], re.S)[0]
    defaults = re.findall(r'(?:float|gboolean) (\w+);[^\n]*\$DEFAULT: ([^ $]+)', params)
    assert len(defaults) == 32, len(defaults)
    text += '\nstatic dt_iop_colorequal_params_t probe_default_params(void) {return (dt_iop_colorequal_params_t){'+','.join('.'+k+'='+v for k,v in defaults)+'};}\n'
    text += 'static void probe_set_controls(dt_iop_colorequal_params_t *p,const float h[8],const float s[8],const float b[8]) {\n'
    for prefix, array in [('hue','h'),('sat','s'),('bright','b')]:
        names = [n for n in re.findall(r'float ('+prefix+r'_\w+);', params) if n != 'hue_shift']
        assert len(names) == 8
        text += ''.join(f'p->{name}={array}[{i}];\n' for i,name in enumerate(names))
    text += '}\n'
    # All copied numerical blocks retain their exact source bytes and source
    # copyright notices. The generated default initializer is introspection data.
    notices = []
    for path in dict.fromkeys(b['source'] for b in blocks):
        original = files[path]
        if original.startswith('/*'):
            notices.append(original[:original.index('*/')+2])
    (work/'upstream_cpu.h').write_text('\n'.join(notices)+'\n'+text)
    for path in ['host.h', 'runner.c', 'run.py']:
        shutil.copyfile(here/path, work/path)
    identities = {str(root/'build/native/captraw-engine'): sha((root/'build/native/captraw-engine').read_bytes())}
    assert next(iter(identities.values())) == '5a85ded0dd0a0f8a0f23756e6e6d423df544f882593776a3d11741148b064b48', 'Shared native freeze changed'
    manifest = {'sourcePin': pin, 'blocks': blocks, 'defaultParameters': dict(defaults), 'sharedIdentities': identities,
                'privateInputs': {p.name: sha(p.read_bytes()) for p in work.iterdir() if p.is_file()},
                'scope': 'Complete original Color Equalizer CPU processing: UCS22, default RBF, both guided filters, original recursive Gaussian blur, working-gamut soft clipping. Only module-host ABI/allocation/I/O adapters; serial CPU, no shared-native linkage.',
                'unverified': ['compilation', 'runtime', 'Adobe band/amount equivalence', 'display/output-gamut safety']}
    (work/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    flags = subprocess.check_output(['pkg-config','--cflags','glib-2.0','lcms2'], text=True).strip()
    libs = subprocess.check_output(['pkg-config','--libs','glib-2.0'], text=True).strip()
    verify = '''import hashlib,json,pathlib,sys
w=pathlib.Path(sys.argv[1]);m=json.loads((w/'manifest.json').read_text())
for p,h in m['sharedIdentities'].items():assert hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==h,p
for p,h in m['privateInputs'].items():assert hashlib.sha256((w/p).read_bytes()).hexdigest()==h,p
for p,h in m['sourcePin']['sha256'].items():assert hashlib.sha256((w/'upstream'/p).read_bytes()).hexdigest()==h,p
'''
    (work/'verify.py').write_text(verify)
    command = f'/usr/bin/clang -std=c11 -O2 -fno-fast-math -ffp-contract=off -Wall -Wextra {flags} {shlex.quote(str(work/"runner.c"))} {libs} -lm -o {shlex.quote(str(work/"probe"))}'
    (work/'compile.sh').write_text('#!/bin/sh\nset -eu\npython3 '+shlex.quote(str(work/'verify.py'))+' '+shlex.quote(str(work))+'\n'+command+'\npython3 '+shlex.quote(str(work/'verify.py'))+' '+shlex.quote(str(work))+'\n')
    (work/'compile.sh').chmod(0o700)
    print(json.dumps({'scope':'Preparation only; compiler not invoked','work':str(work),'compile':['/bin/sh',str(work/'compile.sh')],
                      'run':[str(root/'build/qa-venv/bin/python'),str(work/'run.py'),'--probe',str(work/'probe'),'--work',str(work),'--root',str(root)]}))
    complete = args.check
finally:
    if complete:
        shutil.rmtree(work)
    else:
        print('Prepared/failed private probe retained: '+str(work))
