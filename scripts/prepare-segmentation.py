"""Fetch hash-pinned research assets into ignored build/. Does not modify the app."""
from pathlib import Path
import json,hashlib,urllib.request,tarfile,shutil
ROOT=Path(__file__).resolve().parents[1];dest=ROOT/'build/segmentation/upstream';dest.mkdir(parents=True,exist_ok=True)
manifest=json.loads((ROOT/'tests/segmentation-sources.json').read_text())
for item in manifest['sources']:
    path=dest/item['name']
    if not path.exists():
        temporary=path.with_suffix(path.suffix+'.part')
        with urllib.request.urlopen(item['url'],timeout=60) as response,temporary.open('wb') as output:
            while chunk:=response.read(1048576):output.write(chunk)
        if hashlib.sha256(temporary.read_bytes()).hexdigest()!=item['sha256']:raise ValueError('Checksum mismatch: '+item['name'])
        temporary.replace(path)
    assert path.stat().st_size==item['bytes'] and hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256'],item['name']
    if item['name'] in ['sam2.tar.gz','onnxruntime-osx-arm64-1.30.0.tgz']:
        with tarfile.open(path) as archive:
            target=dest/archive.getnames()[0].split('/')[0]
            if not target.exists():archive.extractall(dest,filter='data')
    elif item['name'].startswith('ort-') and path.suffix=='.py':
        (dest/'ort').mkdir(exist_ok=True);shutil.copyfile(path,dest/'ort'/item['name'][4:])
print('Verified',len(manifest['sources']),'pinned archives, checkpoints and exporter files in',dest)
