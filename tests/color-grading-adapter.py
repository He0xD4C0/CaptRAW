"""Experimental SDR grading adapter. Not a product algorithm or ACR equivalence test.

Uses fixed darktable GPL-3.0-or-later HSL conversion unchanged. The region
weights, opacity, luminance and ordering below are CaptRAW experiments.
"""
from pathlib import Path
import ctypes,hashlib,json,subprocess,time
import numpy as np
import tifffile
from PIL import Image,ImageCms
import io

root=Path(__file__).resolve().parents[1];cache=root/'build/grading-research'
out=root/'artifacts/color-grading-candidates/adapter';out.mkdir(parents=True,exist_ok=True)
source=cache/'darktable-5.6.2/src/common/colorspaces.h'
art=root/'build/upstream/ART-1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/src/engine'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(source)=='b9565605fe4013c2627ad7c23c837346776a7f6008c31f7ab543202213c10606'
assert sha(art/'iccmatrices.h')=='b1ead16867c76564596aae4e8727969f8e23cbaa0c537357c0b9da6944da2710'
text=source.read_text();start=text.index('static inline float hue2rgb(')
at=text.index('static inline void hsl2rgb(',start);brace=text.index('{',at);depth=1;end=brace+1
while depth:
    depth+=(text[end]=='{')-(text[end]=='}');end+=1
