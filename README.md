<h1 align="center">
  <br>CaptRAW<br>
</h1>

## 安装与使用

构建产物为 `release/CaptRAW-0.31.0-arm64.dmg`，将应用拖入 Applications，也可直接运行 `release/mac-arm64/CaptRAW.app`。本次依赖瓶装库的最低系统为 **macOS 26.0，ARM64**；其他版本未验收。原型没有 Developer ID 签名和 Apple 公证，本机验收不等于跨机器 Gatekeeper 验收。

打开照片后在右侧折叠面板调整；“曲线 → 参数”控制四个区域，图下三个分界支持鼠标、方向键和数值输入；最右工具栏切换编辑、裁切、修复和蒙版。蒙版面板创建组、添加组件或减去 / 相交，拖动中心移动、端点改变范围；画笔和橡皮擦仅在蒙版模式出现。文件名旁、胶片缩略图和底栏都有关闭入口，未保存时选择保存 / 放弃 / 取消；底栏“完成”保存后关闭。裁切区域内的“完成”结束裁切。1:1 按物理屏幕像素显示，并从核心请求全分辨率区域；拖动可平移。

- `⌘O` 打开；`⌘S` 保存；`⌘W` 关闭；`⌘Z` / `⇧⌘Z` 撤销 / 重做。
- 裁切模式：`X` 切换横竖，`Enter` 完成；拖动边角缩放、框内移动、框外新建。
- `P` 或 `\` 切换初始显影；按住“按住对比”按钮临时查看。
- `I` 白平衡吸管；可选 5×5 / 11×11 / 25×25 原图像素，在中性灰处单击；`Esc` 退出。自动与预设结果保存为固定的通道系数；手动改色温 / 色调转为自定义。
- `⇧L` 新建亮度范围，直接单击或拖框取样；“显示亮度图”切换灰度视图，“亮度取样”重新启用吸管。
- `B` 修复：先单击来源，再单击目标；Option 单击重新取样，拖动两端重定位；Backspace 删除选中点，`[` / `]` 改半径，Shift 配合改羽化。
- `E` 编辑，`M` 蒙版，`K` 新画笔，`⇧K` 添加画笔组件，`G` 线性，`J` 径向，`C` 裁切，`H` 平移，空格临时平移，`R/L` 右 / 左旋转，`Y` 覆盖层，`X` 反选蒙版。
- `[` / `]` 改画笔大小，`⇧[` / `⇧]` 改羽化，按住 Option 临时擦除。实际参数及颜色使用 ART 语义，不能按相同数值复现 ACR。
- 配方使用 `.captraw.json`。重新打开配方恢复完整编辑；默认也识别原片旁的同名配方。0.4 接入精确白平衡系数并保存基线版本；旧版配方维持原有初始显影和对比状态。撤销历史仅存在于当前会话；关闭文件与退出应用均提示未保存更改。
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
pnpm typecheck
pnpm test
node scripts/fetch-samples.mjs
# 只下载并校验 D850；不传 --only 时仍处理完整固定清单，未知名称直接报错：
node scripts/fetch-samples.mjs --only nikon-d850.NEF
uv venv build/qa-venv
uv pip install --python build/qa-venv/bin/python -r tests/requirements.txt
build/qa-venv/bin/python tests/synthetic.py
node tests/white-balance.mjs
node tests/input-profiles.mjs
node tests/black-white.mjs
node tests/repair.mjs
node tests/local-details.mjs
node tests/local-white-balance.mjs
node tests/local-tone.mjs
node tests/global-details.mjs
build/qa-venv/bin/python tests/inspect-global-details.py
build/qa-venv/bin/python tests/inspect-local-tone.py
build/qa-venv/bin/python tests/inspect-local-white-balance.py
build/qa-venv/bin/python tests/inspect-local-details.py
build/qa-venv/bin/python tests/inspect-repair.py
node tests/curve-conformance.mjs
node tests/core-regression.mjs
build/qa-venv/bin/python tests/inspect-regression.py
node tests/mask-preview.mjs
build/qa-venv/bin/python tests/inspect-mask-preview.py
node tests/mask-groups.mjs
build/qa-venv/bin/python tests/inspect-mask-groups.py
node tests/extended-controls.mjs
# HE 全清单需要额外下载；只验收已有且哈希正确的样本：
CAPTRAW_NIKON_CACHED_ONLY=1 node tests/nikon-he.mjs
# 相机构图测试还需 ExifTool、上述 Nikon 样本与保留的 0.8 安装核心：
node tests/camera-crop.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.13.app/Contents/MacOS/CaptRAW" node tests/camera-crop-e2e.mjs
node tests/acceptance-native.mjs
build/qa-venv/bin/python tests/inspect-acceptance.py
node tests/xtrans-stability.mjs
build/qa-venv/bin/python tests/inspect-xtrans-stability.py
pnpm test:e2e
node tests/white-balance-e2e.mjs
build/qa-venv/bin/python tests/inspect-white-balance.py
node tests/input-profiles-e2e.mjs
build/qa-venv/bin/python tests/inspect-input-profiles.py
node tests/black-white-e2e.mjs
node tests/repair-e2e.mjs
node tests/local-details-e2e.mjs
node tests/local-white-balance-e2e.mjs
node tests/local-tone-e2e.mjs
node tests/global-details-e2e.mjs
# 裁切工作流使用上一步 local-tone-e2e 生成的 RAW 配方；原生对照需保留 0.12 安装核心。
node tests/crop-workflow-e2e.mjs
node tests/crop-workflow.mjs
build/qa-venv/bin/python tests/inspect-crop-workflow.py
node tests/desktop-consistency.mjs artifacts/global-details-gui/global.captraw.json artifacts/global-details/desktop-independent.tiff
node tests/desktop-consistency.mjs artifacts/local-tone-gui/local.captraw.json artifacts/local-tone/desktop-independent.tiff
build/qa-venv/bin/python tests/inspect-local-tone.py
node tests/desktop-consistency.mjs artifacts/local-white-balance-gui/local.captraw.json artifacts/local-white-balance/desktop-independent.tiff
build/qa-venv/bin/python tests/inspect-local-white-balance.py
node tests/desktop-consistency.mjs artifacts/local-details-gui/local.captraw.json artifacts/local-details/desktop-independent.tiff
build/qa-venv/bin/python tests/inspect-local-details.py
node tests/desktop-consistency.mjs artifacts/repair-gui/repaired.captraw.json artifacts/repair/desktop-independent.tiff
build/qa-venv/bin/python tests/inspect-repair.py
node tests/desktop-consistency.mjs artifacts/black-white-gui/mixed.captraw.json artifacts/black-white/desktop-independent.tiff
build/qa-venv/bin/python tests/inspect-black-white.py
node tests/mask-overlay-e2e.mjs
node tests/revision-e2e.mjs
node tests/workbench-e2e.mjs
node tests/restart-e2e.mjs
node tests/desktop-consistency.mjs
build/qa-venv/bin/python tests/inspect-desktop.py
```

