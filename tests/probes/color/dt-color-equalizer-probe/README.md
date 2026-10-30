Private Color Equalizer CPU-module probe, darktable 5.6.2, module version 4,
commit `20891f6c6fa7be995e5bf9dff9d1ee5062051773`. GPL-3.0-or-later source
notices and the original LICENSE accompany the generated sources. Source hashes
are fixed in `source-pin.json`.

Prepare only (no compiler or shared build):

```sh
python3 tests/probes/color/dt-color-equalizer-probe/prepare.py
```

The printed private `compile.sh` is executed by the parent. It compiles one C11
translation unit using the existing Clang, GLib and LittleCMS headers, links no
ART or CaptRAW library, and verifies the original shared engine SHA before/after.
No CMake/Ninja edge, application window, Adobe session or production source is
used. `--sources PATH` permits a predownloaded private tree; every source is still
hash-verified. `--check` removes its preparation scratch on success.

`upstream_cpu.h` contains byte-preserved numerical functions plus their original
notices. `manifest.json` records source lines and each copied block's hash.
Included paths are the complete CPU module process/commit/init/cleanup, UCS22
forward/inverse conversions, periodic RBF and original Cholesky solver, UV
prefilter, correction guidance, original recursive Gaussian kernels, bilinear
resampling, saturation weights, gradient halo suppression and gamut soft clip.
The scalar serial build disables scheduling/clone annotations only; it does not
replace filters, shorten support, approximate color transforms or tune gains.

`host.h` supplies full-frame module ABI, aligned memory, logging and raw I/O
adapters. Processing uses the original default parameters extracted from module
introspection, including guided filtering. Input/output ICC conversion uses
LittleCMS float32, relative colorimetric, NOOPTIMIZE/NOCACHE. The chosen working
profile is the frozen installation's linear Rec2020 ICC; its colorant matrix and
inverse are passed to the original module, which performs its own CAT16 D65
adaptation. This is the complete original module, not the whole darktable pipe
or a production ART integration.

After the parent compiles, run the printed `run.py` command for **zero + gray**.
It records actual neutral-module differences and a fixed gray stress case; it
does not declare identity merely because all native controls are neutral.
The run's small explicit report remains; successful image/log scratch is removed.
Failure retains only that run's scratch. Keep the compile directory until both
phases finish, then remove that exact path after preserving its small manifest.

Only after reviewing zero/gray, use the same command with:

```text
--phase references --zero-report /tmp/captraw-dt-color-equalizer-zero.json
```

This diagnoses the four actual ACR TAT references plus the manual red-luminance
+40 reference. All non-HSL CRS properties/structures must equal the fixed
neutral. References and outputs have separate baselines; output ICCs and common
XYZ D50 increments are measured independently. Native output remains float until
the explicit TIFF16 quantization, and newly clipped pixels are recorded per ROI.

The one predeclared diagnostic bridge is **not an Adobe mapping**: native hue
degrees equal the CRS number; native saturation/brightness gains equal
`1 + CRS/100`; the original native UCS nodes remain untouched. Both CRS and
native controls are recorded. There is no parameter sweep, amplitude fitting,
node repositioning, target-derived coefficient, or claim that numerical residuals
alone establish Adobe equivalence. Actual band support, amount semantics,
cross-tool order and fit/detail/export geometry remain separate acceptance work.
