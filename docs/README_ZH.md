<h1 align="center">
  <img alt="CaptRAW Logo" src="../assets/branding/logo.svg" width="160" height="160" />
  <br>CaptRAW<br>
</h1>
<p align="center">macOS 上的开源 RAW 显像工作台</p>

<p align="center">
  <a href="../LICENSE">GPL-3.0-or-later</a> ·
  <a href="CONTRIBUTING_ZH.md">贡献指南</a> ·
  <a href="../CODE_OF_CONDUCT.md">贡献者公约</a> ·
  <a href="SECURITY_ZH.md">安全策略</a> ·
  <a href="GOVERNANCE_ZH.md">治理章程</a>
</p>

> Find [English Version](../README.md) here.

CaptRAW 使用本地原生核心处理 RAW，提供非破坏编辑、多图会话、蒙版、几何校正、预设、比较和高质量导出。照片与编辑配方保留在本机，产品运行不依赖云服务或网络。

## 当前状态

| 对象 | 版本 | 状态 |
|---|---|---|
| 已发布安装基线 | 0.64 | 已登记 DMG、源码归档和验收身份 |
| 安装体验候选 | `0.66.0-beta.1`／`febb036106312f9b` | 可信色彩链路与冻结范围内的 macOS 摄影工作流已交付；完整 ACR 替代仍属后续目标 |

当前施工与验收范围以 [macOS 收尾账本](CLOSEOUT.md) 为准。安装、签名、哈希与既有验收记录见 [验收记录](ACCEPTANCE.md)。旧对齐研究和历史验收仅作追溯。

当前验收平台为 **macOS 26.0+ / Apple Silicon**。Windows 和 Linux 尚未实现原生构建与产品验收，平台边界见 [适配说明](PLATFORMS.md)。

### 安装版与源码的格式差异

| 项目 | 已发布 0.64 | 当前 0.66 源码 |
|---|---|---|
| 编辑旁车 | CaptRAW XMP | `.captraw` |
| Adobe XMP | 读取和写回 | 仅作为导入来源，不覆盖源文件 |
| 用户预设 | `.xmp` | `.captrawpreset` |
| 原片 | 不写入 | 不写入 |

`.captraw` 使用带类型和版本的 JSON 容器，不读取历史旧 JSON 编辑格式。Adobe 设置导入后需要用户确认；不支持或有歧义的字段会明确提示。具体接口见 [引擎文档](ENGINE.md)。

## 功能

- 本地 RAW 显影：白平衡、曝光、曲线、HSL、颜色分级、细节、镜头与输出色彩配置，并提供受管理浮点 Display P3 SDR 监看。
- 多图工作流：胶片条、网格、多选、同步、逐图撤销、批量保存与导出。
- 蒙版与修复：画笔、线性与径向渐变、颜色 / 亮度范围、对象与人物部位选择、局部调整和修复点。
- 几何校正：裁切、旋转、拉直、透视、引导线和镜头校正。
- 预设与比较：预设强度、悬停预览、收藏、前后比较和多种分割对比。
- 输出：带 ICC 的 JPEG、16 位 TIFF 和目标色域 proof 预览，以及当前源码中的实验性 HDR AVIF。

算法允许采用与 Adobe Camera Raw 不同的实现，不承诺同参数、同函数或同像素结果。HDR 和其余 ACR 对照边界见 [HDR 文档](HDR.md)、[色彩分类](COLOR-GRADING.md) 和 [ACR 对齐记录](ACR-PARITY.md)。

## 安装与使用

