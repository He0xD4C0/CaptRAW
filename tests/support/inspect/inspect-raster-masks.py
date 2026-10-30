from pathlib import Path
import json,sys,os
import numpy as np
from PIL import Image
import tifffile
OUT=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())/os.environ.get('CAPTRAW_RASTER_OUT','artifacts/raster-masks')
w,h=641,479
if '--prepare' in sys.argv:
    OUT.mkdir(exist_ok=True)
    x,y=np.meshgrid(np.arange(w),np.arange(h));a=np.zeros((h,w,3),np.uint8)
    a[:,:,0]=80+(x//40%2)*10;a[:,:,1]=90+(y//35%2)*10;a[:,:,2]=95
    Image.fromarray(a).save(OUT/'原片 网格.png')
    Image.new('RGB',(2564,1916),(90,90,90)).save(OUT/'uniform-large.png')
    for width,height,name in [(641,479,'full'),(160,120,'small')]:
        x,y=np.meshgrid(np.arange(width),np.arange(height));a=np.zeros((height,width),np.uint8)
        a[(x/width>.06)&(x/width<.31)&(y/height>.11)&(y/height<.36)]=255
        a[(x/width-.64)**2+(y/height-.67)**2<.1**2]=153
        a[(x<3)|(y==height-1)]=200
        Image.fromarray(a).save(OUT/(name+'.png'))
        # Independent pixel-center resampling, quantized only at 16-bit reference output.
        sx=np.clip((np.arange(w)+.5)*width/w-.5,0,width-1);sy=np.clip((np.arange(h)+.5)*height/h-.5,0,height-1)
        x0=sx.astype(int);y0=sy.astype(int);x1=np.minimum(x0+1,width-1);y1=np.minimum(y0+1,height-1)
        xf=sx-x0;yf=sy-y0
        top=a[y0[:,None],x0]*(1-xf)+a[y0[:,None],x1]*xf
        bottom=a[y1[:,None],x0]*(1-xf)+a[y1[:,None],x1]*xf
        coverage=(top*(1-yf[:,None])+bottom*yf[:,None])/255
        for rotation in [0,90,180,270]:
            rotated=np.rot90(coverage,-rotation//90)
            np.save(OUT/f'{name}-{rotation}-expected.npy',rotated)
            Image.fromarray(np.rint(rotated*65535).astype(np.uint16)).save(OUT/f'{name}-{rotation}-reference.png')
    print('Prepared asymmetric masks and independent 16-bit references');sys.exit()
report=json.loads((OUT/'report.json').read_text());rows=[]
alpha=lambda name:np.asarray(Image.open(OUT/(name+'-coverage.png')))[:,:,3]
for row in report['rows']:
    name=row['name'];actual=alpha(name)
    if row.get('uniform'):continue
    if row.get('feather'):expected=actual
    else:expected=np.rint(np.load(OUT/f'{row["kind"]}-{row["rotation"]}-expected.npy')*255).astype(np.uint8)
    assert actual.shape==expected.shape,(name,actual.shape,expected.shape)
    difference=np.abs(actual.astype(int)-expected.astype(int));assert difference.max()<=1,(name,difference.max())
    d=row['detail']['mask'];roi=actual[int(d['y']):int(d['y']+d['height']),int(d['x']):int(d['x']+d['width'])]
    detail=alpha(name+'-detail');diff=np.abs(detail.astype(int)-roi.astype(int));assert diff.max()<=1,(name,'detail',diff.max())
    stats={'name':name,'coverageMaxDifference':int(difference.max()),'detailMaxDifference':int(diff.max())}
    if not row.get('feather'):
        with tifffile.TiffFile(row['actual']) as f:a=f.asarray();assert a.dtype==np.uint16 and 34675 in f.pages[0].tags
        b=tifffile.imread(row['expected']);error=np.abs(a.astype(int)-b.astype(int));assert error.max()<=(0 if row['kind']=='full' else 2),(name,error.max())
        stats['tiffMaximumDifference']=int(error.max())
    rows.append(stats);print('PASS',stats)
base=alpha('full-0').astype(float)/255;brush=alpha('brush').astype(float)/255
for operation,expected in [('add',np.maximum(base,brush)),('subtract',base*(1-brush)),('intersect',base*brush)]:
    actual=alpha('combined-'+operation);error=np.abs(actual.astype(float)-expected*255);assert error.max()<=1,(operation,error.max());rows.append({'operation':operation,'maximumDifference':float(error.max())})
assert np.max(np.abs(alpha('inverse').astype(int)+alpha('full-0').astype(int)-255))<=1

for row in report['rows']:
    if not row.get('uniform'):continue
    mask=np.asarray(Image.open(OUT/'full.png'),dtype=float)/255
    def expected(width,height):
        sx=np.clip((np.arange(width)+.5)*mask.shape[1]/width-.5,0,mask.shape[1]-1);sy=np.clip((np.arange(height)+.5)*mask.shape[0]/height-.5,0,mask.shape[0]-1)
        x=sx.astype(int);y=sy.astype(int);xx=np.minimum(x+1,mask.shape[1]-1);yy=np.minimum(y+1,mask.shape[0]-1)
        a=(mask[y[:,None],x]*(1-(sx-x))+mask[y[:,None],xx]*(sx-x))*(1-(sy-y)[:,None])+(mask[yy[:,None],x]*(1-(sx-x))+mask[yy[:,None],xx]*(sx-x))*(sy-y)[:,None]
        r=int(min(width,height)*.01+.5)
        for repeat in range(2):
            for axis in [1,0]:
                n=a.shape[axis];positions=np.arange(n);lo=np.maximum(positions-r,0);hi=np.minimum(positions+r+1,n)
                prefix=np.concatenate([np.zeros_like(np.take(a,[0],axis=axis)),np.cumsum(a,axis=axis)],axis=axis)
                divisor=(hi-lo)[None,:] if axis==1 else (hi-lo)[:,None]
                a=(np.take(prefix,hi,axis=axis)-np.take(prefix,lo,axis=axis))/divisor
        return np.rint(np.clip(a,0,1)*255).astype(np.uint8)
    for kind in ['fit','detail']:
        frame=row['frame'] if kind=='fit' else row['detail'];actual=alpha(row['name']+('' if kind=='fit' else '-detail'))
        full=expected(frame['width'],frame['height']) if kind=='fit' else expected(2564,1916)
        d=frame['mask'];reference=full if kind=='fit' else full[d['y']:d['y']+d['height'],d['x']:d['x']+d['width']]
        difference=np.abs(actual.astype(int)-reference.astype(int));assert difference.max()<=1,('uniform',kind,difference.max())
        stats={'name':'uniform-'+kind,'maximumDifference':int(difference.max())};rows.append(stats);print('PASS',stats)
(OUT/'pixels.json').write_text(json.dumps({'comparisons':rows,'scope':'Coordinates, algebra and implementation consistency; no semantic or ACR quality claim.'},indent=2)+'\n')
