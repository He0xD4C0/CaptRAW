from pathlib import Path
import json,numpy as np,tifffile
root=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())/'artifacts/mask-groups'
images={f.stem:tifffile.imread(f).astype(np.int32) for f in root.glob('*.tiff')}
base=images['baseline'];h,w=base.shape[:2]
def delta(name,x,y):return float(np.abs(images[name]-base)[int(y*h),int(x*w)].mean())
for x,y in [(.3,.45),(.475,.45),(.7,.45)]:assert delta('add',x,y)>100
assert delta('add',.9,.9)==0
assert delta('subtract',.3,.45)>100 and delta('subtract',.475,.45)==0 and delta('subtract',.7,.45)==0
assert delta('intersect',.475,.45)>100 and delta('intersect',.3,.45)==0 and delta('intersect',.7,.45)==0
assert delta('hidden-child',.3,.45)>100 and delta('hidden-child',.7,.45)==0
assert delta('inverted',.475,.45)==0 and delta('inverted',.9,.9)>100
assert np.array_equal(images['intersect'],images['reloaded'])
(root/'pixel-report.json').write_text(json.dumps({'add':True,'subtract':True,'intersect':True,'childVisibility':True,'groupInvert':True,'independentExportIdentical':True},indent=2)+'\n')
print('Group pixel coverage, inversion, visibility and independent profile restore passed')
