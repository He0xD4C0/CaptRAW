# macOS 收尾账本

本页是当前施工与验收的唯一入口。旧对齐矩阵、算法探针和构建记录仅供追溯，不再构成排期或 ACR 同值效果门槛。

固定边界：ART＋本地核心＋Electron/React；允许算法风格不同。优先保证软件色彩链路和摄影工作流；显示设备转换交给系统，不做硬件校准或打印。HDR/AI仅受影响回归，Windows/Linux本轮只整理适配边界。不 commit、不 push。

| 项目 | 当前状态 | 唯一阻挡 | 下一项决定性验证 | 完成条件／证据 |
|---|---|---|---|---|
| A 统一基线 | 已完成 | 无 | 仅后续相关改动触发回归 | [候选cda4985d708663da](../build/candidates/cda4985d708663da/manifest.json)、[集中结果](../build/candidates/cda4985d708663da/checks.json)、对应source.tar.gz；类型检查、91单测、XMP及4项工作流专项通过；未验收身份层已隔离 |
| B 原生文档与导入 | 已完成 | 无 | 仅相关改动触发回归 | [0.65.0-beta.1安装体验候选](../release/0.65.0-beta.1/CaptRAW-0.65.0-beta.1-arm64.dmg)、[统一证据](../release/0.65.0-beta.1/evidence/release.json)、[界面](../release/0.65.0-beta.1/evidence/native-edit.png)；安装版隐藏工作流及断网／禁Homebrew核心通过；对应源码与许可同目录 |
| C 软件色彩链路 | 已完成 | 无 | 仅相关改动触发回归 | [0.66.0-beta.1安装体验候选](../release/0.66.0-beta.1/CaptRAW-0.66.0-beta.1-arm64.dmg)、[统一证据](../release/0.66.0-beta.1/evidence/release.json)、[可见界面](../release/0.66.0-beta.1/evidence/color-experience.png)、[候选结果](../release/0.66.0-beta.1/evidence/checks.json)；无ICC输入选择与资产保存、Display P3半浮点适屏／1:1／对比、目标色域proof、JPEG/TIFF16 ICC均在同一安装版通过；216个固定样本平均ΔE00 0.00965、最大0.06528；不宣称硬件校准 |
| D 摄影工作流收尾 | 已完成 | 无 | 仅后续相关改动触发回归 | [0.66.0-beta.1安装包](https://github.com/He0xD4C0/CaptRAW/releases/tag/v0.66.0-beta.1)、[最终候选结果](../release/0.66.0-beta.1/evidence/checks.json)、[工作流截图](../release/0.66.0-beta.1/evidence/workflow/mask-edit.png)、[性能报告](../release/0.66.0-beta.1/evidence/workflow/performance-smoke.json)；安装版通过两图选择／评分／色标／联动曝光／径向蒙版／批量原生保存／重开／整组取消，以及会话保存恢复、预设与ISO、连续修复、双图TIFF16输出；45MP RAW首帧1.71秒，基础更新最大530.39毫秒；源码、许可和下一轮多平台清单同目录 |

## 原生文档约定

- 新旁车为 `完整原片文件名.captraw`，预设为 `.captrawpreset`，使用有类型和版本的 JSON，不恢复历史旧 JSON 格式。
- 原生旁车优先；只有Adobe旁车时提示导入或默认显影。导入允许外观不同，先列可应用项、未支持项及缺失资产，确认后一步历史提交；源XMP不覆盖。
- 已有CaptRAW XMP按完整引擎参数保真恢复，首次保存转存新格式，原文件保留；停止Adobe标准蒙版写回和自制显影XMP输出。
- 现有图像元数据与ICC仍使用标准表达，独立于原生编辑配方。原片不回写，导出不携带会再次应用的显影配方。

## 色彩与交付约定

- 有可靠源配置就按其导入；无可靠声明时弹窗选择，默认sRGB，保存源空间选择。指定配置不等于转换像素。
- 默认Rec.2020浮点工作域，分别核实各算法计算域。SDR主监看使用声明正确的浮点Display P3，经Electron/macOS完成显示设备转换；不支持时明确受限回退。
- JPEG/TIFF直接从高精度结果转换并嵌入所选ICC，默认相对色度＋黑点补偿；提供现有RGB目标预览，不含打印设备打样。
- B后提供第一份安装体验候选（颜色链路待验），C后再次真实修图体验。最终不宣称完整ACR替代。
- 同时只有一个主施工模块，必要时一个独立研究。组件仅做一次集中回归；后续只重验相关改动或新失败。E2E保持隐藏、不聚焦，以真实控件及实际预览完成信号为准。

## 自动候选清单

`pnpm candidate:build` 冻结当前工作源码（含未跟踪实现）、构建核心/XMP/桌面，并复用macOS打包器收集真实原生依赖，再验证构建输入未改变。成功后输出唯一ID，产物位于 `build/candidates/<id>/`：`manifest.json`、对应 `source.tar.gz`。`latest.json`仅作索引，不能代替ID。

`pnpm candidate:verify <id>` 核对当前构建输入、程序、桌面资源、原生资源和依赖；构建输入或产物改变后拒绝沿用旧候选；JS验证脚本独立记录校验值，避免无关测试新增触发产品重建。

`pnpm candidate:check <id> <检查名> <命令> [参数]` 在检查前后核对同一候选，每项独立记入 `checks/`，避免并行覆盖。整批结束后执行 `pnpm candidate:report <id>` 统一生成 `checks.json`。成功只保留简要结果；失败保留对应日志，修复通过后清理。同ID的检查结果不是新安装包验收。

`tests/suites.json` 是测试层、功能域、依赖、并行和发布 gate 的机器可读入口。`pnpm test:gate <name>` 只接受有效 candidate；直接调试使用 `--dev-unverified` 时不登记为通过。`pnpm candidate:suite <id> <suite>` 会在 suite 前后校验同一候选，并继续记录其他失败。统一 `pnpm build` 通过 Turbo 根任务协调 contracts、原生、XMP 和 UI，最终校验契约与原生处理版本一致。

历史依据：[验收记录](ACCEPTANCE.md)、[既有对齐调查](ACR-PARITY.md)、[下一轮平台边界](PLATFORMS.md)。
