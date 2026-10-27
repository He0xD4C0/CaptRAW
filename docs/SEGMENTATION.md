# 本地对象分割：部署与接入

2026-10-27。前述研究已在 **0.29 接入本地对象点选工作流，0.30 增加框选**，详见下节；历史章节继续保留当时验证边界。

下文早期部分记录基于安装版 0.25 的独立研究探针，**不是对象分割的安装版功能验收，也不是 ACR 画质对齐结论**。后续 0.26 修复下述外部蒙版失败路径，没有加入对象、主体、天空或人物部位按钮。之前的关闭文件、蒙版、曲线及 Nikon 支持交付保持不变。

## 候选与开放性

| 组件 | 固定来源 | 核查结论 |
|---|---|---|
| SAM 2.1 Tiny / Small | [SAM 2 提交 2b90b9f](https://github.com/facebookresearch/sam2/tree/2b90b9f5ceec907a1c18123530e92e794ad901a4) | README 明确代码、训练代码和模型权重为 Apache 2.0；本次权重来自其官方 checkpoint 地址。可进入本项目候选。CPU 未使用可选 CUDA 连通域实现；该实现另有 BSD-3-Clause 许可 |
| ONNX 导出代码 | [ONNX Runtime v1.30.0 SAM2 工具](https://github.com/microsoft/onnxruntime/tree/v1.30.0/onnxruntime/python/tools/transformers/models/sam2) | MIT；复用未修改的编码器 / 解码器导出函数。原命令的配置查找仍针对旧 SAM2 布局，因此探针显式用官方 SAM2.1 builder 加载，不改模型计算代码 |
| ONNX Runtime C++ | [v1.30.0](https://github.com/microsoft/onnxruntime/releases/tag/v1.30.0) | MIT；官方 macOS ARM64 发布包实测，归档 SHA-256 与 GitHub release digest 一致。禁用遥测，在禁网 / Homebrew 禁读环境运行。其他平台只有上游支持信息，没有 CaptRAW 实机验收 |
| SAM 3 | [官方 LICENSE](https://github.com/facebookresearch/sam3/blob/main/LICENSE) | 自定义 SAM License 1.b.iv 限制逆向工程等行为；与本项目完全开源要求不符，本轮不采用，也未下载权重 |

原始归档、checkpoint 和导出代码的 URL / SHA-256 固定在 `tests/segmentation-sources.json`；转换后的 ONNX 文件哈希在 `artifacts/segmentation/{tiny,small}-report.json`。转换不改变权重原许可，后续分发须同时附上 Apache / MIT 等适用文本和归属说明。当前生产包没有这些模型或运行库。

训练代码公开，[SA-V](https://github.com/facebookresearch/sam2/tree/2b90b9f5ceec907a1c18123530e92e794ad901a4/sav_dataset) 声明 CC BY 4.0 并提供下载。本轮没有取得、核对整个训练数据组合或复现 checkpoint 训练；不能将权重可修改再分发扩大为完整训练可复现结论。

## 已执行的验证

固定已有 NEF / CR3 / RAF 样本，经安装版 0.25 输出长边 1536 的 sRGB JPEG，源 RAW 校验值不变。以苹果点击、柠檬框选、苹果加排除点、色卡框选、天空正负点组成五种提示。天空案例仍需人工给点，不能称为自动天空识别。全部过程无 GUI 窗口，无照片上传。

1. 用官方 SAM2.1 checkpoint 建模，将编码器和三候选解码器导出 FP32 ONNX。四个模型均通过 ONNX full checker。ORT 对编码器中一个 Concat 的形状元数据产生 lenient-merge 警告；已保留日志，尚未消除该警告。
2. 两个模型各五种提示，与官方 `SAM2ImagePredictor` 比较所有候选掩码。Tiny 最低 IoU 为 0.999986，Small 为 0.999565；这是**转换结果对原模型结果的一致性**，并非相对于真实选区或 ACR 的分割准确率。保留 logits / 评分数值差和所有覆盖图。重复五次解码，选区相同。
3. 独立 C++ 程序加载官方 ORT 动态库；10 个案例在禁网及 Homebrew 禁读环境中，最终选区与 Python ORT 输出逐字节相同。评分存在小于 1e-5 的浮点差异；不是宣称所有浮点中间值逐位相同。这轮原始探针输入是预处理后的张量；后续原生 PNG 输入验证见下节。
4. 三个生成的栅格蒙版直接进入 ART `ExternalMask`，对对应的 RAW 预览 JPEG 施加 +0.75 EV 局部亮度，导出 TIFF16。蒙版外最大差 0，内侧最大响应分别为 13427、15154、10506 / 65535；反选与独立新进程重新打开结果精确一致。此处刻意用同尺寸、零羽化隔离覆盖率，**没有证明完整 RAW 分辨率、旋转裁切、复杂组运算和详细区域已接好**。

| 本机 CPU，8 线程 | Tiny | Small |
|---|---:|---:|
| 编码器 + 解码器 ONNX 总字节 | 126066973 | 154613831 |
| 编码暖运行，三次 / 图 | 374–421 ms | 444–463 ms |
| 后续提示解码，五次 / 案例 | 9.4–12.1 ms | 9.5–9.9 ms |
| 独立 C++ 进程最大 RSS | 1891205120 B | 1920565248 B |

上述是 M4 Pro / 48 GB 的有限样本测量，不是 P95、跨平台承诺或完整交互延迟。两种模型都具备本地部署可行性；当前五个案例不足以确定最终质量档位。编码器固定 1024×1024，低分辨率 logits 为 256×256；视觉上树冠间的细孔等仍有遗漏，也没有验证发丝和半透明物。预测分割不等于 alpha matting，不应把简单羽化称作细节恢复。

## 原生 PNG 输入验证（安装版 0.26 之后的源码工作）

新增 `native/segmentation-input.{h,cc}`：libpng 读取已由显影核心完成方向和色彩转换的、不透明 sRGB RGB8 PNG，再由 ONNX Runtime 生成 1×3×1024×1024 FP32 输入。输入预览上限为 64 MP、每边 65000；这是分割预览接口的内存边界，不改变显影核心的 RAW 支持范围。没有重复应用 ICC、EXIF、裁切或旋转，也不把任意用户 PNG 当作色彩已正确处理的照片。模块尚未链接到安装版应用。

`scripts/export-segmentation-preprocess.py` 生成 577 字节、无权重的确定性 ONNX 图：RGB8 转浮点、NCHW、除以 255、1024 方形抗锯齿双线性缩放、官方 mean / std 归一化。使用 [ONNX Resize opset 18](https://onnx.ai/onnx/operators/onnx__Resize.html#resize-18) 的 half_pixel / antialias / exclude_outside；没有另写插值算法。图 SHA-256 为 `f8e256ddac47dc43ffca34ee3bca58bdbaae7f32ab10369cab119ab4618770b3`。Python / Torch 只用于构建与参考测试，原生执行不依赖它们。

- 24 组输入：既有三个 JPEG 的无损 RGB PNG、安装版核心生成的 NEF / CR3 / RAF 适屏 PNG，以及单像素、细长、放大 / 缩小、恒定色、棋盘、锐利颜色边界、中文路径和 8256×5504 合成图。所有原生张量与相同图的 Python ORT 输出逐位相同。
- **与官方 PyTorch 不是逐位相同。** 锐利颜色边界暴露浮点坐标差异：[ORT](https://github.com/microsoft/onnxruntime/blob/v1.30.0/onnxruntime/core/providers/cpu/tensor/upsamplebase.h) 使用浮点输出 / 输入比例做反向除法；[PyTorch](https://github.com/pytorch/pytorch/blob/v2.7.1/aten/src/ATen/native/UpSample.h) 的尺寸路径直接计算输入 / 输出比例。97 像素示例的对应输入坐标为 63.0141639709 与 63.0141601563。完整测试集最大归一化差为 0.0001356602，等效 RGB8 差为 0.007783502 个色阶。最初 1e-5 绝对阈值在色块边界失败；最终明确采用低于 **1/64 个 RGB8 色阶** 的数值预算，并另行检查实际模型输出。没有把失败隐藏为逐位一致，也没有证明此上界适用于所有图像。
- Tiny / Small 各八次，共 16 次提示分割，与官方 Torch 预处理后输入同一已验证 ONNX 模型的结果比较：选中候选相同，最终二值选区变化像素为 0；评分最大差 8.34465e-7。另保留两种模型的旧 `.f32` 输入回归。测试门槛为选区 IoU > 0.9999、评分差 < 1e-4；这些是实现一致性门槛，**不是物体真实边界准确率**。
- 20 个非法输入 / 提示 / 张量案例明确失败并保留已有输出，涵盖文件缺失 / 截断 / 损坏、灰度 / RGBA / RGB16、尺寸上限、整数溢出、尺寸不符、越界坐标、非法标签与 NaN 张量。
- 将原生程序、两个动态库、Tiny 模型、预处理图和输入复制到项目外的中文临时目录；禁止网络、Homebrew 及整个 CaptRAW 仓库的读取，仍完成 PNG → tensor → 模型 → PNG 蒙版，选区与参考逐像素相同。临时目录由测试结束时回收。运行库采用相对加载路径，没有靠项目内的 Python 环境运行。

本机三个真实适屏 PNG 的读取为 3.1–8.8 ms，图初始化加预处理为 6.5–7.9 ms；45 MP 合成输入为 190.8 ms / 70.8 ms，预处理进程峰值约 1.41 GB。Tiny 八次首次编码为 396–443 ms，Small 为 455–478 ms；模型 Session 初始化另需约 440–493 ms。完整推理进程峰值约 1.96 / 2.00 GB。这些是单次独立进程的实测范围，不能当作交互 P95；常驻进程、特征缓存和取消尚未接入。

证据位于 `artifacts/segmentation-input/`：`engine-inputs.json`、`report.json`、`resize-roundoff.json`、各 `.f32` / 蒙版 / 日志和 `receipt.json`。本批没有更新安装包，0.26 应用、引擎、发布归档及已有生产源码保持不变。没有对象选择 GUI、源图坐标映射、可移植栅格配方或 ACR 分割质量结论。

在已完成上节模型导出、保留安装版 0.26 后复现：

```sh
build/segmentation/venv/bin/python scripts/export-segmentation-preprocess.py
node scripts/build-segmentation-probe.mjs
CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/segmentation-input.mjs
build/segmentation/venv/bin/python tests/segmentation-input.py
```

## 常驻分割进程与主进程调度（未进入安装版）

新增 `native/segmentation.{h,cc}` 与 `segmentation-worker.cc`，构建 `captraw-segment MODEL_DIRECTORY PRIVATE_CACHE_DIRECTORY`。JSON Lines 提供 `predict`、`info`、`close`；诊断写 stderr。该进程不链接 ART、Electron 或显示服务，当前构建限 macOS ARM64。使用固定 SAM2.1 Tiny / Small 的 FP32 ONNX 产物；未决定最终产品的模型档位。

- 模型只初始化一次，内存中只保留一张输入图像的编码特征。`close` 清空特征，保留模型 Session；释放整个推理内存须退出进程。返回三张二值候选 PNG、各自预测评分及建议候选，评分不是经过标注验证的准确率。
- 构建时按 `tests/segmentation-sources.json` 的转换产物哈希生成清单。启动时校验预处理图、编码器与解码器的长度 / SHA-256；校验和加载使用同一份内存数据。此检查证明与清单一致，不代替发布者签名。
- 每个请求包含会话、递增版本、预览路径 / SHA-256、尺寸、点与标签。点使用该输入预览的像素坐标；框角必须成对且有正面积。即使命中缓存，也读取并检查输入文件内容；缺失或变化不能继续使用旧特征。PNG 解码与哈希使用同一份字节。
- `apps/desktop/electron/segmentation.ts` 提供尚未接入主程序的调度器：提交时冻结参数；串行运行，只保留最新待处理请求；过时结果丢弃并清理。明确取消终止独立进程、等待退出、移除私有目录；重试会重新加载模型。旧进程清理不会取消期间新提交的请求。
- 缓存只保留最近一次成功结果的三张候选。文件借用期到下一次成功请求或取消为止；未来接受选区时必须先复制到文档资产，不能直接保存这些临时路径。异常请求不删除上次成功结果；进程异常后重建时清理遗留目录。
- 复用的 `NativeEngine` 增加启动失败时关闭日志流，避免找不到程序时遗留文件描述符；未改变正常显影协议。

离线测试 `tests/segmentation-worker.mjs` 已通过 **14 组**检查：两种模型各八个输入 / 提示案例及重复缓存；非法请求保留状态；不可变参数快照；连续请求合并；编码 / 解码阶段取消；取消期间新请求；异常进程退出重试；缓存输入被修改 / 删除后拒绝、恢复后重试；重复版本；尚未启动的排队取消；模型损坏与程序缺失后的错误和退出。原生进程均禁止网络及 Homebrew 读取，没有启动 Electron 或窗口。

`tests/inspect-segmentation-worker.py` 对全部 **48 张候选**执行独立 Python ONNX 推理比较，变化像素为 0，候选选择一致；这是接入一致性证据，不是语义分割质量或 ACR 画质证据。共享 PNG 模块新增内存输入后，原有 24 组预处理、16 次分割、2 次张量输入回归及 20 个非法输入测试重新通过。所有 E2E 继续使用隐藏窗口启动器；本批原生测试无需窗口。

本机 M4 Pro / 48 GB，固定 1536×1024 输入、Tiny 模型，30 次缓存点选的主进程请求至三张 PNG 返回 P95 为 **17.1 ms**；六次 RSS 采样为 **1.886–1.888 GB**。这不是冷启动时间、完整 GUI 延迟或其他照片 / 机器的性能承诺。常驻内存仍需纳入产品预算，未因仅缓存一张图就宣称低内存。

证据为 `artifacts/segmentation-worker/report.json`、`pixel-report.json`、`receipt.json`、候选 PNG 和日志。构建清单为 `build/segmentation/worker-build.json`。安装版 0.26、原生显影核心、DMG 与历史源码发布包均未替换；本批源码不包含在那些发布包内。对象选择 UI、整图坐标变换、可移植栅格配方、手工修正和质量验收仍未完成。

在前述模型与输入准备完成后复现：

```sh
node scripts/build-segmentation-worker.mjs
node tests/segmentation-worker.mjs
build/segmentation/venv/bin/python tests/inspect-segmentation-worker.py
build/segmentation/venv/bin/python tests/segmentation-input.py
npm run typecheck
npm test
```

## 已证实的接入风险

ART `ExternalMaskManager::apply_mask` 在文件加载失败时返回 false；调用处跳过该选区相乘。0.25 探针刻意使用不存在的文件，实测输出与全图调整完全一致。0.26 在更新、详细预览、compose、保存和导出前解码核验启用资产；同时补齐所有蒙版模块的输出 / 详细区域错误传递，阻止渲染中失败的结果发布。缓存使用文件内容 SHA-256，避免同大小、同时间戳的损坏替换被旧缓存掩盖；恢复后强制重新处理。实现与安装包验证见 [核心边界](ENGINE.md#外部蒙版失败保护026) 和 [验收记录](ACCEPTANCE.md)。此处的旧探针继续固定 0.25 以保留缺陷证据；新测试是 `tests/external-masks.mjs`。

0.28 已将栅格覆盖率接入 CaptRAW 的正式蒙版组件与资产保存；分割推理仍未进入安装版或创建工作流。产品还需共同解决：

- 0.27 已接入通用外部蒙版资产的复制、校验、配方原子发布和离线重开，见 [核心协议](ENGINE.md#配方的蒙版资产027)。0.28 进一步覆盖带源图坐标、尺寸和 SHA-256 的栅格组件及其控件投影，验证旋转、裁切、羽化和画笔运算；对象候选提交入口仍未接入。重开已有资产不依赖模型。
- 记录输入图像坐标系、方向及源文件指纹；旋转、裁切、适屏和 1:1 的同一选区必须一致。模型先在可用全图推理，再映射提示和结果，不能把裁切预览误作整张源图。
- 对象选择的框 / 正负点、候选切换、取消、过时结果丢弃和手工添加 / 减去 / 相交；推理是独立工作进程，不能阻塞显影或 UI。
- 原生预处理、模型文件校验及常驻进程生命周期已按上节限定范围完成验证；仍需正式安装包、可复用显影接口和应用工作流接入，不能把独立推理进程当作产品闭环。
- 增加细边缘、多人、遮挡、发丝、透明物和实际操作成本对照。主体检测、语义天空、人物部位还需额外模型 / 推理链；SAM2 提示分割不能冒充这些能力。

## 复现

准备三个固定 RAW 样本和已安装 0.25；参考 `scripts/fetch-samples.mjs` 及原验收记录。Python 只用于本轮转换、参考与测量，不是拟议安装包运行依赖。

```sh
python3 scripts/prepare-segmentation.py
uv venv --python 3.12 build/segmentation/venv
uv pip install --python build/segmentation/venv/bin/python torch==2.7.1 torchvision==0.22.1 onnxruntime==1.30.0 onnx==1.19.1 hydra-core==1.3.2 numpy==2.2.6 pillow==11.3.0 tqdm==4.67.1 iopath==0.1.10 setuptools==84.2.1
SAM2_BUILD_CUDA=0 uv pip install --python build/segmentation/venv/bin/python --no-deps --no-build-isolation -e build/segmentation/upstream/sam2-2b90b9f5ceec907a1c18123530e92e794ad901a4
CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/segmentation-art.mjs --prepare-inputs
build/segmentation/venv/bin/python tests/segmentation-probe.py --model tiny
build/segmentation/venv/bin/python tests/segmentation-probe.py --model small
node scripts/build-segmentation-probe.mjs
CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/segmentation-art.mjs
build/qa-venv/bin/python tests/inspect-segmentation.py
```

依赖环境完整列表在 `artifacts/segmentation/python-environment.txt`。关键证据为 `downloads.json`、`tiny-report.json`、`small-report.json`、`onnx-checker.json`、`verification.json`、`art/report.json` 和各覆盖图 / C++ 日志。当前源码、生产二进制及发布归档的边界另见 `artifacts/segmentation/receipt.json`。


## 0.29 安装版对象点选

安装包携带 SAM2.1 Small、原生预处理、ONNX Runtime 和许可文件。选择该模型是基于已验证的本机部署与有限样本结果；没有把参数量、内部评分或五个简单物体案例当作优于 Tiny / ACR 的质量证据。不会在用户打开照片时下载模型、启动 Python 或上传照片。

“蒙版 → 选择对象”准备当前图像的未旋转、未裁切 sRGB 快照；点击选中，Option 点击排除，可撤回提示、切换三候选或取消。创建时复制候选资产，然后加入中性栅格蒙版，作为一步历史记录；后续使用已有画笔组运算、羽化和局部调整。原图 / 配方持久化、取消和过期结果边界见 [ENGINE.md](ENGINE.md#本地对象点选029)。

真实 Canon CR3（约 44.6 MP）安装版检查完成点选苹果、候选切换、负点和撤回、创建 / 撤销 / 重做、局部亮度、旋转、保存重启和 TIFF16 输出。候选与提交后的原生覆盖逐像素一致；输出与独立 0.28 引擎读取保存配方的结果逐像素相同。证据见 `artifacts/object-selection-installed-0.29/`。这是接入一致性与局部样本体验证据，不能作为发丝、遮挡、多人、透明物或 ACR 质量验收。

独立宿主流程使用安装包的显影 / 分割程序，在 OS 禁网及 Homebrew 禁读环境通过五组生命周期检查；整套 Electron 在外层 sandbox-exec 下与 Chromium 内层沙盒冲突，未通过启动，没有关闭 Chromium 沙盒。另在 Electron HTTP/HTTPS 全部拦截、并确认外部请求失败后完成安装版 GUI 全流程；两层证据分别记录，不把它称为全应用 OS 禁网测试通过。

0.29 尚缺框选（0.30 已补充）、候选重新推理编辑、自动主体 / 天空 / 背景、人物与部位、边缘细化和语义质量验收。已保存的对象蒙版是可手工修正的栅格组件，不保存模型提示以便重新推理。

### 可重复构建

先按上文安装固定转换环境并运行 `python3 scripts/prepare-segmentation.py`；然后：

```sh
build/segmentation/venv/bin/python tests/segmentation-probe.py --model small --export-only
build/segmentation/venv/bin/python scripts/export-segmentation-preprocess.py
npm run package
```

`package` 先构建 / 打包显影核心，再编译独立分割进程并复制固定 Small 模型。`build-segmentation-worker.mjs` 不再依赖旧安装版或构建研究探针；libpng 来自本次显影核心 bundle。模型缺失、大小或哈希不符时构建失败，不回退到联网下载。Small 三个 ONNX 文件、原生程序 / 库、许可证及依赖清单在 `Resources/segmentation`。训练数据及 Python 虚拟环境不进入安装包。

## 0.30 框选与取消

对象选择可切换点选 / 框选。框选两角映射到未旋转、未裁切的原图归一化坐标，再转为模型像素中心及标签 2、3；允许反向拖动，完成后自动回到点提示。新框替换旧提示，可逐步撤回；框选占两个提示，总数仍限制为 64。提交继续保存原有不可变栅格资产，无新增模型或配方版本。

取消现在先使准备代次失效，覆盖任务尚未分配快照状态的时间段；前端准备前记录照片与编辑快照，关闭、切换或参数变化均使迟到结果失效。验收细节见 [当前记录](ACCEPTANCE.md#030-增量验收)。语义主体 / 天空 / 人物部位、边缘细化和 ACR 画质对照仍未完成。
