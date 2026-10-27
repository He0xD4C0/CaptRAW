<h1 align="center">
  <img alt="CaptRAW Logo" src="./apps/desktop/src/assets/logo.svg" width="160" height="160" />
  <br>CaptRAW<br>
</h1>
<p align="center">新世代开源 RAW 显像方案</p>


## 安装与使用

构建产物为 `release/CaptRAW-0.34.0-arm64.dmg`，将应用拖入 Applications，也可直接运行 `release/mac-arm64/CaptRAW.app`。本次依赖瓶装库的最低系统为 **macOS 26.0，ARM64**；其他版本未验收。原型使用 ad-hoc 签名，没有 Developer ID 签名和 Apple 公证，本机验收不等于跨机器 Gatekeeper 验收。

打开照片后在右侧折叠面板调整；“曲线 → 参数”控制四个区域，图下三个分界支持鼠标、方向键和数值输入；最右工具栏切换编辑、裁切、修复和蒙版。蒙版面板创建组、添加组件或减去 / 相交，拖动中心移动、端点改变范围；画笔和橡皮擦仅在蒙版模式出现。文件名旁、胶片缩略图和底栏都有关闭入口，未保存时选择保存 / 放弃 / 取消；底栏“完成”保存后关闭。裁切区域内的“完成”结束裁切。1:1 按物理屏幕像素显示，并从核心请求全分辨率区域；拖动可平移。

- `⌘O` 打开；`⌘S` 保存；`⌘W` 关闭；`⌘Z` / `⇧⌘Z` 撤销 / 重做。
- 裁切模式：`X` 切换横竖，`Enter` 完成；拖动边角缩放、框内移动、框外新建。
- `P` 或 `\` 切换初始显影；按住“按住对比”按钮临时查看。
- `I` 白平衡吸管；可选 5×5 / 11×11 / 25×25 原图像素，在中性灰处单击；`Esc` 退出。自动与预设结果保存为固定的通道系数；手动改色温 / 色调转为自定义。
- “配置文件 → 导入 DCP / ICC”将文件复制到本地库；保存 XMP 时随附可校验资产。移动编辑文件须保留 `.xmp.assets` 文件夹。DCP 检查机型限制，控件按实际能力显示；Adobe 名称 / digest 自动匹配仍待验证。
- 全局白平衡使用 Adobe Temperature / Tint 坐标（2000–50000 K，-150–150），由当前相机 DCP / 矩阵转换。XMP 只含其中一项时保留另一项；Adobe 相机配置、自动模式重算与完整像素等效仍待验证，见 [白平衡接口](docs/ENGINE.md#xmp-白平衡坐标033)。
- `⇧L` 新建亮度范围，直接单击或拖框取样；“显示亮度图”切换灰度视图，“亮度取样”重新启用吸管。
- `B` 修复：先单击来源，再单击目标；Option 单击重新取样，拖动两端重定位；Backspace 删除选中点，`[` / `]` 改半径，Shift 配合改羽化。
- `E` 编辑，`M` 蒙版，`K` 新画笔，`⇧K` 添加画笔组件，`G` 线性，`J` 径向，`C` 裁切，`H` 平移，空格临时平移，`R/L` 右 / 左旋转，`Y` 覆盖层，`X` 反选蒙版。
- `[` / `]` 改画笔大小，`⇧[` / `⇧]` 改羽化，按住 Option 临时擦除。实际参数及颜色使用 ART 语义，不能按相同数值复现 ACR。
- 编辑和预设使用 `.xmp`；默认识别原片旁的同名 XMP。当前初始显影基线固定为 4，旧 JSON 格式不读取、不迁移。撤销历史仅存在于当前会话；关闭文件与退出应用均提示未保存更改。Adobe 参数支持范围见 [XMP 接口说明](docs/ENGINE.md#xmp-编辑文档与预设032替代旧文件格式)。
- 默认导出新文件；保存对话框中的覆盖选择才允许替换已有输出。取消或失败保留已有目标文件。

## 构建

需要 Xcode Command Line Tools、ARM64 Node.js 22.13+（CI 固定 22.23.1）、pnpm 11.25.0、CMake、Ninja、pkg-config、Homebrew。固定开源 LibRaw HE 解码分支 `3b20539d3faa766a370e93a529a3b87edffbf0f6` 和 ART 提交 `1e0e12c62e4f329d30bb5624d62a23a663ffbe6b`，源码压缩包有 SHA-256 检查；JavaScript 依赖由 `pnpm-lock.yaml` 固定，工作区由 `pnpm-workspace.yaml` 管理，Turborepo 固定为 2.11.10。

```sh
brew install cmake ninja pkgconf autoconf automake libtool gtkmm3 exiv2 lensfun libomp nlohmann-json librsvg jpeg-turbo fftw little-cms2
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm package
```

如默认 Electron 下载站点不可达，可在构建环境设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`；安装器仍使用 Electron 包内的官方 SHA-256 校验。运行应用不需要网络。

