# 本地核心协议

核心库目标为 `captraw-core`，进程为 `captraw-engine <resources-directory> <private-cache-directory>`。它没有 Electron 或窗口初始化依赖。CPU / OpenMP，Vulkan、SIMDE、OCIO、CTL、mimalloc 后端关闭；固定 ART 接口由 CMake 编译验证。

stdin / stdout 每行一个 JSON 对象；ART 自身 stdout 重定向到 stderr，保证控制输出纯净。请求 `{ "id": 1, "method": "open", "params": { ... } }`，结果 `{ "id": 1, "result": ... }` 或 `{ "id": 1, "error": "..." }`；异步帧和进度使用 `event`。启动发送 `ready`。公共类型见 `packages/contracts/index.ts`。

| 操作 | 参数 | 结果 |
|---|---|---|
| `open` | 绝对 `path`、不重复的 `sessionId`；`baselineVersion` 如提供只能为 4 | 可用图像尺寸、相机、ISO、实际 `inputProfiles` 能力、默认控件投影、完整 `artProfile`、相机构图 `cameraCrop` 及固定基线 4 |
| `whiteBalance` | `mode: camera/auto/preset/sample`；可选 preset ID 或原始图像归一化坐标、奇数像素窗口 | 返回精确相机通道系数、色温 / 色调投影和显示状态，不直接更改当前配方 |
| `maskAssets` | 完整 `artProfile`、可选控件投影 `adjustments`、精确路径 `replacements`、`validate` | 递归枚举 / 重绑定四种工具中全部外部蒙版路径，包含停用工具与组件；可解码核验。同时处理投影中的栅格引用（含停用组件）；返回完整配置及传入的投影，不修改当前图像 |
| `validate` | 完整 `artProfile` 和 `adjustments` | 无图像解码的配方参数检查和输入配置文件投影，不改变已打开图片 |
| `update` | 递增 `revision`、`adjustments`、可选 `artProfile` 和仅控制显示的 `maskId` | 更新后的完整 ART 配置文本；异步输出 fit 帧 |
| `viewport` | `revision`、`x/y/width/height`（已旋转图像像素坐标） | 真正 skip=1 的 detail 帧，每边最多 2048 像素 |
| `before` | `revision` | 初始显影 before 帧，不更改保存配方 |
| `curve` | 有序 `points` | ART 实际样条采样，用于前后端一致性检查 |
| `save` | 无 | 核心当前完整 ART 配置文本，文件事务由宿主负责 |
| `export` | `path`、完整 `artProfile`、`output`、`format: jpeg/tiff`，可选 `colorSpace` | 全分辨率处理；TIFF 为 uint16，JPEG 95，嵌入输出 ICC；返回 path / outputProfile |
| `cancel` / `close` | 无 | 停止预览 / 释放当前图像 |

每个进程持有一个活跃图像；多图文档由宿主管理并在切换时重新连接。导出使用独立进程和配方快照，取消由宿主终止该任务进程；常驻核心的同步控制队列不能中断同进程内正在执行的全图导出。退出或崩溃不能损坏原片或保存配方。

预览帧包括 revision、会话、完整尺寸、区域坐标、三通道 256 档真实输出直方图、私有 PNG 文件路径及耗时；可选 `mask` 包含组 ID、覆盖图及其图像坐标范围。每帧文件名唯一，PNG 写入 sRGB chunk。宿主只将自己的缓存路径映射成 `captraw://preview/` URL，保留有限帧；没有 Base64 图像控制消息。前端丢弃过期会话和 revision，连续调整延迟 90 ms 合并。Canvas2D 按 sRGB 解码，1:1 使用 `1/devicePixelRatio` 的 CSS 缩放；不重复执行后端色彩变换。

`EditDocument` 是 XMP 的内存投影，包含固定引擎版本、源路径 / 大小 / SHA-256、完整 ART 配置和控件值。当前仅接受 `CaptRAW-19_ART-1.26.10_LibRaw-3b20539` 的 ART 扩展，初始基线为 4；不推断或迁移旧引擎。`adjustments` 由 C++ 适配器映射，渲染与输出读取完整 ART `ProcParams`。XMP 保存先写旁侧临时文件，再原子 rename；导出成功后才替换目标。以下带历史版本的实现记录不构成旧文件格式兼容承诺；当前文件协议见末尾 XMP 章节。

引擎 14 的颜色分级使用 `adjustments.colorGrading`：`shadows/midtones/highlights/global` 各有 `hue:0..360`、`saturation:0..100`、`luminance:-100..100`，外加 `blending:0..100`、`balance:-100..100`。`validate` 返回同名投影；完整原生参数保存在 `[CaptRAW Color Grading]` 的 `Version=1` / `Values`，顺序为四组三值、混合、平衡。缺省可继承完整配置，显式初始值清除该组；原生加载拒绝版本、长度、范围和有限值错误。共享 Stage 3 在黑白之后处理，全中性旁路，继承参数变化同样刷新预览缓存。详见 [接入与限制](COLOR-GRADING.md)。0.17 已接入 Web 色轮；数值不等于 Adobe 参数。

蒙版与裁切以原始可用图像的归一化坐标保存；EXIF 原始传感器边界不是可用图像边界。90° 旋转在适配器内映射到 ART 图像坐标。画笔 radius 遵循 ART DrawnMask 半径单位：`radius × 0.1 × min(width,height)`；擦除顺序保存在同一笔迹序列。局部亮度以 `2^value` 映射 RGB slope，局部对比度映射 RGB power，局部饱和度使用区域 outSaturation。全局 tint 为 `100 × ln(ART green)`，不冒充 ACR 色偏单位。RGB 与三个颜色通道曲线使用 ART 自然三次样条，支持 2–128 个有序点；Web 图形密集采样同一算法，实际处理由 ART 完成。0.2 新增的高光 / 阴影 / 白色 / 黑色接入 ART ToneEqualizer，锐化使用 USM，降噪使用传统 RGB 方法，HSL 接入 ART hue 曲线，去朦胧、颗粒、晕影、Lensfun 均走原处理模块；它们不是 ACR 同名算法或相同数值单位。

资源生命周期：加载所得 InitialImage 保留一个宿主引用；交给 StagedImageProcessor 前增加一个引用，由处理器销毁时释放。关闭先等待处理结束、移除监听器、销毁处理器，再释放宿主引用。detail 属于处理器，回调图像只在回调期间有效，必须当场编码。

蒙版组的 `components` 按顺序包含 `add/subtract/intersect`。覆盖率从 0 开始；添加为 max(a,b)，减去为 a×(1−b)，相交为 a×b；组反选和不透明度随后执行。各组件复用 ART 几何 / 画笔与羽化，组合后只执行一次该组的局部调整。未绘制组件不参加计算。`CaptRAWComponentCount` 和索引子字段随完整 ART 配置保存，独立进程读回；原版 ART 忽略扩展，不能用原版 ART 打开它来验证组效果。覆盖层直接读取 ART 完成组件组合、羽化、反选后用于局部处理的同一浮点覆盖率，量化成透明度 PNG；不是前端再次计算形状。适屏及详细区域各带覆盖图，前端避免两层重复叠加，并按图像范围和裁切裁剪。详细区域按有效羽化范围扩展邻域；只编码可见区域，不将邻域大图传入 Web。`maskId` 不保存到配方，也不参与导出；0.3 的处理版本与 0.2 相同。