安装体验候选：[CaptRAW 0.66.0-beta.1](https://github.com/He0xD4C0/CaptRAW/releases/tag/v0.66.0-beta.1)。本机副本为 `~/Applications/CaptRAW-0.66.0-beta.1.app`。稳定安装基线 `../release/CaptRAW-0.64.0-arm64.dmg` 和 `~/Applications/CaptRAW-0.64.app` 保留。

0.64 和 0.66 使用 ad-hoc 签名，没有 Developer ID 签名和 Apple 公证。本机安装通过不代表其他机器的 Gatekeeper。`0.66.0-beta.1` 完成本轮批准的 macOS 色彩与工作流范围，不宣称完整 ACR 同级。

当前源码的主要菜单入口：

| 操作 | 快捷键 |
|---|---|
| 打开照片 | `⌘O` |
| 保存 CaptRAW 编辑 | `⇧⌘S` |
| 打开导出设置 | `⌘S` |
| 关闭当前照片 | `⌘W` |
| 撤销 / 重做 | `⌘Z` / `⇧⌘Z` |
| 适屏 / 1:1 | `⌘0` / `⌥⌘0` |

打开照片后在右侧调整面板编辑。保存时默认在原片旁写入完整文件名加 `.captraw`；带蒙版等外部资产时还需保留对应的 `.captraw.assets` 文件夹。关闭文件或退出应用前，未保存编辑会触发确认。

各工具的操作方式和快捷键可能随当前源码变化。发布版行为以对应安装包内的菜单和界面为准；当前源码的工作流检查见 `tests/e2e/`。

## 构建

构建需要 Xcode Command Line Tools、ARM64 Node.js 22.13+、pnpm 11.25.0、CMake、Ninja、pkg-config 和 Homebrew。CI 固定 Node.js 22.23.1。

```sh
brew install cmake ninja pkgconf autoconf automake libtool gtkmm3 exiv2 lensfun libomp nlohmann-json librsvg jpeg-turbo fftw little-cms2 aom
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` 通过 Turbo 协调 contracts、原生核心、XMP worker 和桌面界面，并校验版本与产物。原生构建固定 ART 提交 `1e0e12c62e4f329d30bb5624d62a23a663ffbe6b` 和 LibRaw HE 分支 `3b20539d3faa766a370e93a529a3b87edffbf0f6`；JavaScript 依赖由 `pnpm-lock.yaml` 固定。

```sh
pnpm dev      # 启动开发工作台
pnpm build:ui # 只构建共享包和桌面 JavaScript
pnpm package  # 构建当前源码的 ARM64 应用和 DMG
```

`pnpm dev` 要求原生核心和 XMP worker 已经构建。打包前还需按 [分割模型说明](SEGMENTATION.md) 准备并校验本地模型资产。安装后的产品不依赖 Homebrew、FFmpeg 或 Python。

HDR AVIF 构建接受 AOM 3.15.0 或 3.15.2 与 libavif 1.4.2，并记录实际安装版本及对应源码 revision。变更 Homebrew 依赖后，应先增加并核对已知固定项再构建。若 Electron 下载站点不可达，可在构建环境设置 `ELECTRON_MIRROR`；安装器仍校验 Electron 包内的摘要。

## 验证

基础检查和单元测试：

```sh
pnpm ci:check
pnpm test:unit
```

安装级和 E2E 结果必须绑定候选构建：

```sh
pnpm candidate:build
CAPTRAW_CANDIDATE=<candidate-id> pnpm test:gate macos-smoke
```

直接调试可运行 `pnpm test:e2e:dev`，结果会标记为未经候选验证，不能登记为安装验收。测试按层级和功能域组织，完整入口、夹具和环境变量见 [测试目录](../tests/README.md) 与 [suite 清单](../tests/suites.json)。

后台 E2E 使用隐藏且不可聚焦的 Electron 窗口。控件、截图和像素检查通过，不等于用户已完成可见窗口、跨机器安装或 Gatekeeper 验收。测试证据写入 `artifacts/`；固定样本的授权和 SHA-256 见 [fixtures 清单](../tests/fixtures/fixtures.json)。

## 仓库结构

| 路径 | 职责 |
|---|---|
| `native/` | 无窗口 C++ 核心、上游补丁、原生接口与测试资源。 |
| `apps/desktop/` | React 工作台、Electron main / preload 和 Vite 配置。 |
| `packages/contracts/` | 跨进程契约、参数校验、预设和同步类型。 |
| `packages/desktop-core/` | Node-only 的引擎、文档、编辑、预设、配置和导出服务。 |
| `scripts/` | 源码固定、构建、候选、打包、依赖和样本脚本。 |
| `tests/` | 单元、原生、集成、E2E 和研究探针。 |

内部包使用 `workspace:*`。跨包引用通过领域入口完成，最终由 `build:app` 校验契约版本、原生 ready 版本和 package exports。

## CI

PR 和 `main` 推送执行 Ubuntu JavaScript 快检：冻结安装后运行 `pnpm ci:check`。`v*` 标签或手动触发执行 macOS ARM64 smoke：构建并冻结 candidate，准备 Electron 和固定 RAW，再运行 `macos-smoke` gate。

CI 不构建 DMG、不发布 Release。工作流配置、本地开发构建、安装包和人工可见验收分别判定；远端未实际执行前，不得把配置存在当作通过证据。

## 许可证与社区

项目采用 [GPL-3.0-or-later](../LICENSE)，版权与第三方声明见 [COPYRIGHT](../COPYRIGHT) 和 [THIRD_PARTY.md](../THIRD_PARTY.md)。参与开发前请阅读 [贡献指南](CONTRIBUTING_ZH.md)、[行为准则](../CODE_OF_CONDUCT.md) 和 [安全政策](SECURITY_ZH.md)；维护与决策规则见 [GOVERNANCE_ZH.md](GOVERNANCE_ZH.md)。

完整历史版本记录见 [CHANGELOG.md](../CHANGELOG.md)。当前功能变更应以代码、测试和收尾账本为准。
