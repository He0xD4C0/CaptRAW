import json,sys
from pathlib import Path
import numpy as np
import tifffile
from PIL import Image,ImageCms
reports=[Path(x) for x in sys.argv[1:]] or [Path('artifacts/batch-export/report.json'),Path('artifacts/batch-export-gui/report.json')]
results=[]
for report in reports:
    data=json.loads(report.read_text())
    for pair in data['pairs']:
        with tifffile.TiffFile(pair['actual']) as t:
            a=t.asarray();icc=t.pages[0].tags[34675].value
        b=tifffile.imread(pair['expected'])
        assert a.dtype==np.uint16 and a.shape==b.shape and icc
        assert np.array_equal(a,b), (pair, int(np.max(np.abs(a.astype(np.int32)-b.astype(np.int32)))))
        results.append(dict(**pair,shape=list(a.shape),dtype=str(a.dtype),iccBytes=len(icc),maxDifference=0))
    jpeg_folder=report.parent/('JPEG 输出' if data.get('backgroundWindow') else '同名照片')
    for path in jpeg_folder.glob('*.jpg'):
        with Image.open(path) as im:
            import io
            icc=im.info.get('icc_profile');assert icc
            name=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc))).strip()
            assert 'P3' in name,(path,name)
            results.append(dict(path=str(path),format=im.format,iccDescription=name))
output=reports[-1].parent/'pixel-verification.json';output.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n');print(json.dumps(results,ensure_ascii=False,indent=2))
