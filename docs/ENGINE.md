# 本地核心协议

核心库目标为 `captraw-core`，进程为 `captraw-engine <resources-directory> <private-cache-directory>`。它没有 Electron 或窗口初始化依赖。CPU / OpenMP，Vulkan、SIMDE、OCIO、CTL、mimalloc 后端关闭；固定 ART 接口由 CMake 编译验证。

stdin / stdout 每行一个 JSON 对象；ART 自身 stdout 重定向到 stderr，保证控制输出纯净。请求 `{ "id": 1, "method": "open", "params": { ... } }`，结果 `{ "id": 1, "result": ... }` 或 `{ "id": 1, "error": "..." }`；异步帧和进度使用 `event`。启动发送 `ready`。公共类型见 `packages/contracts/index.ts`。

| 操作 | 参数 | 结果 |
|---|---|---|
| `open` | 绝对 `path`、不重复的 `sessionId` | 可用图像尺寸、相机、ISO、默认控件投影及完整 `artProfile` |
| `whiteBalance` | `mode: camera/auto/preset/sample`；可选 preset ID 或原始图像归一化坐标、奇数像素窗口 | 返回精确相机通道系数、色温 / 色调投影和显示状态，不直接更改当前配方 |
| `validate` | 完整 `artProfile` 和 `adjustments` | 无图像解码的配方参数检查，不改变已打开图片 |
| `update` | 递增 `revision`、`adjustments`、可选 `artProfile` 和仅控制显示的 `maskId` | 更新后的完整 ART 配置文本；异步输出 fit 帧 |
| `viewport` | `revision`、`x/y/width/height`（已旋转图像像素坐标） | 真正 skip=1 的 detail 帧，每边最多 2048 像素 |
| `before` | `revision` | 初始显影 before 帧，不更改保存配方 |
| `curve` | 有序 `points` | ART 实际样条采样，用于前后端一致性检查 |
| `save` | 无 | 核心当前完整 ART 配置文本，文件事务由宿主负责 |
| `export` | `path`、完整 `artProfile`、`output`、`format: jpeg/tiff` | 全分辨率处理；TIFF 为 uint16，JPEG 95，sRGB ICC |
| `cancel` / `close` | 无 | 停止预览 / 释放当前图像 |

每个进程持有一个活跃图像；多图文档由宿主管理并在切换时重新连接。导出使用独立进程和配方快照，取消由宿主终止该任务进程；常驻核心的同步控制队列不能中断同进程内正在执行的全图导出。退出或崩溃不能损坏原片或保存配方。

预览帧包括 revision、会话、完整尺寸、区域坐标、三通道 256 档真实输出直方图、私有 PNG 文件路径及耗时；可选 `mask` 包含组 ID、覆盖图及其图像坐标范围。每帧文件名唯一，PNG 写入 sRGB chunk。宿主只将自己的缓存路径映射成 `captraw://preview/` URL，保留有限帧；没有 Base64 图像控制消息。前端丢弃过期会话和 revision，连续调整延迟 90 ms 合并。Canvas2D 按 sRGB 解码，1:1 使用 `1/devicePixelRatio` 的 CSS 缩放；不重复执行后端色彩变换。

`RecipeV1` 包含 schema、固定引擎版本、源路径 / 大小 / SHA-256、完整 ART 配置，以及供控件恢复的投影。`adjustments` 是由同一 C++ 适配器映射的有限字段，不另建 Web 显影算法；最终渲染与输出读取完整 ART `ProcParams`。当前引擎标识为 `CaptRAW-3_ART-1.26.10_LibRaw-3b20539`；兼容 `CaptRAW-2_ART-1.26.10_LibRaw-3b20539` 及初版 `ART-1.26.10-1e0e12c` 配方，补齐新增可选字段。未知引擎版本拒绝恢复，保留原文件。显式保存先写旁侧临时文件，再原子 rename；导出成功后才替换目标。

