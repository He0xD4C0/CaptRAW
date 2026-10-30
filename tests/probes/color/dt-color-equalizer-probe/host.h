// Probe-only host ABI, allocation and I/O adapters. No color/filter algorithms.
typedef struct dt_iop_order_iccprofile_info_t {
  dt_colormatrix_t matrix_in, matrix_out;
} dt_iop_order_iccprofile_info_t;
typedef struct dt_dev_pixelpipe_t {
  int mask_display;
  dt_iop_order_iccprofile_info_t profile;
} dt_dev_pixelpipe_t;
typedef struct dt_iop_module_t { void *gui_data; } dt_iop_module_t;
typedef struct dt_dev_pixelpipe_iop_t {
  void *data;
  int colors;
  float iscale;
  dt_dev_pixelpipe_t *pipe;
} dt_dev_pixelpipe_iop_t;
typedef struct dt_iop_roi_t { int x,y,width,height; float scale; } dt_iop_roi_t;
typedef void dt_iop_params_t;
typedef struct dt_iop_colorequal_gui_data_t { int mask_mode; } dt_iop_colorequal_gui_data_t;
#define DT_IMGSZ_OUTPUT 0x100
#define DT_IMGSZ_FULL 0x200
#define DT_DEV_PIXELPIPE_DISPLAY_PASSTHRU 1
#define DT_DEBUG_ALWAYS 0
#define DT_DEBUG_PIPE 1
#define _(s) (s)
static void fail(const char *message) { fprintf(stderr,"%s\n",message); exit(2); }
static void *dt_alloc_aligned(size_t bytes) {
  void *p=NULL;
  if(posix_memalign(&p,DT_CACHELINE_BYTES,bytes?bytes:DT_CACHELINE_BYTES)) fail("Aligned allocation failed");
  return p;
}
static float *dt_alloc_align_float(size_t count) { return dt_alloc_aligned(count*sizeof(float)); }
static void *dt_calloc_aligned(size_t bytes) { void *p=dt_alloc_aligned(bytes); memset(p,0,bytes); return p; }
static float *dt_calloc_align_float(size_t count) { return dt_calloc_aligned(count*sizeof(float)); }
static void dt_free_align(void *p) { free(p); }
static void copy_pixel(float *dst,const float *src) { memcpy(dst,src,4*sizeof(float)); }
static void dt_simd_memcpy(const float *src,float *dst,size_t count) { memcpy(dst,src,count*sizeof(float)); }
static void dt_print(int category,const char *format,...) {
  (void)category;va_list args;va_start(args,format);vfprintf(stderr,format,args);va_end(args);fputc('\n',stderr);
}
static void dt_control_log(const char *format,...) {
  va_list args;va_start(args,format);vfprintf(stderr,format,args);va_end(args);fputc('\n',stderr);
}
static gboolean dt_pipe_is_full(const dt_dev_pixelpipe_t *pipe) { (void)pipe;return FALSE; }
static gboolean dt_pipe_is_fast(const dt_dev_pixelpipe_t *pipe) { (void)pipe;return FALSE; }
static dt_iop_order_iccprofile_info_t *dt_ioppr_get_pipe_current_profile_info(dt_iop_module_t *self,dt_dev_pixelpipe_t *pipe) {
  (void)self;return &pipe->profile;
}
static gboolean dt_iop_have_required_input_format(int required,dt_iop_module_t *self,int colors,
    const void *in,void *out,const dt_iop_roi_t *ri,const dt_iop_roi_t *ro) {
  (void)self;
  if(required!=4||colors!=4||!in||!out||ri->width!=ro->width||ri->height!=ro->height||ri->width<3||ri->height<3)
    fail("Probe requires matching full-frame RGBA float buffers >=3x3");
  return TRUE;
}
static gboolean dt_iop_alloc_image_buffers(dt_iop_module_t *self,const dt_iop_roi_t *ri,const dt_iop_roi_t *ro,...) {
  (void)self;(void)ri;va_list args;va_start(args,ro);
  for(int flags;(flags=va_arg(args,int))!=0;) {
    float **ptr=va_arg(args,float **);const int channels=flags&0xff;
    if(channels<1||channels>4)fail("Unexpected host-buffer channel flags");
    *ptr=dt_alloc_align_float((size_t)ro->width*ro->height*channels);
  }
  va_end(args);return TRUE;
}
static void dt_iop_copy_image_roi(void *out,const void *in,int colors,const dt_iop_roi_t *ri,const dt_iop_roi_t *ro) {
  if(ri->width!=ro->width||ri->height!=ro->height)fail("Unexpected ROI copy");
  memcpy(out,in,(size_t)ro->width*ro->height*colors*sizeof(float));
}
