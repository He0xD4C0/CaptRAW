"""Headless SAM 2.1 / ONNX deployment probe. Not a product or ACR quality acceptance."""
import argparse,json,sys,time,hashlib,platform,resource
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
import torch
import onnxruntime as ort
ROOT=next(candidate for candidate in Path(__file__).resolve().parents if (candidate / 'package.json').is_file())
WORK=ROOT/'build/segmentation';UP=WORK/'upstream';OUT=ROOT/'artifacts/segmentation'
sys.path.insert(0,str(UP/'ort'))
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from sam2.utils.transforms import SAM2Transforms
from image_encoder import export_image_encoder_onnx
from image_decoder import export_decoder_onnx
parser=argparse.ArgumentParser();parser.add_argument('--model',choices=['tiny','small'],default='tiny');parser.add_argument('--export-only',action='store_true');args=parser.parse_args()
name=args.model;target=WORK/'models'/name;target.mkdir(parents=True,exist_ok=True)
torch.set_num_threads(8);torch.manual_seed(42);ort.disable_telemetry_events()
config=f'configs/sam2.1/sam2.1_hiera_{"t" if name=="tiny" else "s"}.yaml'
checkpoint=UP/f'sam2.1_hiera_{name}.pt';model=build_sam2(config,str(checkpoint),device='cpu',apply_postprocessing=False).eval()
with torch.inference_mode():
 for component,export in [('encoder',export_image_encoder_onnx),('decoder',export_decoder_onnx)]:
  p=target/(component+'.onnx')
  if not p.exists():
   start=time.monotonic();print('EXPORT',name,component,flush=True)
   export(model,str(p),**({'multimask_output':True} if component=='decoder' else {}));print('EXPORTED',round(time.monotonic()-start,3),flush=True)
