from pathlib import Path
import json,os
import numpy as np
import tifffile
root=Path(__file__).resolve().parents[1]
out=root/os.environ.get('CAPTRAW_ASSETS_OUT','artifacts/mask-assets')
report=json.loads((out/'report.json').read_text())
pairs=list(report['pairs'])
gui=root/os.environ.get('CAPTRAW_ASSETS_E2E_OUT','artifacts/mask-assets-gui')
if (gui/'report.json').is_file():
    assert len(json.loads((gui/'report.json').read_text())['checks'])==8
    pairs.append({'actual':str(gui/'已恢复.tiff'),'expected':report['pairs'][0]['expected']})
rows=[]
for pair in pairs:
    with tifffile.TiffFile(pair['actual']) as f:
        actual=f.asarray();assert actual.dtype==np.uint16 and 34675 in f.pages[0].tags
    with tifffile.TiffFile(pair['expected']) as f:expected=f.asarray()
    assert actual.shape==expected.shape and np.array_equal(actual,expected),pair
    rows.append({**pair,'dtype':str(actual.dtype),'shape':list(actual.shape),'ICC':True,'maximumDifference':0})
(out/'pixel-report.json').write_text(json.dumps({'comparisons':rows},indent=2)+'\n')
print('PASS',len(rows),'TIFF16 / ICC outputs exactly match independent 0.26')