0.4 的白平衡处理版本为 3。新照片基线使用相机原始系数，经 ART `wbMul2Camera` / `wbCamera2Mul` 坐标系转换后以 `WBParams::CUSTOM_MULT` 渲染，避免把系数压缩成色温再还原。`wbMultipliers`、`wbMode` 和投影警告由核心返回；手动色温 / 色调清空系数并使用原有 CUSTOM_TEMP。自动白平衡取 ART 估计，预设来自随包 `wbpresets.json`，只按相机内部完整型号匹配；采样调用 ART 原生 RAW / 图像取样，处理旋转和几何坐标。

`EditDocument.baselineVersion` 仅表示当前基线 4；宿主不再选择旧基线，核心拒绝 2 / 3 等不受支持的值。重新打开、胶片切换、重置和初始对比均使用相机白平衡及有效相机构图。

0.5 接入输入配置文件，处理版本为 4，初始显影基线仍为 3。核心在 `open.inputProfiles` 返回实际相机匹配结果及 DCP 能力：自动选择按 ART 原有顺序优先 DCP、其次 ICC，再回退相机矩阵；显式矩阵不使用 DCP / ICC。嵌入选项仅在检测到 ICC 或 DNG 配置文件时提供；普通图像没有 RAW 相机矩阵选项。`adjustments.colorProfile` 映射选择、双光源插值及 DCP 内部曲线 / 表 / 基准曝光字段；控制是否显示取决于真实数据。切换触发 ART 原有颜色处理，Web 不实施配置文件变换。

旧配方缺少 `colorProfile` 时，预检查从其完整 ART 参数提取对应控件状态，避免新默认值覆盖旧引用。`inherited` 保留外部或特殊输入引用，供历史和保存恢复使用；0.34 已提供导入器和 XMP 随附资产，见文末接口。直接读入绝对路径引用时仍须提供对应文件。预检查、更新及导出拒绝缺失 / 无效的外部配置文件，避免 ART 静默回退到矩阵。随包相机配置按固定 ART 版本解析；DCP / ICC 不等于 Adobe 风格、配置文件数量或显影效果对齐。

打开配方先验证参数与基线版本，再替换当前核心图像。若显式打开的配方指向已打开且有未保存编辑的原片，则保留当前编辑并提示先保存或关闭；直接切换会话图片不触发此保护，也不会丢失未保存配方。白平衡异步计算期间若文档或调整已改变，丢弃旧计算结果。

ART 兼容性修正：白平衡 Multipliers 的保存类型和字段为 double，但原载入代码使用 float 中转；现按 double 载入，避免新精确白平衡配方重开后损失精度。X-Trans 三遍插值原先在尾块扩大 mrow/mcol，超过已初始化的同质性范围；现保持有效范围并用现有 11 像素边缘插值补齐。生产代码不清零 / 填充缓冲区来掩盖越界读。该缺陷修正会改变历史 X-Trans 边缘输出；旧基线的白平衡语义仍保持，不能承诺保留未初始化数据产生的旧像素。

0.6 的处理版本为 5。`adjustments.blackWhite` 保存开关、八个整数混色值及原生黑白转换的基础参数投影（原有 RGB 权重、预设、滤镜、gamma 与色调）。旧配方从完整 ART 参数恢复这些值，避免迁移时强行换成新默认值。黑白混色独立保存为 `Black & White.CaptRAWLuminanceCurve`；中性曲线不新增 ARP 字段，彩色默认参数与 0.5 保持一致。

八色中心由 sRGB 参考颜色转换到当前工作色域，再按 ART 的 YUV 色相定位；不是把 HSV 坐标直接当作 ART 色相。处理在原有黑白转换前复用 HSL 明亮度计算，以 `min(1, chroma / luminance)` 减弱近中性色响应，原彩色 HSL 不启用此加权分支。这样避免灰色残余色相导致的变化；该扩展不等于 Adobe 黑白算法。完整 ARP 可交给本项目的独立核心或含相同补丁的 ART CLI；原版 ART 不识别新字段。

## 取样修复与仿制

`adjustments.spots` 顺序保存 ID、名称、开关、原始可用图像归一化来源 / 目标，以及 method、radius、feather、opacity、detail、retainTexture。radius 为原图像素，范围 2–200；羽化 / 不透明度为 0–100，映射 ART 的 0–1；羽化外半径为 radius × (1 + feather / 100)。clone 对应 ART detail 0，保留目标细节对应 1；heal 对应 2–5（界面精细度 0–3）。这些是 ART 语义。

C++ 将坐标旋转到 ART 完整图像像素坐标，再写入原生 Spot Removal；局部裁切不改变来源 / 目标关联，来源可以位于详细预览之外。停用点保留在编辑文档中，处理列表只包含启用点。XMP 直接恢复完整 spots 参数；旧 ARP 修复点反投影和 `recipeSpots` 返回值已移除。初始显影保持无修复，更新和导出继续验证现有修复参数。

ART 的 Laplace 修复迭代原来以 OpenMP 同时更新相邻行，造成读写竞争。补丁仅移除该迭代内的行并行，保留原有更新顺序和其他独立计算的并行；因此与旧单线程结果一致，而旧多线程修复像素可能改变。测试比较 1 / 2 / 8 线程、独立进程及带相同补丁的 ART CLI。连续修复画笔和自动选源未实现。

## 蒙版局部细节

0.8 处理版本为 7，`LocalMask.details` 为可选投影；缺失或中性值不改变旧蒙版的完整原生参数。hue 映射独立的 YUV 色相区域（-180–180 度）；texture 与 clarity 映射 TextureBoost.strength=value/50，detailThreshold 分别为原生默认 0.2 和较大尺度 4；noise 映射亮度通道 NLMeans 强度 0–100，noiseDetail 映射其细节保留参数。高感质量、肤色和 ACR 对照尚未验收。

原生纹理 / 平滑区域的 MaskName 使用 `@CaptRAW-details-v1:` 标记所有权、原模块启用状态和蒙版 ID。每次更新仅移除标记区域、恢复原启用状态，再从当前文档重建；其他原生区域保留。停用但非中性的独立原生参数不能随新增区域自动启用，因此明确拒绝该合并；原配方保持可恢复。零值、停用、删除、复制后删除和撤销均验证无残留。

纹理增强具有全图最小值约束；NLMeans 也有区域相关的细节估计。含新局部细节的 1:1 不能只给固定邻域：核心请求全图 skip=1 处理，回调只编码所需视口（仍最多 2048×2048）。缓存最终 RGB8 和当前组浮点覆盖率；后续 viewport revision 仅从缓存裁取，覆盖图同步更新。参数 / 显示蒙版改变、初始状态对比、打开或关闭图像时失效和释放。滤镜计算、色彩与 TIFF16 仍走原生高精度管线；RGB8 缓存只用于屏幕预览。此路径首帧和内存成本明显高于普通裁块，尚未完成全部设备与大图性能验收。

0.9 的处理版本为 8，新的初始基线为 4。`RawImage` 在 LibRaw 解码缓冲释放前复制 Nikon `raw_inset_crops[0]`，随后按实际活动区边距、ART 去马赛克边界及 EXIF 方向映射为 `cameraCrop`。只保存四个整数，不延长解码缓冲生命周期。核心仍返回原有可用图像坐标和尺寸；默认裁切是同一 ART 配方里的 crop，并非改写解码结果。其他品牌及无有效裁切标签的输入不新增默认裁切。

当前文档统一使用基线 4，相机构图按钮仅在核心提供有效数据时显示；裁切、局部蒙版及修复仍使用原有坐标空间。

