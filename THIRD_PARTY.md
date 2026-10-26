# 开源组件与资源

CaptRAW 原型采用 GPL-3.0-or-later；完整条款和上游作者声明见 `LICENSE`。没有随本批分发或调用 AI 模型、闭源 RAW 解码器或云显影服务。

| 组件 | 用途 | 许可依据 |
|---|---|---|
| ART 1.26.10 / RawTherapee 衍生代码 | RAW 显影、局部处理、输出 | 固定源码中的 `LICENSE.txt`、文件头与 `licenses/`，GPL-3.0-or-later 及单文件声明 |
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

对应源码：固定 ART 源码包与 SHA-256 由 `scripts/build-native.mjs` 给出；本项目的完整接入、修改和构建脚本随交付源码提供。ART 修改包括：用 CaptRAW 目标替换原桌面目标、固定 LibRaw 链接路径、修正非 SIMD LUT3D 重复局部变量、固定构建版本，以及 `native/patch-art.mjs` 提供的蒙版组件组合、持久化、真实覆盖率回调与详细区域边界接口扩展，以及 X-Trans 尾块同质性范围 / 11 像素边缘补齐和白平衡系数双精度读取修正。扩展保留在 GPL 源码中；原版 ART 不识别这些组合字段。LibRaw 分支按固定上游源码构建，没有调用 Nikon 闭源解码库。原生动态库保留为可替换文件，打包脚本提供重链接和重签名路径。各依赖源归档地址和校验值来自实际 Homebrew 配方并记录在清单中。

本地交付附带 ART、LibRaw 原源码归档与 CaptRAW 源码归档。对外分发时应同时提供这些对应源码，并按各依赖条款提供对应版本源码及构建资料；不能只分发应用而丢弃这些材料。
