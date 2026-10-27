"""Deterministic linear Bayer DNG for numerical and mask regression tests."""
from pathlib import Path
import numpy as np
import tifffile
import struct

out = Path(__file__).resolve().parents[1] / 'build/samples'
out.mkdir(parents=True, exist_ok=True)
h, w = 768, 1024
y, x = np.mgrid[0:h, 0:w]
linear = 0.05 + 0.75 * x / (w - 1)
raw = (512 + linear * (16383 - 512)).astype(np.uint16)
# Neutral illuminant: the same sample value at each CFA channel.
tags = [
    (33421, 'H', 2, (2, 2), False),
    (33422, 'B', 4, (0, 1, 1, 2), False),
    (50706, 'B', 4, (1, 4, 0, 0), False),
    (50707, 'B', 4, (1, 3, 0, 0), False),
    (50708, 's', 0, 'CaptRAW Synthetic Bayer', False),
    (50714, 'H', 1, 512, False),
    (50717, 'I', 1, 16383, False),
    (50721, '2i', 9, (1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1), False),
    (50728, '2I', 3, (1, 1, 1, 1, 1, 1), False),
    (50778, 'H', 1, 21, False),
]
tifffile.imwrite(out / 'synthetic.dng', raw, photometric=32803, metadata=None, extratags=tags)
with tifffile.TiffFile(out/'synthetic.dng') as f:
    offset=f.pages[0].tags['Compression'].valueoffset
    byteorder=f.byteorder
unsupported=bytearray((out/'synthetic.dng').read_bytes())
struct.pack_into(byteorder+'H',unsupported,offset,65000)
(out/'unsupported-compression.dng').write_bytes(unsupported)
print(out / 'synthetic.dng')

from PIL import Image, ImageCms
rgb = np.stack([linear, np.broadcast_to(y / (h - 1), (h, w)), 1 - linear], axis=-1)
Image.fromarray((rgb * 255).astype(np.uint8)).save(
    out / 'embedded-srgb.png', icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())

import colorsys
swatches = np.empty((256, 1728, 3), dtype=np.uint8)
for i, hue in enumerate([0, 1/12, 1/6, 1/3, .5, 2/3, .75, 5/6, None]):
    for row in range(256):
        value = .2 + .6 * row / 255
        color = (value, value, value) if hue is None else colorsys.hsv_to_rgb(hue, 1, value)
        swatches[row, i*192:(i+1)*192] = np.array(color) * 255
Image.fromarray(swatches).save(out / 'bw-swatches.png', icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())

# Authored repair target: clean gradient source, dust target and color patches.
repair = np.broadcast_to((90 + 80*x/(w-1) + 3*np.sin(y/5))[...,None], (h,w,3)).copy()
repair[(x-716)**2+(y-460)**2 < 8**2] = 20
repair[160:240,216:296] = [40,100,200]
repair[160:240,676:756] = [200,60,40]
Image.fromarray(np.clip(repair,0,255).astype(np.uint8)).save(out/'repair-source.png',icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())

# Controlled detail/noise target, with reproducible grain and color patches.
rng=np.random.default_rng(81026)
noise=128+3*rng.standard_normal((h,w))+10*np.sin(x*.24)+5*np.sin(y*.11)
detail_rgb=np.repeat(noise[...,None],3,axis=2)
detail_rgb[:180,:w//2]=[180,65,45]
detail_rgb[:180,w//2:]=[45,90,180]
Image.fromarray(np.clip(detail_rgb,0,255).astype(np.uint8)).save(out/'local-details.png',icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())

# Equal-stop luminance ramp with deterministic fine texture for tonal bands.
linear=2.**np.linspace(-10,0,w)[None,:]*np.ones((h,1))
linear*=1+.02*np.sin(np.arange(h)[:,None]/3)*np.sin(np.arange(w)[None,:]/3)
srgb=np.where(linear<=.0031308,12.92*linear,1.055*linear**(1/2.4)-.055)
tone=np.repeat(np.clip(np.round(srgb*255),0,255).astype('uint8')[:,:,None],3,axis=2)
Image.fromarray(tone).save(out/'local-tone.png')

# Small blue targets reveal picker offsets after a calibrated wide-angle warp.
optics = np.full((h, w, 3), [200, 80, 60], dtype=np.uint8)
for cy in [80, 384, 688]:
    for cx in [80, 256, 512, 768, 944]:
        optics[cy-4:cy+4, cx-4:cx+4] = [100, 160, 220]
exif = Image.Exif()
exif[271], exif[272], exif[274] = 'NIKON CORPORATION', 'NIKON D500', 1
exif[34665] = {33437: 3.5, 37386: 10., 41989: 15,
               42036: 'AF-S DX Nikkor 10-24mm f/3.5-4.5G ED'}
Image.fromarray(optics).save(out/'wb-optics.png', exif=exif)
# Authored Bayer data, not a camera sample; EXIF selects the same known warp.
channels = np.array([[0, 1], [1, 2]])[y % 2, x % 2]
optics_raw = (512 + optics[y, x, channels].astype(float)/255*(16383-512)).astype(np.uint16)
tifffile.imwrite(out/'wb-optics.dng', optics_raw, photometric=32803, metadata=None, extratags=tags)
import subprocess
subprocess.run(['exiftool', '-overwrite_original', '-Make=NIKON CORPORATION',
                '-Model=NIKON D500', '-FNumber=3.5', '-FocalLength=10',
                '-FocalLengthIn35mmFormat=15',
                '-LensModel=AF-S DX Nikkor 10-24mm f/3.5-4.5G ED',
                str(out/'wb-optics.dng')], check=True, capture_output=True)