helpers=text[start:end]
cpp=r'''
#include <algorithm>
#include <cmath>
#include <cstddef>
#include "iccmatrices.h"
using dt_aligned_pixel_t = float[4];
''' + helpers + r'''
namespace {
float lightness(const float *v) { return .5f * (*std::min_element(v,v+3)+*std::max_element(v,v+3)); }
float smooth(float a,float b,float x) {
    const float t=std::clamp((x-a)/(b-a),0.f,1.f);return t*t*(3.f-2.f*t);
}
void weights(float l,float blend,float balance,float *w) {
    const float x=std::clamp(l,0.f,1.f),b=blend/100.f;
    const float t=x/(x+(1.f-x)*std::exp2(-balance/25.f));
    w[0]=1.f-smooth(.05f,.45f+.55f*b,t);
    w[1]=smooth(0.f,.35f-.30f*b,t)*(1.f-smooth(.65f+.30f*b,1.f,t));
    w[2]=smooth(.55f-.55f*b,.95f,t);
}
void luminance(float *v,float amount) {
    if(amount==0.f)return;
    for(int c=0;c<3;++c)v[c]=amount>0.f?v[c]+amount*(1.f-v[c]):v[c]*(1.f+amount);
}
void tint(float *v,const float *settings,const float *w,int count) {
    const float l=lightness(v);
    if(l<=0.f || l>=1.f)return; // Continuous endpoint fade; no RGB clipping.
    float target[3]={},sum=0.f,remaining=1.f;
    for(int i=0;i<count;++i) {
        const float opacity=w[i]*settings[3*i+1]/100.f;
        if(opacity==0.f)continue; // A zero wheel never desaturates the input.
        dt_aligned_pixel_t color;
        hsl2rgb(color,settings[3*i]/360.f,1.f,l);
        for(int c=0;c<3;++c)target[c]+=opacity*color[c];
        sum+=opacity;remaining*=1.f-opacity;
    }
    if(sum==0.f)return;
    for(float &c:target)c/=sum;
    const float targetShift=l-lightness(target);
    const float alpha=(1.f-remaining)*4.f*l*(1.f-l);
    for(int c=0;c<3;++c)v[c]+=(target[c]+targetShift-v[c])*alpha;
    const float shift=l-lightness(v);
    for(int c=0;c<3;++c)v[c]+=shift;
}
}
extern "C" void grade(const float *input,float *output,std::size_t pixels,const float *p) {
    bool active=false;for(int i=0;i<4;++i)active|=p[3*i+1]!=0.f||p[3*i+2]!=0.f;
    for(std::size_t i=0;i<pixels;++i) {
        float *v=output+3*i;std::copy_n(input+3*i,3,v);if(!active)continue;
        float w[3];weights(lightness(v),p[12],p[13],w);
        float lum=0.f,total=0.f;for(int j=0;j<3;++j){lum+=w[j]*p[3*j+2]/100.f;total+=w[j];}
        luminance(v,lum/std::max(1.f,total));tint(v,p,w,3);
        luminance(v,p[11]/100.f);const float globalWeight=1.f;tint(v,p+9,&globalWeight,1);
    }
}
extern "C" void region_weights(float l,float blend,float balance,float *w) {weights(l,blend,balance,w);}
namespace {
const float (*spaceMatrix(int space,bool inverse))[3] {
    using namespace art::engine;
    switch(space) {
        case 0:return inverse?sRGB_xyz:xyz_sRGB;
        case 1:return inverse?rec2020_xyz:xyz_rec2020;
        case 2:return inverse?prophoto_xyz:xyz_prophoto;
        default:return inverse?adobe_xyz:xyz_adobe;
    }
}
void multiply(const float m[3][3],const float *v,float *out) {
    for(int r=0;r<3;++r)out[r]=m[r][0]*v[0]+m[r][1]*v[1]+m[r][2]*v[2];
}
float encode(float x) {return std::abs(x)<=.0031308f?12.92f*x:std::copysign(1.055f*std::pow(std::abs(x),1.f/2.4f)-.055f,x);}
float decode(float x) {return std::abs(x)<=.04045f?x/12.92f:std::copysign(std::pow((std::abs(x)+.055f)/1.055f,2.4f),x);}
}
extern "C" void color_matrix(int space,int inverse,float *out) {
    const auto m=spaceMatrix(space,inverse);for(int r=0;r<3;++r)std::copy_n(m[r],3,out+r*3);
}
extern "C" void transfer(const float *input,float *output,std::size_t count,int linearize) {
    for(std::size_t i=0;i<count;++i)output[i]=linearize?decode(input[i]):encode(input[i]);
}
extern "C" void grade_working(const float *input,float *output,std::size_t pixels,const float *p,int space) {
    bool active=false;for(int i=0;i<4;++i)active|=p[3*i+1]!=0.f||p[3*i+2]!=0.f;
    if(!active){std::copy_n(input,pixels*3,output);return;}
    const auto work=spaceMatrix(space,false),inverse=spaceMatrix(space,true);
    for(std::size_t i=0;i<pixels;++i) {
        float xyz[3],srgb[3],graded[3];multiply(work,input+3*i,xyz);multiply(art::engine::sRGB_xyz,xyz,srgb);
        for(float &v:srgb)v=encode(v);grade(srgb,graded,1,p);for(float &v:graded)v=decode(v);
        multiply(art::engine::xyz_sRGB,graded,xyz);multiply(inverse,xyz,output+3*i);
    }
}
'''
cpp_path=cache/'grading-adapter.cpp';cpp_path.write_text('// Experimental CaptRAW adapter.\n'+text[:text.index('*/')+2]+'\n'+cpp)
binary=cache/'grading-adapter.dylib'
subprocess.run(['/usr/bin/clang++','-std=c++17','-O2','-dynamiclib','-arch','arm64','-I',str(art),str(cpp_path),'-o',str(binary)],check=True)
lib=ctypes.CDLL(str(binary));pointer=np.ctypeslib.ndpointer(dtype=np.float32,flags='C_CONTIGUOUS')
lib.grade.argtypes=[pointer,pointer,ctypes.c_size_t,pointer];lib.grade.restype=None
lib.region_weights.argtypes=[ctypes.c_float,ctypes.c_float,ctypes.c_float,pointer];lib.region_weights.restype=None
lib.grade_working.argtypes=[pointer,pointer,ctypes.c_size_t,pointer,ctypes.c_int];lib.grade_working.restype=None
lib.color_matrix.argtypes=[ctypes.c_int,ctypes.c_int,pointer];lib.color_matrix.restype=None
lib.transfer.argtypes=[pointer,pointer,ctypes.c_size_t,ctypes.c_int];lib.transfer.restype=None
# Independently extracted W3C JavaScript reference, including negative values and both knees.
reference=cache/'srgb-reference.mjs';provenance=json.loads((cache/'srgb-reference-provenance.json').read_text())
assert sha(reference)==provenance['extractedReferenceSHA256']=='2412a2de0e9f60e4e3316b0e794182566c4e4b2a51a797d13c42e13034b82924'
transfer_input=np.unique(np.concatenate([np.linspace(-16,16,4097),[-.040451,-.04045,-.040449,-.0031309,-.0031308,-.0031307,0,.0031307,.0031308,.0031309,.040449,.04045,.040451]])).astype(np.float32)
expected=json.loads(subprocess.check_output(['node',str(reference),json.dumps(transfer_input.tolist())],text=True))
transfer_results=[]
for mode,key in [(0,'encoded'),(1,'linear')]:
    actual=np.empty_like(transfer_input);lib.transfer(transfer_input,actual,len(actual),mode)
    oracle=np.array(expected[key]);error=float((abs(actual-oracle)/np.maximum(1,abs(oracle))).max())
    restored=np.empty_like(actual);lib.transfer(actual,restored,len(actual),1-mode)
    roundtrip=float((abs(restored-transfer_input)/np.maximum(1,abs(transfer_input))).max())
    assert roundtrip<2e-6 and np.array_equal(actual,np.copysign(abs(actual),transfer_input))
    transfer_results.append({'operation':key,'maximumScaledError':error,'maximumRoundtripScaledError':roundtrip})