`CAPTRAW_E2E_BACKGROUND=1` 只用于后台测试：BrowserWindow 从创建时隐藏且不可聚焦，关闭后台节流以继续绘图；macOS 使用 accessory 激活策略。生产正常启动不设置该环境变量。E2E 共享启动器验证 `isVisible=false`、`isFocused=false`、`isFocusable=false`，旧包没有该开关则在启动前拒绝测试，避免闪现窗口。


## 蒙版局部白平衡

0.10 引入此处理，当前初始基线为 4。`LocalMask.whiteBalance` 可选，包含 -100–100 的 temperature / tint；未设置或均为零时不保存矩阵，也不进入新处理分支。

温度映射 `6504 × 2^(temperature/100)`，绿通道参数映射 `exp(-tint/200)`。ART ColorTemp 估计光源，LittleCMS `cmsAdaptToIlluminant` 在 XYZ 中执行 Bradford 适应；通过当前工作 RGB 的正逆矩阵形成完整 3×3 变换。正色温趋暖，正色调趋洋红。矩阵在原有 ColorCorrection RGB 区域处理前作用于线性像素，同一组覆盖率只应用一次。它不改变全局 RAW 白平衡、不进行第二次去马赛克，不声称与 Adobe 参数等效。

完整 ARP 保存 `ColorCorrection.CaptRAWWhiteBalanceMatrix_<region>`，仅接受九个有限且绝对值不超过 64 的值。原版 ART 不识别扩展；独立导出及参考 CLI 均需本项目补丁。局部白平衡本身不增加全图上下文缓存，沿用区域处理；受控样本的 ROI 与全图 RGB8 最大差为 1，完整 detail 与 fit 同分辨率图像一致。TIFF16、独立核心及补丁 ART CLI 逐像素一致。混合光源、肤色、极端颜色和 ACR 画质盲评仍待完成。


## 蒙版局部明暗

0.11 处理版本为 10，基线仍为 4；旧版本及显式基线保留。`LocalMask.tone` 可选，保存 -100–100 的 highlights / shadows / whites / blacks；映射为原生整数频段 `[blacks, shadows, 0, highlights, whites]`。均为零时删除扩展字段并完全跳过新分支。完整 ARP 使用 `ColorCorrection.CaptRAWToneBands_<region>`，载入检查五个整数和范围。

复用 `iptoneequalizer.cc` 的同一计算函数，保留 ART 默认 regularization=4、pivot=0、EV 分段和引导滤波。局部路径从当前线性 YUV 亮度计算增益，不复制算法到前端。存在有效局部明暗时按区域顺序处理：当前图像计算增益 → 该区域局部白平衡和 CDL → 原有蒙版覆盖混合；后续区域看到前面的结果。每次只保留一个增益平面；没有局部明暗时沿用原来的按行循环。原版 ART 不识别扩展，参考 CLI 需应用相同补丁。

局部明暗含较大引导滤波邻域，1:1 复用全图上下文缓存路径，防止裁块明暗不一致。受控样本的四项正负方向、组合和旋转均与全图同坐标一致；首次完整处理、参数变化后的重算仍有性能成本。没有把该算法和参数称为 Adobe 等效实现。

同时修正局部白平衡矩阵的载入：直接读取 double 数组，不再经过 ART 的曲线格式整理函数。合法矩阵首项恰为曲线类型编号时不得改写其余系数；接近同一 float 值的矩阵导出逐像素一致。尺寸、有限值及范围检查继续保留。


## 全局纹理与清晰度

0.12 处理版本为 11，初始基线仍为 4。`adjustments.texture` / `clarity` 为可选 -100–100 数值；缺失按零处理，不向旧配方投影强行添加字段。分别映射全覆盖 TextureBoost 区域，strength=value/50，detailThreshold 为 0.2 / 4；使用已有 `@CaptRAW-details-v1:` 所有权机制，标记为 `global:texture` / `global:clarity`。保留原生继承区域，随后添加全局区域和局部纹理区域；全局与局部独立复位，不是复制一层 Web 滤镜。

非零全局细节使 1:1 进入已有全上下文缓存路径；修改参数触发 ALLNORAW 并使缓存失效，平移只裁取结果。全分辨率 TIFF 仍独立运行高精度管线。中性 ColorCorrection 蒙版的 YUV 往返会造成浮点舍入，受控全局细节样本的 RGB8 最大差为 1；不将中性蒙版表述为全场景逐像素恒等。

同时修正 `ToneCurve.CurveMode2` 保存条件：第一、第二条曲线模式不同时，即使第二条是恒等曲线也必须保存其模式。否则新建配方的 Standard / Neutral 会在读回时被推断成 Standard / Standard，改变 ART 的合并曲线优化路径。新保存文件明确记录模式；已有缺失该字段的配方仍按 ART 原有读取规则恢复，不擅自解释为 Neutral。新建默认图像与 0.11 相同，完整参数文本多出显式模式字段。


## 裁切交互约束

0.13 继续使用处理版本 11 / 基线 4，没有更换显影或裁切算法。可选 `adjustments.cropAspect` 是原始可用图像像素宽高比的 UI 锁定约束；null / 缺失为自由裁切。它与 crop 一起参与文档保存、撤销和重做，核心只检查非空值为有限正数（1e-6–1e6），不将它作为另一套渲染参数。实际输出仍完全取决于原有 `ProcParams.crop`。旧版同一处理版本可以按相同 crop 输出，旧 UI 不提供比例锁定操作。

预设按当前画面方向显示，写入前按 90° / 270° 方向换算。拖动在显示坐标求解边界与比例，再映射回原图坐标；只改变裁框，不迁移蒙版或修复点。选择比例 / 切换横竖尽量保持面积与中心，超出图像时按比例缩小并移入边界。边角控制点固定对边 / 对角，锁定比例的边控制点沿另一轴围绕中心伸缩；框内拖动保持尺寸并限制在图像内。一次拖动是一条历史记录。

“相机原始构图”和“清除裁切”同时解除比例锁；全局重置恢复原有文档基线。完成 / Enter 结束裁切工具，保存配方由原有显式保存 / 完成流程负责。该功能不提供任意角旋转、透视、拉直或生成式扩展。

## 独立参数曲线（0.14 / 引擎 12）

`adjustments.parametricCurve` 保存四个 -100…100 明暗区域和三个 1…99 百分比分界；分界递增且间隔至少 1。缺失字段或全零时不执行额外处理，维持原有像素及原生参数文本。已有基线 2 / 3 / 4 不迁移；引擎 11 及更早配方继续读取，新配方标记引擎 12，避免旧版误读扩展。

原生 `parametricCurve` 控制消息返回 ART `DiagonalCurve` 的 513 点采样，Web 只绘图，异步结果按设置键丢弃过时值。不是另一份 JavaScript 曲线算法。全分辨率和适屏处理使用同一原生定义，经 ART 原有 `adjust` 转换至线性工作域，再通过标准 `ToneCurve` 应用；预览采样图展示其编码域定义，不是最终图像全管线的传递函数。

`ToneCurveParams::captrawParametric` 为独立字段，保存为 `[ToneCurve] CaptRAWParametric`，在两个原有曲线之后、饱和度曲线之前处理。使用原有 ART 参数曲线算法、范围转换和通道映射，没有覆盖 `curve2` 或改变继承曲线模式。仅非零值写扩展字段，身份曲线不走新分支。完整参数保存 / 读取、比较及缓存失效均包含此字段；补丁 ART CLI 可独立复现，原版 ART 不认识该字段。

