# 开源组件与资源

CaptRAW 原型采用 GPL-3.0-or-later；完整条款和上游作者声明见 `LICENSE`。0.29 随包分发本地 SAM2.1 Small 模型与 ONNX Runtime。没有闭源 RAW 解码器或云显影服务。

| 组件 | 用途 | 许可依据 |
|---|---|---|
| Adobe XMP Toolkit SDK v2025.03 | XMP / RDF 读写；固定 `581c41213ddcee1fbc72cbb532531102a6617a25` | BSD-3-Clause；保留 RSA MD5 单文件声明。构建脚本记录源码散列与多语言值保留补丁；系统 Expat 只通过 macOS 系统库调用 |
| ART 1.26.10 / RawTherapee 衍生代码 | RAW 显影、局部处理、输出 | 固定源码中的 `LICENSE.txt`、文件头与 `licenses/`，GPL-3.0-or-later 及单文件声明 |
| ART 中源自 GIMP 的修复代码 | Laplace 取样修复 | `src/engine/ipspot.cc` 保留 GIMP 作者、原始声明和 GPL-3.0-or-later 条款；没有新增运行依赖 |
| ART TextureBoost / NLMeans | 全局 / 蒙版纹理、清晰度与局部亮度降噪 | 固定源码 `iptextureboost.cc`、`ipsmoothing.cc`、`nlmeans.cc` 的 GPL-3.0-or-later 声明；原算法未修改，无新增模型或依赖 |
| ART Tone Equalizer（源自 darktable） | 局部高光、阴影、白色、黑色 | `iptoneequalizer.cc` 保留 Alberto Griggio 与 Aurelien Pierre 的 GPL-3.0-or-later 声明；复用同一算法计算每个区域的明暗增益，无新增依赖 |
| LibRaw Redlamp 分支 `3b20539d3faa766a370e93a529a3b87edffbf0f6` | 本地相机 RAW、Nikon HE / HE★ 解码 | 选择 LGPL-2.1-only；源码双许可及单文件声明不变，保留 LGPL、CDDL、COPYRIGHT、REDLAMP.md |
| Exiv2、FFTW | 元数据、计算 | 各自 GPL 条款，实际版本记录在依赖清单 |
| LittleCMS、libjpeg-turbo、libpng、libtiff、libomp 等 | 色彩、编码、并行 | 逐个收集声明和版本，不将它们统一重新许可为 GPL |
| gtkmm / glibmm / GTK / Cairo 等 | ART CLI 支持代码依赖 | 原库 LGPL / MPL 等条款；不构建或显示 ART 原界面 |
| Electron / Chromium | 桌面容器 | Electron MIT 与 Chromium 完整第三方声明 |
| React、Radix UI、Lucide | Web 交互与图标 | 各包随附许可，生成 `licenses/web-dependencies.json` |
| ART wbpresets.json | 相机白平衡预设 | 随固定 ART 源码提供，文件头注明源于 Darktable；按 ART GPL 源码和各文件声明分发，保留原始头部和来源 |
| ART ICC / DCP / camconst / profiles | 色彩与相机数据 | 随固定 ART 源码分发，保留原资源及作者信息；ICC 标记 Public Domain / Nobody，DCP 各自保留版权字段，不将“有版权”误标为 CC0 |
| Lensfun 数据库 | 光学数据 | 随 Lensfun 分发；实际配方列出 LGPL-3.0、GPL-3.0、CC-BY-3.0 和 Public Domain，保留各部分声明 |
| QA RAW 样本 | 验证解码与画质接入 | raw.pixls.us 的 CC0 样本，来源、模式与校验值在 `tests/fixtures.json`；不装入应用 |

应用内 `Contents/Resources/native/licenses/` 包含 ART / 作者、原生库声明、Homebrew 构建配方、Web 包声明以及 Chromium 声明。`dependency-manifest.json` 是本次构建的实际依赖记录；它不是对未来版本的许可保证。