transfer_report={'reference':provenance,'samples':len(transfer_input),'results':transfer_results}
(out/'transfer-report.json').write_text(json.dumps(transfer_report,indent=2)+'\n')
assert all(row['maximumScaledError']<2e-6 for row in transfer_results),transfer_report
def params(shadows=(0,0,0),midtones=(0,0,0),highlights=(0,0,0),global_=(0,0,0),blend=50,balance=0):
    return np.array([*shadows,*midtones,*highlights,*global_,blend,balance],dtype=np.float32)
def render(a,p):
    result=np.empty_like(a);lib.grade(a,result,len(a),p);assert np.isfinite(result).all();return result
gray=np.repeat(np.linspace(0,1,4097,dtype=np.float32)[:,None],3,axis=1)
colors=np.stack(np.meshgrid(*([np.linspace(0,1,17,dtype=np.float32)]*3),indexing='ij'),axis=-1).reshape(-1,3)
extended=np.array([[-1,-1,-1],[-.2,0,.2],[-.1,.5,1.1],[1,1,1],[1.1,1.2,1.3],[16,16,16]],dtype=np.float32)
inputs=np.concatenate([gray,colors,extended]);np.save(out/'inputs.npy',inputs)
cases=[('neutral',params()),('zero-wheels-other-hues',params(shadows=(90,0,0),midtones=(240,0,0),global_=(300,0,0),blend=0,balance=100))]
for region in ['shadows','midtones','highlights','global_']:
    cases.extend([(region+'-blue',params(**{region:(240,70,0)})),(region+'-luminance',params(**{region:(0,0,20)}))])
cases.extend([('tinted-black',params(shadows=(240,70,25))),('tinted-white',params(highlights=(0,70,-25)))])
for blend in [0,50,100]:
    for balance in [-100,0,100]:
        cases.append((f'mixed-{blend}-{balance}',params(shadows=(240,70,0),midtones=(120,50,0),highlights=(0,70,0),blend=blend,balance=balance)))
