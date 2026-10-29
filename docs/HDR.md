# HDR 接入验证

2026-10-29。0.64 已打包现有实验性 HDR 能力，本轮暂缓新增 HDR 功能，仅维护必要回归。核心 / 桌面已接入真实 HDR 编辑开关、1–4 EV 余量、扩展直方图、WebGPU 主画布、历史及 XMP 保存恢复，显影版本为 27。安装版含 HDR AVIF；0.63 历史归档保留。此处回归不代表完整 HDR 功能或物理显示验收。

固定 ART `1e0e12c62e4f329d30bb5624d62a23a663ffbe6b`。上游明确支持通过 ToneCurve WhitePoint 扩展显影范围，但其桌面预览不能显示 HDR，见 [ART HDR 输出说明](https://artraweditor.github.io/Hdroutput)。本次只使用本地、开放的 ART 和浮点 TIFF 路径，不依赖 Adobe 解码器、云服务或新的模型。

## 已测数据

原生 CLI 在禁网络、禁 Homebrew 读取的沙箱内执行。当前核心生成完整配置，固定曝光 +3 EV，分别设置白点 1 / 8 和线性 Rec.709 输出；完整 RAW 处理后缩放至 2048 像素边界框。受控 DNG 和真实 Nikon D850 NEF 各执行六种输出：SDR 控制、HDR Float32、HDR Float16、点曲线、颜色分级和径向局部亮度。所有输出均为有限浮点值、IEEEFP TIFF，带 704 字节的 Linear Rec.709 ICC。

| 指标 | 受控 DNG | D850 NEF |
|---|---:|---:|
| 输出尺寸 | 1016 × 760 | 2048 × 1365 |
| 白点 1 的亮度 P99 | 1.000006 | 1.000007 |
| 白点 8 的亮度 P99 | 6.368543 | 1.321038 |
| 白点 8 的亮度超过 1.001 的像素 | 696,920 | 483,292 |
| Float16 相对 Float32 最大量化误差 | 0.001952 | 0.000977 |
| 与 NumPy 偶数舍入不同的中点样本 | 0 | 530 |

亮度按线性 Rec.709 系数计算，仅是相对白点的数据测量，不是屏幕尼特数。D850 源文件 SHA-256 为 `0c9438258ddae5260b9f5a1aace6658a723f1cb1acace3a6cb507116dc6da4f2`；测试前后不变。

两个关键边界：

- D850 的白点 1 控制也出现最大 RGB 1.41832、亮度 1.18796。色域变换及曲线之后的缩放可产生超调，不能仅以某个通道大于 1 判定 HDR；测试比较相同配置下改变白点后的亮度分布及有效高光数量。
- ART 的 `DNG_FloatToHalf` 在中点向远离零的方向舍入，NumPy 默认向偶数舍入。按源码规则构造独立参考后，两个来源的 Float16 输出均逐值一致，未把一档误差简单放宽后算通过。

曲线、现有颜色分级与局部调整都改变了实际浮点像素且没有消灭全部高光余量，但这不证明 HDR 语义正确。最初的 `native/grading.cc` 使用 SDR 算法：正明度将分量移向 1，超白区染色也受限制。受控样本中全局明度 +20 曾把最大值从 6.43142 降到 4.89006。下文新增显式 HDR 分支修正了这一受控情况；旧配方保留原算法，不能据此宣称全部 HDR 工具或 ACR 分级语义等效。

## Electron 与显示链

在隐藏、不可聚焦的安装版进程中测得 Electron 45.0.0 / Chromium 156.0.8078.48，Apple Metal 3。内置显示器报告 10 位分量、P3；动态范围媒体查询为 high。AppKit 报告 current EDR 为 1、potential EDR 为 16、reference EDR 为 0。这些是查询值，未测量物理亮度，也不证明应用激活了 EDR。

| 路径 | 实际结果 | 可得结论 |
|---|---|---|
| Canvas2D Float16 | 保留 0.5 / 1 / 2 / 4；请求 extended 后实际属性仍为 standard | 不能直接替换当前 Canvas2D 就宣布 HDR |
| WebGPU rgba16float | standard / extended 配置均成功，读回保留 0.5 / 1 / 2 / 4 | 缓冲格式与配置可用，屏幕表现未证明 |
| srgb-linear / display-p3-linear | 当前运行时拒绝颜色空间枚举 | 不能仅根据 Chromium 主版本启用 |
| 真实 TIFF → 二进制协议 → WebGPU | 两张图像各验证 1:1 的 standard / extended 和 extended 适屏缩放；另加两组有符号传递控制，共 8 个案例 | 编码和线性插值路径已获数值证据 |

传输实验使用安装版内独立的内存 session / 隐藏窗口和严格路径表，不替换产品协议。Float16 RGBA 以二进制读入 GPU，在线性空间插值，再仅执行一次有符号的扩展 sRGB 编码，写入标记为 sRGB 的 rgba16float 画布。输入、读回图像均不经 Base64 控制消息。所有输出与独立 CPU 参考在两档半浮点 ULP 内，实测最大 1.07955 ULP；负数、零、白点和超白控制均覆盖。窗口始终隐藏、不聚焦且不可聚焦。

**同一图像的 standard 和 extended 缓冲读回逐字节相同。** 这直接说明读回超白值不能证明显示合成器、窗口或屏幕已呈现 HDR；普通截图同样不是物理亮度证据。HDR 显示、跨屏切换、窗口遮挡及系统亮度变化仍未验收。

[Chromium HDR 接口说明](https://developer.chrome.com/blog/new-in-webgpu-129)区分 standard 与 extended 的呈现行为；[155–156 的接口说明](https://developer.chrome.com/blog/new-in-webgpu-155-156)介绍线性画布颜色空间，但本机探测尚不接受该枚举。Chromium 曾记录 [macOS 扩展模式仍呈 SDR 的问题](https://issues.chromium.org/issues/567321057)，公开检索摘要同时包含 156.0.8078.38 的修复验证。该记录仅说明需要单独检查合成链，不能据版本号认定当前 Electron 受影响或已通过。

## 接入门槛

数据链优先采用 ART 缓存浮点结果 → 明确色域 / 线性白点的 Float16 帧 → WebGPU extended。当前不需要更换 Electron / Web UI，也不能从已经裁剪的 8 位 PNG 重建高光。代码检查确认适屏处理在 `improccoordinator.cc` 的 `bufs_[2]` 中仍是浮点，随后才调用 `rgb2monitor` 生成 `Image8`；详细区域另有处理路径，两者都须接入和比较。

后续必须完成：

1. 适屏 / 1:1 缓存浮点帧已接入；继续补充 HDR 模式下蒙版与细节工具、取消和真实 RAW 滑杆性能验收，不能每次调节启动一次 CLI 全图导出来替代交互预览。
2. HDR 开关、ART 余量、浮点直方图及 XMP 已接入；完整超白曲线交互、SDR 映射和逐模块画质仍需完成，不把 SDR 算法默认视为 HDR 正确。
3. 验证传递函数只执行一次、色域映射明确；集成后的完整图像链与浮点参考核对，覆盖缩放、裁切、旋转、覆盖层和前后对比。GPU 丢失或能力不足须明确回到标记为 SDR 的视图。
4. 完成显示合成与物理亮度验收。当前隐藏 E2E 约束下只能验证数据和能力，不能将以上数值测试当作这一门槛通过。
5. 为可互操作的 HDR 输出确定绝对亮度 / 传递 / 色域元数据与开源编码路径，并验证外部读取和 SDR 对应图。当前研究用浮点 TIFF 不等于已经实现 AVIF / JPEG XL / gain map，也未改变产品的 TIFF16 / JPEG 导出行为。

## 已接入的缓存浮点接口（0.64，实验性）

`native/patch-float-preview.mjs` 为固定 ART 添加独立的借用像素监听器，在适屏与详细区域各自完成第三阶段后、生成最终帧时回调。默认没有像素复制或浮点帧分配。新接口 `update.linearPreview=true` 只请求显示数据，不写入 `Adjustments` 或 XMP，不改变 WhitePoint，也不影响 JPEG / TIFF16 导出行为；普通 SDR 中不指定或设为 false 时关闭；显式 `hdrEnabled=true` 会自动请求浮点帧，不能靠显示请求关闭 HDR 处理。原生 `before` 操作仍无浮点附件；桌面的四种前后布局通过独立核心的 `update` 生成浮点参考，见下节。

核心复制需要交付的区域，保留原工作色域及图像模式，使用 ART 原有浮点色彩变换得到线性 Rec.709，再按其 DNG 中点舍入写成有符号 `rgba16float-le`。相对白点是 1，不是绝对尼特数；Alpha 恒为 1。`PreviewFrame.linear` 附件与同次 PNG 的尺寸、revision、session 和区域一致，带 `width` / `height` / `rowBytes` / `encoding` / `colorSpace`。桌面通过现有私有预览协议登记文件 URL，不把二进制放入 JSON。

含局部明暗等依赖完整上下文的 1:1 请求，保留半浮点全图缓存，并按当前窗口提取，平移不重复完整处理。更改参数、关闭及重新打开会释放该缓存；普通 1:1 只编码实际详细区域。处理线程回调结束后不保留 ART 裸指针。不可表示像素或写入失败会报错并阻止发布损坏的帧。

补测发现旧实现把外部会话 ID 拼入文件名，带路径分隔符的 ID 会导致预览写入失败及停止等待卡住。当前核心保留原始 RPC ID，仅使用其 SHA-256 摘要作为 PNG、覆盖图、亮度图和浮点缓存的文件名前缀；不限制 ID 为文件名，也不变更配方。包含斜线、空格、中文和 URL 特殊字符的 ID 已核对缓存范围及返回身份。

验证结果：

- `tests/float-preview.mjs` 的当前基础 **12 项**检查通过。受控 DNG、D850 NEF、R5 CR3、X-T4 RAF 的默认 SDR 以及开启浮点附件后的 SDR PNG，均与已安装 0.63 的同配置逐字节相同，配方未改变。
- Z5 II 的 3:2 HE / HE★ 另补测 **6 项**。文件 `196971ea` / `276ef4ad` 的完整 SHA-256 与此前已读取实际压缩标签 13 / 14 的固定样本一致；默认和附加浮点帧时的 SDR 仍与 0.63 相同。不是仅按扩展名判断压缩模式。
- 合计 **7 组 192 × 128 区域**对照独立 ART Float32 输出：DNG、D850、Z5 II HE / HE★、带局部明暗的旋转裁切、缓存平移及新 HDR 分级。按 ART 的半浮点舍入规则量化后逐值一致，实际最大误差为 0.5 半浮点 ULP，包含负值和超白；不外推为所有工具和全尺寸像素已一致。
- 原生核心与参考 CLI 都在禁网络、禁 Homebrew 读取的沙箱中执行；固定原片哈希不变。早期四个缓存接口文件已从干净归档重放；当前包含 HDR 标记的 21 个补丁另从校验过的源归档重放，8 个相关上游文件与编译源逐字节一致，重复应用不改变内容（`artifacts/hdr-edit/patch.json`）。
- `tests/float-preview-e2e.mjs` 的 **5 项**检查通过。生产构建的实际打开、曝光、1:1 和关闭控件均可操作；适屏 14,612,544 字节、详细区 22,352,000 字节的真实附件经过私有协议与 GPU 上传 / 读回后 SHA-256 一致。测试以 IPC 包装器请求可选附件，该通信专项不操作用户 HDR 开关。后续画布接入见下节；该测试不是新安装包或物理 HDR 显示验收。桌面原生子进程未加 OS 沙箱，浏览器 HTTP 已禁用。

因此，缓存取数、区域复用与通信已有实现和上述有限证据；不能仅据该接口把整个门槛或 HDR 功能标记完成。后续主画布进展见下节。

## WebGPU 主画布（0.64，实验性）

`apps/desktop/src/LinearCanvas.ts` 消费真实 `PreviewFrame.linear`，以 `rgba16float` / `srgb` / `extended` 配置绘制；适屏在**线性光**中插值，然后仅编码一次有符号扩展 sRGB，1:1 详细区域按像素中心近邻取样。保留负值与超白，不经 8 位预览重建数据。裁切、平移、旋转和四种前后布局使用现有画布坐标，蒙版、修复与控制点继续走原覆盖层；亮度灰度视图仍使用原有显示路径。

普通 SDR 帧不创建 WebGPU 设备或额外画布。当前画面有浮点附件时，前后对比核心按同一显示需求生成和登记浮点附件，原始编辑参数不因此变化。只保留当前需要的纹理，替换帧时取消旧读取并释放旧纹理；关闭或重试会销毁设备。设备丢失或配置 / 读取失败时，界面回到原 PNG，并明确显示“已回退 SDR · 高光可能截断”，提供可实际点击的重试入口；这不是 HDR→SDR 色调映射验收。

实际操作暴露并修复了两处问题：重试按钮的指针事件原先被画布平移捕获；连续详细区域更新会挤掉仍用于适屏背景的文件，造成设备恢复时无法重新读取。现在状态栏按钮隔离画布拖动，缓存保留当前适屏 / 详细区域及其附件，同时继续清理旧帧。十次平移后当前适屏附件仍可读取，测试中的私有图像文件数不超过 18。

`tests/linear-canvas-e2e.mjs` 当前 **15 项**通过：实际 HDR 开关、曝光、余量、直方图、撤销 / 重做、XMP 保存、1:1、十次平移、真实 `GPUDevice.destroy()` 后的回退与点击恢复、四种对比布局、裁切、旋转及关闭 HDR。关闭应用后在全新隐藏实例打开 XMP，控制值与浮点像素 SHA-256 一致，撤销历史清空；重开后的 HDR 开关仍可撤销。

测试记录实际 GPU 上传、绑定及呈现纹理，对 **232,000 个网格采样像素**使用独立 CPU 参考检查线性插值、传递函数、1:1 取样、透明边界及分屏裁剪；当前实测最大误差为 **1.24241 半浮点 ULP**，输入数据 SHA-256 与核心附件一致。这不是全画布每个像素或所有工具组合的验证。当前测试已经移除请求浮点数据和篡改 WhitePoint 的 IPC 包装器，使用真实可见控件驱动原生参数；保留对 GPU 命令的只读记录。物理显示和完整 HDR 功能仍未验收。

默认 SDR 的 **12 项**前后对比与 **19 项**关闭 / 曲线 / 蒙版交互回归通过，四种 SDR 组合图与原生图像的 8 位像素最大差为 0。新旧测试均使用隐藏、不可聚焦窗口；截图仅用于查看布局，不是亮度证明。当前默认 SDR 回归输出位于 `artifacts/hdr-edit-regression/`；浮点 GUI 输出位于 `artifacts/linear-canvas-e2e/`，原生子进程未加 OS 沙箱；新浮点测试的浏览器 HTTP 已禁用。并发验证数据不作为性能基准。

WebGPU 类型使用固定的开发依赖 `@types/web@0.0.352`（BSD-3-Clause），按 [gpuweb 类型项目说明](https://github.com/gpuweb/types#integration-into-dom-type-definitions)替换 TypeScript 7.0.2 不完整的 DOM 声明，不增加运行时依赖。

## HDR 编辑与 XMP（0.64 / 引擎 27，实验性）

`Adjustments.hdrEnabled` 为实际处理开关；`hdrHeadroom` 是 1–4 EV，可按 0.25 EV 调节，缺省为 3。开启时 ART `ToneCurve.WhitePoint=2^EV`，不是增加全图曝光，也不定义屏幕尼特数。开关和余量进入原有历史、脏标记、预设与独立的 HDR 同步组；改动触发 `ALLNORAW`，避免只更新画布而留下旧像素。关闭或删除受管 HDR 状态会恢复白点 1；未含 HDR 状态的旧 ART 白点与分级保持原外观。

实际开关写 `crs:HDREditMode` 的 0 / 1，余量只存于有类型的 `ct:ARTAdjustments.hdrHeadroom`，不重复保存私有开关，不把 ART WhitePoint 猜写为 `crs:HDRMaxValue`。本机 ACR 18.7 的 `Defaults/Previous.xmp` 只取得模式 0；模式 1 是依据 [MIDI2LR 固定版本的直接切换实现](https://github.com/rsjaffe/MIDI2LR/blob/e7f181cbaab5d9a0a1fd9de2e8c576f88a3f19cc/src/plugin/ClientUtilities.lua#L391)采用的实现映射，尚未取得本机 Adobe 非零样本做往返验收，不能称为 Adobe 规范确认。未知模式明确拒绝；未实现的 `HDRMaxValue` / `SDR*` 原属性保留并提示，绝不解释为本项目的 EV 参数。

新增的原生 `ToneCurve.CaptRAWHDREditMode=true` 标记确保独立进程重建 HDR 分级域，旧高白点配置不自动改算法。仅在显式 HDR 分支中，工作 RGB 转为线性 sRGB 后先除以白点，再执行原有编码 / 权重 / 明度 / 染色 / 解码，最后乘回白点。分级范围相对于峰值，改变余量会改变权重；不是 ACR 算法、感知等效或 SDR 外观不变的承诺。中性设置仍在任何转换前旁路，SDR 保留原计算路径。新处理版本 27 / 基线 4，读取现有 20–26；旧应用会拒绝新处理版本，避免误读分级域。

`PreviewFrame.linear.histogram` 在真实半浮点预览上统计三个 512 桶通道：左半为 0–1 的 sRGB 编码坐标，右半为白点以上至当前余量的对数 EV 坐标；另记负值和超出当前峰值的数量。直方图不修改像素，超色域通道计数也不等于场景曝光裁剪。它是当前适屏 / 区域的预览统计，不冒充全分辨率原始数据；曲线输入直方图仍为 ART 原有 SDR 范围统计。原有阴影 / 高光覆盖提示明确针对 SDR，尚未实现 HDR 范围覆盖图。

已知不适用组合会明确报错：使 ART 忽略 WhitePoint 的旧式对比 / 第二曲线、非恒等 RGB 单通道曲线、非零黑白 gamma 或旧染色。HDR 界面暂不提供单通道曲线，SDR 直方图自动影调也停用。主点曲线和参数曲线沿用 ART 的 HDR 扩展，当前编辑器仍显示归一化 0–255，完整 ACR 超白曲线坐标、范围取样、其他效果与局部工具的 HDR 语义及画质未完成。

`tests/hdr-edit.mjs` **14 项**通过。受控 DNG +3 EV 的亮度 P99：余量 3 EV 为 6.36747，余量 1 EV 为 1.99993；3 EV 下全局分级明度 +20 后为 6.67606，修正该样本中增加明度反而压低超白的问题。四组完整半浮点预览的直方图逐桶和负值 / 超峰值计数均与独立 NumPy 结果一致。默认、非中性 SDR 分级、旧高白点分级与安装版 0.63 的预览 / 适用配置字节一致；关闭和删除 HDR 恢复原像素。使用实际 Adobe XMP 工具链验证标准模式、私有余量、完整 ARP 及未知 RDF / HDR / SDR 属性保留。这些构造的非零 XMP 样本是测试夹具，不是 Adobe 导出证明。原生接口检查未加 OS 沙箱。

缓存专项另增加一组 192 × 128 的显式 HDR 分级区域，与独立 CLI 的 Float32 渲染按 ART 规则量化后逐值一致（最大 0.49939 半浮点 ULP），证明原生标记能够随完整配置进入独立渲染，而不只依赖桌面进程状态。原生缓存专项仍在禁网络 / 禁 Homebrew 的沙箱中运行；当前报告为 `artifacts/hdr-edit-float/` 和 `artifacts/hdr-edit-float-he/`。

**整数导出边界：JPEG / TIFF16 仍为 SDR。** 新核心对高白点配方的这两种请求在创建输出文件前报错，避免悄悄截断高光；可选择 HDR AVIF，或先另存 HDR XMP，再关闭 HDR 生成 SDR 版本。该 SDR 重显影不等于 HDR→SDR 色调映射。HDR AVIF 接入见下节；可调 SDR 映射、完整 HDR 工具 / 曲线 / 性能和物理显示仍须完成。[Adobe 官方说明](https://helpx.adobe.com/camera-raw/desktop/hdr-and-advanced-output/hdr-output.html)区分这些能力，不能合并为一个通过项。

## HDR AVIF 输出（0.64 候选）

新增 `avif` 导出格式，单张和批量均使用当前编辑 / 评分的快照、独立工作进程及原有临时文件发布路径。输出尺寸、裁切 / 旋转及缩放后锐化仍走完整 ART 浮点管线。HDR 格式固定 Rec.2020 / PQ，不受旁边的 SDR 色彩空间选择影响；底层拒绝与之矛盾的色彩空间。12 位 PQ 量化后，使用全范围 RGB / 4:4:4、恒等矩阵的 AV1 无损编码；这不等于 RAW 或浮点结果无损。

像素由 ART `RTv4_Linear_Rec2020` / 关闭 BPC 的浮点输出取得，按 ST.2084 和 **203 cd/m² 参考白**编码一次，再舍入至 12 位。为避免 ART 单精度 PQ 在量化边界的舍入差异，此步骤按同一标准常量以双精度计算。文件写 CICP **9 / 16 / 0**（Rec.2020 / PQ / RGB），全范围；不嵌入 SDR / Linear ICC，也不嵌入高光曲线表饱和的 ART PQ ICC。元数据 `clli` 从实际量化码解码后的 RGB 最大分量计算单帧峰值和画面平均上界，向上取整。没有添加未经定义的参考白私有文件标签。

Rec.2020 外的负通道截到 0，超过 10000 cd/m² 的通道截到 PQ 上限；这不是 ACR 的感知色域映射。没有增益图或应用可调 SDR rendition，SDR 查看器如何映射由查看器决定。当前原生读取器尚不能重新打开 AVIF；继续编辑应保留 RAW 与 XMP。Chromium 解码成功也不证明屏幕物理亮度正确。

AVIF 元数据取自 ART 输出元数据对象，保留可编码的源 EXIF / XMP 及 IPTC→XMP，应用当前 XMP 评分、正常方向与实际像素尺寸；显式评分移除冲突的旧 EXIF Rating / RatingPercent。源 RAW 和旁车只读。完整 IPTC / GPS / 隐私策略及各种 MakerNote 的跨应用保真仍未验收。编码取消通过终止独立 worker 实现，成功后才发布；批量同名编号保留已有文件。

依赖固定 [libavif 1.4.2](https://github.com/AOMediaCodec/libavif/releases/tag/v1.4.2)，源归档 SHA-256 为 `2b645287340ba5a631d268b551dc2d72bd73ac33335962dd36dcdb6d8366921d`。只启用本机 AOM 3.15.0；构建脚本核对版本，不引入其他 codec、libyuv、云服务或产品端 Python / FFmpeg。打包收集实际 AOM→libvmaf 依赖、完整 libavif LICENSE、AOM LICENSE / PATENTS 和 libvmaf 专利许可；固定 AOM revision、PATENTS 校验值和实际 Cellar 版本写清单。归档 / 许可说明见 THIRD_PARTY.md。

验证分别使用 `tests/hdr-export.mjs` 的实际原生输出、独立 ART Float32 参考与 FFmpeg / dav1d 解码；另由隐藏 GUI 操作单张 / 批量、调整快照、后续编辑、取消保留目标及缩放。最终结果以各目录 `report.json` 为准，候选验证未通过前不宣称安装版完成。原生专项在禁网 / 禁 Homebrew 读取的沙箱内运行；GUI 子进程未加该沙箱，浏览器 HTTP 已禁用。普通截图不能作为 HDR 亮度证据。

## 重现

先按 README 构建原生核心、部署其依赖、准备 QA Python 环境及固定样本。桌面探测默认使用 `~/Applications/CaptRAW-0.63.app`；其他安装位置用 `CAPTRAW_APP` 指定可执行文件。

```sh
CAPTRAW_HDR_CAPABILITIES_OUT=artifacts/hdr-research/capabilities node tests/hdr-capabilities.mjs
CAPTRAW_HDR_NATIVE_OUT=artifacts/hdr-research/native node tests/hdr-native.mjs
CAPTRAW_HDR_SOURCE=build/samples/nikon-d850.NEF CAPTRAW_HDR_NATIVE_OUT=artifacts/hdr-research/native-raw node tests/hdr-native.mjs
node tests/hdr-transport.mjs
CAPTRAW_FLOAT_PREVIEW_OUT=artifacts/hdr-edit-float node tests/float-preview.mjs
CAPTRAW_FLOAT_PREVIEW_OUT=artifacts/hdr-edit-float-he CAPTRAW_FLOAT_SAMPLES=nikon-he/Z5_2_3x2_HE_196971ea.NEF,nikon-he/Z5_2_3x2_HEstar_276ef4ad.NEF node tests/float-preview.mjs
node tests/float-preview-e2e.mjs
node tests/hdr-edit.mjs
node tests/linear-canvas-e2e.mjs
node tests/hdr-export.mjs
CAPTRAW_HDR_SOURCE=build/samples/nikon-d850.NEF CAPTRAW_HDR_EXPORT_OUT=artifacts/hdr-export-raw node tests/hdr-export.mjs
node tests/hdr-export-e2e.mjs
```

研究报告位于以上四个研究目录的 `report.json`；缓存接口检查报告分别位于 `artifacts/float-preview/`、`artifacts/float-preview-he/`、`artifacts/float-preview-e2e/`；当前 HDR 编辑接口结果为 `artifacts/hdr-edit/`。HE / HE★ 需先按 README 准备固定样本。GUI 接口检查需先构建当前核心和桌面，默认运行本地生产构建，不能指向缺少该接口的旧安装版。原生探测仅保留明确的 Float32 / Float16 参考 TIFF 和报告；成功后清理工作目录。失败时保留现场；修复通过后清理旧失败目录。`probeComplete` / `complete` 只表示对应检查执行完整，`hdrFeatureAccepted` 和 `physicalDisplayVerified` 仍为 false。安装版和源 RAW / XMP / ARP 均未修改。
