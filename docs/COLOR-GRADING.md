# 颜色分级接入证据

0.62 / 2026-10-28：现代 XMP 分级字段可单独导入，应用时合并目标原值，不为缺失轮或混合补默认值。仅当五个 `SplitToning*` 字段全部出现且没有现代 `ColorGrade*` 字段时，按 [Adobe 的 Split Tone compatibility 规则](https://blog.adobe.com/en/publish/2020/10/20/introducing-color-grading)将混合置 100，中间调 / 全局 / 所有明度置零；预设导入后的即时说明保留此次转换提示。该字段组合识别是本项目的实现判断；有现代字段时按稀疏现代设置处理，缺项不会推测为旧式。算法与下述 0.17 相同；同配方新旧核心像素相同不能证明与 ACR 渲染相同。

0.61 / 2026-10-28：XMP 互操作纠正使用实际的 14 个 `SplitToning*` / `ColorGrade*` 字段。旧版本误写的五个名称只对自有版本 24 文档迁移，保存保持原生配置和像素；外来未知同名属性保留，新文档版本 25 防止误解释。已只读核对 ACR 18.7 上次设置和 Adobe 15.1 官方非零分级预设；安装版色轮 / 预设、迁移重启和 TIFF16 一致性已验证。以下 0.17 算法研究仍为历史证据，字段对齐不补足 ACR 画质等效；映射及边界见 [接口说明](ENGINE.md#颜色分级标准字段纠正061--引擎-25)。

2026-10-27。0.17 安装原型接入四色轮与原生分级，处理版本为 14，初始基线仍为 4。保留 0.16，未修改 RAW 或旧配方。目标是用户 ACR 18.7 截图中的阴影 / 中间调 / 高光 / 全局色轮，以及混合、平衡、明度和相应操作方式。

## 先验收行为，再选择模块

[Adobe 的颜色分级介绍](https://blog.adobe.com/en/publish/2020/10/20/introducing-color-grading) 给出以下可检验语义。它是官方行为参考，尚未在本机 ACR 18.7 导出图上逐项测量：

- 染色和明度独立；明度为零时，纯黑 / 纯白保持端点。调整明度后才可使这些端点显色。
- 混合控制三个明暗区域的重叠；零值仍须平滑过渡。
- 平衡移动各区域的影响范围。
- 全局染色叠加在分区结果上，不受混合 / 平衡控制。
- 中性设置必须保留当前显影；无色相 / 饱和度时仍可单独调整明度。

还必须检查：灰阶上的连续性、有限值、色相方向、饱和色及负值 / 超白输入、色域处理、局部调整组合、预览 / TIFF16 一致、撤销和旧配方兼容。界面相同或有三个色轮不足以通过这些门槛。

## 固定候选

| 候选 | 固定源码 | 当前证据 | 接入结论 |
|---|---|---|---|
| ART HSL factors | ART 1.26.10，`1e0e12c62e4f329d30bb5624d62a23a663ffbe6b` | 实际包内核心五组 TIFF16；原生实现为 Slope / Offset / Power，缺少 ACR 混合 / 平衡的直接参数 | 否决直接映射成 ACR 四色轮；可继续研究颜色空间与区域处理组件 |
| RapidRAW 分级函数 | 1.6.7，`a4f2cf5cb867fa1def9f6d5ca2a16654b56fb8a8` | 不改原函数提取 WGSL，在隐藏 Electron 的 Apple Metal WebGPU 上运行 7×9 个输入 | 否决直接移植；端点行为和零混合边界不满足门槛 |
| darktable color balance rgb | 5.6.2，`20891f6c6fa7be995e5bf9dff9d1ee5062051773` | 官方 ARM64 CLI 八组 TIFF16；记录实际处理模块和线性 Rec.2020 工作空间 | 否决直接控件映射；中间调 / 高光 / 全局染色在零明度时改变纯白端点。未独立移植模块进 ART |
| darktable split-toning | 同一 5.6.2 固定源码与官方 CLI | 九组灰阶 + 彩色 TIFF16，包含两端零饱和度、染色、压缩和平衡 | 保留端点，但两端饱和度归零仍改变彩色像素；只有两个区域，无 ACR 中间调 / 全局 / 明度。否决直接接入 |
| OpenColorIO GradingTone | 2.4.2，`6918fad3f5d22ac3ef2397c754bf4268c2b58dd0` | 官方 ARM64 Python wheel 内的原生 CPU 处理器，39 组 × 9,019 个浮点 RGB 输入 | VIDEO 模式通过已测端点与单调性门槛，保留为组件候选；没有原生 ACR 混合 / 平衡和全局色轮，未确定最终路线 |
| CaptRAW 分区染色实验 | `tests/color-grading-adapter.py` 生成并编译独立 C++，复用固定 darktable HSL 转换与 ART 色域矩阵 | 21 组行为测试、四种工作空间、4,109 个独立传递函数参考采样、八组 ICC 输出组件测试与一张已显影 TIFF16 | 已有可运行的四色轮处理实验；宽色域画质及 ART 接入未验收，不接入安装版 |

ART [HSL factors 文档](https://artraweditor.github.io/Reference.html) 与[固定处理源码](https://github.com/artraweditor/ART/blob/1e0e12c62e4f329d30bb5624d62a23a663ffbe6b/src/engine/ipcolorcorrection.cc)支持三个色轮，但实际处理对每通道执行增益、偏移和幂。直接把它们更名为高光、阴影、中间调，会把相似外观误当作相同调节语义。

[darktable 固定模块](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/colorbalancergb.c)包含工作色域矩阵、D50 / D65 适应、明度权重、颜色空间转换及色域边界处理，不能只复制 `opacity_masks` 就声称移植了完整算法。其默认控件也不是 ACR 混合 / 平衡。[官方说明](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/color-balance-rgb/)用于理解处理角色，不把滚动版本文档当作固定源码的渲染证据。

## 实测结果

ART 通过 CaptRAW 0.16 安装核心直接导出人工生成的 256×32 灰阶。完整 ARP、TIFF 与输入生成方法保留；未通过 Web Canvas 或 8 位预览加工结果。蓝色设置为 hue=240、sat=70、factor=0、gamma=2.4，分别只启用一个 HSL 因子。

| ART 用例 | 纯黑输出 RGB16 | 纯白输出 RGB16 |
|---|---|---|
| 基准 | 0, 0, 0 | 65529, 65532, 65535 |
| 中性 HSL | 0, 0, 0 | 65529, 65532, 65535 |
| Slope 蓝色 | 0, 0, 0 | 62615, 62805, 65535 |
| Offset 蓝色 | 0, 0, 26069 | 64072, 64170, 65535 |
| Power 蓝色 | 0, 0, 0 | 65527, 65534, 65535 |

中性 HSL 与旁路的最大差为 1/65535，因此即使后续复用，也应对全零设置旁路，不能为旧配方无条件开启模块。Offset 对纯黑的变化明显超过量化误差。全部文件为 uint16、包含 sRGB ICC；基准白色自身已有转换舍入，比较使用实际基准而非假设三个通道均为 65535。

RapidRAW 使用[固定 shader](https://github.com/CyberTimon/RapidRAW/blob/a4f2cf5cb867fa1def9f6d5ca2a16654b56fb8a8/src-tauri/src/shaders/shader.wgsl)中的 `ColorGradeSettings`、`get_luma`、`hsv_to_rgb`、`apply_color_grading` 原文。只添加输入 / 输出测试入口，未手写 JavaScript 近似算法。结果为函数返回的浮点值，**不是完整 RapidRAW 应用的最终导出**：

- 纯黑 + 蓝色阴影（饱和度 1、明度 0）约为 `[-0.05, -0.05, 0.05]`。
- 纯黑 + 蓝色全局约为 `[-0.5, -0.5, 0.5]`，纯白约为 `[0.5, 0.5, 1.5]`。即使后续钳位，也不能恢复原端点。
- 固定源码中 `feather=0.2*blending`；混合为零时两个 `smoothstep` 边界相同。这个表达式未提供“零混合仍平滑”的过渡。具体 GPU 的返回结果已保存，不把某台 GPU 恰好返回有限数当作可移植保证。

没有使用这些候选输出冒充 Adobe 参考图，也没有据此断言候选产品整体画质低劣。结论只针对“直接接入为本项目 ACR 分级”的可行性。

### darktable 完整命令行渲染

从[官方 5.6.2 ARM64 包](https://github.com/darktable-org/darktable/releases/tag/release-5.6.2)提取 `darktable-cli`，纯命令行运行，没有启动桌面窗口。使用私有配置 / 缓存 / 临时目录、内存图库，禁止写源图 sidecar；禁网并禁止 Homebrew 读取。未把应用安装到用户 Applications。

输入是人工生成的 256×32 灰阶 PNG。关闭自动预设和自动工作流，使用原生默认参数、DTUCS 饱和度公式，单项染色设为 C=0.1、H=240、Y=0。每次日志均验证工作空间为 `linear Rec2020 RGB`，处理序列只有 `colorin → colorbalancergb → finalscale → colorout`；旁路去掉分级模块。输出无缩放、uint16、sRGB ICC。

| darktable 用例 | 纯黑 RGB16 | 纯白 RGB16 |
|---|---|---|
| 旁路 | 0, 0, 0 | 65535, 65535, 65535 |
| 中性分级 | 0, 0, 0 | 65535, 65534, 65535 |
| 阴影染色 | 0, 0, 0 | 65533, 65535, 65535 |
| 中间调染色 | 0, 0, 0 | 62260, 63331, 65535 |
| 高光染色 | 0, 0, 0 | 46532, 65535, 65535 |
| 全局染色 | 0, 0, 0 | 39183, 65535, 65535 |
| 全局明度 +0.1，无染色 | 22271, 22271, 22270 | 65535, 65535, 65535 |
| 中间调明度 +0.1，无染色 | 0, 0, 0 | 65389, 65387, 65388 |

这是固定 darktable 管线的实际输出，不是移植进 ART 后的结果。其场景线性算法有自己的语义；本表只证明不能直接改名为 ACR 控件。

另验证了同一官方包的 `splittoning` 模块。256×64 输入上半为灰阶，下半为明确的 RGB 彩色条。九组输出均保留黑白端点；但是两端饱和度都为零时，灰阶与旁路相同，彩色部分的最大差仍为 **17,711/65535**。固定源码将输入与目标 HSL 色相 / 饱和度的 RGB 值按区域混合；目标饱和度为零会混入灰色，并不代表旁路。这与[官方说明](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/split-toning/)主要用于单色输入的定位一致。

不能把它当作可直接接入的 ACR 色轮，也不能把 compress 改名为 Blending：compress 保护一个不染色的中间区，并未实现三色重叠。由此增加接入门槛：**中性验证必须同时覆盖灰阶与彩色样本**，仅检查灰阶不够。

### OpenColorIO 原生组件验证

依据[官方安装说明](https://opencolorio.readthedocs.io/en/v2.4.2/quick_start/installation.html)，在项目专用 venv 安装固定 PyPI wheel；两个已加载的原生二进制逐字节匹配已校验的 wheel。[GradingTone API](https://opencolorio.readthedocs.io/en/v2.4.2/api/grading_transforms.html#gradingtonetransform)提供五个色调区域及 RGB / Master 调节。试验未增加自己编写的像素算法、ICC 转换或 ACR 控件映射。

每组输入包括 4,097 级灰阶、9 个扩展灰阶（−1 至 16）和 17³ RGB 色块。39 组覆盖 VIDEO / LIN / LOG 三种模式、中性、三个区域的蓝通道及 Master 调节、合法极值、作用范围变化、黑位抬升、白位降低及三分区叠加。

- 所有输出均为有限值；三个模式中性设置逐位不改变输入。已测灰阶输出保持单调。
- VIDEO 染色测试的黑白端点最大误差为 `5.96e-8`；全部 VIDEO 用例正反处理最大误差为 `2.98e-7`。这些是浮点组件误差，不是与 ACR 的误差。
- 调整阴影 start 从 0.35 到 1，实际影响区扩大；高光 start 从 0.65 到 0，实际影响区扩大。中间调 width 不等同于硬蒙版宽度，不能直接按名称映射为 ACR 混合。
- 黑位 Master=1.2 将纯黑抬至约 0.04；白位 Master=0.8 将纯白降至约 0.95。它们是单独参数，不等于已完成 ACR 阴影 / 高光明度联动。
- LIN 默认处理以 0.18 为基准的曝光级数定义区域，纯白 1.0 并非固定端点。不能把 VIDEO 参数原样用于 ART 的线性图像。
- 固定实现逐通道判断范围，实测三分区调整仍保留纯红 / 纯绿 / 纯蓝。它不是按一个像素的共同明度计算染色权重；色相、饱和度及肤色行为仍须设计并验证。

因此 OCIO 提供了可运行的成熟曲线组件，但尚未解决最终工作空间、共同明度分区、混合 / 平衡、全局叠加和色域处理。未加入安装包或产品依赖。

## 分区染色原生实验

`tests/color-grading-adapter.py` 将已验证的接入行为推进为独立可执行的 C++ 实验。它从固定 darktable `colorspaces.h` 原文提取 `hue2rgb` / `hsl2rgb`，保留版权和 GPL 许可；使用 ART 固定 `iccmatrices.h` 的 D50 工作矩阵。**区域权重、饱和度作为混合强度、明度处理和组合次序是本项目新写的实验适配，不是 darktable 原模块，也不是已复现的 Adobe 算法。**

实验参数为阴影 / 中间调 / 高光 / 全局四组 H/S/L，加混合与平衡。三个分区共用输入像素的 HSL lightness 计算范围；平衡移动分区，混合扩大重叠。三个分区同时组合后再应用全局调节。零饱和度的色轮不参与染色，全部中性直接复制原像素。明度先于染色，允许抬黑 / 压白后显色。零明度染色保留的是 **HSL lightness，不是光度学 Y**。

首轮数值验证：

- 21 组 × 9,016 个输入，覆盖灰阶、17³ 彩色立方体及负值 / 超白；结果有限，重复执行一致，两个中性用例逐位保持输入。
- 染色而明度为零时，黑白端点保持；固定范围边界的相邻样本没有观测到跳变。这是有限采样，不等于对所有参数证明连续。
- 阴影蓝色、饱和度 70、明度 +25 将纯黑变为约 `[0.11875, 0.11875, 0.38125]`；高光红色、饱和度 70、明度 −25 将纯白变为约 `[0.88125, 0.61875, 0.61875]`。
- 在 999 个灰阶取样点上，混合 0 / 50 / 100 时三个分区同时具有有效权重的点数为 0 / 443 / 989。正平衡增加固定中灰的高光权重；只启用全局时，改变分区混合 / 平衡得到逐位相同的输出。
- 原生工作空间包装先转为扩展浮点 sRGB 编码、执行实验处理，再转回线性工作空间；转换前不钳位负值或超白。sRGB、Rec.2020、ProPhoto、Adobe RGB 四种空间共 16 组比较，SDR 网格转回 XYZ 的最大差约 `5.30e-6`。这验证数值接入，不是色差盲评或 Adobe 误差。
- 四种空间各自的 17³ 原生色域立方体均无非有限值。修正扩展 sRGB 负值传递函数后，蓝色全局染色的工作 RGB 最大约 **1.105**，最小约 **−0.00246**。sRGB / Rec.2020 / ProPhoto / Adobe RGB 分别有 0 / 70 / 55 / 202 个像素超出单位立方体（容差 `1e-6`）。浮点工作值超界本身不等于错误；须结合最终输出与感知质量判断，不能直接钳位。

另从已有 `artifacts/preview-output-gui/auto.tiff` 读取带 sRGB ICC 的 uint16 图像，抽样 710,016 像素，生成独立 TIFF16 及左右对比图。输入文件哈希未变；原生调用单次约 14 ms，仅作运算测量，不包含 RAW 解码、预览管线或 GUI，不作为端到端性能验收。已检查对比图，但该图不是 ACR 参考，也没有构成画质盲评。

上述独立实验之后，已完成下述 ART 后置接入与原生持久化，0.17 增加 Web 色轮。宽色域 / 感知明度、饱和色与肤色质量仍未通过 ACR 对照，不能仅凭行为测试采用为最终算法。

### 扩展 sRGB 修正与 ICC 输出组件验证

初版实验对所有负数使用 sRGB 小信号线性分支，宽色域矩阵产生的负分量因而被错误放大。根据 [W3C CSS Color 4 固定版本的转换代码](https://www.w3.org/TR/2026/CRD-css-color-4-20261026/#color-conversion-code)，改为按绝对值选择分支，再恢复符号；没有裁切负值。独立提取的 JavaScript 参考与 C++ 在 −16 到 16 及两个分段点附近共 4,109 点对照。误差按 `abs(actual-reference)/max(1,abs(reference))` 计算，编码 / 解码最大值分别为 `1.68e-7` / `5.85e-7`，正反变换误差均小于 `2e-6`。原有 21 组直接编码 RGB 染色数组哈希未变。修正前失败证据保留在 `adapter/transfer-before.json`，旧工作空间报告在 `working-before.json`。

另通过安装版自带 LCMS 与 `RTv4_sRGB.icc`，以 XYZ double → RGB16、相对色度、黑点补偿运行四空间的 17³ 立方体及七条 4,097 点颜色渐变。四组灰阶端点与旁路输出完全一致。蓝色全局染色后，立方体新增触及 0 / 65535 的通道数依次为 0 / 66 / 80 / 59，同时更多原边界通道离开边界。渐变的最大相邻 RGB16 变化由 207 / 344 / 421 / 290 变为 227 / 343 / 420 / 289。整数端点计数包含量化，不能单凭这些计数判断画质或断言发生错误裁剪。

此测试仅调用包内 ICC 组件，**未执行 ART 的输出快速路径，也不是预览 / 导出一致性验收**。源码、参考、二进制、ICC 哈希和原始数组均已记录；当前证据不构成完整连续性证明、ACR 像素对照或肤色盲评。

## ART 接入位置：源码与原生导出交叉验证

固定 ART 的 `improcfun.cc` 中，局部 `colorCorrection` 在 Stage 2；Stage 3 顺序包括 filmSimulation（可在 toneCurve 前或后）、rgbCurves、labAdjustments、localContrast，最后是 blackAndWhite 及预览锐化。`simpleprocess.cc`、`improccoordinator.cc` 都调用共享的 Stage 3。现有 filmSimulation 并不是最终颜色处理入口。

`tests/color-grading-order.mjs` 使用已安装的 0.16 核心验证此顺序：输入灰阶，生成明确的诊断 Hald LUT（R/G 乘 0.8，B 不变），设置 `AfterToneCurve=true`，导出四组 TIFF16。诊断 LUT 只用于判断处理顺序，绝非分级算法候选。

| 原生导出 | 最大 RGB 通道差（RGB16） |
|---|---:|
| 基准 | 6 |
| 仅诊断 LUT | 13,112 |
| 仅黑白 | 29 |
| LUT + 黑白 | 26 |

黑白后的少量通道差包含现有颜色转换舍入；LUT 的蓝色染色已被消除，留下亮度变化。因而不能通过现有 filmSimulation 插槽交付“黑白照片也可染色”的完整分级。

OCIO 路径还存在独立的色域边界：`clutstore.cc::OCIO_init` 使用 `init_matrices("ACESp0")`，`OCIO_apply` 将工作 RGB 除以 65535，转入 ACES AP0，再调用处理器，最后转回工作空间。它没有替 VIDEO 模式做传递函数转换；现有文件入口只接受 `.clf` / `.clfz`。CaptRAW 当前构建显式 `ENABLE_OCIO=OFF`，因此有这段上游代码并不表示安装核心已具备 OCIO 运行支持。

由当前证据确定接入边界，而非宣称算法已选定：

- 完整分级须在黑白转换之后、预览锐化及输出 ICC 转换之前提供独立入口，让适屏、详细区域和完整输出共用。
- 输入与输出继续使用 ART 的浮点工作 RGB；分级所需的色域 / 传递函数转换必须显式、成对实现。不能先转成 8 位 sRGB，也不能把线性 AP0 当作 VIDEO RGB。
- 全部中性设置直接旁路；彩色与灰阶都必须保持原结果。旧配方不增加隐式处理。
- 先确定共同明度权重、染色与明度的先后关系、超范围值和色域策略，再接 Web 色轮。不能用零值旁路掩盖“一端有色、另一端零饱和度却使原色褪色”的问题。

## 可复跑证据

### 开发核心的后置分级接入

`native/grading.cc` 在共享 Stage 3 的黑白转换后、预览锐化与输出 ICC 前运行，适屏、1:1 和独立导出使用同一实现。复用 ART 自带 `Color::hsl2rgb` 及 `ICCStore` 工作矩阵，没有引入 darktable / OCIO 运行库。范围权重与染色适配保持前述实验语义；更换 HSL 原语不代表 Adobe 算法。全中性参数在任何颜色空间转换前旁路。

`adjustments.colorGrading` 是四组 hue / saturation / luminance 与 blending / balance 的控件投影；实际参数保存在完整 ART 配置的 `[CaptRAW Color Grading]`，独立 Version=1，14 个数值。省略字段时沿用载入的完整配置，显式默认值清除分级；只有色相 / 混合 / 平衡非默认、但无染色或明度时仍保持原像素。完整与部分配置均校验版本、长度、范围、有限值。旧配方默认旁路；引擎 14 的宿主继续接受引擎 13 及更早配方和原基线。

原生验收在禁网、禁止 Homebrew 读取下完成，未显示窗口：

- 灰阶输入的默认配置文本与预览哈希匹配已安装 0.16；缺省与中性分级不改像素。
- 四色轮实际 TIFF16 最大变化分别为 8,541 / 22,864 / 8,541 / 22,864，染色的黑白端点与原输出最大差 0 / 0 / 1 / 1（RGB16）。
- 黑白后染色保留；完整配置跨进程导出逐像素一致；复位、继承参数变化均触发正确缓存刷新。非法 JSON / 原生字段被拒绝。
- Nikon D850 NEF、Canon R5 CR3、Fujifilm X-T4 RAF 的 512×384 原生 1:1 与独立 TIFF16 量化到 RGB8 后最大差均为 **0**，ICC 为 sRGB、源哈希不变。
- 同一修改版 ART 的 CLI 读取部分配置后，灰阶黑白染色与三种 RAW 输出都与协议核心 TIFF16 完全一致。该对照验证接入和配置传递，两个入口共享算法，不是独立画质参考。CLI 使用随包库与私有配置，同样禁网并禁止 Homebrew 读取。
- 新补丁可应用于固定原始源码并重复应用而不改变结果。`artifacts/color-grading-integration/` 保留报告、配置、TIFF、PNG、日志与哈希；`patch-audit.json` 是补丁证据。

上述是原生接入证据；0.17 的 Web 色轮与安装版验证另列于下。肤色 / 饱和色 / 宽色域质量门槛未解除。

```sh
npm run build:native
node scripts/bundle-native.mjs
CAPTRAW_ENGINE="$PWD/build/bundle/native/captraw-engine" CAPTRAW_RESOURCES="$PWD/build/bundle/native/resources" CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/color-grading-integration.mjs
build/qa-venv/bin/python tests/inspect-color-grading-integration.py
```

该测试使用已有三种公开 RAW 及前述顺序实验的灰阶输入；生成的 CLI 副本位于 `build/grading-reference/`，只引用候选 bundle 的资源和动态库。原安装版与发布归档不变。

### 0.17 安装版 Web 色轮

三轮总览按中间调在上、阴影 / 高光在下排列，提供单轮与全局视图。每轮有独立 H/S/L，混合和平衡只在三分区视图显示。Shift 锁定色相，⌘ / Ctrl 锁定饱和度，Option / Alt 微调；一次拖动只记一步历史，Escape 取消。方向键调整，双击只复位 H/S、保留明度；菜单支持复制 / 粘贴此轮、复位此轮 / 三轮 / 全部。三轮复位保留全局和混合 / 平衡。尚无按住旁路、混合强度辅助预览。

从 DMG 隐藏挂载安装至 `~/Applications/CaptRAW-0.17.app`，未显示应用窗口。13 项安装版 E2E 检查通过，包括旧 0.16 配方像素不变、真实拖动、修饰键、独立历史、取消、复制粘贴、复位、模式隔离、中文 / 空格路径、跨进程恢复、小窗口与 RAW 导出。后台截图确认控件可见；全部窗口不可见、不可聚焦，原生对话框由测试提供响应。这不是可见窗口人工验收。

D850 的桌面完整 TIFF 与独立安装核心输出逐像素相同，实际为 uint16、含 sRGB ICC；1528×998 的真正 1:1 PNG 与对应导出区域量化到 RGB8 后最大差 0。源图和旧配方哈希不变。证据为 `artifacts/color-grading-installed-0.17/` 下的 `report.json`、`pixel-report.json`、配方、输出与截图。安装核心 SHA-256 与前述三 RAW 原生测试候选一致；此处没有重新声称独立 ACR 画质验收。

```sh
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.17.app/Contents/MacOS/CaptRAW" CAPTRAW_ENGINE="$HOME/Applications/CaptRAW-0.17.app/Contents/Resources/native/captraw-engine" CAPTRAW_RESOURCES="$HOME/Applications/CaptRAW-0.17.app/Contents/Resources/native/resources" CAPTRAW_GRADING_E2E_OUT=artifacts/color-grading-installed-0.17 node tests/color-grading-e2e.mjs
CAPTRAW_GRADING_E2E_OUT=artifacts/color-grading-installed-0.17 build/qa-venv/bin/python tests/inspect-color-grading-gui.py
```

### 独立算法实验

```sh
CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/color-grading-art.mjs
node tests/color-grading-candidates.mjs
build/qa-venv/bin/python tests/color-grading-darktable.py
build/qa-venv/bin/python tests/color-grading-darktable.py --module splittoning
CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/color-grading-order.mjs
sandbox-exec -f tests/offline-native.sb build/grading-research/ocio-venv/bin/python tests/color-grading-ocio.py
sandbox-exec -f tests/offline-native.sb build/qa-venv/bin/python tests/color-grading-adapter.py
build/qa-venv/bin/python tests/inspect-color-grading-candidates.py
```

需要本项目既有 QA Python 环境（Pillow、NumPy、tifffile）、0.16 安装版，或通过 `CAPTRAW_ENGINE` / `CAPTRAW_RESOURCES` / `CAPTRAW_APP` 指定相应本机构建。RapidRAW 试验首次拉取固定源码和 LICENSE，后续读取校验过的缓存；这不是应用运行依赖。原生试验禁网并禁止 Homebrew 读取。GPU 试验使用共享隐藏窗口启动器，断言不可见、不可聚焦；没有显示应用窗口。

darktable 脚本另需缓存官方 ARM64 DMG、解包后的 `darktable.app` 和对应的源码归档；路径和哈希在脚本中固定。OCIO 脚本另需专用 venv（Python 3.13 ARM64、`opencolorio==2.4.2`、`numpy==2.2.6`），缓存原始 wheel、固定源码及 LICENSE；运行本身禁网。这两个脚本不自动下载或修改系统安装。源码下载地址以表中的固定提交为准，OCIO 文件路径为 `src/OpenColorIO/ops/gradingtone/{GradingTone.cpp,GradingToneOpCPU.cpp}`、`include/OpenColorIO/OpenColorTransforms.h` 及根目录 LICENSE。

分区染色实验另外需要 Apple clang++、已缓存的固定 darktable 源码和 ART 源码、既有 QA Python，以及缓存的 W3C `srgb-reference.mjs` / 来源记录（脚本固定校验 SHA-256）。它在 `build/grading-research/` 生成 C++ / dylib，通过 ctypes 调用原生处理，输出在 `artifacts/color-grading-candidates/adapter/`，不改应用构建配置。数值数组、参数、源码 / 二进制哈希、工作空间误差和图像来源均保存在 `report.json`；新增 `transfer-report.json` 与 `icc-report.json` 记录参考与输出组件测试。

证据位于 `artifacts/color-grading-candidates/`：`art.json`、五组 ARP / TIFF、`rapidraw.json`、`darktable/` 下的八组 XMP / TIFF / 日志及报告、`darktable-splittoning/` 下的九组对应结果、`art-order/` 下的四组 ARP / TIFF、`ocio/` 下的原始浮点数组及报告、汇总 `pixel-report.json`；下载缓存位于 `build/grading-research/`。核心文件校验：

| 文件 | SHA-256 |
|---|---|
| RapidRAW shader | `4830dbc2d62b6b9852359fcc99a60c22ae65636f0032671e8b421dcfc88d4d24` |
| RapidRAW LICENSE | `8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef` |
| darktable colorbalancergb.c | `12e11d05542382d2bd73f1daf3eca10751458403c064b06d301ab9c0a825fb77` |
| darktable splittoning.c | `e0de41b2b849b08cd029f2b2e514e3ffb173b6edcc56ff3e611e1770cd4e3a78` |
| darktable 5.6.2 ARM64 DMG | `6ff88e58a2a59cb07b0a1502fea7205e68cd783380a33a3ce7bda68ec29def0c` |
| OCIO 2.4.2 CPython 3.13 ARM64 wheel | `d5c3b7d56907a74ac5cf488b27748910053d9076d2366a72fc06bd821d5325b0` |
| OCIO GradingToneOpCPU.cpp | `6c88c177b7763b0c37253c33986d36031898aab14b7e6bfeeda196bd91f8d0d5` |
| OCIO LICENSE | `82a40c52065ee968aa62015735e84378ac11425db7a233e6a2dcd2c83fc24276` |

ART、darktable 固定文件标注 GPL-3.0-or-later；RapidRAW 仓库 LICENSE 为 AGPL v3 文本；OCIO 固定文件标注 BSD-3-Clause。此次未将下载的候选代码编入 CaptRAW、复制进产品源码或改变产品许可证。只有研究环境运行候选 CPU / GPU 实现。

## 仍未解决

最终分级算法尚未选定。ART / RapidRAW / darktable 的直接控件映射已被当前证据排除；OCIO 通过部分数值门槛，但尚无完整 ACR 分级语义。新适配已完成真实 ART 后置处理、独立原生配置和三种 RAW 的 1:1 / TIFF16 接入验证。仍须解决宽色域 / 感知明度策略、肤色与饱和色质量，完整 ACR 操作方式和感知质量验收。0.17 的 Web 控件与本地安装原型不代表分级算法已达到 ACR 同级。