蒙版与裁切以原始可用图像的归一化坐标保存；EXIF 原始传感器边界不是可用图像边界。90° 旋转在适配器内映射到 ART 图像坐标。画笔 radius 遵循 ART DrawnMask 半径单位：`radius × 0.1 × min(width,height)`；擦除顺序保存在同一笔迹序列。局部亮度以 `2^value` 映射 RGB slope，局部对比度映射 RGB power，局部饱和度使用区域 outSaturation。全局 tint 为 `100 × ln(ART green)`，不冒充 ACR 色偏单位。RGB 与三个颜色通道曲线使用 ART 自然三次样条，支持 2–128 个有序点；Web 图形密集采样同一算法，实际处理由 ART 完成。0.2 新增的高光 / 阴影 / 白色 / 黑色接入 ART ToneEqualizer，锐化使用 USM，降噪使用传统 RGB 方法，HSL 接入 ART hue 曲线，去朦胧、颗粒、晕影、Lensfun 均走原处理模块；它们不是 ACR 同名算法或相同数值单位。

资源生命周期：加载所得 InitialImage 保留一个宿主引用；交给 StagedImageProcessor 前增加一个引用，由处理器销毁时释放。关闭先等待处理结束、移除监听器、销毁处理器，再释放宿主引用。detail 属于处理器，回调图像只在回调期间有效，必须当场编码。

蒙版组的 `components` 按顺序包含 `add/subtract/intersect`。覆盖率从 0 开始；添加为 max(a,b)，减去为 a×(1−b)，相交为 a×b；组反选和不透明度随后执行。各组件复用 ART 几何 / 画笔与羽化，组合后只执行一次该组的局部调整。未绘制组件不参加计算。`CaptRAWComponentCount` 和索引子字段随完整 ART 配置保存，独立进程读回；原版 ART 忽略扩展，不能用原版 ART 打开它来验证组效果。覆盖层直接读取 ART 完成组件组合、羽化、反选后用于局部处理的同一浮点覆盖率，量化成透明度 PNG；不是前端再次计算形状。适屏及详细区域各带覆盖图，前端避免两层重复叠加，并按图像范围和裁切裁剪。详细区域按有效羽化范围扩展邻域；只编码可见区域，不将邻域大图传入 Web。`maskId` 不保存到配方，也不参与导出；0.3 的处理版本与 0.2 相同。

0.4 的白平衡处理版本为 3。新照片基线使用相机原始系数，经 ART `wbMul2Camera` / `wbCamera2Mul` 坐标系转换后以 `WBParams::CUSTOM_MULT` 渲染，避免把系数压缩成色温再还原。`wbMultipliers`、`wbMode` 和投影警告由核心返回；手动色温 / 色调清空系数并使用原有 CUSTOM_TEMP。自动白平衡取 ART 估计，预设来自随包 `wbpresets.json`，只按相机内部完整型号匹配；采样调用 ART 原生 RAW / 图像取样，处理旋转和几何坐标。

`RecipeV1.baselineVersion` 保存 2 或 3：旧引擎配方以基线 2 读取，保留原有色温基线，迁移保存为新引擎时仍保存该基线。重新打开、胶片切换和初始状态对比均使用同一个版本；单独修改白平衡不会偷偷更换文档初始状态。旧版宿主拒绝新引擎配方，避免忽略精确系数后静默改变输出。

打开配方先验证参数与基线版本，再替换当前核心图像。若显式打开的配方指向已打开且有未保存编辑的原片，则保留当前编辑并提示先保存或关闭；直接切换会话图片不触发此保护，也不会丢失未保存配方。白平衡异步计算期间若文档或调整已改变，丢弃旧计算结果。

ART 兼容性修正：白平衡 Multipliers 的保存类型和字段为 double，但原载入代码使用 float 中转；现按 double 载入，避免新精确白平衡配方重开后损失精度。X-Trans 三遍插值原先在尾块扩大 mrow/mcol，超过已初始化的同质性范围；现保持有效范围并用现有 11 像素边缘插值补齐。生产代码不清零 / 填充缓冲区来掩盖越界读。该缺陷修正会改变历史 X-Trans 边缘输出；旧基线的白平衡语义仍保持，不能承诺保留未初始化数据产生的旧像素。
