"""Compare saved inference and native ART probe outputs; no GUI or model downloads."""
from pathlib import Path
import json,subprocess,hashlib
import numpy as np
from PIL import Image
import tifffile
ROOT=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file());out=ROOT/'artifacts/segmentation';rows=[]
for model in ['tiny','small']:
    r=json.loads((out/(model+'-report.json')).read_text())
    for c in r['cases']:
        prefix=out/model/('cpp-'+c['case']);input=out/'inputs'/(Path(c['input']).name+'.f32');prompts=out/'inputs'/(c['case']+'-prompts.json')
        result=subprocess.run(['/usr/bin/time','-l','/usr/bin/sandbox-exec','-f',str(ROOT/'tests/support/offline-native.sb'),str(ROOT/'build/segmentation/runtime-probe'),str(ROOT/'build/segmentation/models'/model),str(input),str(prompts),str(prefix)],capture_output=True,text=True,check=True)
        prefix.with_suffix('.log').write_text(result.stdout+result.stderr)
        a=np.fromfile(str(prefix)+'.mask',np.uint8).reshape(c['shape'][1],c['shape'][0]);b=np.asarray(Image.open(c['mask']))
        assert np.array_equal(a,b),(model,c['case'],np.count_nonzero(a!=b))
        native=json.loads(Path(str(prefix)+'.json').read_text())
        score_error=float(np.max(np.abs(np.array(native['scores'])-np.array(c['scores'])[0])));assert score_error<1e-5,(model,c['case'],score_error)
        memory=int(next(line.strip().split()[0] for line in result.stderr.splitlines() if 'maximum resident set size' in line))
        rows.append({'model':model,'case':c['case'],'maskByteExact':True,'scoreMaximumDifference':score_error,'offlineAndHomebrewDenied':True,'native':native,'peakRSSBytes':memory})
art=json.loads((out/'art/report.json').read_text());assert art['offlineAndHomebrewDenied'];effects=[]
for c in art['results']:
    name=c['name'];images={k:tifffile.imread(out/'art'/(name+'-'+k+'.tiff')) for k in ['base','full','selected','inverted','missing','reopened']}
    assert all(a.dtype==np.uint16 for a in images.values())
    mask=np.asarray(Image.open(c['mask']))>0
    assert mask.shape==images['base'].shape[:2]
    # At identical resolution and zero feather, external coverage must exactly gate the native adjustment.
    selected=np.where(mask[:,:,None],images['full'],images['base']);inverted=np.where(mask[:,:,None],images['base'],images['full'])
    assert np.array_equal(selected,images['selected']),(name,int(np.abs(selected.astype('int32')-images['selected']).max()))
    assert np.array_equal(inverted,images['inverted']),name
    assert np.array_equal(images['selected'],images['reopened'])
    assert np.array_equal(images['missing'],images['full']),'Document the current fail-open behavior; change this assertion when hardened'
    delta=np.abs(images['selected'].astype('int32')-images['base'].astype('int32'));assert delta.max()>1000
    assert hashlib.sha256(Path(c['path']).read_bytes()).hexdigest()==c['inputSHA256']
    effects.append({'case':name,'selectedPixels':int(mask.sum()),'maximumResponse16bit':int(delta.max()),'outsideMaximumDifference':int(delta[~mask].max()),'invertedExact':True,'reopenedExact':True,'missingMaskFailure':'Confirmed fail-open: missing external mask applies adjustment everywhere. Not acceptable for product integration.'})
summary={'nativeComparisons':rows,'artEffects':effects,'productAcceptance':False,'qualityAcceptance':False}
(out/'verification.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