if args.export_only:sys.exit(0)
session_options=ort.SessionOptions();session_options.intra_op_num_threads=8;session_options.inter_op_num_threads=1;session_options.enable_mem_pattern=False
start=time.monotonic();encoder=ort.InferenceSession(str(target/'encoder.onnx'),sess_options=session_options,providers=['CPUExecutionProvider']);decoder=ort.InferenceSession(str(target/'decoder.onnx'),sess_options=session_options,providers=['CPUExecutionProvider']);session_ms=(time.monotonic()-start)*1000
predictor=SAM2ImagePredictor(model,max_hole_area=0,max_sprinkle_area=0)
transform=SAM2Transforms(1024,0,max_hole_area=0,max_sprinkle_area=0)
cases=[
 ('canon-r5.CR3.jpg','apple',[[270,485]],[1],None),
 ('canon-r5.CR3.jpg','lemon-box',[],[],[702,263,978,667]),
 ('canon-r5.CR3.jpg','apple-exclude',[[270,485],[550,470]],[1,0],None),
 ('fuji-xt4.RAF.jpg','chart-box',[],[],[719,250,1038,780]),
 ('nikon-d850.NEF.jpg','sky',[[760,85],[750,350]],[1,0],None),
]
rows=[];cached={};(OUT/name).mkdir(exist_ok=True)
for filename,label,points,labels,box in cases:
 path=OUT/'inputs'/filename;im=Image.open(path).convert('RGB');image=np.array(im);h,w=image.shape[:2]
 if filename not in cached:
  input_tensor=transform(image).unsqueeze(0).numpy();input_tensor.tofile(OUT/'inputs'/(filename+'.f32'));t=time.monotonic();features=encoder.run(None,{'image':input_tensor});encode_ms=(time.monotonic()-t)*1000
  times=[]
  for _ in range(3):
   t=time.monotonic();encoder.run(None,{'image':input_tensor});times.append((time.monotonic()-t)*1000)
  cached[filename]=(features,encode_ms,times)
 features,encode_ms,encode_warm=cached[filename]
 coords=np.array(points if box is None else np.array(box).reshape(2,2),np.float32).reshape(1,-1,2)*np.array([1024/w,1024/h],np.float32)
 point_labels=np.array(labels if box is None else [2,3],np.int32).reshape(1,-1)
 (OUT/'inputs'/(label+'-prompts.json')).write_text(json.dumps({'width':w,'height':h,'points':points if box is None else np.array(box).reshape(2,2).tolist(),'labels':labels if box is None else [2,3]}))
 inputs=dict(zip(['image_features_0','image_features_1','image_embeddings'],features));inputs.update(point_coords=coords,point_labels=point_labels,input_masks=np.zeros((1,1,256,256),np.float32),has_input_masks=np.zeros((1,),np.float32),original_image_size=np.array([h,w],np.int32))
 t=time.monotonic();masks,scores,low=decoder.run(None,inputs);decode_ms=(time.monotonic()-t)*1000
 times=[]
 for _ in range(5):
  t=time.monotonic();again=decoder.run(None,inputs);times.append((time.monotonic()-t)*1000);assert np.array_equal(again[0],masks)
 with torch.inference_mode():
  predictor.set_image(image);reference,ref_scores,ref_low=predictor.predict(point_coords=np.array(points,np.float32) if points else None,point_labels=np.array(labels,np.int32) if labels else None,box=np.array(box,np.float32) if box else None,multimask_output=True)
 intersection=np.logical_and(masks[0],reference).sum(axis=(1,2));union=np.logical_or(masks[0],reference).sum(axis=(1,2));ious=intersection/np.maximum(union,1)
 assert ious.min()>.995,(label,ious)
 winner=int(scores[0].argmax());assert winner==int(ref_scores.argmax()),(label,scores,ref_scores)
 selected=masks[0,winner];assert selected.any() and not selected.all()
 maskfile=OUT/name/(label+'-mask.png');Image.fromarray((selected*255).astype(np.uint8)).save(maskfile)
 overlay=np.array(im).astype(np.float32);overlay[selected]=overlay[selected]*.55+np.array([255,35,35])*.45
 visual=Image.fromarray(overlay.astype(np.uint8));draw=ImageDraw.Draw(visual)
 for (x,y),v in zip(points,labels):draw.ellipse((x-6,y-6,x+6,y+6),fill='lime' if v else 'blue',outline='white',width=2)
 if box:draw.rectangle(box,outline='lime',width=2)
 visual.save(OUT/name/(label+'-overlay.jpg'),quality=92)
 row={'case':label,'input':str(path),'inputSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'points':points,'labels':labels,'box':box,'mask':str(maskfile),'maskSHA256':hashlib.sha256(maskfile.read_bytes()).hexdigest(),'shape':[w,h],'selectedPixels':int(selected.sum()),'scores':scores.tolist(),'torchMaskIoU':ious.tolist(),'lowLogitMaxError':float(np.max(np.abs(low[0]-ref_low))),'scoreMaxError':float(np.max(np.abs(scores[0]-ref_scores))),'encoderFirstMs':encode_ms,'encoderWarmMs':encode_warm,'decoderFirstMs':decode_ms,'decoderWarmMs':times,'repeatedMasksIdentical':True}
 rows.append(row);print(json.dumps(row),flush=True)
report={'model':name,'checkpointSHA256':hashlib.sha256(checkpoint.read_bytes()).hexdigest(),'config':config,'samCommit':'2b90b9f5ceec907a1c18123530e92e794ad901a4','exporter':'microsoft/onnxruntime v1.30.0 SAM2 exporter, unchanged; explicit SAM2.1 builder','versions':{'torch':torch.__version__,'ort':ort.__version__,'python':platform.python_version()},'providers':encoder.get_providers(),'threads':8,'sessionInitMs':session_ms,'peakRSSBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'models':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in target.glob('*.onnx')},'cases':rows,'limitations':['No ACR ground truth or blind quality acceptance','No person-part recognition, automatic subject detection or alpha matting','1024-square encoder and 256-square low-resolution logits','Python reference/probe only; desktop/C++ integration not yet present','No claim that checkpoint training can be fully reproduced from public datasets']}
(OUT/(name+'-report.json')).write_text(json.dumps(report,indent=2)+'\n')