旧白平衡基线交叉对照测试需要保留 0.3 安装版，默认使用 `~/Applications/CaptRAW-0.3.app`；也可通过 `CAPTRAW_LEGACY_ENGINE` / `CAPTRAW_LEGACY_RESOURCES` 指定。应用运行不依赖旧版本。0.4 修正 X-Trans 旧算法的边缘未初始化读取，历史 X-Trans 配方的边缘输出可能因此改变；该变化与白平衡旧基线保护分别验收。

输入配置文件的默认显影交叉对照测试使用 `~/Applications/CaptRAW-0.4.app`，可通过 `CAPTRAW_PROFILE_LEGACY_ENGINE` / `CAPTRAW_PROFILE_LEGACY_RESOURCES` 指定其他保留的 0.4 核心。仅测试需要旧版，应用不依赖它。

黑白测试的旧版交叉对照使用 `~/Applications/CaptRAW-0.5.app`，可通过 `CAPTRAW_BW_LEGACY_ENGINE` / `CAPTRAW_BW_LEGACY_RESOURCES` 指定；同样仅用于测试。`CaptRAWLuminanceCurve` 是本项目的 ART 扩展，原版 ART 和旧核心不会执行它，旧宿主会拒绝新版本配方。

修复回归以保留的 `~/Applications/CaptRAW-0.6.app` 比较中性参数和旧单线程输出；旧版只用于测试。修复算法现在有确定的迭代顺序，含旧修复参数的历史配方可能与此前多线程输出略有差异。