results=[];images={}
for name,p in cases:
    a=render(inputs,p);images[name]=a;np.save(out/(name+'.npy'),a)
    assert np.array_equal(a,render(inputs,p)),name
    neutral=all(p[i]==0 for i in [1,2,4,5,7,8,10,11])
    if neutral:assert np.array_equal(a,inputs),name
    tint_only=all(p[i]==0 for i in [2,5,8,11])
    if tint_only:
        assert np.array_equal(a[[0,4096]],inputs[[0,4096]]),name
        # The adapter promises HSL lightness, not photometric Y, preservation.
        before=(inputs.max(axis=1)+inputs.min(axis=1))/2;after=(a.max(axis=1)+a.min(axis=1))/2
        assert abs(after-before).max()<2e-6,(name,float(abs(after-before).max()))
    assert a[:len(gray)+len(colors)].min()>=-2e-6 and a[:len(gray)+len(colors)].max()<=1+2e-6,name
    # Sample continuity around each nominal range boundary; not a full differentiability claim.
    epsilon=1e-5;edges=np.array([.05,.35,.45,.55,.65,.95],dtype=np.float32)
    near=np.repeat(np.stack([edges-epsilon,edges+epsilon],axis=1).reshape(-1,1),3,axis=1)
    edge_results=render(near,p).reshape(-1,2,3);jump=float(abs(edge_results[:,1]-edge_results[:,0]).max())
    assert jump<.001,(name,jump)
    results.append({'case':name,'parameters':p.tolist(),'blackRGB':a[0].tolist(),'whiteRGB':a[4096].tolist(),'allFinite':True,'boundaryPairMaximumDelta':jump,'outputSHA256':sha(out/(name+'.npy'))})
assert images['tinted-black'][0,2]>images['tinted-black'][0,0]>.01
assert images['tinted-white'][4096,0]>images['tinted-white'][4096,1] and images['tinted-white'][4096].max()<1
global_only=params(global_=(40,35,10));a=render(inputs,global_only)
for blend in [0,100]:
    for balance in [-100,100]:
        p=global_only.copy();p[12:]=[blend,balance];assert np.array_equal(a,render(inputs,p))
# Positive balance expands highlight weight at the fixed 50% input.
weights=[]
for balance in [-100,0,100]:
    w=np.zeros(3,dtype=np.float32);lib.region_weights(.5,50,balance,w);weights.append(w.tolist())
assert weights[0][0]>weights[1][0]>weights[2][0] and weights[0][2]<weights[1][2]<weights[2][2]
# More blending must increase overlap, not just weaken a single wheel.
overlap=[]
for blend in [0,50,100]:
    n=0
    for l in np.linspace(.001,.999,999):
        w=np.zeros(3,dtype=np.float32);lib.region_weights(float(l),blend,0,w);n+=int((w>1e-4).all())
    overlap.append(n)
assert overlap[0]<overlap[1]<overlap[2]
def matrix(space,inverse=False):
    result=np.zeros((3,3),dtype=np.float32);lib.color_matrix(space,int(inverse),result);return result.astype(np.float64)
def decode(a):return np.where(abs(a)<=.04045,a/12.92,np.copysign(((abs(a)+.055)/1.055)**2.4,a))
source_xyz=decode(inputs.astype(np.float64))@matrix(0).T
working_results=[]
for space,name in enumerate(['sRGB','Rec2020','ProPhoto','AdobeRGB']):
    values=np.ascontiguousarray(source_xyz@matrix(space,True).T,dtype=np.float32)
    for case in ['neutral','mixed-50-0','tinted-black','global_-blue']:
        p=next(p for n,p in cases if n==case);graded=np.empty_like(values);lib.grade_working(values,graded,len(values),p,space)
        assert np.isfinite(graded).all()
        if case=='neutral':assert np.array_equal(graded,values)
        expected=decode(images[case].astype(np.float64))@matrix(0).T
        error=float(abs(graded.astype(np.float64)@matrix(space).T-expected).max())
        # Error is in XYZ, includes matrix constants and nonlinear transforms;
        # it is not delta-E and is not a comparison with Adobe rendering.
        relative_error=float((abs(graded.astype(np.float64)@matrix(space).T-expected)/np.maximum(1,abs(expected))).max())
        assert relative_error<2e-5,(name,case,relative_error)
        in_gamut_error=float(abs(graded[:len(gray)+len(colors)].astype(np.float64)@matrix(space).T-expected[:len(gray)+len(colors)]).max())
        assert in_gamut_error<2e-5,(name,case,in_gamut_error)
        working_results.append({'space':name,'case':case,'maximumXYZError':error,'maximumXYZScaledError':relative_error,'SDRGridMaximumXYZError':in_gamut_error,'minOutput':float(graded.min()),'maxOutput':float(graded.max())})