曲线通道栏切换只改变编辑视图；参数曲线与点曲线同时生效。参数复位重置四区域和三个分界，点曲线保留。Radix 键盘的提交回调先于数值变化，统一在同轮微任务结束时提交历史，保证键盘操作不与下一次手势合并。定点工具、ACR 数值 / 色彩 / 画质等效验证未完成。


## 白平衡重载与高质量详细预览（0.15 / 引擎 13）

`White Balance/Multipliers` 必须直接用 `keyFile.get_double_list` 读取。ART 的通用 `vector<double>` 读取重载用于曲线，内部会调用 `sanitizeCurve`；此前为避免 float 精度损失而改用此重载，误将 RGB 系数当成曲线，独立导出重载时回退至 `[1,1,1]`。现在保留双精度且绕过曲线校验；补丁同时支持原始 ART 和旧版已打补丁源码。不是修改 RAW 解码器或套用前端色彩补偿。

更新参数时，精确通道系数变化也触发 `WHITEBALANCE`，即使色温 / 色调投影未变。第一次请求详细区域或参数变化使高质量状态失效时，采用 ART 原界面的 `getHighQualComputed → startProcessing(M_HIGHQUAL) → setHighQualComputed`；仅调用 crop 的 `fullUpdate` 会沿用适屏快速去马赛克和预处理。后续已有高质量状态的区域更新仍走原缓存。

同一 session / revision 的适屏刷新不会清除已经到达的 detail；不同会话或旧 revision 仍丢弃。完整上下文滤镜的缓存和取消机制不变。新配方标记引擎 13，读取引擎 12 及更早配方；基线 2 / 3 / 4 和已有调整坐标不变。修正作用于所有配方的重新导出，不保留错误的白平衡加载行为，所以旧版 TIFF 不能作为新版本的逐像素兼容目标。旧安装包保留用于历史复现。

`tests/preview-output.mjs` 覆盖相机 / 自动 / 预设 / 吸管 / 手动及仅系数变化、DCP / 矩阵、点与参数曲线、NEF / CR3 / X-Trans / Z5II HE 两模式；独立进程输出相同坐标 ROI。`tests/inspect-preview-output.py` 检查 uint16、ICC 和量化像素，再检查隐藏安装版旧配方 / 自动 / 手动白平衡的全尺寸 TIFF。不同 ART Camera / CustomMult 模式的原始 16 位差异另外记录，不将两种模式一概声称相同。


## 曲线输入直方图（0.16）

核心通过 ART `HistogramListener::histogramChanged` 读取 `histToneCurve`，不从最终 sRGB 像素反推输入。上游先按工作色域矩阵计算亮度、通过 `gamma2curve` 编码并压缩至 256 桶，再对高度执行原有 `xlin2log`。统计位置在 toneCurve 入口，包含上游处理但不包含本模块点曲线、参数曲线等操作；数据是适屏全图而非裁切框统计，各曲线通道当前共用明度背景。

ART 的 `imageReady` 在直方图通知之前调用。核心先标记待发布，等同次通知到达后把 `curveHistogram` 与 PNG、sessionId、revision 一起发布，沿用前端的旧 revision 丢弃规则。详细区域不覆盖这个全图输入分布；切图及关闭清除原帧。不要让上一轮统计配上下一轮图像。顶部 RGB 直方图继续统计输出预览，两个图各自表达不同处理阶段。

上游 `hist[y >> compression]++` 位于 OpenMP 并行循环内，多个线程写同一桶会丢计数。用原子增量修正，单线程与多线程所得 256 桶一致。此项只改变统计元数据，未变更显影像素、配方或默认参数，所以维持引擎 13 / 基线 4。前端按原生最大值归一化绘图，不额外对数压缩，不拦截鼠标事件。

## SDR 输出色域（0.18）

`export.colorSpace` 接受 `srgb` / `adobe-rgb` / `prophoto-rgb` / `display-p3` / `rec2020`，分别映射随包 `RTv4_sRGB` / `RTv4_Medium` / `RTv4_Large` / `RTv4_DisplayP3` / `RTv4_Rec2020`。只修改本次独立输出的 ProcParams 副本，采用相对色度和黑点补偿；显影配方、工作空间、预览与撤销历史不变。未传入时沿用完整原生配置的输出设置，保持既有无界面调用；桌面默认显式选择 sRGB。未知 ID / 格式在处理前拒绝，指定 ICC 缺失时失败，不静默使用替代色域。

转换仍由 ART `rgb2out` 执行，之后使用同一配置文件的原始字节嵌入 TIFF / JPEG。没有对 8 位预览改标签或二次转换。此项增加可选输出请求，不改变默认显影及保存配方语义，因此引擎版本仍为 14、基线 4。输出选择仅保留于当前应用会话，重启恢复 sRGB；不是图像显影参数。预览继续 sRGB SDR，尚未实现所选输出色域的软打样或色域警告。

## 亮度范围蒙版（0.19）

`MaskGeometry.type=luminance` 使用 `luminanceRange:[outerLow,innerLow,innerHigh,outerHigh]`，0–100，要求外侧顺序不交叉、内侧下限小于上限。默认 `[0,0,100,100]`。创建即生效，局部调整初始中性；无几何锚点。Web 提供四个滑杆节点和数值输入，拖动一步历史、Enter 提交 / Escape 取消数值，Shift+L 新建。0.20 补充照片取样和灰度亮度图，见下文。

核心映射到 ART `ParametricMask.lightness` 非周期 MinMax 控制点曲线，使用 ART 原生平滑过渡（切线 0.35）。范围依据色彩校正入口的工作 RGB 转换 Lab L*；不是最终 sRGB 像素亮度。关闭亮度细节及空间模糊（blur=-10），过渡由亮度范围自身决定；相等内外节点使用不超过 0.0001 L* 的数值过渡，避免原生曲线重复 X。完整范围使用 ART 默认恒定覆盖。

范围可出现在蒙版组的添加 / 减去 / 相交组件中。包含范围的组以内部唯一名关联后续 TextureBoost / Smoothing 选区，复用 ART LinkedMaskManager 的半精度覆盖缓存，避免前面的局部曝光使后续模块重新选择不同像素；组名仍由 JSON 保存并在 Web 显示。关联数据和曲线均写入完整 ART 配置，不依赖 Web 才能输出。几何蒙版沿用原处理，旧配方不插入范围字段。基线仍为 4，引擎升至 15，旧引擎不应接受新的范围配方。原片、外部 XMP / ARP 保持不变。


## 亮度照片取样与亮度图（0.20）

`update.luminance` 启用只读亮度输出；`sampleLuminance` 接受当前 revision 和原图归一化 start / 可选 end，返回浮点 minimum / maximum（L* 0–100）、像素数和范围。单击使用 5×5，边缘及裁切处截断；拖框取区域最小 / 最大值。处理旋转后坐标，再与当前裁切求交；越界、过时版本或未启用时明确拒绝。

原生监听 ART 色彩校正入口的 `fillPipetteMasks(..., MasksEditID::L)`，与范围选择采用同一亮度数据。临时 DetailedCrop 经高质量握手后同步处理全图，到读取亮度即停止，保留用户的详细视口。浮点平面缓存供后续取样复用；改变全局输入参数、关闭工具或切图时失效。局部色彩 / 纹理 / 降噪位于此采集点之后，不改变取样数据。首次计算需要全图临时内存，重复取样不重算。

