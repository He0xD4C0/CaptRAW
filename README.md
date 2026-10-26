# CaptRAW 0.4

专业 RAW 显影产品原型，为未来 Photoshop 和 Lightroom Classic 替代品提供可独立复用的显影核心。当前交付 macOS Apple Silicon 应用：ART 1.26.10 + Electron + React / TypeScript，全部处理在本机完成。

本批支持真实 RAW、多图会话、全局调色、原照 / 自动 / 相机预设白平衡与 RAW 吸管、RGB 多点样条曲线、八色 HSL、传统降噪、锐化、去朦胧、颗粒、晕影和自动镜头配置；画笔 / 擦除 / 线性 / 径向组成可添加、减去、相交的蒙版组。支持裁切和 90° 旋转、适屏 / 真正的 1:1、撤销重做、对比、保存恢复和关闭文件保护，导出 sRGB JPEG 与带 ICC 的 16 位 TIFF。原始文件和已有 XMP / ARP 不写入。

预览限定 SDR sRGB；Windows / Linux、HDR、Adobe 资产导入、本地 AI、图库及图层系统不属于本批。完成本批不代表完整 ACR 同级。蒙版覆盖层直接取自 ART 局部处理的组合 / 羽化 / 反选覆盖率；控制柄负责编辑当前组件。1:1 按羽化范围扩展处理邻域，避免固定 32 像素边界造成区域差异。完整差距见 [ACR 18.7 能力对齐表](docs/ACR-PARITY.md)。

## 安装与使用

构建产物为 `release/CaptRAW-0.4.0-arm64.dmg`，将应用拖入 Applications，也可直接运行 `release/mac-arm64/CaptRAW.app`。本次依赖瓶装库的最低系统为 **macOS 26.0，ARM64**；其他版本未验收。原型没有 Developer ID 签名和 Apple 公证，本机验收不等于跨机器 Gatekeeper 验收。

打开照片后在右侧折叠面板调整；最右工具栏切换编辑、裁切和蒙版。蒙版面板创建组、添加组件或减去 / 相交，拖动中心移动、端点改变范围；画笔和橡皮擦仅在蒙版模式出现。文件名旁、胶片缩略图和底栏都有关闭入口，未保存时选择保存 / 放弃 / 取消；底栏“完成”保存后关闭。裁切区域内的“完成”结束裁切。1:1 按物理屏幕像素显示，并从核心请求全分辨率区域；拖动可平移。

- `⌘O` 打开；`⌘S` 保存；`⌘W` 关闭；`⌘Z` / `⇧⌘Z` 撤销 / 重做。
- `P` 或 `\` 切换初始显影；按住“按住对比”按钮临时查看。
- `I` 白平衡吸管；可选 5×5 / 11×11 / 25×25 原图像素，在中性灰处单击；`Esc` 退出。自动与预设结果保存为固定的通道系数；手动改色温 / 色调转为自定义。
- `E` 编辑，`M` 蒙版，`K` 新画笔，`⇧K` 添加画笔组件，`G` 线性，`J` 径向，`C` 裁切，`H` 平移，空格临时平移，`R/L` 右 / 左旋转，`Y` 覆盖层，`X` 反选蒙版。
- `[` / `]` 改画笔大小，`⇧[` / `⇧]` 改羽化，按住 Option 临时擦除。实际参数及颜色使用 ART 语义，不能按相同数值复现 ACR。
- 配方使用 `.captraw.json`。重新打开配方恢复完整编辑；默认也识别原片旁的同名配方。0.4 接入精确白平衡系数并保存基线版本；旧版配方维持原有初始显影和对比状态。撤销历史仅存在于当前会话；关闭文件与退出应用均提示未保存更改。
- 默认导出新文件；保存对话框中的覆盖选择才允许替换已有输出。取消或失败保留已有目标文件。

## 构建

需要 Xcode Command Line Tools、ARM64 Node.js 22.12+、npm、CMake、Ninja、pkg-config、Homebrew。固定开源 LibRaw HE 解码分支 `3b20539d3faa766a370e93a529a3b87edffbf0f6` 和 ART 提交 `1e0e12c62e4f329d30bb5624d62a23a663ffbe6b`，源码压缩包有 SHA-256 检查；Web 依赖由 `package-lock.json` 固定。

```sh
brew install cmake ninja pkgconf autoconf automake libtool gtkmm3 exiv2 lensfun libomp nlohmann-json librsvg jpeg-turbo fftw little-cms2
npm ci
npm run build
npm run package
```

如默认 Electron 下载站点不可达，可在构建环境设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`；安装器仍使用 Electron 包内的官方 SHA-256 校验。运行应用不需要网络。