wide_results=[]
for space,name in enumerate(['sRGB','Rec2020','ProPhoto','AdobeRGB']):
    # Here the cube is in each native working space, including colors outside sRGB.
    linear=np.ascontiguousarray(colors);graded=np.empty_like(linear);p=params(global_=(240,35,0))
    lib.grade_working(linear,graded,len(linear),p,space);assert np.isfinite(graded).all()
    np.save(out/(name+'-working-cube.npy'),graded)
    wide_results.append({'space':name,'pixels':len(linear),'minimum':float(graded.min()),'maximum':float(graded.max()),'outsideWorkingUnitCubeTolerance':1e-6,'outsideWorkingUnitCube':int(((graded<-1e-6)|(graded>1+1e-6)).any(axis=1).sum()),'outputSHA256':sha(out/(name+'-working-cube.npy'))})
# Probe the installed ICC component independently; this does NOT run ART's output fast path.
installed=Path.home()/'Applications/CaptRAW-0.16.app/Contents/Resources/native'
cms_path=installed/'lib/liblcms2.2.dylib';profile_path=installed/'resources/iccprofiles/output/RTv4_sRGB.icc'
cms=ctypes.CDLL(str(cms_path));handle=ctypes.c_void_p
for function,args,result in [
    ('cmsCreateXYZProfile',[],handle),('cmsOpenProfileFromFile',[ctypes.c_char_p,ctypes.c_char_p],handle),
    ('cmsCreateTransform',[handle,ctypes.c_uint32,handle,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_uint32],handle),
    ('cmsDoTransform',[handle,handle,handle,ctypes.c_uint32],None),('cmsDeleteTransform',[handle],None),('cmsCloseProfile',[handle],ctypes.c_int)]:
    f=getattr(cms,function);f.argtypes=args;f.restype=result
xyz_profile=cms.cmsCreateXYZProfile();output_profile=cms.cmsOpenProfileFromFile(str(profile_path).encode(),b'r')
assert xyz_profile and output_profile
# lcms2.h: XYZ double=(1<<22)|(9<<16)|(3<<3); RGB16=(4<<16)|(3<<3)|2.
transform=cms.cmsCreateTransform(xyz_profile,(1<<22)|(9<<16)|(3<<3),output_profile,(4<<16)|(3<<3)|2,1,0x2140)
assert transform
def icc_output(values,space):
    xyz=np.ascontiguousarray(values.astype(np.float64)@matrix(space).T)
    result=np.empty(xyz.shape,dtype=np.uint16)
    cms.cmsDoTransform(transform,xyz.ctypes.data,result.ctypes.data,len(result));return result
icc_results=[]
try:
    rays=np.array([[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,0,1],[0,1,1],[1,1,1]],dtype=np.float32)
    ramps=np.ascontiguousarray((rays[:,None,:]*np.linspace(0,1,4097,dtype=np.float32)[None,:,None]).reshape(-1,3))
    for space,name in enumerate(['sRGB','Rec2020','ProPhoto','AdobeRGB']):
        for fixture,values in [('cube',colors),('ramps',ramps)]:
            graded=np.empty_like(values);lib.grade_working(values,graded,len(values),params(global_=(240,35,0)),space)
            baseline=icc_output(values,space);result=icc_output(graded,space)
            clipped_before=(baseline==0)|(baseline==65535);clipped_after=(result==0)|(result==65535)
            row={'space':name,'fixture':fixture,'pixels':len(values),
                 'baselineBoundaryChannels':int(clipped_before.sum()),'gradedBoundaryChannels':int(clipped_after.sum()),
                 'newBoundaryChannels':int((clipped_after&~clipped_before).sum()),
                 'releasedBoundaryChannels':int((clipped_before&~clipped_after).sum())}
            if fixture=='ramps':
                a=baseline.reshape(7,4097,3).astype(np.int32);b=result.reshape(7,4097,3).astype(np.int32)
                row['maximumAdjacentDelta16Before']=int(abs(np.diff(a,axis=1)).max())
                row['maximumAdjacentDelta16After']=int(abs(np.diff(b,axis=1)).max())
                row['neutralEndpointsDelta16']=int(abs(a[6,[0,-1]]-b[6,[0,-1]]).max())
                assert row['neutralEndpointsDelta16']<=1
            path=out/(name+'-'+fixture+'-icc.npy');np.save(path,result);row['outputSHA256']=sha(path)
            icc_results.append(row)