`pnpm dev` 启动开发工作台，之前必须构建原生核心和 XMP worker（`pnpm build`）。开发入口先构建共享包，再监听共享包、Electron bundle 和 Vite；React 与浏览器侧契约更新支持热更新，主进程、preload 或共享服务更新编译后需按终端提示手动重启应用。编译失败时保留当前会话，退出开发流程会回收监听进程。

`pnpm build:ui` 只构建共享包与桌面 JavaScript，产物位于各包的 `dist/` 和 `apps/desktop/dist/`；`pnpm build` 依次构建原生核心、XMP worker 和 UI。`pnpm prepare:electron` 显式准备 Electron 二进制，开发、E2E 和打包入口会调用它；纯 JavaScript 检查无需下载 Electron。安装仅允许 esbuild 的依赖构建脚本，Electron 下载通过上述显式命令执行。

`pnpm package` 构建 ARM64 应用和 DMG，收集依赖、重写 Mach-O 加载路径并审计，无需运行时 Homebrew。打包仍需本机按 [分割文档](docs/SEGMENTATION.md) 准备并校验的模型资产。实际使用的原生库版本、许可证、源地址及加载命令保存在安装包 `Contents/Resources/native/dependency-manifest.json`。构建命令可重复执行；没有声称产物逐字节可复现或不同 Homebrew 版本产生同一二进制。

## 验证

```sh
pnpm ci:check
node scripts/fetch-samples.mjs
uv venv build/qa-venv
uv pip install --python build/qa-venv/bin/python -r tests/requirements.txt
build/qa-venv/bin/python tests/synthetic.py
node tests/xmp-sdk.mjs
node tests/xmp-documents.mjs
pnpm test:e2e
node tests/xmp-e2e.mjs
node tests/revision-e2e.mjs
node tests/workbench-e2e.mjs
node tests/restart-e2e.mjs
node tests/white-balance.mjs
build/qa-venv/bin/python tests/inspect-white-balance.py
node tests/white-balance-e2e.mjs
node tests/desktop-consistency.mjs artifacts/white-balance-gui/switched.xmp artifacts/white-balance-gui/independent.tiff
```

原生和桌面测试需先执行 `pnpm build`；`xmp-e2e` 使用 `xmp-documents` 生成的 Adobe 样本。设定 `CAPTRAW_APP=/绝对路径/CaptRAW.app/Contents/MacOS/CaptRAW` 可测试安装包；`CAPTRAW_ENGINE`、`CAPTRAW_RESOURCES` 和 `CAPTRAW_XMP_BINARY` 指向同一候选包内对应程序与资源。默认入口测试本地构建，不代表已安装应用通过验收。

Nikon 相机构图还需 ExifTool 和 `tests/nikon-he.mjs` 固定样本。`tests/camera-crop.mjs` 使用固定 ART CLI 作为同配方 TIFF 像素对照。历史 GUI 与文档专项已迁移至 XMP、当前处理版本和基线 4，移除旧 JSON 迁移验收；各专项仍需先生成对应夹具。语法迁移通过不表示这些专项已全部在新安装包重跑；旧版验收保留于 [验收记录](docs/ACCEPTANCE.md)。

白平衡独立数值与双光源 DNG 验证（Colour Science 仅作为 QA 参考，不进入产品）：

```sh
cmake --build build/native --target captraw-wb-probe -j 4
uv venv build/wb-reference-venv
uv pip install --python build/wb-reference-venv/bin/python colour-science==0.4.6 tifffile==2026.10.15
build/wb-reference-venv/bin/python tests/white-balance-reference.py
node tests/white-balance-reference.mjs
```

固定样本的授权、机型 / 压缩模式和 SHA-256 位于 [tests/fixtures.json](tests/fixtures.json)。追加 Nikon HE 验收使用 `tests/nikon-he.mjs`；只测试已有且哈希正确的样本可设置 `CAPTRAW_NIKON_CACHED_ONLY=1`。`tests/nikon-adobe-reference.mjs` 使用 Adobe DNG Converter 生成独立参考，转换器不参与产品运行或分发。测试图及参考不进入应用或源码归档。