局部细节回归使用保留的 `~/Applications/CaptRAW-0.7.app` 比较旧蒙版及中性参数；仅测试依赖旧版。独立原生纹理 / 平滑设置会保留，只有本项目带标记的区域随蒙版更新；若旧配方存在停用但非中性的独立设置，新局部细节会明确拒绝合并，避免激活隐藏处理。

局部明暗的中性和已有全局明暗兼容测试使用保留的 `~/Applications/CaptRAW-0.10.app` 原生核心；零值不会启用新处理或保存新频段字段。

局部白平衡中性兼容测试使用保留的 `~/Applications/CaptRAW-0.9.app` 原生核心，仅测试依赖旧版；不运行旧版窗口。

GUI 测试通过 Playwright 操作真实、隐藏的 Electron 窗口；原生对话框由测试显式提供响应，迟到结果等故障场景使用标明的受控注入。正常显影、取样和导出调用包内核心。使用 `CAPTRAW_APP=/absolute/path/CaptRAW.app/Contents/MacOS/CaptRAW` 对安装后的应用执行 GUI 测试；不依赖开发服务器。`CAPTRAW_ENGINE` 和 `CAPTRAW_RESOURCES` 可将原生验收指向安装包内核心。

0.9 安装版已完成 29 / 29 Nikon HE / HE★ 固定样本的包内解码、独立 Adobe 感光点对照和后台界面工作流，覆盖六种机型的清单所列模式。0.13 沿用相同解码库，本批未重新运行全部 29 项；不能据此推及所有固件或模式。Adobe 转换器仅作独立测试参考，不随产品分发、不参与运行。

追加 Nikon 验收使用 `tests/nikon-he.mjs` 的完整清单：下载保留 `.part`、校验后才转为 NEF；单项失败会记录并继续其余项。`CAPTRAW_NIKON_OUT` 可把追加结果与已发布证据分开。指定安装版资源时，感光点工具直接链接包内 LibRaw，并与核心同样接受禁网 / 禁 Homebrew 约束；不再用开发库代替分发库。

`tests/nikon-adobe-reference.mjs` 对已完整下载的样本生成独立 Adobe DNG Converter 参考，再由开源库逐感光点比较；转换器只作为本机测试工具，不参与产品运行或分发。`tests/nikon-he-e2e.mjs` 在安装版逐个验证可见预览、曝光变化、保存和源哈希。最终 0.9 记录见 `artifacts/nikon-he-0.9/`、`nikon-he-independent/` 和 `nikon-he-gui-0.9/`。其中一张 Fenny 的 Z6III 样本为 CC BY-SA 4.0，其余遵循固定清单的 CC0 声明，测试图及参考不进入应用或源码归档。

固定样本与授权、机型 / 压缩模式、SHA-256 位于 [tests/fixtures.json](tests/fixtures.json)。测试证据输出 `artifacts/`，性能测量基于文件系统已缓存的本机读取，不等于冷磁盘、其他设备或完整画质盲评。结果见 [验收记录](docs/ACCEPTANCE.md)。安装包完成后运行 `node scripts/source-release.mjs`，生成 CaptRAW、固定 ART 与 LibRaw 源码归档及 `release/SHA256SUMS`；源代码和依赖清单应与二进制一并保留。

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

参数曲线验证（安装后的应用仍全程隐藏）：

```sh
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.14.app/Contents/MacOS/CaptRAW" node tests/parametric-curve-e2e.mjs
CAPTRAW_ENGINE="$HOME/Applications/CaptRAW-0.14.app/Contents/Resources/native/captraw-engine" CAPTRAW_RESOURCES="$HOME/Applications/CaptRAW-0.14.app/Contents/Resources/native/resources" CAPTRAW_SANDBOX_PROFILE="$PWD/tests/offline-native.sb" node tests/parametric-curve.mjs
build/qa-venv/bin/python tests/inspect-parametric-curve.py
```

上述测试复用固定三种 RAW、`tests/synthetic.py` 生成的明暗样本、0.13 安装核心以及 `artifacts/crop-workflow-gui/durable.captraw.json` 的裁切迁移样本。