finally:
    cms.cmsDeleteTransform(transform);cms.cmsCloseProfile(xyz_profile);cms.cmsCloseProfile(output_profile)
icc_report={'scope':'Installed LCMS XYZ-double to RGB16 component probe, relative colorimetric/BPC, no optimization/cache. Not ART fast-path integration or ACR equivalence.',
            'librarySHA256':sha(cms_path),'profileSHA256':sha(profile_path),'results':icc_results}
(out/'icc-report.json').write_text(json.dumps(icc_report,indent=2)+'\n')
source_image=root/'artifacts/preview-output-gui/auto.tiff';source_hash=sha(source_image)
with tifffile.TiffFile(source_image) as f:
    original=f.asarray();icc=f.pages[0].tags[34675].value
assert original.dtype==np.uint16
assert 'sRGB' in ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc)))
# Existing developed TIFF is only an SDR adapter fixture, not a RAW-domain integration test.
sample=np.ascontiguousarray(original[::8,::8,:3].reshape(-1,3).astype(np.float32)/65535)
started=time.perf_counter();graded=render(sample,params(shadows=(220,20,0),highlights=(40,20,0)))
elapsed=time.perf_counter()-started;shape=original[::8,::8,:3].shape
assert graded.min()>=-2e-6 and graded.max()<=1+2e-6
tifffile.imwrite(out/'sdr-sample.tiff',np.rint(np.clip(graded.reshape(shape),0,1)*65535).astype(np.uint16),photometric='rgb',extratags=[(34675,'B',len(icc),icc,False)])
comparison=np.concatenate([sample.reshape(shape),graded.reshape(shape)],axis=1)
Image.fromarray(np.rint(np.clip(comparison,0,1)*255).astype(np.uint8)).save(out/'sdr-comparison.png')
assert sha(source_image)==source_hash
report={'scope':'Experimental C++ SDR adapter; fixed darktable HSL helpers, new weights/opacity/luminance. Not selected for production, no ART insertion or ACR pixel/quality acceptance.',
    'license':'GPL-3.0-or-later (derived HSL helpers)','helperSourceSHA256':sha(source),'generatedSourceSHA256':sha(cpp_path),'binarySHA256':sha(binary),'noGUI':True,
    'inputDomain':'Encoded sRGB adapter plus native linear working-space wrapper using ART D50 matrices and extended sRGB transfer. Not inserted into ART yet; finite values do not establish HDR support.',
    'cases':results,'inputsPerCase':len(inputs),'globalIndependentOfRangeControls':True,'overlapCounts':overlap,'balanceWeightsAtHalf':weights,
    'workingSpaces':working_results,'wideWorkingCubes':wide_results,'transferReference':transfer_report,'iccOutputProbe':icc_report,'artMatrixSourceSHA256':sha(art/'iccmatrices.h'),
    'sample':{'source':str(source_image.relative_to(root)),'sourceSHA256':source_hash,'sourceUnchanged':True,'sampledPixels':len(sample),'nativeSeconds':elapsed},
    'remaining':['Photometric luminance and saturated-color hue behavior','Wide-gamut and HDR perceptual policy','ART post-B&W insertion and preview/export parity','ACR 18.7 reference images and blind quality comparison','UI/recipe/history integration']}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print('Native adapter:',len(results),'cases x',len(inputs),'inputs; overlap',overlap,'sample',len(sample),'pixels in',elapsed,'seconds')