`npm run dev` 启动开发工作台，之前必须构建原生核心。`npm run package` 构建 ARM64 应用和 DMG，收集依赖、重写 Mach-O 加载路径并审计，无需运行时 Homebrew。实际使用的原生库版本、许可证、源地址及加载命令保存在安装包 `Contents/Resources/native/dependency-manifest.json`。构建命令可重复执行；没有声称产物逐字节可复现或不同 Homebrew 版本产生同一二进制。

## 验证

```sh
npm run typecheck
npm test
node scripts/fetch-samples.mjs
uv venv build/qa-venv
uv pip install --python build/qa-venv/bin/python -r tests/requirements.txt
build/qa-venv/bin/python tests/synthetic.py
node tests/white-balance.mjs
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
node tests/acceptance-native.mjs
build/qa-venv/bin/python tests/inspect-acceptance.py
node tests/xtrans-stability.mjs
build/qa-venv/bin/python tests/inspect-xtrans-stability.py
npm run test:e2e
node tests/white-balance-e2e.mjs
build/qa-venv/bin/python tests/inspect-white-balance.py
node tests/mask-overlay-e2e.mjs
node tests/revision-e2e.mjs
node tests/workbench-e2e.mjs
node tests/restart-e2e.mjs
node tests/desktop-consistency.mjs
build/qa-venv/bin/python tests/inspect-desktop.py
```

旧白平衡基线交叉对照测试需要保留 0.3 安装版，默认使用 `~/Applications/CaptRAW-0.3.app`；也可通过 `CAPTRAW_LEGACY_ENGINE` / `CAPTRAW_LEGACY_RESOURCES` 指定。应用运行不依赖旧版本。0.4 修正 X-Trans 旧算法的边缘未初始化读取，历史 X-Trans 配方的边缘输出可能因此改变；该变化与白平衡旧基线保护分别验收。

GUI 测试通过 Playwright 操作真实 Electron 窗口；只有系统文件对话框的返回值由测试提供。使用 `CAPTRAW_APP=/absolute/path/CaptRAW.app/Contents/MacOS/CaptRAW` 对安装后的应用执行 GUI 测试；不依赖开发服务器。`CAPTRAW_ENGINE` 和 `CAPTRAW_RESOURCES` 可将原生验收指向安装包内核心。

Nikon Z5II 的 HE 与 HE★ 已分别验证真实公开样本，均匹配固定上游感光点参考；HE 公开样本及另一张 HE★ 用户样本还与独立 Adobe 参考逐感光点一致。Z9 的 HE 样本也通过 45,705,600 感光点独立参考校验。其余机型及尺寸 / 压缩组合尚未本机验收，不能据此声称全部 Nikon 模式通过。Adobe 转换器只用于独立测试参考，不随应用分发、不参与运行。

固定样本与授权、机型 / 压缩模式、SHA-256 位于 [tests/fixtures.json](tests/fixtures.json)。测试证据输出 `artifacts/`，性能测量基于文件系统已缓存的本机读取，不等于冷磁盘、其他设备或完整画质盲评。结果见 [验收记录](docs/ACCEPTANCE.md)。安装包完成后运行 `node scripts/source-release.mjs`，生成 CaptRAW、固定 ART 与 LibRaw 源码归档及 `release/SHA256SUMS`；源代码和依赖清单应与二进制一并保留。

## 结构

- `native/`：无窗口 C++ 核心库、JSON Lines 进程及 ART 参数适配。
- `apps/desktop/`：Electron 管理本地进程和文件，React 显示 sRGB 预览并提供交互。
- `packages/contracts/`：与 ART / GTK 类型隔离的公共数据结构。
- `scripts/`：源码固定、构建、打包、依赖和样本收集。
- `tests/`：真实文件、像素和窗口工作流检查。

核心接口与持久化约定见 [docs/ENGINE.md](docs/ENGINE.md)。开源说明见 [THIRD_PARTY.md](THIRD_PARTY.md)，项目采用 GPL-3.0-or-later，保留 ART 与 RawTherapee 作者声明。