Web 将测得内边界向外取整；满范围首次取样提供两侧各 10 L* 过渡，后续保留既有过渡宽度并限制在 0–100。每次完成取样形成一步历史，相同结果不新增历史。切换文档、工具、组件或修改编辑后，迟到回复被丢弃。Escape 取消未完成拖框；等待期间仍可退出工具。

`PreviewFrame.luminance` 是私有缓存中的独立 sRGB 灰度 PNG（L* 线性映射到灰阶数值），不是输出照片。适屏、1:1 和全图上下文缓存平移都带相应平面；前端仅显示，真实蒙版覆盖继续来自 ART。开关不改变配方、缩略图、直方图或导出。配方与默认处理均未变化，保持引擎 15 / 基线 4。这里没有宣称取样尺度、过渡或视觉结果等于 ACR。


## 多照片同步（0.21）

`SyncRequest` 包含来源及目标的会话 / 当前调整 / 完整原生配置快照、勾选组 ID。`packages/contracts/synchronize.ts` 仅复制已接入的控制参数，不实现显影算法；目标完整 ART 配置是渲染底稿，未选择参数及相机配置保持目标值。白平衡复制色温 / 色调，清除来源相机相关的精确通道系数并标为 custom；若来源投影近似，界面提示。裁切和局部几何按原图归一化位置复制，锁定比例按目标像素尺寸重新计算；修复半径保留像素值。

Electron `Synchronizer` 以单独的原生进程串行打开目标，再把目标配置与合并参数交给现有 `update`。等待每张真实预览和完整配置成功，返回私有协议 URL；Web 将缩略图缓存到会话，所有结果齐全后一次提交文档状态。来源画布、活动原生进程不切换。每个变化目标增加一步撤销，未变目标不增加历史。初始基线、源文件关联与已保存状态均属于目标；取消和失败不提交已准备的局部结果，支持再次尝试。

同步预览单独保存在私有会话缓存，下一批替换上一批文件；窗口已缓存的缩略图不依赖旧 URL。取消结束工作进程并清理本批临时目录，退出清理整个会话缓存。原片、已有 XMP / ARP / 配方不写入；之后通过原有显式保存生成目标配方。此批未修改 C++ / ART 处理语义，引擎 15 / 基线 4 保持。

只支持显式同步；多选时普通调节仍只作用于活动照片。相机配置文件同步、自动联动和批量配方保存后续单独验收。灰阶与 RAW 检查中，旧 0.20 核心同进程预览后输出曾出现间歇性 1/65535 差异，复测未稳定重现，原因未定；桌面实际独立导出进程及本批新旧独立核心对照一致。诊断保留在 `artifacts/synchronize/warm-export-diagnostic.json`，不据此宣称所有运行组合逐像素确定。

## 批量导出（0.22）

`images:export` 接收选中照片的路径、原始可用区宽高、完整 ART 配方和当前调整快照，以及输出格式 / 色域。主进程验证后选择目标文件夹；单张仍使用原有保存文件对话框。单张、批量和文件夹选择阶段共用导出互斥，避免重入。快照在打开目标对话框前已确定，后续编辑或切换照片不会影响此次输出；导出不会标记配方为已保存。

`BatchExporter` 逐张创建独立核心。新增 `compose` 从完整 ART 参数合成当前调整，使用同一 `applyAdjustments` 和原始可用区尺寸，不创建预览处理器；因此非活动照片的旧 profile 不会掩盖最新撤销结果。随后调用原有全分辨率 `export`。此次不修改 ART 算法和配方语义，处理版本仍为 CaptRAW-15。

临时输出放在目标文件夹，成功后调用 `publish`。macOS 使用 `renamex_np(RENAME_EXCL)` 原子、不覆盖地发布；碰到同名文件则增加编号重试，包括不同目录中的同名原片。该调用也避免“先检查存在，再覆盖重命名”的竞争。取消期间的发布请求会等到原子操作返回，再记录已完成文件；处理中取消终止核心，等待退出再清理临时文件。已完成输出保留；单文件错误记录后继续下张，结束时提供输出 / 错误清单。非 macOS 的硬链接发布回退未进行平台验收。

批量快照、失败继续、处理中取消、异常退出及逐像素参考对照：`node tests/batch-export.mjs`；隐藏安装包 GUI：`CAPTRAW_APP=.../Contents/MacOS/CaptRAW node tests/batch-export-e2e.mjs`；TIFF16 / ICC / 参考像素：`build/qa-venv/bin/python tests/inspect-batch-export.py <report.json> ...`。

原生初始化明确禁用外部 ExifTool：元数据由随包 Exiv2 / LibRaw 读取。此前 PATH 中可选的 Homebrew ExifTool 会在强制结束核心后留下进程及继承管道，且造成依赖本机环境；本批固定这一边界。依赖 ExifTool 兜底的未验证元数据类型不宣称受支持。

## 颜色范围（0.23）

引擎 16 新增 `color` 蒙版组件、`colorSamples`（最多五个浮点 L/C/H 与原图归一化取样位置 / 可选矩形终点）和 `colorRefine`。每个样本复用 ART `DeltaEMask`，按最大覆盖率合并；组的添加 / 减去 / 相交、反选和后续局部细节仍使用原有路径。精细度 0–100 映射为 ART range 0.25–19.75，decay=50，L/C/H 权重为 50/75/100。颜色范围使用无额外空间平滑的连续色差权重，防止 guided filter 导致放宽范围时边缘覆盖反而下降，并使亮度 / 色度覆盖一致。

`update.colorSampling` 只控制取样资源。`sampleColor` 复用全质量详细区域、旋转 / 裁切坐标校验及 revision 检查；在 colorcorrection 前缓存完整浮点图像，点取样 5×5，框选按 ART 原有 Lab 通道中值规则得到代表色。新矩形 helper 复用原生色彩转换和中值定义，原有 ART 点选函数未改。区域不是离散色簇集合；复杂多色区域与 ACR 等效尚未证实。新增采样钩子不进入输出路径。

颜色以 ART 归一化 Lab 编码保存（L×100、C×100、H 度）；色块仅作视觉提示，CSS LCH 色度需乘 1.28173828125 还原标准 Lab 尺度。覆盖率使用原生浮点值，前端不从 sRGB 预览反算。全图缓存约每像素 12 字节（45MP 约 540MB），改变取样前参数、退出颜色模式或关闭图片即释放；局部参数变化复用缓存。未宣称低内存硬件和所有照片达到性能目标。

