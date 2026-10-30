import json, pathlib, shutil, subprocess, tempfile, time
import numpy as np
import tifffile
root = next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
work = pathlib.Path(tempfile.mkdtemp(prefix='captraw-grain-footprint-'))
success = False
try:
    subprocess.run(['clang++', '-std=c++17', '-O3', '-I', str(root/'native/include'), str(root/'tests/native/color/effects-footprint.cc'), '-o', str(work/'probe')], check=True)
    results = []
    def stats(a):
        a = a - a.mean()
        rms = float(np.sqrt(np.mean(a*a)))
        correlation = float(np.mean(a[:, 1:]*a[:, :-1]) / np.mean(a*a))
        # Gradient-based correlation length in destination pixels; comparable
        # even when fine particles become smaller than a destination pixel.
        length = float(np.sqrt(2*np.mean(a*a)/np.mean(np.diff(a, axis=1)**2)))
        spectrum = np.abs(np.fft.rfft2(a))**2
        fy = np.fft.fftfreq(a.shape[0])[:, None]
        fx = np.fft.rfftfreq(a.shape[1])[None, :]
        high = float(spectrum[(fx*fx+fy*fy) > .35**2].sum()/spectrum.sum())
        return dict(rms=rms, correlation1=correlation, correlationLength=length, highFrequencyEnergy=high)
    for size, roughness in [(5, 0), (25, 50), (80, 100)]:
        start=time.perf_counter()
        subprocess.run([str(work/'probe'), str(work), str(size), str(roughness)], check=True)
        probe_seconds=time.perf_counter()-start
        noise = np.fromfile(work/'full.f32', dtype=np.float32).reshape(2048,3072).astype(np.float64)
        # Flat 50% linear gray, grain amount 10, matching effects.cc's amplitude.
        amplitude = .10*.08*np.sqrt(.5/1.5)
        pixels = .5+amplitude*noise
        assert np.min(pixels)>0 and np.max(pixels)<1
        tiff = work/'export16.tif'
        tifffile.imwrite(tiff, np.rint(pixels*65535).astype(np.uint16), photometric='minisblack')
        restored = tifffile.imread(tiff).astype(np.float64)/65535
        for skip in (2,4,8):
            h,w = 2048//skip,3072//skip
            reference = restored.reshape(h,skip,w,skip).mean(axis=(1,3))
            fit = .5+amplitude*np.fromfile(work/f'fit-{skip}.f32', dtype=np.float32).reshape(h,w)
            old = .5+amplitude*np.fromfile(work/f'old-{skip}.f32', dtype=np.float32).reshape(h,w)
            r,f,o = stats(reference),stats(fit),stats(old)
            rms_error = abs(f['rms']/r['rms']-1)
            normalized_error = float(np.sqrt(np.mean((fit-reference)**2))/r['rms'])
            assert rms_error < .002, (size,roughness,skip,rms_error)
            assert normalized_error < .005, (size,roughness,skip,normalized_error)
            assert abs(f['correlationLength']/r['correlationLength']-1) < .005
            assert abs(f['highFrequencyEnergy']-r['highFrequencyEnergy']) < .002
            results.append(dict(size=size,roughness=roughness,skip=skip,probeSeconds=probe_seconds,oldRMSRatio=o['rms']/r['rms'],fitRMSRatio=f['rms']/r['rms'],relativePixelError=normalized_error,reference=r,fit=f))
        for path in work.glob('*.f32'): path.unlink()
        tiff.unlink()
    print(json.dumps(dict(fixture=[3072,2048],linearGray=.5,amount=10,reference='standalone full-resolution kernel / uint16 TIFF / area downsample, not ART export',results=results),indent=2))
    success=True
finally:
    if success: shutil.rmtree(work)
    else: print('Failure retained:',work)