对应源码：固定 ART 源码包与 SHA-256 由 `scripts/build-native.mjs` 给出；本项目的完整接入、修改和构建脚本随交付源码提供。ART 修改包括：用 CaptRAW 目标替换原桌面目标、固定 LibRaw 链接路径、修正非 SIMD LUT3D 重复局部变量、固定构建版本，以及 `native/patch-art.mjs` 提供的蒙版组件组合、持久化、真实覆盖率回调与详细区域边界接口扩展，以及 X-Trans 尾块同质性范围 / 11 像素边缘补齐和白平衡系数直接按双精度数值列表读取（0.15 修正此前误用曲线校验的错误），以及黑白混色曲线持久化和转换前复用 HSL 的接入（按色度加权保护近中性色）。以及移除修复 Laplace 迭代中的相邻行 OpenMP 读写竞争，保留顺序算法。修正恒等第二曲线模式的保存省略，避免重载时改变处理路径。扩展还包括局部白平衡工作色域矩阵、Nikon 相机构图，以及局部明暗频段持久化与按区域顺序执行的增益计算。0.14 还将原生参数曲线独立持久化并接入已有色调曲线管线，保留两个原有曲线。0.16 将曲线输入直方图的并行计数改为原子增量，避免共享桶丢失像素；通过 ART 原有 HistogramListener 接入显示数据。扩展保留在 GPL 源码中；原版 ART 不识别这些组合字段。LibRaw 分支按固定上游源码构建，没有调用 Nikon 闭源解码库。原生动态库保留为可替换文件，打包脚本提供重链接和重签名路径。各依赖源归档地址和校验值来自实际 Homebrew 配方并记录在清单中。

本地交付附带 ART、LibRaw 原源码归档与 CaptRAW 源码归档。对外分发时应同时提供这些对应源码，并按各依赖条款提供对应版本源码及构建资料；不能只分发应用而丢弃这些材料。

0.33 的 `native/white-balance.cc` 的 Robertson 表与逆投影改编自固定 ART `src/engine/dcp.cc`（Copyright 2012 Oliver Duis，GPL-3.0-or-later），保留文件内声明；相机转换调用原有 DCP 方法，仅扩展访问权限。没有加入 Adobe DNG SDK 运行依赖。独立 QA 使用 Colour Science 0.4.6（BSD-3-Clause），不随安装包分发；自产双光源 DNG 测试数据按 CC0 提供。

0.17 的引擎 14 增加 `native/grading.cc` 与 ART 黑白后的独立分级入口、版本化参数、部分配置选择标记。原生实现调用 ART 已有 HSL 转换和 ICCStore 矩阵，不包含研究缓存中的 darktable HSL 源码，也没有新增 darktable / OCIO 运行依赖。新适配按本项目 GPL-3.0-or-later 提供；不表示复现了 Adobe 算法，Web 交互验收见本项目记录，ACR 画质等效性仍未证实。

0.18 的五种 SDR 输出复用原包中的 `RTv4_sRGB` / `RTv4_Medium` / `RTv4_Large` / `RTv4_DisplayP3` / `RTv4_Rec2020`，ICC 版权字段均为 Public Domain；配置文件保持原字节，来自固定 ART 源码 `data/iccprofiles/output/`。实际色彩转换仍使用 ART / LittleCMS，不新增运行库。

0.27 的蒙版资产清单、内容校验与保存事务使用 Node 内置文件 / 加密接口及现有 ART 蒙版加载器，不增加应用运行库。独立分割研究代码与构建脚本见 `docs/SEGMENTATION.md`；模型权重、ONNX Runtime 与研究虚拟环境不装入本次应用或源码归档。


## 0.29 本地对象点选

SAM2.1 Small 官方 checkpoint（SHA-256 `6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38`）从固定 SAM2 提交 `2b90b9f5ceec907a1c18123530e92e794ad901a4` 转为 FP32 ONNX；使用微软 ONNX Runtime v1.30.0 未修改的 SAM2 导出函数，没有量化或重新训练。SAM2 README 明确模型权重、训练代码与演示代码采用 Apache-2.0。没有分发演示网页字体、SA-V 数据集或可选 CUDA 连通域组件。

ONNX Runtime 官方 macOS ARM64 v1.30.0 动态库采用 MIT，并原样携带其 `ThirdPartyNotices.txt`。libpng 与显影引擎已有包相同，另附许可。包内 `Resources/segmentation/` 携带 `NOTICE.txt`、`licenses/`、固定模型清单与依赖清单；`tests/segmentation-sources.json` 保存上游 URL、原始归档 / checkpoint 及转换产物的校验值。自产预处理图与桥接代码随本项目源码提供。

SAM2 / ORT 源码链接及训练复现限制见 [SEGMENTATION.md](docs/SEGMENTATION.md)。代码、权重和转换产物可本地运行、修改、再分发；这不意味着已验证 checkpoint 的完整训练数据来源或可重训复现。当前用户体验采用 Small，属于已验证可部署的实现选择，不是声称已完成全部模型质量选型或优于其他候选。

0.34 的输入配置文件检查复用 ART DCP 解析器与 Little CMS，未增加 Adobe DNG SDK 依赖。DCP 元数据与独立文件校验补丁不替换原显影算法；用户导入的 DCP / ICC 保存在用户数据目录及其编辑资产中，不随安装包或源码归档分发。`ProfileEmbedPolicy` 仅是资产内声明，不代表完整版权授权。`tests/profile-assets.py` 自产 DCP / ICC 测试输入按 CC0 提供。
