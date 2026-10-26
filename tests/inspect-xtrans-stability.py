from pathlib import Path
import json,numpy as np,tifffile
root=Path(__file__).resolve().parents[1]/'artifacts/xtrans-stability'
files=['threads-1.tiff','threads-2.tiff','threads-8.tiff','cli-0.tif','cli-1.tif'];base=tifffile.imread(root/files[0]);result=[]
for f in files:
 image=tifffile.imread(root/f);assert image.dtype==np.uint16 and np.array_equal(base,image),f
 result.append({'file':f,'maximumDifference':0})
(root/'pixel-report.json').write_text(json.dumps({'independentRepeatedExports':result,'repeatableAcrossThreadCounts':True,'repeatableWithHeapScribble':True},indent=2)+'\n');print('X-Trans workers, 1/2/8 threads, heap scribble and two CLI runs: all pixels identical')