交互参考 [Adobe 官方蒙版文档](https://helpx.adobe.com/camera-raw/desktop/edit-and-enhance-images/masking-and-local-adjustments/masking.html)的颜色范围部分（2026-06-18）：点击 / 框选、Shift 最多五样本、Option 删除与 Refine；固定验收基线仍为 ACR 18.7，操作参考不证明算法等效。见 `tests/color-range.mjs`、`tests/color-range-e2e.mjs`、`tests/inspect-color-range.py`。

## 镜头配置与预览一致性（0.24）

`lensCorrections` 保留旧版总开关语义；新增可选 `lensProfile` 包含 auto / manual、手动机身厂商 / 型号 / 镜头名称及 distortion / vignette / ca 布尔值，直接映射 ART `LensProfParams`。旧版缺失该字段时沿用自动匹配与三个开关开启，默认关闭的旧配方像素和参数不变。引擎标识升至 17，防止旧 UI 忽略手动选择后覆盖配方；初始基线仍为 4。

`open.lensCatalog` 来自随包 LFDatabase（本机固定数据库 948 个相机、1304 条镜头记录，重复名称在界面合并）；`open/update.lensStatus` 在处理线程启动前读取同一匹配和实际 Lensfun modifier flags。能力表示当前焦距 / 光圈条件下成功建立的校正，不将数据库中存在某镜头当作全部能力通过。空元数据不允许通配匹配第一条器材；手动配置缺少选项时不作校正，未知相机 / 镜头在参数校验阶段拒绝；缺少焦距时手动和自动均不使用标定。没有实际焦距输入功能，用户不能用猜测的焦距冒充校正成功。

RAW 暗角位于 `RawImageSource::preprocess`，镜头设置变化必须刷新 `FIRST`，仅 `ALLNORAW` 会留下旧 RAW 缓存。已复现 0.23 的 D850 热更新 / 重开不一致，并以当前开关往返 / 重开完全一致验证修复。另一处修复在 `iptransform.cc`：实际 modifier 支持、且用户开启镜头色差时，适屏也启用对应高质量转换，避免控件对适屏没有像素响应。两处修复不改变有效完整配方的全质量导出算法；NEF / CR3 / RAF 与独立 0.23 导出精确比较。

手动同步复制完整所选机身和镜头；界面说明器材需一致。自动模式仍按目标照片元数据重新匹配。数据库几何坐标沿用 ART 的现有实现，未增加 ACR LCP 导入、内置镜头校正、校正强度、手动畸变 / 暗角数值或去边。配置名和范围不等于 Adobe 校准结果。交互参考 [Adobe 镜头校正文档](https://helpx.adobe.com/camera-raw/desktop/using/correct-lens-distortions-camera-raw.html)。

## 导出缩放与输出锐化（0.25）

`ExportOptions` 随单张 `export` / 批量请求传入独立工作进程，只修改该任务的完整 ART 参数快照，不改变编辑配方、撤销或预览。当前桌面会话保留选择，重启恢复原尺寸 / 关闭锐化；不保存到 `.captraw.json`。缺少 `options` 的旧接口保留完整 ARP 中已有 Resize / OutputSharpening 字段；显式原尺寸 / 关闭锐化则覆盖本次输出的相应字段。处理版本保持 17、初始基线 4，没有改变显影参数或引入新依赖。

原尺寸保留当前裁切；长边使用正方形 FitBox，短边按旋转后有效裁切宽高选择 ART Width / Height，边界框使用固定宽 × 高的 FitBox，均保持比例。`dontEnlarge` 控制 allowUpscaling。核心只解码一次，与 ART `stage_init` 一致设置 RAW 边界、EXIF / coarse 方向及裁切范围，再调用原生 `resizeScale` 核验结果。结果须每边 1–65000 像素且总量不超过 512 MP；拒绝极端比例导致另一边四舍五入为零的情况。数值与类型在 IPC 和核心边界分别校验；批量逐张核验实际尺寸，错误不覆盖原文件。

使用 `ProcessingJob::create(InitialImage*, p, false)` 的全质量路径，在所有全局 / 局部显影和裁切之后、输出 ICC 转换之前，由 ART Lanczos 处理浮点图像，再执行 `prsharpening`。输出锐化采用 ART 默认 USM / Contrast 25 与原生阈值，数量 0–300、半径 0.1–3 输出像素；数量为 0 关闭该步骤。未使用 Canvas 或 8 位预览进行缩放、锐化或 TIFF16 输出。加载图像由 RAII 管理，ProcessingJob 自有引用在完成时释放。

界面显示当前照片按裁切 / 90° 旋转计算的预期尺寸，批量明确逐图应用。输出设置不声称与 ACR 的屏幕 / 纸张锐化预设或数值等效；没有 PPI / 物理单位、JPEG 质量、介质预设或持久工作流程预设。本批的边界框是固定宽高，不冒充其他产品的自动方向宽高语义。

## 外部蒙版失败保护（0.26）

`validateExternalMasks` 遍历启用的 ColorCorrection、Smoothing、TextureBoost、LocalContrast 及嵌套蒙版分量，使用与渲染共享的 ART 解码器 / 缓存验证文件内容。校验针对合成后的实际参数，已被 CaptRAW 调整替代的旧区域不再作为活动资产；停用工具、停用区域和停用外部分量不要求文件存在。更新在候选参数通过检查后才替换当前状态；compose / validate、详细区域、原生 save、导出和桌面保存也执行检查。对比基线不需要当前编辑的蒙版。

外部图像缓存改为文件路径与内容 SHA-256，避免仅凭大小 / 时间戳复用损坏文件。新增 `ProgressListener::externalMaskError`，与宽高比等非致命警告区分；输出处理器通过独立的蒙版错误监听器传播失败，不改导出进度算法。四个蒙版模块在适屏、详细区域及输出路径都传递读取错误。原生核心用原子失败标记禁止发布预览或写入导出文件；标记在下一次有效更新时复位，并强制完整重算，避免复用失败处理的缓存。外部 profile 变化也触发完整更新。桌面任务仍只在成功时发布临时导出文件。

这不是对象蒙版产品接口：配方仍保存既有 ART 引用，尚未提供可移植、不可变的栅格资产包；外部文件正常替换也不是版本化素材编辑。没有新增模型、ONNX Runtime 或 Python 运行依赖，没有改变有效蒙版的像素算法或配方版本；处理版本仍为 17 / 基线 4。安装版故障与恢复交互由隐藏 E2E 验证，不能替代对象选择的坐标、质量和性能验收。

## 配方的蒙版资产（0.27）

`RecipeV1.maskAssets` 为可选 `{schemaVersion:1, files:[{id,path,bytes}]}`；`id` 是文件内容 SHA-256，`path` 为配方旁资产文件夹中的相对路径。完整 ART 配置使用 `captraw-mask:<id>` 逻辑引用，由 ART 自身 KeyFile 序列化与解析；宿主不通过正则改写用户配置。四类工具（ColorCorrection、TextureBoost、Smoothing、LocalContrast）的递归组件，包括停用但仍有路径的资产，都参与保存。没有外部资产时仍只保存原来的 JSON。

保存先解码核验源资产，再以内容命名、独占发布到 `<配方文件名>.assets/`。按复制后的文件再次核验后，原子替换 JSON。相同内容去重，已有同名资产的内容不符则拒绝覆盖；失败不替换旧配方。保留旧资产与其他文件，不自动清理孤立文件，以免破坏用户复制的其他配方。当前每个资产最多 256 MiB。

打开时严格核查清单版本、大小、SHA-256、引用集合、路径及符号链接，再将同一份已校验字节复制到本次应用的私有缓存，重绑定 ART 路径后才载入照片。即使有缓存，也必须验证配方旁的文件。这样移动原文件夹或清理推理临时结果，不会破坏已经打开的文档；另存会从文档的资产副本生成新的配套文件夹。缺失、损坏或不匹配均报错，不使用上次缓存掩盖错误。

`before-quit` 在进程退出前同步清理本次缓存。原来的未等待异步删除在安装版回归中留下了目录；0.27 对退出后的目录消失增加验证。不自动删除其他应用实例或历史版本的缓存目录。

新的保存标记引擎 18，旧版本将明确拒绝，避免忽略清单后丢失引用。继续读取引擎 2–17 和初版配方；已有配方仅在用户保存到目标路径时更改。源 RAW 仍按现有路径 / 大小 / SHA-256 关联，没有复制原片或新增丢失原片重定位界面。模型、对象提示、栅格坐标与对象选择 UI 不由此协议代替。

## 栅格蒙版组件（0.28）

`MaskGeometry.type="raster"`，`raster` 保存 `path`、文件内容 `sha256`、解码 `width/height`。像素覆盖整个未施加用户旋转 / 裁切的可用图像；坐标不使用 EXIF 原始传感器边界。源图身份仍由 Recipe 的路径、大小、SHA-256 关联。此批没有创建入口或模型部署。

适配器将元数据保存为 ART ExternalMask 的 `CaptRAWRaster`、`CaptRAWRasterRotation/Width/Height/SHA256` 扩展，保留原有组运算。反向映射 0/90/180/270° 后按像素中心做双线性取样，图外边界复制。未带扩展的旧外部蒙版保持原有采样与羽化。

新栅格的羽化半径为当前处理分辨率短边的 `feather/100 × 0.01`，取最近整数；引导滤波固定 subsampling=1，避免区域尺寸跨 600 像素门槛改变采样网格。详细区域保留 2r 加 32 像素边界，不因此申请全图细节缓存。修复前同一受控选区的 fit/detail 覆盖率最大差 50/255；修复后四种旋转均一致，2564×1916 均匀图的缩小 / 区域结果与独立双重盒式均值参考一致。没有把这一结果扩展为任意照片或任意缩放逐像素恒等。

每次使用前核验内容身份，包括命中缓存时；解码尺寸不符、资产损坏 / 缺失时拒绝更新或输出。资产上限 64 MP，继续受宿主 256 MiB 文件限制。保存将原生配置和控件投影共同重绑定为 `captraw-mask:<sha>`，读取时恢复到同一私有资产；核心响应缺少完整投影时拒绝发布 JSON。已停用组件也参与资产收集。

读取已有栅格组件时画布使用平移工具，不出现线性 / 径向控制柄；可使用现有组面板管理和画笔修正。导出使用原生高精度处理，不读取覆盖层的 8 位 PNG。


## 本地对象点选（0.29）

显影核心保持引擎 19 / 基线 4。桌面接口新增 `beginObject(sessionId, adjustments, artProfile)`、`predictObject(id, prompts)`、`commitObject(id, revision, candidateIndex)` 和 `cancelObject(id?)`；进度通过 `object-progress` 事件发送。前端不传模型文件路径、快照文件路径或候选文件路径。

宿主在独立显影进程中应用当前完整编辑快照，仅清除用户旋转 / 裁切，输出 sRGB 适屏 PNG；不会改变主处理器或当前画布。提示点为未旋转可用图像的 0–1 坐标，映射到像素中心并夹紧；输入 PNG 内容散列与尺寸一起交给分割进程。最多 64 个正 / 负点，首个提示必须包含选中点。0.29 不支持框选；0.30 扩展见下节。

三候选通过私有协议显示，提示修正串行执行且只发布最新结果；在新结果到来前清除旧覆盖，禁止提交旧 revision。提交先核对候选内容散列，再以不覆盖方式复制到 `document-assets`，之后取消临时任务。前端创建中性 raster 组件及一个历史步骤。新对象、取消、编辑参数变化、切换照片和关闭文件使旧选择失效；已提交资产留在文档缓存，供撤销、导出、保存及后续对象选取使用。

对象候选覆盖与提示点沿用画布的旋转 / 裁切 / 缩放变换。选择期间隐藏旧蒙版覆盖与操作柄，离开对象工具取消临时选择；确认后回到常规蒙版面板。模型概率评分不作为边界准确率展示。当前使用 SAM2.1 Small 的三张二值候选，不能表达半透明 alpha，也未实现语义主体 / 天空 / 人物部位检测。

## 对象框选与准备代次（0.30）

`predictObject(id, prompts, box?)` 新增 `ObjectBox {start:Point,end:Point}`；两点同样为原图归一化坐标。宿主排序两角、映射到像素中心，拒绝非有限、越界或小于一快照像素的范围。传入模型时先放两角，标签为 2、3，再放正负点；框内无需额外正点，总提示数含两角不超过 64。模型、显影引擎、配方格式均保持不变。

一次拖动是一项临时提示历史，创建后仍是一项文档历史。切换模式不提交配方；取消、关闭、参数变化使准备代次失效，即使快照状态尚未建立也不能继续启动旧任务。前端在等待显影队列前记录照片与调整，等待后再次核对；返回的过时任务仅清理自身 ID。

## 用户预设（0.31）

`listPresets / createPreset / updatePreset / renamePreset / deletePreset / importPreset / exportPreset / applyPreset` 是受限桌面接口。预设文件为 `.captraw-preset.json`：`kind=CaptRAW-preset`、schema 1、引擎 19、名称、分组、选中的同步类别及对应的控件值。没有源 RAW 路径或指纹，不保存未选中的调节或隐藏 ART 参数；`artProfile` 固定为空，复用资产事务时不引入来源图像的隐藏配置。当前仅接受本版本格式，未知引擎、无效字段或缺失必需值明确拒绝。

预设库位于应用 userData 下 `presets/<随机 UUID>/preset.captraw-preset.json`。名称不参与路径；创建和更新原子发布 JSON，外部栅格蒙版使用既有内容寻址 `.assets` 事务并校验。导入生成新的 UUID；删除将整个目录移到库内 `.deleted`，不影响照片私有缓存和配方已保存的资产。此保留区暂未提供恢复界面。携带预设时须一起移动配套资产文件夹。

应用复用 `Synchronizer` 的隔离核心，准备完整结果后才对当前文档提交一个历史步骤；未选项、目标输入配置文件和隐藏原生参数保留。相同设置不增加历史。白平衡按色温 / 色调；裁切、蒙版按相对坐标，修复半径保留像素值，手动镜头配置保留选中的器材。固定对象选区不会重新识别目标照片。等待资产恢复时取消会使本次代次失效；开始渲染后取消终止隔离进程。进度对话框位于被锁定的工作区外，确保实际可点击取消。

创建 / 更新 / 删除确认使用 Web 对话框；导入 / 导出使用文件选择框。隐藏 E2E 可设置专用 `CAPTRAW_E2E_USER_DATA`，不会改动用户的真实预设库。测试路径只在 `CAPTRAW_E2E_BACKGROUND=1` 时生效。

交互参考 [Adobe 用户预设说明](https://helpx.adobe.com/camera-raw/desktop/edit-and-enhance-images/tone-and-color/presets.html) 的命名、选择调整子集、更新与删除；此接入不表示 Adobe 文件或数值兼容。预设强度、悬停预览、收藏、批量直接应用、ISO 自适应和 Adobe XMP 导入未实现。


## XMP 编辑文档与预设（0.32，替代旧文件格式）

运行代码移除 `.captraw.json` / `.captraw-preset.json` 文件读写和历史引擎推断。`EditDocument` 是内存契约，不是 JSON 磁盘格式；JSON Lines 控制通信不变。历史版本段落仅记录当时行为。已有旧文件和旧预设库不删除、不迁移，新库为 userData 下 `xmp-presets/<UUID>/preset.xmp`。

`native/xmp.cc` 使用固定 Adobe XMP Toolkit SDK v2025.03，`captraw-xmp` 独立进程接受受限属性操作。系统 Expat 先验证 XML，禁止 DTD；SDK 错误回调拒绝恢复性丢弃。唯一上游行为补丁取消两个语言选项时覆盖第二项的旧修复，保留 x-default 排序。源码与补丁散列由 `scripts/build-xmp.mjs` 记录；没有 Adobe 二进制依赖。

`crs:Exposure2012` 为 EV，`Temperature` 为色温，四条 `ToneCurvePV2012*` 使用有序点序列（0–255 归一化到核心坐标）。未出现的字段不参与预设覆盖。曲线插值和显影使用现有 ART 管线，没有证明与 Adobe 像素等效。ART 白平衡精确系数保存在扩展中；外部修改标准色温后，系数失效并转入自定义白平衡。Adobe Tint 与 ART green 的对数单位不同，目前不强行映射。

`https://captraw.org/ns/develop/1.0/` 存放 ART 参数语义、原生处理配置、源文件指纹、基线 4、蒙版和资产清单；结构使用 RDF struct / Seq 与类型限定符，不使用 JSON 字符串。当前可保存全套 CaptRAW 编辑，但尚未将 ART 局部蒙版转换为 Adobe 蒙版。未知 Adobe / 其他命名空间保留在原始 XMP 元数据图中，未接入的 Adobe 字段在工作台与预设列表提示。

保存先发布不可变内容寻址资产，再通过 SDK 序列化、重解析核对，最后原子替换旁车。失败保持原有文件。直接打开 XMP 优先使用源关联和 SHA-256；外部 XMP 根据同目录唯一同名照片关联。默认自动发现同名 `.xmp`；不修改 RAW、ARP 或旧 JSON。当前桌面输入限定 UTF-8 XMP；宽字符输入与完整 Adobe 配置文件、蒙版、修复、自动 / 自适应设置的映射仍待实现。

## XMP 白平衡坐标（0.33）

全局 `temperature` / `tint` 改为 Robertson 色温与 Adobe -3000 缩放的 uv 偏移，范围 2000–50000 K / -150–150，按 CRS 整数类型直接存入 `crs:Temperature` / `crs:Tint`；原照及取样的精确系数不因显示取整而改变。处理版本升为 CaptRAW-20；基线仍为 4。旧 CaptRAW 显影版本明确拒绝，不将旧 ART green 对数值误解释为 Tint，也不恢复 JSON 兼容层。原文件不删除。

`native/white-balance.cc` 复用固定 ART 的 Robertson 表和逆投影，保留 325 mired 的历史 0.24702 项；不是套用 ART 的 daylight / blackbody SPD 数值。存在 DCP 时，通过同一配置文件、光源选择和双光源逆色温插值得到 XYZ→相机矩阵，再把白点转成相机通道系数。没有 DCP 时，使用 ART 的线性 sRGB / 相机矩阵接口。`patchWhiteBalanceAccess` 只公开既有 DCP 转换接口，不改其显影算法。

预览和 `compose` 均在进入 ART 前解析为 `CustomMult`，全分辨率导出直接消费已解析的 ARP。无活动会话的 `compose` 为手动白平衡读取原片以取得相机矩阵；这一读取有额外成本。原照、自动、取样及机身预设仍保存精确系数；显示坐标从当前 DCP / 矩阵反算，超出控件范围时提示近似。切换输入配置或 DCP 光源时，固定系数保持不变，仅重新投影显示坐标；手动白平衡保留坐标并按新矩阵解析。嵌入 ICC 优先于同文件 DCP，转换分支与实际渲染一致。

`ct:ARTWhiteBalanceCoordinates` 记录精确系数对应的两项标准数值。外部修改任一数值会清除旧系数，避免保存的原照系数遮住 XMP 修改。仅含 Temperature 或 Tint 的预设只覆盖该项。保存数值白平衡使用 `crs:WhiteBalance=Custom`；外部其他模式若已有数值，则使用其数值快照并明确提示未重算模式。缺少数值的其他模式保留并报告未接入。

独立参考为 Colour Science 0.4.6，显式调整其已修正的 325 mired 表项后比较 50 组正反投影。自产双光源 DNG 验证相机系数、真实中性灰输出和独立进程 TIFF16。来源：[Adobe CRS 命名空间](https://developer.adobe.com/xmp/docs/xmp-namespaces/crs/)、[Colour Robertson 实现](https://github.com/colour-science/colour/blob/v0.4.6/colour/temperature/robertson1968.py)。

这完成全局白平衡坐标接入，不代表 Adobe 画质等效：尚未导入 Adobe 相机配置或补齐 ART 不支持的 CameraCalibration / AnalogBalance 组合，完整 ACR 色彩管线仍不同。极端色温 / Tint 在某些相机矩阵上产生无效系数时明确报错，不静默裁剪。局部白平衡继续使用已有 ART 相对模型。


## 输入配置文件导入与随附资产（0.34）

桌面“配置文件 → 导入 DCP / ICC”接受独立 DCP 或 RGB 输入、显示、颜色空间类 ICC / ICM。原生 `inspectInputProfile` 使用 ART 的 DCP 解析器及 Little CMS 读取名称、机型限制、嵌入规则和真实处理能力；ICC 须能建立 RGB→XYZ 转换。文件最多 64 MiB。DCP 只用于 RAW，并按声明的机型限制检查；DNG 使用 `UniqueCameraModel`，其余照片使用 ART 提供的相机名称。未声明机型的 DCP 和 ICC 显示适用性提示，不推断不存在的机型约束。

导入先校验复制后的准确字节，再按 SHA-256 存入用户数据目录 `input-profiles`，重复导入复用同一内容。原文件可移走；读取已有绝对路径引用时也先固定到私有内容快照。原生预检查和导出核对内容寻址文件名与实际哈希，避免路径缓存掩盖文件变化。本地库不属于应用安装包，用户导入的配置不进入发行资源。配置名称不作为唯一身份。同名项通过内容标识区分，不自动匹配 Adobe 名称或 digest。

保存 XMP 时，独立配置与蒙版一起放入 `<文件名>.xmp.assets`。`ct:InputProfileAsset` 记录 SHA-256、相对路径及字节数；ART 参数和控件状态使用 `captraw-profile:<sha256>` 引用。读取时先核对旁车资产，即使私有缓存已有文件也不能绕过校验；再恢复为当前进程私有路径。缺失、篡改、越界路径、链接和不一致引用均拒绝。资产先发布，XMP 最后原子替换；不会删除已有资产或替换原片。移动或重命名 XMP 时须保留配套资产文件夹。

`ProfileEmbedPolicy=2` 的 DCP 可用于当前编辑，但拒绝随配方复制；界面说明保存前需改选配置。其他取值仍须遵守配置自身许可，不能把字段值当作第三方资产再分发授权。切换配置沿用当前精确白平衡系数并更新 Temperature / Tint 投影，形成一个可撤销操作。导入回调使用当前控件状态，面板卸载或切换照片后丢弃迟到结果；处理版本仍为 20，基线 4，没有改变已支持配方的显影算法。

Adobe `crs:CameraProfile` 是设置名称，`CameraProfileDigest` 尚未完成与真实 Adobe 输出的成对验证。当前不会把文件 MD5 / SHA-256、ICC ID 或同名 DCP 冒充 Adobe digest；这些字段及增强 Look 原样保留并列为未生效。DCP / ICC 导入、XMP 结构保留和 ACR 像素等效是独立验收项。

依据：[DNG 1.7.1 ProfileName / UniqueCameraModel / ProfileEmbedPolicy](https://helpx.adobe.com/content/dam/help/en/photoshop/pdf/DNG_Spec_1_7_1_0.pdf)、[Adobe Camera Raw XMP](https://developer.adobe.com/xmp/docs/xmp-namespaces/crs/)。