测试证据输出至 `artifacts/`。历史性能记录不等于冷磁盘、其他设备或完整画质盲评。安装包完成后运行 `node scripts/source-release.mjs`，源码、依赖清单和二进制应一并保留。

## Monorepo 结构

- 根包：产品版本的唯一来源，协调原生 / XMP 构建、验收、打包和源码归档。
- `native/`：无窗口 C++ 核心库、JSON Lines 进程及 ART 参数适配。
- `apps/desktop/`（`@captraw/desktop`）：React 工作台、Electron main / preload 及 Vite 配置。
- `packages/contracts/`（`@captraw/contracts`）：与 ART / GTK 类型隔离的契约、参数校验、导出选项、预设和同步契约。
- `packages/desktop-core/`（`@captraw/desktop-core`）：Node-only 的引擎协议、XMP、文档、蒙版资产、预设、同步、批量导出及对象分割服务。
- `scripts/`：源码固定、构建、打包、依赖和样本收集。
- `tests/`：真实文件、像素和窗口工作流检查。

三个工作区均为私有包，内部依赖使用 `workspace:*`；跨包通过公开包入口引用。共享包输出 ESM JavaScript 与 TypeScript 声明，桌面 bundle 包含内部包代码。Turborepo 按 contracts → desktop-core → desktop 的依赖顺序编排任务；本地 `.turbo/` 只缓存 JavaScript 构建、类型检查和纯 Node 单元测试，原生构建、模型准备、打包与 E2E 每次实际执行。

根测试声明了共享包开发依赖；按 [Turbo 全局哈希规则](https://turborepo.dev/docs/reference/configuration#globaldependencies)，修改这些共享包会使全部 JavaScript 任务失效。仅修改桌面源码时保留共享包缓存。`pnpm test:e2e:performance` 单独检查本机 5 秒首帧预算；`CAPTRAW_RELEASE_DIR` 可将源码归档与校验清单输出到独立发布目录。

## CI

PR 和 `main` 推送执行 Ubuntu 快检，使用 Node 22.23.1、pnpm 11.25.0 冻结安装后运行 `pnpm ci:check`（`turbo run build typecheck test:unit`）；此流程不准备 Electron 二进制。只需 JavaScript 验证时，本机也可执行相同命令，无需 Homebrew 原生依赖。

`v*` 标签或手动触发 macOS smoke，使用 `macos-26` ARM64，安装上述 Homebrew 依赖，执行 `pnpm build`，下载并校验 D850 固定 RAW，再执行 `pnpm test:e2e`。E2E 入口准备 Electron 与 UI，并运行后台 `tests/e2e.mjs`，覆盖开图、曝光 / 蒙版编辑、保存 XMP、导出 TIFF 和恢复配方。功能等待期限为 60 秒，首帧耗时写入报告；本机性能门槛单独验收。

原生构建默认并行度为 8，可通过 `CAPTRAW_BUILD_JOBS` 设置；macOS CI 使用 2，限制托管 runner 的编译内存占用。

两个工作流只缓存 pnpm store 与 `.turbo/`，缓存键包含 OS、架构、Node / pnpm 版本、lockfile 哈希及 commit，并仅恢复相同 lockfile 前缀。macOS 无论成功或失败均尝试上传 `artifacts/monorepo/e2e/**` 下的报告、截图和日志；启动或构建失败时可能尚无截图。CI 不构建 DMG、不发布 Release，也不配置外部远程缓存。后台 smoke、安装包验收及可见窗口人工验收各自记录，工作流配置本身不代表远端已执行成功。

核心接口与持久化约定见 [docs/ENGINE.md](docs/ENGINE.md)。开源说明见 [THIRD_PARTY.md](THIRD_PARTY.md)，项目采用 GPL-3.0-or-later，保留 ART 与 RawTherapee 作者声明。

所有 `tests/*e2e.mjs` 默认使用隐藏且不可聚焦的 Electron 窗口，通过 `CAPTRAW_E2E_BACKGROUND=1` 保持后台渲染，不弹窗或抢占焦点。共享启动器在运行前拒绝不支持该模式的旧安装包，并验证窗口实际隐藏。后台控件、截图和像素检查不代表用户已完成可见窗口人工验收；正常启动应用仍显示工作台。
