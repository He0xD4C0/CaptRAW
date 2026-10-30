Native pipette isolation probe. No production edits, GUI initialization,
replacement sampling formula, CMake changes, or shared-library build.

Parent compile/run, after confirming the existing libraries and upstream headers
belong to the same coordinated native build:

```sh
CAPTRAW_PIPETTE_ENGINE_SHA=0a632cc3d5ec6ca6720f0d85ece2d4cd842207947bcf4643bcb94e05f4d13899 node tests/probes/color/tat-pipette-probe/run.mjs --build --raw build/samples/nikon-d850.NEF --report /tmp/captraw-tat-pipette-results.json
```

`--build` invokes only an isolated compile and link, using flags from
`ninja -t commands captraw-wb-probe` and already-built libraries. It never runs
Ninja build edges. Object, dependency file, executable and ART cache are private
temporary files. Successful runs remove that directory; the explicit small
report remains. Failures retain the directory and native stdout/stderr.

Preparation only (no compiler or native execution):

```sh
node tests/probes/color/tat-pipette-probe/run.mjs --check
```

Without arguments, preparation retains `compile.sh`, requests and a manifest in
a fresh temporary directory. The printed compile script can be run manually by
the parent; its printed `run` array gives the executable command. `--check`
performs the same preparation and removes its scratch on success.

What the executable checks:

- Actual `EditDataProvider`/`EditSubscriber`, `ET_PIPETTE`, staged processor and
  `Crop`/`PipetteBuffer`, using the existing ART operators without a window.
- ToneCurve1 RGB and R/G/B single-channel buffers; all native samples must be
  finite and normalized. Independent footprint means must agree with ART's
  `getPipetteData` API. No monitor RGB or PNG is substituted.
- The same full-canvas display pixel sampled from full resolution and a real
  skip=1 ROI, including ART's actual left/top borders. Maximum difference
  must be below 1e-5. Source/display mapping round trips must be below .05 px.
- Fixed chart neutral, main 166-to-201 curve, crop, coarse rotation90 and
  fine-rotation/perspective cases. Main-curve edits must preserve its own
  input buffer and change the later RGB-channel input. An optional real RAW
  exercises the same full/ROI path; it is not a performance benchmark.
- HSL reads every hue in the footprint before aggregation and reports the
  circular resultant separately. It does not use the ordinary mean of wrapped
  hues, claim saturation confidence, generate eight-band weights, or edit HSL.
- Input, probe source, relevant upstream source/header and shared-artifact
  hashes are recorded and must remain unchanged during the run. Source hashes
  document the inputs; they do not independently prove library provenance.

ACR comparison boundary:

The chart is the actual `tat-interaction-187/inputs/controlled-tat.tif`, with
verified file SHA, pixels, ICC and 1536x1024 RGB16 shape. Its third gray patch
center `(640,550)` has RGB16 `(42667,42642,42682)`, approximately 166/255. The
reference reports point-curve input166 and display RGB156. This probe reports
native encoded RGB and their mean times255 against166 without fitting or
requiring equality. The original ACR click's precise source pixel was not
recorded, so this is a same-patch domain diagnostic, not exact click parity.
The other recorded anchors are the orange and darker gray patch centers.

Preparation success is not compiled/native acceptance. Until the parent runs
the executable, headless provider availability and numerical checks are pending.
