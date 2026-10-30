// Host-only boundary: full-frame float I/O and original module entry points.
#include "upstream_cpu.h"
int main(int argc,char **argv) {
  if(argc!=8)fail("Usage: probe INPUT.f32 OUTPUT.f32 WIDTH HEIGHT MATRIX.txt PARAMS.txt SCALE");
  const int width=atoi(argv[3]),height=atoi(argv[4]);const float scale=strtof(argv[7],NULL);
  if(width<3||height<3||width>65000||height>65000||!isfinite(scale)||scale<=0||scale>1)fail("Invalid frame");
  const size_t n=(size_t)width*height*4;
  float *in=dt_alloc_align_float(n),*out=dt_alloc_align_float(n);
  FILE *f=fopen(argv[1],"rb");if(!f||fread(in,sizeof(float),n,f)!=n||fgetc(f)!=EOF)fail("Input size mismatch");fclose(f);
  dt_dev_pixelpipe_t pipe={0};dt_iop_module_t module={0};
  dt_dev_pixelpipe_iop_t piece={.colors=4,.iscale=1.f,.pipe=&pipe};
  f=fopen(argv[5],"r");if(!f)fail("Matrix input missing");
  for(int m=0;m<2;m++)for(int r=0;r<3;r++)for(int c=0;c<3;c++) {
    float *v=m?&pipe.profile.matrix_out[r][c]:&pipe.profile.matrix_in[r][c];
    if(fscanf(f,"%f",v)!=1||!isfinite(*v))fail("Invalid profile matrix");
  }
  fclose(f);
  dt_iop_colorequal_params_t params=probe_default_params();
  f=fopen(argv[6],"r");if(!f)fail("Native parameters missing");
  float hue[8],sat[8],bright[8];
  for(int i=0;i<24;i++) {
    float *v=i<8?&hue[i]:i<16?&sat[i-8]:&bright[i-16];
    if(fscanf(f,"%f",v)!=1||!isfinite(*v)||((i<8)?(*v< -180||*v>180):(*v<0||*v>2)))fail("Invalid native controls");
  }
  fclose(f);probe_set_controls(&params,hue,sat,bright);
  if(!params.use_filter)fail("Original default guided filtering must remain enabled");
  init_pipe(&module,&pipe,&piece);commit_params(&module,&params,&pipe,&piece);
  const dt_iop_roi_t roi={.width=width,.height=height,.scale=scale};
  process(&module,&piece,in,out,&roi,&roi);
  double minimum=INFINITY,maximum=-INFINITY,alpha_error=0;
  for(size_t k=0;k<n;k++) {
    if(!isfinite(out[k]))fail("Nonfinite original-module output");
    if(k%4==3)alpha_error=fmax(alpha_error,fabs((double)out[k]-in[k]));
    else {minimum=fmin(minimum,out[k]);maximum=fmax(maximum,out[k]);}
  }
  f=fopen(argv[2],"wb");if(!f||fwrite(out,sizeof(float),n,f)!=n||fclose(f))fail("Output write failed");
  printf("{\"width\":%d,\"height\":%d,\"scale\":%.9g,\"minimum\":%.12g,\"maximum\":%.12g,\"alphaMaxError\":%.12g,\"fullOriginalFilter\":true}\n",width,height,scale,minimum,maximum,alpha_error);
  cleanup_pipe(&module,&pipe,&piece);dt_free_align(in);dt_free_align(out);return 0;
}
